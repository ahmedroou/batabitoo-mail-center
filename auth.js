// Centralized Authentication and Session Management for Batabitoo Mail Center
const crypto = require('crypto');
const { getFirestore } = require('firebase-admin/firestore');

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);
// Local development keeps the historical PIN so the existing test suite and
// offline workflow remain usable. Deployed instances fail closed unless both
// secrets are explicitly provisioned by Firebase Secret Manager.
const MASTER_PIN = String(process.env.MASTER_PIN || process.env.MASTER_PASSWORD || (IS_PRODUCTION ? '' : '0530')).trim();
const SESSION_SECRET = String(process.env.SESSION_SECRET || (IS_PRODUCTION ? '' : `dev-only:${MASTER_PIN}:${process.env.GCLOUD_PROJECT || 'batabitoo-mail-2026'}`));
if (!MASTER_PIN || !SESSION_SECRET) {
  throw new Error('MASTER_PIN and SESSION_SECRET must be configured in production.');
}

// Revocations are bounded by token expiry. This immediately invalidates a
// logged-out token on the serving instance; short-lived sessions reduce the
// cross-instance window without adding a database read to every API request.
const revokedSessions = new Map();
const REVOCATION_COLLECTION = 'mailRevokedSessions';

function pruneRevokedSessions(nowSeconds = Math.floor(Date.now() / 1000)) {
  for (const [tokenHash, expiresAt] of revokedSessions.entries()) {
    if (expiresAt <= nowSeconds) revokedSessions.delete(tokenHash);
  }
}

function sessionHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Parse HTTP cookie header into object
function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const name = parts[0]?.trim();
    if (!name) return;
    const value = parts.slice(1).join('=').trim();
    try {
      list[name] = decodeURIComponent(value);
    } catch (_) {
      list[name] = value;
    }
  });
  return list;
}

// Timing-safe PIN/password verification
function verifyPin(inputPin) {
  if (typeof inputPin !== 'string') return false;
  const cleanInput = inputPin.trim();
  if (!cleanInput) return false;

  const bufInput = Buffer.from(cleanInput, 'utf8');
  const bufExpected = Buffer.from(MASTER_PIN, 'utf8');

  if (bufInput.length !== bufExpected.length) {
    // Constant time dummy comparison to resist timing attacks
    crypto.timingSafeEqual(bufInput, bufInput);
    return false;
  }
  return crypto.timingSafeEqual(bufInput, bufExpected);
}

// Generate cryptographically secure random session token
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function signSessionPayload(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

// Stateless signed sessions keep authentication durable without a local DB read.
function createSession(opts = {}) {
  const options = typeof opts === 'string' ? { userAgent: opts } : (opts || {});
  const userAgent = options.userAgent || '';
  const ip = options.ip || '';
  const maxAgeSeconds = Number(options.maxAgeSeconds) > 0
    ? Math.min(Number(options.maxAgeSeconds), 24 * 3600)
    : Math.min(Number(options.maxAgeDays || 0) * 24 * 3600 || 12 * 3600, 24 * 3600);
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = issuedAt + maxAgeSeconds;
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    iat: issuedAt,
    exp: expiresAtSeconds,
    nonce: generateSessionToken().slice(0, 24),
    ua: crypto.createHash('sha256').update(userAgent).digest('hex').slice(0, 12),
    ip: crypto.createHash('sha256').update(ip).digest('hex').slice(0, 12)
  })).toString('base64url');
  return { token: `${payload}.${signSessionPayload(payload)}`, expiresAt: new Date(expiresAtSeconds * 1000).toISOString() };
}

// Validate session token
function validateSession(token) {
  if (!token || typeof token !== 'string') return false;
  pruneRevokedSessions();
  if (revokedSessions.has(sessionHash(token))) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = signSessionPayload(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return decoded.v === 1 && Number(decoded.exp) > Math.floor(Date.now() / 1000);
  } catch (_) {
    return false;
  }
}

// Revoke / delete session
async function isSessionRevoked(token) {
  const tokenHash = sessionHash(token);
  pruneRevokedSessions();
  if (revokedSessions.has(tokenHash)) return true;
  if (!IS_PRODUCTION) return false;
  try {
    const snapshot = await getFirestore().collection(REVOCATION_COLLECTION).doc(tokenHash).get();
    if (!snapshot.exists) return false;
    const expiresAt = Date.parse(snapshot.data()?.expiresAt || 0);
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      snapshot.ref.delete().catch(() => {});
      return false;
    }
    revokedSessions.set(tokenHash, Math.floor((expiresAt || Date.now() + 24 * 3600_000) / 1000));
    return true;
  } catch (error) {
    // Authentication fails closed if the shared revocation store is unavailable.
    console.error('Session revocation check failed:', error.message);
    return true;
  }
}

async function revokeSession(token) {
  if (!token || typeof token !== 'string') return false;
  const payload = token.split('.')[0];
  let expiresAt = Math.floor(Date.now() / 1000) + 24 * 3600;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (Number.isFinite(Number(decoded.exp))) expiresAt = Number(decoded.exp);
  } catch (_) {}
  pruneRevokedSessions();
  const tokenHash = sessionHash(token);
  revokedSessions.set(tokenHash, expiresAt);
  if (IS_PRODUCTION) {
    await getFirestore().collection(REVOCATION_COLLECTION).doc(tokenHash).set({
      revokedAt: new Date().toISOString(),
      expiresAt: new Date(expiresAt * 1000).toISOString()
    });
  }
  return true;
}

// Authenticate an incoming HTTP request
async function authenticateRequest(req, url) {
  // 1. Check Bearer token in Authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (validateSession(token) && !(await isSessionRevoked(token))) return { ok: true, token, method: 'bearer' };
    // Backward compatibility if client passed PIN as bearer
    if (verifyPin(token)) return { ok: true, method: 'legacy_pin_bearer' };
  }

  // 2. Check X-Session-Token header
  const sessionHeader = req.headers['x-session-token'];
  if (sessionHeader && validateSession(sessionHeader.trim()) && !(await isSessionRevoked(sessionHeader.trim()))) {
    return { ok: true, token: sessionHeader.trim(), method: 'header' };
  }

  // 3. Check session cookie
  const cookies = parseCookies(req.headers.cookie);
  const sessionCookie = cookies['batabitoo_session'];
  if (sessionCookie && validateSession(sessionCookie) && !(await isSessionRevoked(sessionCookie))) {
    return { ok: true, token: sessionCookie, method: 'cookie' };
  }

  // 4. Check token or pin in query parameters (for direct file downloads like attachments)
  const queryToken = url.searchParams.get('token') || url.searchParams.get('session');
  if (queryToken && validateSession(queryToken.trim()) && !(await isSessionRevoked(queryToken.trim()))) {
    return { ok: true, token: queryToken.trim(), method: 'query' };
  }
  const queryPin = url.searchParams.get('pin');
  if (queryPin && verifyPin(queryPin.trim())) {
    return { ok: true, method: 'query_pin' };
  }

  // 5. Backward compatibility: check X-Master-PIN / X-PIN headers or legacy pin cookie
  const pinHeader = req.headers['x-master-pin'] || req.headers['x-pin'];
  if (pinHeader && verifyPin(pinHeader)) {
    return { ok: true, method: 'legacy_pin_header' };
  }

  const legacyPinCookie = cookies['batabitoo_pin'];
  if (legacyPinCookie && verifyPin(legacyPinCookie)) {
    return { ok: true, method: 'legacy_pin_cookie' };
  }

  // 6. Query parameter token/pin (only for webhooks or direct browser link if explicitly required)
  const fallbackQueryToken = url.searchParams.get('token');
  if (fallbackQueryToken && validateSession(fallbackQueryToken) && !(await isSessionRevoked(fallbackQueryToken))) {
    return { ok: true, token: fallbackQueryToken, method: 'query_token' };
  }

  return { ok: false, error: '🔒 الوصول مقفل من السيرفر. يلزم تسجيل الدخول بجلسة صالحة.' };
}

module.exports = {
  MASTER_PIN,
  parseCookies,
  verifyPin,
  generateSessionToken,
  createSession,
  validateSession,
  isSessionRevoked,
  revokeSession,
  authenticateRequest
};
