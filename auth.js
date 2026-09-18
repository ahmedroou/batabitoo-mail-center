// Centralized Authentication and Session Management for Batabitoo Mail Center
const crypto = require('crypto');
const { mailDatabase } = require('./database');

// Default master PIN for personal single-user deployment
const MASTER_PIN = String(process.env.MASTER_PIN || process.env.MASTER_PASSWORD || '0530').trim();

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

// Create a new authenticated session in SQLite
function createSession(opts = {}) {
  const options = typeof opts === 'string' ? { userAgent: opts } : (opts || {});
  const userAgent = options.userAgent || '';
  const ip = options.ip || '';
  const maxAgeDays = options.maxAgeDays || 30;
  const token = generateSessionToken();
  const maxAgeSeconds = maxAgeDays * 24 * 3600;
  const session = mailDatabase.createSession(token, maxAgeSeconds, userAgent, ip);
  return session;
}

// Validate session token
function validateSession(token) {
  return mailDatabase.validateSession(token);
}

// Revoke / delete session
function revokeSession(token) {
  return mailDatabase.deleteSession(token);
}

// Authenticate an incoming HTTP request
function authenticateRequest(req, url) {
  // 1. Check Bearer token in Authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (validateSession(token)) return { ok: true, token, method: 'bearer' };
    // Backward compatibility if client passed PIN as bearer
    if (verifyPin(token)) return { ok: true, method: 'legacy_pin_bearer' };
  }

  // 2. Check X-Session-Token header
  const sessionHeader = req.headers['x-session-token'];
  if (sessionHeader && validateSession(sessionHeader.trim())) {
    return { ok: true, token: sessionHeader.trim(), method: 'header' };
  }

  // 3. Check session cookie
  const cookies = parseCookies(req.headers.cookie);
  const sessionCookie = cookies['batabitoo_session'];
  if (sessionCookie && validateSession(sessionCookie)) {
    return { ok: true, token: sessionCookie, method: 'cookie' };
  }

  // 4. Backward compatibility: check X-Master-PIN / X-PIN headers or legacy pin cookie
  const pinHeader = req.headers['x-master-pin'] || req.headers['x-pin'];
  if (pinHeader && verifyPin(pinHeader)) {
    return { ok: true, method: 'legacy_pin_header' };
  }

  const legacyPinCookie = cookies['batabitoo_pin'];
  if (legacyPinCookie && verifyPin(legacyPinCookie)) {
    return { ok: true, method: 'legacy_pin_cookie' };
  }

  // 5. Query parameter token/pin (only for webhooks or direct browser link if explicitly required)
  const queryToken = url.searchParams.get('token');
  if (queryToken && validateSession(queryToken)) {
    return { ok: true, token: queryToken, method: 'query_token' };
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
  revokeSession,
  authenticateRequest
};
