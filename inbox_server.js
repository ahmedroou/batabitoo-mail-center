const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const RealInboxService = require('./RealInboxService');
const db = require('./InboxDatabase');
const emailParser = require('./EmailParser');
const content = require('./MailContent');
const gmailSync = require('./GmailSyncService');
const tempSync = require('./TempSyncService');
const niveaWinnerSync = require('./NiveaWinnerSyncWorker');
const auth = require('./auth');
const validators = require('./validators');

process.on('uncaughtException', err => console.error('⚠️ [Uncaught Exception]:', err));
process.on('unhandledRejection', reason => console.error('⚠️ [Unhandled Rejection]:', reason?.message || reason));

const PORT = Number(process.env.PORT || 3030);
const service = new RealInboxService();
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

// OAuth state in-memory cache with 10-minute expiry
const oauthStateCache = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of oauthStateCache.entries()) {
    if (data.expiresAt <= now) oauthStateCache.delete(state);
  }
}, 60000).unref();

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// Clean and sanitize existing messages on server startup using the upgraded EmailParser
async function cleanupExistingMessages() {
  try {
    const all = db.getAllMessages();
    const pending = all.filter(msg => msg.parserVersion !== content.VERSION);
    if (pending.length) {
      const backupDir = path.join(content.ROOT, 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(path.join(backupDir, `messages-${Date.now()}.json`), JSON.stringify(all));
    }
    for (const msg of pending) {
      const source = content.recoverSource(msg);
      const normalized = await content.normalize(source, msg.id, { complete: Boolean(msg.contentComplete) });
      await db.saveMessages(msg.inboxEmail, [{ ...msg, ...normalized }]);
    }
    console.log(`Mail content migration: ${pending.length} records; originals preserved.`);
  } catch (e) {
    console.error('Error during message cleanup:', e.message);
  }
}

const ready = cleanupExistingMessages().then(() => {
  gmailSync.startAll();
  tempSync.startAutoSync(3);
  niveaWinnerSync.startScheduler();
});

const server = http.createServer(async (req, res) => {
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

    const url = new URL(req.url, `http://${req.headers.host}`);

    const sendJSON = (statusCode, data) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };

    // Server-Side PIN / Session Authentication Guard
    if (url.pathname.startsWith('/api/')) {
      const isPublicApi = url.pathname === '/api/health' || 
                          (url.pathname === '/api/app/version' && req.method === 'GET') || 
                          url.pathname === '/api/auth/login' ||
                          url.pathname === '/api/auth/verify-pin';
      if (!isPublicApi) {
        const authResult = auth.authenticateRequest(req, url);
        if (!authResult.ok) {
          console.warn(`🔒 [401 BLOCKED] Unauthorized API access to ${url.pathname} (Host: ${req.headers.host})`);
          return sendJSON(401, {
            error: authResult.error || '🔒 الوصول مقفل من السيرفر. يلزم تسجيل الدخول بجلسة صالحة.',
            code: 'AUTH_REQUIRED'
          });
        }
      }
    }

    // Dynamic body parser: 2MB standard limit, 32MB allowed only for inbound emails
    const parseBody = (maxBytes = (url.pathname === '/api/webhook/email' || url.pathname === '/api/inbound') ? 32 * 1024 * 1024 : 2 * 1024 * 1024) => {
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
          `batabitoo_session=${session.token}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly`,
          `batabitoo_pin=authenticated; Path=/; Max-Age=2592000; SameSite=Lax`
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
      if (token) auth.revokeSession(token);

      res.setHeader('Set-Cookie', [
        `batabitoo_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`,
        `batabitoo_pin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`
      ]);

      return sendJSON(200, { success: true, message: 'تم تسجيل الخروج بنجاح' });
    }

    if (url.pathname === '/api/auth/check' && req.method === 'GET') {
      const authResult = auth.authenticateRequest(req, url);
      return sendJSON(authResult.ok ? 200 : 401, { authenticated: authResult.ok });
    }

    // ============================================================
    // System Status Endpoint
    // ============================================================
    if (url.pathname === '/api/status' && req.method === 'GET') {
      const official = db.getOfficialInboxes();
      const temp = db.getTempInboxes();
      const amazon = db.getAmazonInboxes();
      const banned = db.getBannedInboxes();
      const suspected = db.getSuspectedInboxes();
      const messages = db.getAllMessages();
      const amazonMsgs = db.getAmazonMessages();
      const bannedMsgs = db.getBannedMessages();
      const appVersion = db.getAppVersion();
      return sendJSON(200, {
        status: 'online',
        cloudConnected: db.isCloudConnected,
        projectId: 'batabitoo-mail-2026',
        appVersion: appVersion,
        counts: {
          totalInboxes: official.length + temp.length,
          official: official.length,
          temp: temp.length,
          amazon: amazon.length,
          banned: banned.length,
          suspected: suspected.length,
          messages: messages.length,
          amazonMessages: amazonMsgs.length,
          bannedMessages: bannedMsgs.length
        }
      });
    }

    // ============================================================
    // App Version & Update Endpoints (GET is public, POST requires auth)
    // ============================================================
    if (url.pathname === '/api/app/version' && req.method === 'GET') {
      const versionInfo = db.getAppVersion();
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
      console.log('⚡ Received Inbound Email Webhook');

      const msgId = payload.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const normalized = await content.normalize(payload, msgId, { complete: true });

      const recipient = emailParser.formatAddress(payload.recipient || payload['to-address'] || normalized.to || '');
      const toClean = (recipient.match(/<([^<>]+)>/)?.[1] || recipient.split(',')[0]).toLowerCase().trim();
      if (!/^[^\s<>@]+@[^\s<>@]+$/.test(toClean)) return sendJSON(400, { error: 'Missing or invalid recipient' });
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
          host: isOff ? (dom === 'gmail.com' ? 'Gmail (Google Official)' : 'batabitoo.com (Official Trusted)') : 'inboxes.com',
          label: isOff ? `رسمي (${toClean.split('@')[0]})` : toClean.split('@')[0],
          isOfficial: isOff,
          type: isOff ? 'official' : 'temp',
          createdAt: new Date().toISOString(),
          messageCount: 1
        });
      }

      await db.saveMessages(targetInbox.email, [messageRecord]);
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

      const domain = email.split('@')[1] || targetDomain;
      const isOfficial = email.endsWith('@batabitoo.com') || email.endsWith('@gmail.com');
      const label = payload.label || payload.personName || `حساب رسمي (${email.split('@')[0]})`;

      const record = await db.saveInbox({
        id: `official_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        email: email,
        domain: domain,
        host: domain === 'gmail.com' ? 'Gmail (Google Official)' : 'batabitoo.com (Official Trusted)',
        isOfficial: isOfficial,
        type: isOfficial ? 'official' : 'temp',
        label: label,
        personName: payload.personName || label,
        createdAt: new Date().toISOString(),
        messageCount: 0
      });

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
      const clientId = config.clientId || url.searchParams.get('client_id');
      if (!clientId) {
        return sendJSON(400, { success: false, error: 'Google OAuth Client ID غير مهيأ بعد.' });
      }
      const host = req.headers.host;
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const clientRedirect = url.searchParams.get('redirect_uri');
      const redirectUri = clientRedirect || config.redirectUri || `${protocol}://${host}/api/gmail/oauth/callback`;
      
      const rawReturnTo = url.searchParams.get('return_to') || (host ? `${protocol}://${host}` : 'https://batabitoo-mail-2026.web.app');
      const isAllowedReturn = rawReturnTo.startsWith('/') ||
                              /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.test(rawReturnTo) ||
                              rawReturnTo.startsWith('https://batabitoo-mail-2026.web.app') ||
                              rawReturnTo.startsWith('https://batabitoo-mail-2026.firebaseapp.com');
      const returnTo = isAllowedReturn ? rawReturnTo : 'https://batabitoo-mail-2026.web.app';

      // Generate cryptographically secure random state bound to memory cache (10 min expiry)
      const stateParam = crypto.randomBytes(24).toString('hex');
      oauthStateCache.set(stateParam, {
        returnTo,
        redirectUri,
        expiresAt: Date.now() + 10 * 60 * 1000
      });

      const scopes = encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email');
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scopes}&access_type=offline&prompt=consent&state=${encodeURIComponent(stateParam)}`;
      return sendJSON(200, { success: true, authUrl, redirectUri });
    }

    if (url.pathname === '/api/gmail/oauth/callback' && (req.method === 'GET' || req.method === 'POST')) {
      const payload = req.method === 'POST' ? await parseBody() : {};
      const code = url.searchParams.get('code') || payload.code;
      const errParam = url.searchParams.get('error') || payload.error;
      const stateVal = url.searchParams.get('state') || payload.state || '';
      const isAjax = req.headers.accept?.includes('application/json') || url.searchParams.get('format') === 'json' || req.method === 'POST';

      const stateData = oauthStateCache.get(stateVal);
      if (!stateData && stateVal) {
        if (isAjax) return sendJSON(400, { success: false, error: 'رمز حالة OAuth غير صالح أو منتهي الصلاحية.' });
        res.writeHead(302, { Location: `https://batabitoo-mail-2026.web.app/?gmail_error=${encodeURIComponent('حالة OAuth غير صالحة أو منتهية')}` });
        res.end();
        return;
      }
      if (stateVal) {
        oauthStateCache.delete(stateVal); // Single-use token
      }

      let returnTo = stateData?.returnTo || 'https://batabitoo-mail-2026.web.app';
      let effectiveRedirectUri = stateData?.redirectUri || '';

      const config = gmailSync.getOAuthConfig();
      const host = req.headers.host;
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const redirectUri = payload.redirect_uri || url.searchParams.get('redirect_uri') || effectiveRedirectUri || config.redirectUri || `${protocol}://${host}/api/gmail/oauth/callback`;

      if (errParam) {
        if (isAjax) return sendJSON(400, { success: false, error: errParam });
        res.writeHead(302, { Location: `${returnTo}/?gmail_error=${encodeURIComponent(errParam)}` });
        res.end();
        return;
      }

      if (!code) {
        if (isAjax) return sendJSON(400, { success: false, error: 'رمز المصادقة (code) مفقود.' });
        res.writeHead(302, { Location: `${returnTo}/?gmail_error=${encodeURIComponent('رمز المصادقة مفقود')}` });
        res.end();
        return;
      }

      try {
        console.log(`🔑 [Gmail OAuth] Exchanging code for token with redirect_uri: ${redirectUri}`);
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
          })
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
          const errMsg = tokenData.error_description || tokenData.error || 'فشل الحصول على تصريح جوجل';
          console.error('❌ [Gmail OAuth] Token exchange failed:', tokenData);
          if (isAjax) return sendJSON(400, { success: false, error: errMsg });
          res.writeHead(302, { Location: `${returnTo}/?gmail_error=${encodeURIComponent(errMsg)}` });
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
          personName: userEmail.split('@')[0]
        });

        if (isAjax) {
          return sendJSON(200, { success: true, email: userEmail, inbox: connectRes.inbox });
        }

        res.writeHead(302, { Location: `${returnTo}/?gmail_connected=1&email=${encodeURIComponent(userEmail)}` });
        res.end();
        return;
      } catch (e) {
        console.error('❌ [Gmail OAuth] Callback handler error:', e.message);
        if (isAjax) return sendJSON(400, { success: false, error: e.message });
        res.writeHead(302, { Location: `${returnTo}/?gmail_error=${encodeURIComponent(e.message)}` });
        res.end();
        return;
      }
    }

    if (url.pathname === '/api/gmail/oauth/config' && req.method === 'GET') {
      const conf = gmailSync.getOAuthConfig();
      return sendJSON(200, {
        clientId: conf.clientId,
        hasSecret: Boolean(conf.clientSecret),
        redirectUri: conf.redirectUri
      });
    }

    if (url.pathname === '/api/gmail/oauth/config' && req.method === 'POST') {
      const payload = await parseBody();
      gmailSync.saveOAuthConfig({
        clientId: payload.clientId || '',
        clientSecret: payload.clientSecret || '',
        redirectUri: payload.redirectUri || ''
      });
      return sendJSON(200, { success: true });
    }

    // ============================================================
    // 2.2 POST /api/gmail/oauth/save — Save Gmail account from frontend OAuth
    // Called by the frontend after a successful Google OAuth to persist the account
    // in the local database so it survives page reloads.
    // ============================================================
    if (url.pathname === '/api/gmail/oauth/save' && req.method === 'POST') {
      const payload = await parseBody();
      const cleanEmail = String(payload.email || '').trim().toLowerCase();
      if (!cleanEmail.endsWith('@gmail.com')) {
        return sendJSON(400, { success: false, error: 'Invalid Gmail address' });
      }
      const cleanName = payload.personName || cleanEmail.split('@')[0];
      const docId = payload.docId || `gmail_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`;
      try {
        const inboxRecord = {
          id: docId,
          email: cleanEmail,
          domain: 'gmail.com',
          host: 'Gmail (Google Official Real)',
          isOfficial: true,
          type: 'official',
          label: cleanName,
          personName: cleanName,
          isRealGmail: true,
          gmailAuthType: 'oauth2',
          createdAt: new Date().toISOString(),
          messageCount: 0
        };
        await db.saveInbox(inboxRecord);

        // Also update gmail_connections.json if accessToken provided
        if (payload.accessToken || payload.refreshToken) {
          const accounts = gmailSync.loadAccounts();
          const idx = accounts.findIndex(a => a.email === cleanEmail);
          const accData = {
            email: cleanEmail,
            accessToken: payload.accessToken || null,
            refreshToken: payload.refreshToken || null,
            personName: cleanName,
            authType: 'oauth2',
            connectedAt: new Date().toISOString(),
            lastSyncAt: new Date().toISOString(),
            status: 'connected',
            lastError: null,
            syncedCount: 0
          };
          if (idx >= 0) {
            accounts[idx] = { ...accounts[idx], ...accData };
          } else {
            accounts.push(accData);
          }
          gmailSync.saveAccounts(accounts);
        }

        console.log(`✅ [Gmail Save] Saved Gmail account from OAuth: ${cleanEmail}`);
        return sendJSON(200, { success: true, inbox: inboxRecord });
      } catch (err) {
        console.error('❌ [Gmail Save] Error:', err.message);
        return sendJSON(500, { success: false, error: err.message });
      }
    }

    // ============================================================
    // 3. GET /api/inboxes — List inboxes with Separation & Counts
    // ============================================================
    if (url.pathname === '/api/inboxes' && req.method === 'GET') {
      const filterType = url.searchParams.get('type'); // 'official' | 'temp' | 'amazon' | 'banned' | 'suspected'
      const official = db.getOfficialInboxes();
      const temp = db.getTempInboxes();
      const amazon = db.getAmazonInboxes();
      const banned = db.getBannedInboxes();
      const suspected = db.getSuspectedInboxes();
      const all = db.getAllInboxes();
      const active = db.getActiveInbox();

      let returnedInboxes = all;
      if (filterType === 'official') returnedInboxes = official;
      else if (filterType === 'temp') returnedInboxes = temp;
      else if (filterType === 'amazon') returnedInboxes = amazon;
      else if (filterType === 'banned') returnedInboxes = banned;
      else if (filterType === 'suspected') returnedInboxes = suspected;

      return sendJSON(200, {
        activeId: active ? active.id : null,
        counts: {
          total: all.length,
          official: official.length,
          temp: temp.length,
          amazon: amazon.length,
          banned: banned.length,
          suspected: suspected.length
        },
        official: official,
        temp: temp,
        amazon: amazon,
        banned: banned,
        suspected: suspected,
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
      let active = db.getActiveInbox();
      if (!active) {
        try {
          const created = await service.createInbox('user');
          active = await db.saveInbox({
            id: created.accountId || `inbox_${Date.now()}`,
            email: created.email,
            domain: created.domain,
            provider: created.provider,
            host: created.host,
            password: created.password,
            token: created.token,
            accountId: created.accountId,
            label: 'الحساب 1',
            isOfficial: false,
            type: 'temp',
            createdAt: created.createdAt,
            messageCount: 0
          });
        } catch (err) {
          return sendJSON(500, { error: err.message });
        }
      }

      if (!active.isOfficial) {
        try {
          await tempSync.syncInbox(active);
        } catch(e) {
          console.error('Remote inbox sync error:', e.message);
        }
      }

      const localMessages = db.getMessagesForInbox(active.email);
      return sendJSON(200, {
        inbox: active,
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

      if (target.isOfficial) {
        if (target.email?.endsWith('@gmail.com')) {
          try {
            const res = await gmailSync.syncAccount(target.email);
            return sendJSON(200, res);
          } catch(e) {
            return sendJSON(400, { success: false, error: e.message });
          }
        }
        return sendJSON(200, { success: true, message: 'Official domain batabitoo.com uses real-time webhook' });
      }

      const syncRes = await tempSync.syncInbox(target, { forceFull: true });
      const localMessages = db.getMessagesForInbox(target.email);
      return sendJSON(200, {
        success: true,
        inbox: target,
        sync: syncRes,
        messages: localMessages.map(content.summary)
      });
    }

    if (url.pathname === '/api/inboxes/sync-all' && req.method === 'POST') {
      if (tempSync.isSyncAllRunning) {
        return sendJSON(200, { success: true, running: true, message: 'المزامنة الخلفية جارية بالفعل حالياً.' });
      }
      tempSync.syncAllInboxes({ intervalMs: 2500 }).catch(err => {
        console.error('Bulk sync background error:', err.message);
      });
      return sendJSON(200, { success: true, message: 'تم بدء مزامنة كافة صناديق البريد السريع في الخلفية.' });
    }

    if (url.pathname === '/api/inboxes/sync-status' && req.method === 'GET') {
      return sendJSON(200, tempSync.getStatus());
    }

    if (url.pathname === '/api/messages/winning' && req.method === 'GET') {
      const all = db.getAllMessages();
      const winning = all.filter(m => m.isWinning || tempSync.detectWinningEmail(m.subject, m.text || m.intro, m.from).isWinning);
      return sendJSON(200, {
        success: true,
        count: winning.length,
        messages: winning.map(content.summary)
      });
    }

    // ============================================================
    // 5. POST /api/inboxes/create — Fast Temp Inbox
    // ============================================================
    if (url.pathname === '/api/inboxes/create' && req.method === 'POST') {
      const payload = await parseBody();
      try {
        const prefix = payload.prefix || 'user';
        const label = payload.label || `حساب ${db.getAllInboxes().length + 1}`;

        const created = await service.createInbox(prefix);
        const record = await db.saveInbox({
          id: created.accountId || `inbox_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          email: created.email,
          domain: created.domain,
          provider: created.provider,
          host: created.host,
          password: created.password,
          token: created.token,
          accountId: created.accountId,
          label: label,
          personName: payload.personName || label,
          isOfficial: false,
          type: 'temp',
          createdAt: created.createdAt,
          messageCount: 0
        });

        return sendJSON(200, { success: true, inbox: record });
      } catch(err) {
        return sendJSON(500, { error: err.message });
      }
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
      if (ok) return sendJSON(200, { success: true });
      return sendJSON(404, { error: 'Inbox not found' });
    }

    // ============================================================
    // 10. GET /api/all-messages — Separated Official vs Temp messages
    // ============================================================
    if (url.pathname === '/api/all-messages' && req.method === 'GET') {
      const filterType = url.searchParams.get('type'); // 'official' | 'temp' | 'amazon' | 'banned'
      const official = db.getOfficialMessages();
      const temp = db.getTempMessages();
      const amazon = db.getAmazonMessages();
      const banned = db.getBannedMessages();
      const all = db.getAllMessages();

      let returnedMessages = all;
      if (filterType === 'official') returnedMessages = official;
      else if (filterType === 'temp') returnedMessages = temp;
      else if (filterType === 'amazon') returnedMessages = amazon;
      else if (filterType === 'banned') returnedMessages = banned;

      return sendJSON(200, {
        counts: {
          total: all.length,
          official: official.length,
          temp: temp.length,
          amazon: amazon.length,
          banned: banned.length
        },
        official: official.map(content.summary),
        temp: temp.map(content.summary),
        amazon: amazon.map(content.summary),
        banned: banned.map(content.summary),
        messages: returnedMessages.map(content.summary)
      });
    }

    // ============================================================
    // 11. GET /api/messages/:id
    // ============================================================
    const attachmentRoute = url.pathname.match(/^\/api\/messages\/([^/]+)\/attachments\/([a-f0-9]{64})$/);
    if (attachmentRoute && req.method === 'GET') {
      const message = db.getAllMessages().find(item => item.id === decodeURIComponent(attachmentRoute[1]));
      const file = message && content.attachment(message, attachmentRoute[2]);
      if (!file) return sendJSON(404, { error: 'Attachment not found' });
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': file.content.length, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/'/g, '%27')}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
      return res.end(file.content);
    }
    if (/^\/api\/messages\/[^/]+$/.test(url.pathname) && req.method === 'GET') {
      const msgId = decodeURIComponent(url.pathname.split('/').pop());
      const all = db.getAllMessages();
      const local = all.find(m => m.id === msgId);

      if (local?.contentComplete || (local?.isOfficialDomain && local?.bodyStored)) {
        return sendJSON(200, content.detail(local));
      }

      const active = local ? db.getAllInboxes().find(item => item.email === local.inboxEmail) : null;
      if (active && !active.isOfficial) {
        try {
          const fullMsg = await service.getMessage(active, msgId);
          if (fullMsg) {
            const normalized = await content.normalize(fullMsg, msgId);
            const saved = { ...fullMsg, ...normalized };
            await db.saveMessages(active.email, [saved]);
            return sendJSON(200, content.detail(saved));
          }
        } catch(e) {}
      }
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
});

ready.then(() => server.listen(PORT, () => {
  console.log(`✨ Batabitoo Cloud Mail Center running at http://localhost:${PORT} [Firebase: batabitoo-mail-2026]`);
}));
