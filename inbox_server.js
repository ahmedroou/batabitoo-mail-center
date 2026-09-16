const http = require('http');
const fs = require('fs');
const path = require('path');
const RealInboxService = require('./RealInboxService');
const db = require('./InboxDatabase');
const emailParser = require('./EmailParser');
const content = require('./MailContent');

const PORT = Number(process.env.PORT || 3030);
const service = new RealInboxService();
const PUBLIC_DIR = path.join(__dirname, 'public');

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

// Global crash guards to keep the server running 24/7 without dying on network or Firestore hiccups
process.on('uncaughtException', (err) => {
  console.error('⚠️ [Guarded] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [Guarded] Unhandled Rejection:', reason);
});

const ready = cleanupExistingMessages();

const server = http.createServer(async (req, res) => {
  try {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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

    const parseBody = () => {
      return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let oversized = false;
        req.on('data', chunk => {
          if (oversized) return;
          size += chunk.length;
          if (size > 32 * 1024 * 1024) { oversized = true; chunks.length = 0; reject(Object.assign(new Error('Message exceeds 32 MB'), { status: 413 })); return; }
          chunks.push(chunk);
        });
        req.on('end', () => {
          if (oversized) return;
          const buffer = Buffer.concat(chunks);
          if ((req.headers['content-type'] || '').includes('application/json')) {
            try { resolve(JSON.parse(buffer.toString('utf8'))); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
          } else resolve({ rawBase64: buffer.toString('base64') });
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
    // App Version & Update Endpoints
    // ============================================================
    if (url.pathname === '/api/app/version' && req.method === 'GET') {
      const versionInfo = db.getAppVersion();
      return sendJSON(200, versionInfo);
    }

    if (url.pathname === '/api/app/version' && req.method === 'POST') {
      const payload = await parseBody();
      const updated = await db.updateAppVersion(payload);
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
      const isOff = toClean.endsWith('@batabitoo.com');

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
        targetInbox = await db.saveInbox({
          id: `official_${Date.now()}`,
          email: toClean,
          domain: toClean.split('@')[1] || 'batabitoo.com',
          host: isOff ? 'batabitoo.com (Official Trusted)' : 'inboxes.com',
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
    // 2. CREATE OFFICIAL BATABITOO.COM INBOX
    // ============================================================
    if (url.pathname === '/api/official/create' && req.method === 'POST') {
      const payload = await parseBody();
      const rawPrefix = (payload.prefix || '').toLowerCase().replace(/[^a-z0-9\.]/g, '');
      const isExact = payload.exact === true || (rawPrefix.length > 0 && payload.random !== true);
      const prefix = rawPrefix || 'amazon.acc';
      const email = isExact
        ? `${prefix}@batabitoo.com`.toLowerCase()
        : `${prefix}${Math.floor(100 + Math.random() * 900)}@batabitoo.com`.toLowerCase();
      const label = payload.label || payload.personName || `حساب رسمي (${prefix})`;

      const record = await db.saveInbox({
        id: `official_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        email: email,
        domain: 'batabitoo.com',
        host: 'batabitoo.com (Official Trusted)',
        isOfficial: true,
        type: 'official',
        label: label,
        personName: payload.personName || label,
        createdAt: new Date().toISOString(),
        messageCount: 0
      });

      return sendJSON(200, { success: true, inbox: record });
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
      const { id, banStatus, reason } = payload;
      if (!id || !banStatus) return sendJSON(400, { error: 'Missing inbox id or banStatus' });
      const updated = await db.setInboxBanStatus(id, banStatus, reason);
      if (!updated) return sendJSON(404, { error: 'Inbox not found' });
      return sendJSON(200, { success: true, inbox: updated });
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
          const remoteMessages = await service.getMessages(active);
          if (remoteMessages && remoteMessages.length > 0) {
            const cleanedRemote = [];
            for (const m of remoteMessages) {
              const msgId = m.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const existing = db.getAllMessages().find(item => item.id === msgId);
              // List APIs contain snippets, not complete messages. Never replace a fetched body with one.
              cleanedRemote.push({
                ...(existing || { contentComplete: false, bodyStatus: 'pending' }),
                from: emailParser.formatAddress(m.from),
                to: emailParser.formatAddress(m.to) || active.email,
                subject: emailParser.decodeRfc2047(m.subject || existing?.subject || '(بدون عنوان)'),
                intro: existing?.intro || m.intro || '',
                createdAt: m.createdAt || existing?.createdAt,
                id: msgId,
                inboxEmail: active.email,
                isOfficialDomain: false,
                domain: active.domain || 'inboxes.com'
              });
            }
            await db.saveMessages(active.email, cleanedRemote);
          }
        } catch(e) {
          console.error('Remote inbox fetch error:', e.message);
        }
      }

      const localMessages = db.getMessagesForInbox(active.email);
      return sendJSON(200, {
        inbox: active,
        messages: localMessages.map(content.summary)
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
      try {
        const result = await db.saveNiveaSubmission(payload);
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
