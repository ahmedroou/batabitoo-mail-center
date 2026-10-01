const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function fetchRemoteBuffer(url, options = {}, postData = null, redirects = 0) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const allowedHosts = new Set(['inboxes.com', 'getnada.com', 'api.mail.tm', 'api.mail.gw']);
      if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname) || parsed.username || parsed.password || (parsed.port && parsed.port !== '443') || redirects > 3) return resolve(null);
      const reqOpts = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 15000
      };
      if (postData) {
        const bodyStr = typeof postData === 'string' ? postData : JSON.stringify(postData);
        reqOpts.headers = { ...reqOpts.headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) };
      }
      const req = https.request(reqOpts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const target = new URL(res.headers.location, parsed);
          if (target.origin !== parsed.origin && options.headers?.Authorization) return resolve(null);
          return fetchRemoteBuffer(target.href, options, postData, redirects + 1).then(resolve);
        }
        const chunks = [];
        let bytes = 0;
        res.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 32 * 1024 * 1024) { res.destroy(); req.destroy(); resolve(null); return; }
          chunks.push(chunk);
        });
        res.on('error', () => resolve(null));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              buffer: Buffer.concat(chunks),
              contentType: res.headers['content-type'],
              statusCode: res.statusCode
            });
          } else {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      if (postData) {
        req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
      }
      req.end();
    } catch (_) {
      resolve(null);
    }
  });
}

function isPdfTruncated(buf) {
  if (!buf || buf.length < 100) return false;
  if (buf.slice(0, 4).toString() !== '%PDF') return false;
  const tail = buf.slice(-1024).toString('latin1');
  const m = tail.match(/startxref\s+(\d+)\s+%%EOF/);
  if (!m) return true;
  const xrefOffset = parseInt(m[1], 10);
  if (xrefOffset >= buf.length) return true;
  return false;
}

const db = require('./InboxDatabase');
const emailParser = require('./EmailParser');
const content = require('./MailContent');
const gmailSync = require('./GmailSyncService');
const { createMailReply, firestoreReplyStore } = require('./lib/mailReply');
const { mailDatabase } = require('./CloudDatabase');
const niveaWinnerSync = require('./NiveaWinnerSyncWorker');
const auth = require('./auth');
const validators = require('./validators');
const mobileRequestWindows = new Map();
const { eventBus, broadcast } = require('./eventBus');

function detectWinningEmail(subject = '', text = '', from = '') {
  const combined = `${subject} ${text} ${from}`.toLowerCase();
  const keywords = [
    'ربح', 'فوز', 'جائزة', 'مبروك', 'تهانينا', 'كوبون', 'قسيمة',
    'winner', 'won', 'congratulations', 'congrats', 'prize', 'contest', 'giveaway', 'gift card', 'voucher', 'nivea', 'raffle'
  ];
  const matched = keywords.filter(kw => combined.includes(kw));
  return { isWinning: matched.length > 0, matchedKeywords: matched };
}

process.on('uncaughtException', err => console.error('⚠️ [Uncaught Exception]:', err));
process.on('unhandledRejection', reason => console.error('⚠️ [Unhandled Rejection]:', reason?.message || reason));

const PORT = Number(process.env.PORT || 3030);
const PUBLIC_DIR = path.join(__dirname, 'public');

// Allowed Origins Whitelist
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:3030',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3030',
  'http://127.0.0.1:8080',
  'https://batabitoo-mail-2026.web.app',
  'https://batabitoo-mail-2026.firebaseapp.com',
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : [])
]);

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

function sanitizeUrlForLog(rawUrl) {
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    for (const key of ['code', 'state', 'token', 'pin', 'password', 'key']) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, '[REDACTED]');
      }
    }
    return parsed.pathname + (parsed.search ? parsed.search : '');
  } catch (_) {
    return rawUrl.split('?')[0];
  }
}

const DEFAULT_GOOGLE_CLIENT_ID = '13228089590-38ofl0b0j69oqqr1bmr9s6mg0hbdv56n.apps.googleusercontent.com';
const OAUTH_STATE_COLLECTION = 'mailOAuthStates';
const DEFAULT_OAUTH_RETURN_TO = 'https://batabitoo-mail-2026.web.app';
const INBOUND_SIGNATURE_HEADER = 'x-batabitoo-signature';
const INBOUND_TIMESTAMP_HEADER = 'x-batabitoo-timestamp';
const INBOUND_SIGNATURE_MAX_AGE_SECONDS = 300;

function createInboundSignature(secret, timestamp, rawBody) {
  return `v1=${crypto.createHmac('sha256', String(secret)).update(String(timestamp)).update('.').update(rawBody).digest('hex')}`;
}

function verifyInboundSignature(headers, rawBody, secret, nowMs = Date.now()) {
  if (!secret) return { ok: false, status: 503, error: 'Inbound email secret is not configured' };
  const timestamp = String(headers[INBOUND_TIMESTAMP_HEADER] || '').trim();
  const supplied = String(headers[INBOUND_SIGNATURE_HEADER] || '').trim();
  const timestampMs = Number(timestamp) * 1000;
  if (!timestamp || !Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > INBOUND_SIGNATURE_MAX_AGE_SECONDS * 1000) {
    return { ok: false, status: 401, error: 'Expired or invalid inbound timestamp' };
  }
  const expected = createInboundSignature(secret, timestamp, rawBody);
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return { ok: false, status: 401, error: 'Invalid inbound signature' };
  }
  return { ok: true };
}

function safeOAuthReturnTo(rawReturnTo) {
  try {
    const candidate = new URL(rawReturnTo || DEFAULT_OAUTH_RETURN_TO);
    const isLocal = /^https?:$/.test(candidate.protocol) && /^(localhost|127\.0\.0\.1)$/.test(candidate.hostname);
    const isHostedApp = candidate.protocol === 'https:' &&
      (candidate.hostname === 'batabitoo-mail-2026.web.app' || candidate.hostname === 'batabitoo-mail-2026.firebaseapp.com');
    if (!isLocal && !isHostedApp) return DEFAULT_OAUTH_RETURN_TO;
    // The OAuth handoff only needs the app origin. Never preserve an
    // untrusted path, query, or fragment in a redirect target.
    return candidate.origin;
  } catch (_) {
    return DEFAULT_OAUTH_RETURN_TO;
  }
}

function oauthReturnUrl(returnTo, parameter, value) {
  const result = new URL(safeOAuthReturnTo(returnTo));
  result.searchParams.set(parameter, value);
  return result.toString();
}

function createPkcePair() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function createOAuthState(state, data) {
  await mailDatabase.firestore.collection(OAUTH_STATE_COLLECTION).doc(state).set(data);
}

async function consumeOAuthState(state) {
  if (!state) return null;
  const ref = mailDatabase.firestore.collection(OAUTH_STATE_COLLECTION).doc(state);
  return mailDatabase.firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    transaction.delete(ref);
    if (!data?.expiresAt || Date.parse(data.expiresAt) <= Date.now()) return null;
    return data;
  });
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const ready = db.ready().then(async () => {
  if (require.main === module) {
    gmailSync.startAll();
    niveaWinnerSync.startScheduler();
  }
});

const handleRequest = async (req, res) => {
  try {
    const safeUrlLog = sanitizeUrlForLog(req.url);
    console.log(`📥 [REQ] ${req.method} ${safeUrlLog} (Host: ${req.headers.host})`);

    // Strict Whitelisted CORS
    const reqOrigin = req.headers.origin;
    if (reqOrigin && isOriginAllowed(reqOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (!reqOrigin) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Master-PIN, X-Session-Token');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const hostHeader = req.headers.host || req.headers['x-forwarded-host'] || 'batabitoo-mail-2026.web.app';
    const rawPath = req.originalUrl || req.url || '/';
    const url = new URL(rawPath, `https://${hostHeader}`);

    const sendJSON = (statusCode, data) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };

    // Server-Side PIN / Session Authentication Guard
    if (url.pathname.startsWith('/api/')) {
      const isPublicApi = url.pathname === '/api/health' || 
                          url.pathname === '/api/webhook/email' ||
                          url.pathname === '/api/inbound' ||
                          (url.pathname === '/api/app/version' && req.method === 'GET') || 
                          url.pathname === '/api/auth/login' ||
                          url.pathname === '/api/auth/verify-pin' ||
                          url.pathname === '/api/mobile/exchange' ||
                          url.pathname === '/api/mobile/refresh' ||
                          // Google returns to this endpoint without our bearer
                          // header. A cryptographically random, single-use state
                          // stored in Firestore authorizes only that callback.
                          url.pathname === '/api/gmail/oauth/callback';
      if (!isPublicApi) {
        const authResult = await auth.authenticateRequest(req, url);
        if (!authResult.ok) {
          console.warn(`🔒 [401 BLOCKED] Unauthorized API access to ${url.pathname} (Host: ${req.headers.host})`);
          return sendJSON(401, {
            error: authResult.error || '🔒 الوصول مقفل من السيرفر. يلزم تسجيل الدخول بجلسة صالحة.',
            code: 'AUTH_REQUIRED'
          });
        }
        if (mailDatabase.refreshIfChanged) await mailDatabase.refreshIfChanged();
      }
    }

    // Dynamic body parser: 2MB standard limit, 32MB allowed only for inbound emails
    const parseBody = (maxBytes = (url.pathname === '/api/webhook/email' || url.pathname === '/api/inbound') ? 32 * 1024 * 1024 : 2 * 1024 * 1024) => {
      // Firebase Functions exposes the exact incoming bytes on rawBody. This is
      // required for lossless RFC822/MIME parsing and HMAC verification.
      if (Buffer.isBuffer(req.rawBody)) {
        if (req.rawBody.length > maxBytes) {
          return Promise.reject(Object.assign(new Error(`Payload exceeds limit of ${Math.round(maxBytes / (1024 * 1024))} MB`), { status: 413 }));
        }
        if ((req.headers['content-type'] || '').includes('application/json')) {
          try {
            return Promise.resolve(JSON.parse(req.rawBody.toString('utf8')));
          } catch {
            return Promise.reject(Object.assign(new Error('Invalid JSON format'), { status: 400 }));
          }
        }
        return Promise.resolve({ rawBase64: req.rawBody.toString('base64') });
      }

      // If running inside Firebase Functions / Express, req.body is already parsed
      if (req.body !== undefined && req.body !== null) {
        if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
          return Promise.resolve(req.body);
        }
        if (typeof req.body === 'string') {
          try {
            return Promise.resolve(JSON.parse(req.body));
          } catch {
            return Promise.resolve({ rawText: req.body });
          }
        }
        if (Buffer.isBuffer(req.body)) {
          try {
            return Promise.resolve(JSON.parse(req.body.toString('utf8')));
          } catch {
            return Promise.resolve({ rawBase64: req.body.toString('base64') });
          }
        }
      }

      return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let oversized = false;
        req.on('data', chunk => {
          if (oversized) return;
          size += chunk.length;
          if (size > maxBytes) {
            oversized = true;
            chunks.length = 0;
            reject(Object.assign(new Error(`Payload exceeds limit of ${Math.round(maxBytes / (1024 * 1024))} MB`), { status: 413 }));
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => {
          if (oversized) return;
          const buffer = Buffer.concat(chunks);
          if ((req.headers['content-type'] || '').includes('application/json')) {
            try {
              resolve(JSON.parse(buffer.toString('utf8')));
            } catch {
              reject(Object.assign(new Error('Invalid JSON format'), { status: 400 }));
            }
          } else {
            resolve({ rawBase64: buffer.toString('base64') });
          }
        });
        req.on('error', reject);
      });
    };

    if (url.pathname.startsWith('/api/mobile/') && req.method === 'POST') {
      res.setHeader('Cache-Control', 'no-store');
      const body = await parseBody(4096);
      const access = require('./lib/mobileAccess').mobileAccess(require('firebase-admin/firestore').getFirestore(), process.env.SESSION_SECRET || `dev-mobile:${auth.MASTER_PIN}`);
      // Invalid signatures do not touch Firestore or consume legitimate users'
      // renewal quota. This check is stateless and inexpensive.
      if ((url.pathname === '/api/mobile/refresh' && !access.validCredential(body.credential)) ||
          (url.pathname === '/api/mobile/exchange' && !access.validApproval(body.code))) {
        return sendJSON(401, { error: 'اعتماد الجهاز غير صالح.' });
      }
      const now = Date.now();
      // Instance-wide cap cannot be bypassed by forged forwarding/IP headers.
      // maxInstances is also bounded in functions.js. Reject before DB access.
      const window = mobileRequestWindows.get('all');
      if (!window || now - window.start >= 60000) mobileRequestWindows.set('all', { start: now, count: 1 });
      else if (++window.count > 120) {
        res.setHeader('Retry-After', '60');
        return sendJSON(429, { error: 'طلبات اتصال كثيرة. أعد المحاولة بعد دقيقة.' });
      }
      if (url.pathname === '/api/mobile/approve') return sendJSON(200, await access.approve(body.challenge));
      if (url.pathname === '/api/mobile/register') return sendJSON(200, await access.register());
      if (url.pathname === '/api/mobile/exchange') {
        const result = await access.exchange(body.code, body.verifier);
        return sendJSON(200, { ...result, ...auth.createSession() });
      }
      if (url.pathname === '/api/mobile/refresh') {
        await access.refresh(body.credential);
        return sendJSON(200, auth.createSession());
      }
    }

    // Serve the complete PWA from the local server and Cloudflare tunnel.
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const relativePath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const filePath = path.resolve(PUBLIC_DIR, relativePath);
      if (filePath.startsWith(PUBLIC_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600'
        });
        res.end(fs.readFileSync(filePath));
        return;
      }
    }

    // ============================================================
    // Session Authentication Endpoints
    // ============================================================
    if ((url.pathname === '/api/auth/login' || url.pathname === '/api/auth/verify-pin') && req.method === 'POST') {
      const body = await parseBody().catch(() => ({}));
      const val = validators.validateLoginPayload(body);
      if (!val.valid) {
        return sendJSON(400, { success: false, error: val.error });
      }

      if (auth.verifyPin(val.data.pin)) {
        const session = auth.createSession({
          userAgent: req.headers['user-agent'] || '',
          ip: req.socket.remoteAddress || ''
        });

        res.setHeader('Set-Cookie', [
          `batabitoo_session=${session.token}; Path=/; Max-Age=43200; SameSite=Lax; HttpOnly; Secure`,
          `batabitoo_pin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure`
        ]);

        return sendJSON(200, {
          success: true,
          token: session.token,
          message: 'تم تسجيل الدخول بنجاح'
        });
      } else {
        return sendJSON(401, { success: false, error: 'رمز الأمان غير صحيح' });
      }
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const cookies = auth.parseCookies(req.headers.cookie);
      const token = (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null) || cookies['batabitoo_session'];
      if (token) await auth.revokeSession(token);

      res.setHeader('Set-Cookie', [
        `batabitoo_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`,
        `batabitoo_pin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`
      ]);

      return sendJSON(200, { success: true, message: 'تم تسجيل الخروج بنجاح' });
    }

    if (url.pathname === '/api/auth/check' && req.method === 'GET') {
      const authResult = await auth.authenticateRequest(req, url);
      return sendJSON(authResult.ok ? 200 : 401, { authenticated: authResult.ok });
    }

    // ============================================================
    // Server-Sent Events (SSE) Real-Time Stream
    // ============================================================
    if (url.pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write(': connected\n\n');

      const onBroadcast = (payload) => {
        try {
          res.write(`event: ${payload.event}\ndata: ${JSON.stringify(payload.data)}\n\n`);
        } catch (_) {}
      };

      eventBus.on('broadcast', onBroadcast);
      let seenRevision = `${mailDatabase.datasetPath}:${mailDatabase.meta?.revision}:${mailDatabase.meta?.checksum}`;
      let checking = false;
      let closed = false;
      // Catch up after reconnects, including changes made by another instance.
      onBroadcast({ event: 'inbox:updated', data: { cloudRefresh: true } });
      const heartbeat = setInterval(async () => {
        if (checking || closed) return;
        checking = true;
        try {
          await mailDatabase.refreshIfChanged();
          if (closed) return;
          const revision = `${mailDatabase.datasetPath}:${mailDatabase.meta?.revision}:${mailDatabase.meta?.checksum}`;
          if (revision !== seenRevision) {
            seenRevision = revision;
            onBroadcast({ event: 'inbox:updated', data: { cloudRefresh: true } });
          }
          res.write(': ping\n\n');
        } catch (_) {
          // A transient cloud read failure is retried at the next heartbeat.
        } finally { checking = false; }
      }, 15000);

      res.on('close', () => {
        closed = true;
        clearInterval(heartbeat);
        eventBus.removeListener('broadcast', onBroadcast);
      });
      return;
    }

    // ============================================================
    // System Status Endpoint (Instant Single-Query Aggregation)
    // ============================================================
    if (url.pathname === '/api/status' && req.method === 'GET') {
      const counts = db.getStatusCounts();
      const appVersion = db.getAppVersion();
      return sendJSON(200, {
        status: 'online',
        cloudConnected: db.isCloudConnected,
        projectId: 'batabitoo-mail-2026',
        appVersion: appVersion,
        counts: counts
      });
    }

    // ============================================================
    // Health Check Endpoint (Public)
    // ============================================================
    if (url.pathname === '/api/health' && req.method === 'GET') {
      return sendJSON(200, {
        status: 'healthy',
        dataPolicyVersion: '2026-09-30-cost-v2',
        time: new Date().toISOString(),
        cloudConnected: Boolean(db.isCloudConnected)
      });
    }

    // ============================================================
    // App Version & Update Endpoints (GET is public, POST requires auth)
    // ============================================================
    if (url.pathname === '/api/app/version' && req.method === 'GET') {
      const versionInfo = await mailDatabase.getCloudAppVersion();
      return sendJSON(200, versionInfo);
    }

    if (url.pathname === '/api/app/version' && req.method === 'POST') {
      const payload = await parseBody();
      const val = validators.validateAppVersionPayload(payload);
      if (!val.valid) {
        return sendJSON(400, { success: false, error: val.error });
      }
      const updated = await db.updateAppVersion(val.data);
      return sendJSON(200, { success: true, version: updated });
    }

    // ============================================================
    // Storage Quota Protection & Cleanup Endpoints
    // ============================================================
    if (url.pathname === '/api/storage/status' && req.method === 'GET') {
      const stats = db.getStorageStats();
      return sendJSON(200, stats);
    }

    if (url.pathname === '/api/storage/cleanup' && req.method === 'POST') {
      const result = await db.enforceStorageLimits();
      return sendJSON(200, { success: true, ...result });
    }

    // ============================================================
    // Nivea 12-Hour Winner Sync Endpoints
    // ============================================================
    if (url.pathname === '/api/winners-sync/status' && req.method === 'GET') {
      return sendJSON(200, niveaWinnerSync.getStatus());
    }

    if (url.pathname === '/api/winners-sync/trigger' && req.method === 'POST') {
      niveaWinnerSync.runSync().catch(err => console.error('Triggered sync error:', err.message));
      return sendJSON(200, { success: true, message: 'Scan started in background', status: niveaWinnerSync.getStatus() });
    }

    // ============================================================
    // 1. INBOUND WEBHOOK FOR OFFICIAL DOMAIN (batabitoo.com)
    // Smart MIME Parser + Arabic Decoder + Instant OTP Extraction
    // ============================================================
    if ((url.pathname === '/api/webhook/email' || url.pathname === '/api/inbound') && req.method === 'POST') {
      const payload = await parseBody();
      const rawForSignature = payload.rawBase64
        ? Buffer.from(payload.rawBase64, 'base64')
        : Buffer.from(JSON.stringify(payload));
      const signatureCheck = verifyInboundSignature(req.headers, rawForSignature, process.env.INBOUND_EMAIL_SECRET);
      const isCloudRuntime = Boolean(process.env.K_SERVICE || process.env.FUNCTION_TARGET);
      if (!signatureCheck.ok && (isCloudRuntime || process.env.INBOUND_EMAIL_SECRET)) {
        console.warn(`Rejected inbound email: ${signatureCheck.error}`);
        return sendJSON(signatureCheck.status, { success: false, error: signatureCheck.error });
      }
      if (!signatureCheck.ok) {
        console.warn('Inbound signature check skipped only because this is a local runtime without INBOUND_EMAIL_SECRET.');
      }

      // The Email Worker sends original MIME bytes and signed envelope headers.
      if (!payload.recipient && req.headers['x-batabitoo-recipient']) payload.recipient = String(req.headers['x-batabitoo-recipient']);
      if (!payload.sender && req.headers['x-batabitoo-sender']) payload.sender = String(req.headers['x-batabitoo-sender']);
      console.log('⚡ Received Inbound Email Webhook');

      // Content-addressed IDs make retries idempotent and prevent duplicates.
      const rawDigest = payload.rawBase64 ? crypto.createHash('sha256').update(rawForSignature).digest('hex') : '';
      const msgId = payload.id || (rawDigest ? `mail_${rawDigest.slice(0, 48)}` : `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
      const normalized = await content.normalize(payload, msgId, { complete: true });

      const recipient = emailParser.formatAddress(payload.recipient || payload['to-address'] || normalized.to || '');
      const toClean = (recipient.match(/<([^<>]+)>/)?.[1] || recipient.split(',')[0]).toLowerCase().trim();
      if (!/^[^\s<>@]+@[^\s<>@]+$/.test(toClean)) return sendJSON(400, { error: 'Missing or invalid recipient' });
      if (db.getDeletedAmazonAccounts?.().includes(toClean)) {
        console.log(`🗑️ Suppressed inbound email for deleted Amazon account ${toClean}`);
        return sendJSON(202, { success: true, suppressed: true });
      }
      const isOff = toClean.endsWith('@batabitoo.com') || toClean.endsWith('@gmail.com');

      const messageRecord = {
        ...normalized,
        id: msgId,
        to: toClean,
        inboxEmail: toClean,
        isOfficialDomain: isOff,
        domain: toClean.split('@')[1] || 'batabitoo.com',
        createdAt: payload.createdAt || normalized.createdAt || new Date().toISOString()
      };

      // Ensure recipient inbox exists in database
      const allInboxes = db.getAllInboxes();
      let targetInbox = allInboxes.find(i => i.email.toLowerCase() === toClean);
      if (!targetInbox) {
        const dom = toClean.split('@')[1] || 'batabitoo.com';
        targetInbox = await db.saveInbox({
          id: `official_${Date.now()}`,
          email: toClean,
          domain: dom,
          host: dom === 'gmail.com' ? 'Gmail (Google Official)' : 'batabitoo.com (Official Trusted)',
          label: `رسمي (${toClean.split('@')[0]})`,
          isOfficial: true,
          type: 'official',
          createdAt: new Date().toISOString(),
          messageCount: 1
        });
      }

      await db.saveMessages(targetInbox.email, [messageRecord]);
      broadcast('message:new', { inboxEmail: toClean, message: content.summary(messageRecord) });
      broadcast('status:counts', db.getStatusCounts());
      if (db.isOfficialInbox(targetInbox)) {
        if (!targetInbox.isBanned && (db.isBannedMessage(messageRecord) || db.isBannedInbox(targetInbox))) {
          targetInbox.isBanned = true;
          targetInbox.isAmazon = true;
          targetInbox.banReason = db.getBanReason(messageRecord);
          targetInbox.bannedDetectedAt = new Date().toISOString();
          await db.saveInbox(targetInbox);
        } else if (!targetInbox.isAmazon && (db.isAmazonMessage(messageRecord) || db.isAmazonInbox(targetInbox))) {
          targetInbox.isAmazon = true;
          targetInbox.amazonDetectedAt = new Date().toISOString();
          await db.saveInbox(targetInbox);
        }
      }
      console.log(`✅ Stored decoded message for ${toClean} | Subject: "${messageRecord.subject}" | OTP: ${messageRecord.otp || 'N/A'} (Cloud Synced)`);

      return sendJSON(200, { success: true, messageId: messageRecord.id, otp: messageRecord.otp, subject: messageRecord.subject });
    }

    // ============================================================
    // 2. CREATE OFFICIAL INBOX (@batabitoo.com or @gmail.com)
    // ============================================================
    if (url.pathname === '/api/official/create' && req.method === 'POST') {
      const payload = await parseBody();
      const reqDomain = (payload.domain || 'batabitoo.com').toLowerCase().trim();
      const targetDomain = reqDomain.includes('gmail') ? 'gmail.com' : 'batabitoo.com';
      const rawInput = (payload.email || payload.prefix || '').toLowerCase().trim();

      let email = '';
      if (rawInput.includes('@')) {
        email = rawInput;
      } else {
        const rawPrefix = rawInput.replace(/[^a-z0-9\.]/g, '') || 'amazon.acc';
        const isExact = payload.exact === true || (rawPrefix.length > 0 && payload.random !== true);
        email = isExact
          ? `${rawPrefix}@${targetDomain}`.toLowerCase()
          : `${rawPrefix}${Math.floor(100 + Math.random() * 900)}@${targetDomain}`.toLowerCase();
      }

      const val = validators.validateOfficialCreatePayload({
        email,
        password: payload.password,
        label: payload.label,
        personName: payload.personName
      });
      if (!val.valid) {
        return sendJSON(400, { success: false, error: val.error });
      }
      if (db.getDeletedAmazonAccounts?.().includes(val.data.email)) {
        return sendJSON(409, {
          success: false,
          error: 'الحساب محذوف عمداً. استخدم الاستعادة أولاً قبل إنشائه مجدداً.'
        });
      }

      const domain = val.data.email.split('@')[1] || targetDomain;
      const isOfficial = val.data.email.endsWith('@batabitoo.com') || val.data.email.endsWith('@gmail.com');
      if (!isOfficial) {
        return sendJSON(400, { success: false, error: 'يتم دعم الحسابات الرسمية فقط (@batabitoo.com أو @gmail.com)' });
      }

      // Alias discovery can repeat after every refresh. Reuse the existing
      // account without resetting its creation date/count or broadcasting a
      // fake creation event (which previously caused another discovery pass).
      const existingOfficial = db.findInboxByEmail(val.data.email);
      if (existingOfficial) {
        const needsAliasUpgrade = payload.isDottedGmailAlias === true && !existingOfficial.isDottedGmailAlias;
        const needsAmazonUpgrade = payload.isAmazon === true && !existingOfficial.isAmazon;
        if (needsAliasUpgrade || needsAmazonUpgrade) {
          const upgraded = await db.saveInbox({
            ...existingOfficial,
            isAmazon: existingOfficial.isAmazon || payload.isAmazon === true,
            isDottedGmailAlias: existingOfficial.isDottedGmailAlias || payload.isDottedGmailAlias === true,
            parentEmail: existingOfficial.parentEmail || payload.parentEmail || null,
          });
          broadcast('inbox:updated', upgraded);
          return sendJSON(200, { success: true, inbox: upgraded, reused: true });
        }
        return sendJSON(200, { success: true, inbox: existingOfficial, reused: true });
      }

      const record = await db.saveInbox({
        id: `official_${crypto.createHash('sha256').update(val.data.email).digest('hex').slice(0, 20)}`,
        email: val.data.email,
        domain: domain,
        host: domain === 'gmail.com' ? 'Gmail (Google Official)' : 'batabitoo.com (Official Trusted)',
        isOfficial: true,
        type: 'official',
        label: val.data.label,
        personName: val.data.personName,
        createdAt: new Date().toISOString(),
        messageCount: 0,
        isAmazon: Boolean(payload.isAmazon),
        isDottedGmailAlias: Boolean(payload.isDottedGmailAlias),
        parentEmail: payload.parentEmail || null
      });

      broadcast('inbox:new', record);
      broadcast('status:counts', db.getStatusCounts());
      return sendJSON(200, { success: true, inbox: record });
    }

    // ============================================================
    // 2.1 REAL GMAIL LIVE SYNC & CONNECTION ENDPOINTS
    // ============================================================
    if (url.pathname === '/api/gmail/connect-app-password' && req.method === 'POST') {
      const payload = await parseBody();
      try {
        const result = await gmailSync.connectAppPassword(payload);
        return sendJSON(200, result);
      } catch (err) {
        return sendJSON(400, { success: false, error: err.message });
      }
    }

    if (url.pathname === '/api/gmail/accounts' && req.method === 'GET') {
      const accounts = gmailSync.getAccounts();
      return sendJSON(200, { success: true, accounts });
    }

    if (url.pathname === '/api/gmail/sync' && req.method === 'POST') {
      const payload = await parseBody();
      try {
        const result = await gmailSync.syncAccount(payload.email);
        return sendJSON(200, result);
      } catch (err) {
        return sendJSON(400, { success: false, error: err.message });
      }
    }

    if (url.pathname === '/api/gmail/disconnect' && req.method === 'POST') {
      const payload = await parseBody();
      try {
        const result = await gmailSync.disconnect(payload.email);
        return sendJSON(200, result);
      } catch (err) {
        return sendJSON(400, { success: false, error: err.message });
      }
    }

    if (url.pathname === '/api/gmail/oauth/auth-url' && req.method === 'GET') {
      const config = gmailSync.getOAuthConfig();
      const clientId = config.clientId || process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;
      if (!clientId) {
        return sendJSON(400, { success: false, error: 'Google OAuth Client ID غير مهيأ بعد.' });
      }
      if (!config.clientSecret && !process.env.GOOGLE_CLIENT_SECRET) {
        return sendJSON(409, {
          success: false,
          code: 'OAUTH_SERVER_CONFIG_REQUIRED',
          error: 'يلزم حفظ Google OAuth Client Secret مرة واحدة في إعدادات الخادم لإبقاء Gmail متصلاً تلقائياً بعد انتهاء صلاحية رمز الدخول.'
        });
      }
      const host = req.headers.host;
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const redirectUri = config.redirectUri || `${protocol}://${host}/api/gmail/oauth/callback`;
      
      const rawReturnTo = url.searchParams.get('return_to') || (host ? `${protocol}://${host}` : DEFAULT_OAUTH_RETURN_TO);
      const returnTo = safeOAuthReturnTo(rawReturnTo);

      // Persist one-time OAuth state in Firestore. This survives a server
      // restart and lets Google return without a browser bearer token.
      const stateParam = crypto.randomBytes(24).toString('hex');
      const pkce = createPkcePair();
      await createOAuthState(stateParam, {
        returnTo,
        redirectUri,
        codeVerifier: pkce.verifier,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString()
      });

      const scopes = encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email');
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scopes}&access_type=offline&prompt=consent&code_challenge=${encodeURIComponent(pkce.challenge)}&code_challenge_method=S256&state=${encodeURIComponent(stateParam)}`;
      return sendJSON(200, { success: true, authUrl, redirectUri });
    }

    if (url.pathname === '/api/gmail/oauth/callback' && (req.method === 'GET' || req.method === 'POST')) {
      const payload = req.method === 'POST' ? await parseBody() : {};
      const code = url.searchParams.get('code') || payload.code;
      const errParam = url.searchParams.get('error') || payload.error;
      const stateVal = url.searchParams.get('state') || payload.state || '';
      const isAjax = req.headers.accept?.includes('application/json') || url.searchParams.get('format') === 'json' || req.method === 'POST';

      const stateData = await consumeOAuthState(stateVal);
      if (!stateData) {
        if (isAjax) return sendJSON(400, { success: false, error: 'رمز حالة OAuth غير صالح أو منتهي الصلاحية.' });
        res.writeHead(302, { Location: oauthReturnUrl(DEFAULT_OAUTH_RETURN_TO, 'gmail_error', 'حالة OAuth غير صالحة أو منتهية') });
        res.end();
        return;
      }

      let returnTo = safeOAuthReturnTo(stateData?.returnTo);
      let effectiveRedirectUri = stateData?.redirectUri || '';

      const config = gmailSync.getOAuthConfig();
      const host = req.headers.host;
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const redirectUri = effectiveRedirectUri || config.redirectUri || `${protocol}://${host}/api/gmail/oauth/callback`;

      if (errParam) {
        if (isAjax) return sendJSON(400, { success: false, error: errParam });
        res.writeHead(302, { Location: oauthReturnUrl(returnTo, 'gmail_error', errParam) });
        res.end();
        return;
      }

      if (!code) {
        if (isAjax) return sendJSON(400, { success: false, error: 'رمز المصادقة (code) مفقود.' });
        res.writeHead(302, { Location: oauthReturnUrl(returnTo, 'gmail_error', 'رمز المصادقة مفقود') });
        res.end();
        return;
      }

      try {
        console.log(`🔑 [Gmail OAuth] Exchanging code for token with redirect_uri: ${redirectUri}`);
        const tokenRequest = new URLSearchParams({
          code,
          client_id: config.clientId || process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID,
          redirect_uri: redirectUri,
          code_verifier: stateData.codeVerifier,
          grant_type: 'authorization_code'
        });
        const clientSecret = config.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
        if (clientSecret) tokenRequest.set('client_secret', clientSecret);
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: tokenRequest
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
          const errMsg = tokenData.error_description || tokenData.error || 'فشل الحصول على تصريح جوجل';
          console.error('❌ [Gmail OAuth] Token exchange failed:', tokenData);
          if (isAjax) return sendJSON(400, { success: false, error: errMsg });
          res.writeHead(302, { Location: oauthReturnUrl(returnTo, 'gmail_error', errMsg) });
          res.end();
          return;
        }

        const userRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();
        const userEmail = userData.emailAddress;

        if (!userEmail) {
          throw new Error('تعذر قراءة عنوان البريد الإلكتروني من حساب Google');
        }

        console.log(`✅ [Gmail OAuth] Successfully verified account: ${userEmail}`);
        const connectRes = await gmailSync.connectOAuth({
          email: userEmail,
          refreshToken: tokenData.refresh_token,
          accessToken: tokenData.access_token,
          scopes: tokenData.scope || '',
          expiryDate: new Date(Date.now() + Number(tokenData.expires_in || 3600) * 1000).toISOString(),
          personName: userEmail.split('@')[0]
        });

        if (isAjax) {
          return sendJSON(200, { success: true, email: userEmail, inbox: connectRes.inbox, newCount: connectRes.newCount, syncWarning: connectRes.syncWarning });
        }

        const callbackUrl = new URL(oauthReturnUrl(returnTo, 'gmail_connected', '1'));
        callbackUrl.searchParams.set('email', userEmail);
        callbackUrl.searchParams.set('new_count', String(connectRes.newCount || 0));
        if (connectRes.syncWarning) callbackUrl.searchParams.set('gmail_warning', connectRes.syncWarning);
        res.writeHead(302, { Location: callbackUrl.toString() });
        res.end();
        return;
      } catch (e) {
        console.error('❌ [Gmail OAuth] Callback handler error:', e.message);
        if (isAjax) return sendJSON(400, { success: false, error: e.message });
        res.writeHead(302, { Location: oauthReturnUrl(returnTo, 'gmail_error', e.message) });
        res.end();
        return;
      }
    }

    if (url.pathname === '/api/gmail/oauth/config' && req.method === 'GET') {
      const conf = gmailSync.getOAuthConfig();
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const host = req.headers.host;
      return sendJSON(200, {
        clientId: conf.clientId || process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID,
        hasSecret: Boolean(conf.clientSecret),
        redirectUri: conf.redirectUri || `${protocol}://${host}/api/gmail/oauth/callback`
      });
    }

    if (url.pathname === '/api/gmail/oauth/config' && req.method === 'POST') {
      const payload = await parseBody();
      const existing = gmailSync.getOAuthConfig();
      await gmailSync.saveOAuthConfig({
        clientId: payload.clientId || existing.clientId || DEFAULT_GOOGLE_CLIENT_ID,
        // An empty password field means "keep the stored secret", not erase it.
        clientSecret: payload.clientSecret || existing.clientSecret || '',
        redirectUri: payload.redirectUri || existing.redirectUri || ''
      });
      return sendJSON(200, { success: true });
    }

    // Legacy browser-token endpoint. Do not accept a short-lived access token:
    // it caused a false "connected" state followed by an hourly disconnect.
    if (url.pathname === '/api/gmail/oauth/save' && req.method === 'POST') {
      const payload = await parseBody();
      const cleanEmail = String(payload.email || '').trim().toLowerCase();
      if (!cleanEmail.endsWith('@gmail.com')) {
        return sendJSON(400, { success: false, error: 'Invalid Gmail address' });
      }
      try {
        if (!payload.refreshToken) {
          return sendJSON(409, {
            success: false,
            code: 'RENEWABLE_OAUTH_REQUIRED',
            error: 'لا يمكن حفظ رمز Gmail قصير العمر. استخدم زر ربط Google ليتم حفظ رمز التجديد الدائم في الخادم.'
          });
        }
        const result = await gmailSync.connectOAuth({
          email: cleanEmail,
          refreshToken: payload.refreshToken,
          accessToken: payload.accessToken || null,
          personName: payload.personName || cleanEmail.split('@')[0]
        });
        return sendJSON(200, result);
      } catch (err) {
        console.error('❌ [Gmail Save] Error:', err.message);
        return sendJSON(500, { success: false, error: err.message });
      }
    }

    // ============================================================
    // 3. GET /api/inboxes — List inboxes with Separation & Counts
    // ============================================================
    if (url.pathname === '/api/inboxes' && req.method === 'GET') {
      const filterType = url.searchParams.get('type'); // 'official' | 'amazon' | 'banned' | 'suspected'
      const official = db.getOfficialInboxes();
      const amazon = db.getAmazonInboxes();
      const banned = db.getBannedInboxes();
      const suspected = db.getSuspectedInboxes();
      const all = official;
      const active = db.getActiveInbox();

      let returnedInboxes = all;
      if (filterType === 'official') returnedInboxes = official;
      else if (filterType === 'temp') returnedInboxes = [];
      else if (filterType === 'amazon') returnedInboxes = amazon;
      else if (filterType === 'banned') returnedInboxes = banned;
      else if (filterType === 'suspected') returnedInboxes = suspected;

      return sendJSON(200, {
        activeId: active ? active.id : (official[0]?.id || null),
        counts: {
          total: official.length,
          official: official.length,
          temp: 0,
          amazon: amazon.length,
          banned: banned.length,
          suspected: suspected.length
        },
        official: official,
        temp: [],
        amazon: amazon,
        banned: banned,
        suspected: suspected,
        deletedAmazon: db.getDeletedAmazonAccounts ? db.getDeletedAmazonAccounts() : [],
        inboxes: returnedInboxes
      });
    }

    // ============================================================
    // POST /api/inbox/ban-status — User confirm / dismiss ban
    // ============================================================
    if (url.pathname === '/api/inbox/ban-status' && req.method === 'POST') {
      const payload = await parseBody();
      const targetId = payload?.id || payload?.inboxId || payload?.email;
      const status = payload?.banStatus || payload?.status || (payload?.verdict === 'reject' ? 'safe' : 'confirmed');
      const reason = payload?.reason || '';
      const val = validators.validateBanStatusPayload({ inboxId: targetId, status, reason });
      if (!val.valid) return sendJSON(400, { success: false, error: val.error });
      const updated = await db.setInboxBanStatus(val.data.inboxId, val.data.status, val.data.reason);
      broadcast('inbox:updated', updated);
      broadcast('status:counts', db.getStatusCounts());
      return sendJSON(200, { success: true, inbox: updated });
    }

    // ============================================================
    // POST /api/inbox/ai-verify — AI auto-verify suspected ban
    // ============================================================
    if (url.pathname === '/api/inbox/ai-verify' && req.method === 'POST') {
      const payload = await parseBody();
      if (!payload?.id) return sendJSON(400, { error: 'Missing inbox id' });
      const result = await db.aiVerifyInbox(payload.id);
      if (!result) return sendJSON(404, { error: 'Inbox not found' });
      return sendJSON(200, result);
    }

    // ============================================================
    // POST /api/ai/feedback — Submit AI feedback for training & rules
    // ============================================================
    if (url.pathname === '/api/ai/feedback' && req.method === 'POST') {
      const payload = await parseBody();
      if (!payload?.inboxId || !payload?.verdict) {
        return sendJSON(400, { error: 'Missing inboxId or verdict' });
      }
      const entry = await db.saveAiFeedback(payload);
      return sendJSON(200, { success: true, entry });
    }

    // ============================================================
    // GET /api/ai/feedback — Get all feedback training logs
    // ============================================================
    if (url.pathname === '/api/ai/feedback' && req.method === 'GET') {
      const logs = db.getAiFeedbackLogs();
      return sendJSON(200, { success: true, logs });
    }

    // ============================================================
    // GET /api/ai/status — Check Gemini AI availability
    // ============================================================
    if (url.pathname === '/api/ai/status' && req.method === 'GET') {
      try {
        const { defaultGemini } = require('./GeminiAI');
        const testResult = await defaultGemini.classifyAmazonEmail({
          subject: 'test ping',
          text: 'test ping',
          from: 'test@test.com'
        });
        return sendJSON(200, { ready: true, model: testResult.model, latencyMs: testResult.latencyMs });
      } catch (e) {
        return sendJSON(200, { ready: false, error: e.message });
      }
    }

    // ============================================================
    // 4. GET /api/inbox/current — Active inbox + messages
    // ============================================================
    if (url.pathname === '/api/inbox/current' && req.method === 'GET') {
      const queryEmail = url.searchParams.get('email');
      const queryId = url.searchParams.get('id');
      let target = null;
      if (queryEmail) {
        const cleanEmail = queryEmail.toLowerCase().trim();
        target = (db.findInboxByEmail ? db.findInboxByEmail(cleanEmail) : null) ||
                 db.getAllInboxes().find(i => (i.email || '').toLowerCase().trim() === cleanEmail);
      }
      if (!target && queryId) {
        target = (db.findInboxById ? db.findInboxById(queryId) : null) ||
                 db.getAllInboxes().find(i => i.id === queryId);
      }

      if (!target && !queryEmail && !queryId) {
        target = db.getActiveInbox() || db.getOfficialInboxes()[0] || null;
      }

      if (!target) {
        return sendJSON(404, { success: false, error: 'Inbox not found', inbox: null, messages: [] });
      }

      // Fast read from the disposable Firestore snapshot; sync continues in background.
      const localMessages = db.getMessagesForInbox(target.email);
      return sendJSON(200, {
        success: true,
        inbox: target,
        messages: localMessages.map(content.summary)
      });
    }

    // ============================================================
    // 4.1 REMOTE TEMP MAIL SYNC & WINNING ENDPOINTS
    // ============================================================
    if (url.pathname === '/api/inbox/sync' && req.method === 'POST') {
      const payload = await parseBody().catch(() => ({}));
      const allInboxes = db.getAllInboxes();
      let target = null;
      if (payload?.id || payload?.email) {
        target = allInboxes.find(i => (i.id === (payload.id || payload.email)) || (i.email?.toLowerCase() === (payload.email || payload.id)?.toLowerCase()));
      }
      if (!target) {
        target = db.getActiveInbox();
      }
      if (!target) {
        return sendJSON(404, { success: false, error: 'No active inbox to sync' });
      }

      if (target.email?.endsWith('@gmail.com')) {
        try {
          const res = await gmailSync.syncAccount(target.email);
          return sendJSON(200, res);
        } catch(e) {
          return sendJSON(400, { success: false, error: e.message });
        }
      }
      const localMessages = db.getMessagesForInbox(target.email);
      return sendJSON(200, {
        success: true,
        inbox: target,
        sync: { newCount: 0, checkedAt: new Date().toISOString() },
        messages: localMessages.map(content.summary)
      });
    }

    if (url.pathname === '/api/inboxes/sync-all' && req.method === 'POST') {
      const accounts = gmailSync.getAccounts().filter(a => a.status !== 'auth_expired');
      for (const account of accounts) {
        gmailSync.syncAccount(account.email).catch(e => console.error('Gmail sync-all error:', e.message));
      }
      return sendJSON(200, { success: true, message: 'جاري مزامنة حسابات البريد الرسمية في الخلفية.' });
    }

    if (url.pathname === '/api/inboxes/sync-status' && req.method === 'GET') {
      return sendJSON(200, { isRunning: false, activeInboxes: 0, lastSync: new Date().toISOString() });
    }

    if (url.pathname === '/api/messages/winning' && req.method === 'GET') {
      const all = db.getAllMessages();
      const winning = all.filter(m => m.isWinning || detectWinningEmail(m.subject, m.text || m.intro, m.from).isWinning);
      return sendJSON(200, {
        success: true,
        count: winning.length,
        messages: winning.map(content.summary)
      });
    }

    // ============================================================
    // 5. POST /api/inboxes/create — Disabled (Official Mail Only)
    // ============================================================
    if (url.pathname === '/api/inboxes/create' && req.method === 'POST') {
      return sendJSON(400, {
        success: false,
        error: 'تم إيقاف البريد السريع المؤقت بالكامل. يتم دعم الحسابات الرسمية فقط (@batabitoo.com و Gmail).'
      });
    }

    // ============================================================
    // 6. POST /api/nivea/log-registration
    // ============================================================
    if (url.pathname === '/api/nivea/log-registration' && req.method === 'POST') {
      const payload = await parseBody();
      const val = validators.validateNiveaLogPayload(payload);
      if (!val.valid) return sendJSON(400, { success: false, error: val.error });
      try {
        const result = await db.saveNiveaSubmission(val.data);
        return sendJSON(200, { success: true, entry: result.entry, total: result.total });
      } catch(err) {
        return sendJSON(500, { error: err.message });
      }
    }

    // ============================================================
    // 7. GET /api/nivea/logs
    // ============================================================
    if (url.pathname === '/api/nivea/logs' && req.method === 'GET') {
      const logs = db.getNiveaLogs();
      return sendJSON(200, logs);
    }

    // ============================================================
    // 8. POST /api/inboxes/select
    // ============================================================
    if (url.pathname === '/api/inboxes/select' && req.method === 'POST') {
      const payload = await parseBody();
      if (!payload.id) return sendJSON(400, { error: 'Missing inbox id' });
      const ok = db.setActiveInbox(payload.id);
      if (ok) {
        return sendJSON(200, { success: true, active: db.getActiveInbox() });
      }
      return sendJSON(404, { error: 'Inbox not found' });
    }

    // ============================================================
    // 9. DELETE /api/inboxes/:id — Remove inbox and its messages
    // ============================================================
    if (url.pathname.startsWith('/api/inboxes/') && req.method === 'DELETE') {
      const inboxId = decodeURIComponent(url.pathname.split('/').pop());
      if (!inboxId) return sendJSON(400, { error: 'Missing inbox id' });
      const ok = await db.deleteInbox(inboxId);
      if (ok) {
        broadcast('inbox:deleted', { id: inboxId });
        broadcast('status:counts', db.getStatusCounts());
        return sendJSON(200, { success: true });
      }
      return sendJSON(404, { error: 'Inbox not found' });
    }

    if (url.pathname === '/api/inboxes/batch-delete' && req.method === 'POST') {
      const payload = await parseBody();
      const ids = Array.isArray(payload.ids) ? payload.ids : [];
      if (!ids.length) return sendJSON(400, { error: 'Missing inbox ids' });
      const count = await db.deleteInboxes(ids);
      for (const id of ids) {
        broadcast('inbox:deleted', { id });
      }
      broadcast('status:counts', db.getStatusCounts());
      return sendJSON(200, { success: true, count });
    }

    // ============================================================
    // 9.01 AMAZON ACCOUNT MANAGEMENT: DELETE & RESTORE
    // ============================================================
    if (url.pathname === '/api/amazon/deleted' && req.method === 'GET') {
      const deleted = db.getDeletedAmazonAccounts ? db.getDeletedAmazonAccounts() : [];
      return sendJSON(200, { success: true, deleted });
    }

    if (url.pathname === '/api/amazon/delete' && req.method === 'POST') {
      const payload = await parseBody();
      const rawEmail = payload?.email || payload?.id;
      if (!rawEmail) return sendJSON(400, { success: false, error: 'Missing email or id' });
      const cleanEmail = String(rawEmail).toLowerCase().trim();

      const allInboxes = db.getAllInboxes();
      const targetInbox = allInboxes.find(i => (i.id === rawEmail) || (i.email && i.email.toLowerCase().trim() === cleanEmail));
      if (targetInbox) {
        await db.deleteInbox(targetInbox.id);
        broadcast('inbox:deleted', { id: targetInbox.id });
      }

      if (db.deleteMessagesForEmail) {
        await db.deleteMessagesForEmail(cleanEmail);
      }

      if (db.addDeletedAmazonAccount) {
        await db.addDeletedAmazonAccount(cleanEmail);
      }

      broadcast('amazon:deleted', { email: cleanEmail });
      broadcast('status:counts', db.getStatusCounts());
      return sendJSON(200, { success: true, email: cleanEmail });
    }

    if (url.pathname === '/api/amazon/restore' && req.method === 'POST') {
      const payload = await parseBody();
      const rawEmail = payload?.email;
      if (!rawEmail) return sendJSON(400, { success: false, error: 'Missing email' });
      const cleanEmail = String(rawEmail).toLowerCase().trim();

      if (db.removeDeletedAmazonAccount) {
        await db.removeDeletedAmazonAccount(cleanEmail);
      }

      const allInboxes = db.getAllInboxes();
      const exists = allInboxes.some(i => i.email && i.email.toLowerCase().trim() === cleanEmail);
      if (!exists && db.saveInbox) {
        const isBatabitoo = cleanEmail.endsWith('@batabitoo.com');
        const isGmail = cleanEmail.endsWith('@gmail.com');
        const prefix = cleanEmail.split('@')[0] || 'amazon';
        await db.saveInbox({
          email: cleanEmail,
          personName: prefix,
          label: prefix,
          isOfficial: isBatabitoo || isGmail,
          isAmazon: true,
          type: isBatabitoo || isGmail ? 'official' : 'temp'
        });
      }

      broadcast('amazon:restored', { email: cleanEmail });
      broadcast('status:counts', db.getStatusCounts());
      return sendJSON(200, { success: true, email: cleanEmail });
    }

    // ============================================================
    // 9.1 GET /api/messages — Inbox-filtered or general messages
    // ============================================================
    if (url.pathname === '/api/messages' && req.method === 'GET') {
      const inboxEmail = url.searchParams.get('inboxEmail');
      const inboxId = url.searchParams.get('inboxId') || url.searchParams.get('id');
      let target = null;
      if (inboxEmail) {
        const clean = inboxEmail.toLowerCase().trim();
        target = (db.findInboxByEmail ? db.findInboxByEmail(clean) : null) ||
                 db.getAllInboxes().find(i => (i.email || '').toLowerCase().trim() === clean);
      }
      if (!target && inboxId) {
        target = (db.findInboxById ? db.findInboxById(inboxId) : null) ||
                 db.getAllInboxes().find(i => i.id === inboxId);
      }
      const messages = target
        ? db.getMessagesForInbox(target.email)
        : (inboxEmail ? db.getMessagesForInbox(inboxEmail) : db.getAllMessages());
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const sliced = messages.slice(0, limit);
      return sendJSON(200, {
        success: true,
        inbox: target,
        count: sliced.length,
        messages: sliced.map(content.summary)
      });
    }

    // ============================================================
    // 10. GET /api/all-messages — Separated Official vs Temp messages
    // ============================================================
    if (url.pathname === '/api/all-messages' && req.method === 'GET') {
      const filterType = url.searchParams.get('type'); // 'official' | 'amazon' | 'banned'
      const official = db.getOfficialMessages();
      const amazon = db.getAmazonMessages();
      const banned = db.getBannedMessages();
      const all = official;

      let returnedMessages = all;
      if (filterType === 'official') returnedMessages = official;
      else if (filterType === 'temp') returnedMessages = [];
      else if (filterType === 'amazon') returnedMessages = amazon;
      else if (filterType === 'banned') returnedMessages = banned;

      return sendJSON(200, {
        counts: {
          total: official.length,
          official: official.length,
          temp: 0,
          amazon: amazon.length,
          banned: banned.length
        },
        official: official.map(content.summary),
        temp: [],
        amazon: amazon.map(content.summary),
        banned: banned.map(content.summary),
        messages: returnedMessages.map(content.summary)
      });
    }

    // ============================================================
    // 11. GET /api/messages/:id
    // ============================================================
    const replyRoute = url.pathname.match(/^\/api\/messages\/([^/]+)\/reply$/);
    if (replyRoute && ['GET', 'POST'].includes(req.method)) {
      const msgId = decodeURIComponent(replyRoute[1]);
      const message = (db.findMessageById ? db.findMessageById(msgId) : null) || db.getAllMessages().find(item => item.id === msgId);
      if (!message) return sendJSON(404, { error: 'الرسالة غير موجودة' });
      try {
        const reply = createMailReply({ gmail: gmailSync, store: firestoreReplyStore(mailDatabase.firestore) });
        const result = req.method === 'GET' ? await reply.context(message) : await reply.send(message, await parseBody(128 * 1024));
        return sendJSON(200, result);
      } catch (error) {
        return sendJSON(error.status || 502, { success: false, error: error.message, code: error.code || 'REPLY_FAILED' });
      }
    }
    const attachmentRoute = url.pathname.match(/^\/api\/messages\/([^/]+)\/attachments\/([^/]+)$/);
    if (attachmentRoute && req.method === 'GET') {
      const msgId = decodeURIComponent(attachmentRoute[1]);
      const attId = decodeURIComponent(attachmentRoute[2]);
      const message = (db.findMessageById ? db.findMessageById(msgId) : null) || db.getAllMessages().find(item => item.id === msgId);
      if (!message) return sendJSON(404, { error: 'Message not found' });

      let file = await content.attachment(message, attId);
      let contentBuffer = file?.content || null;
      let meta = file || (message.attachments || []).find(item => String(item.id) === attId || item.filename === attId);
      if (!meta) return sendJSON(404, { error: 'Attachment not found' });

      // Automatically detect and discard truncated/corrupted PDF buffers
      if (contentBuffer && isPdfTruncated(contentBuffer)) {
        console.warn(`⚠️ Attachment ${attId} is truncated (${contentBuffer.length} bytes). Fetching complete copy from source...`);
        contentBuffer = null;
      }

      // If content buffer is not yet available, try fetching remotely
      if (!contentBuffer && meta) {
        // Option 1: Direct inboxes.com / getnada.com download
        if (meta.downloadUrl && meta.downloadUrl.startsWith('http')) {
          const res = await fetchRemoteBuffer(meta.downloadUrl);
          if (res?.buffer && !isPdfTruncated(res.buffer)) contentBuffer = res.buffer;
        } else if (meta.id && meta.filename && (!meta.downloadUrl || !meta.downloadUrl.startsWith('/messages/'))) {
          const inboxesUrl = `https://inboxes.com/api/v2/message/at/download/${meta.id}/${encodeURIComponent(meta.filename)}`;
          const res = await fetchRemoteBuffer(inboxesUrl);
          if (res?.buffer && !isPdfTruncated(res.buffer)) contentBuffer = res.buffer;
        }

        // Option 2: mail.tm / mail.gw download
        if (!contentBuffer && meta.downloadUrl && meta.downloadUrl.startsWith('/messages/')) {
          const recipientEmail = message.inboxEmail || message.to;
          const inbox = (db.findInboxByEmail ? db.findInboxByEmail(recipientEmail) : null) || db.getAllInboxes().find(i => i.email === recipientEmail);
          const domain = (recipientEmail || '').split('@')[1];
          const host = (domain === 'emalupe.com') ? 'api.mail.tm' : 'api.mail.gw';
          const password = inbox?.password;
          try {
            if (!password) throw new Error('Mailbox credential missing');
            const tokenRes = await fetchRemoteBuffer(`https://${host}/token`, { method: 'POST' }, {
              address: recipientEmail,
              password: password
            });
            if (tokenRes?.buffer) {
              const tokenData = JSON.parse(tokenRes.buffer.toString());
              if (tokenData?.token) {
                const dlRes = await fetchRemoteBuffer(`https://${host}${meta.downloadUrl}`, {
                  headers: { Authorization: `Bearer ${tokenData.token}` }
                });
                if (dlRes?.buffer && !isPdfTruncated(dlRes.buffer)) {
                  contentBuffer = dlRes.buffer;
                  if (meta.storagePath) {
                    try {
                      const { getStorage } = require('firebase-admin/storage');
                      getStorage().bucket().file(meta.storagePath).save(contentBuffer).catch(() => {});
                    } catch (_) {}
                  }
                }
              }
            }
          } catch (_) {}
        }
      }

      if (!contentBuffer) {
        return sendJSON(404, { error: 'Attachment file not found or expired on provider' });
      }

      const filename = meta?.filename || (meta?.contentType === 'application/pdf' ? 'ticket.pdf' : 'attachment');
      const declaredType = String(meta?.contentType || file?.contentType || '').trim().toLowerCase();
      const isPdf = declaredType.includes('pdf') || filename.toLowerCase().endsWith('.pdf') || (contentBuffer.length >= 4 && contentBuffer.slice(0, 4).toString() === '%PDF');
      const safeInlineRasterTypes = new Set([
        'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'
      ]);
      const mayRenderInline = meta?.inline === true && safeInlineRasterTypes.has(declaredType);
      const attachmentContentType = isPdf ? 'application/pdf' : (mayRenderInline ? declaredType : 'application/octet-stream');
      const disposition = (mayRenderInline || isPdf) ? 'inline' : 'attachment';

      const attachmentHeaders = {
        'Content-Type': attachmentContentType,
        'Content-Length': contentBuffer.length,
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(filename).replace(/'/g, '%27')}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': isPdf ? "default-src 'self' 'unsafe-inline' data: blob:;" : "default-src 'none'; sandbox",
        'Cache-Control': 'private, no-store'
      };
      if (meta?.cid) attachmentHeaders['Content-ID'] = `<${String(meta.cid).replace(/^<|>$/g, '')}>`;
      res.writeHead(200, attachmentHeaders);
      return res.end(contentBuffer);
    }
    if (/^\/api\/messages\/[^/]+$/.test(url.pathname) && req.method === 'GET') {
      const msgId = decodeURIComponent(url.pathname.split('/').pop());
      const local = (db.findMessageById ? db.findMessageById(msgId) : null) || db.getAllMessages().find(m => m.id === msgId);

      // Fast path: message already has renderable content (html or text)
      if (local && (local.html || local.text)) {
        return sendJSON(200, content.detail(local));
      }

      // Legacy flag check for backward compatibility
      if (local?.contentComplete || (local?.isOfficialDomain && local?.bodyStored)) {
        return sendJSON(200, content.detail(local));
      }

      // Return local message
      if (local) return sendJSON(200, content.detail(local));
      return sendJSON(404, { error: 'Message not found' });
    }

    return sendJSON(404, { error: 'Not found' });
  } catch (serverErr) {
    console.error('⚠️ [Server Error Handled]:', serverErr.message);
    if (!res.headersSent) {
      res.writeHead(serverErr.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: serverErr.status ? serverErr.message : 'Internal server error' }));
    }
  }
};

const server = http.createServer(handleRequest);

if (require.main === module) {
  ready.then(() => server.listen(PORT, () => {
    console.log(`✨ Batabitoo Cloud Mail Center running at http://localhost:${PORT} [Firebase: batabitoo-mail-2026]`);
  }));
}

module.exports = {
  handleRequest,
  ready,
  server,
  safeOAuthReturnTo,
  oauthReturnUrl,
  createInboundSignature,
  verifyInboundSignature
};
