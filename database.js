// SQLite Database Layer for Batabitoo Mail Center
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'mail_center.db');

class MailDatabase {
  constructor(dbPath = DB_PATH) {
    this.dbPath = dbPath;
    this.db = new DatabaseSync(this.dbPath);
    this.initPragmas();
    this.initTables();
    this.migrateFromJsonIfNeeded();
  }

  initPragmas() {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA temp_store = MEMORY;');
  }

  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inboxes (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        domain TEXT,
        is_official INTEGER DEFAULT 0,
        is_real_gmail INTEGER DEFAULT 0,
        is_dotted_gmail_alias INTEGER DEFAULT 0,
        type TEXT DEFAULT 'temp',
        message_count INTEGER DEFAULT 0,
        created_at TEXT,
        expires_at TEXT,
        is_banned INTEGER DEFAULT 0,
        ban_status TEXT DEFAULT 'none',
        ban_reason TEXT DEFAULT '',
        ban_decision_source TEXT DEFAULT '',
        ban_decision_at TEXT DEFAULT '',
        is_amazon INTEGER DEFAULT 0,
        password TEXT,
        token TEXT,
        meta TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        inbox_id TEXT,
        inbox_email TEXT NOT NULL,
        sender TEXT,
        recipient TEXT,
        subject TEXT,
        intro TEXT,
        text TEXT,
        html TEXT,
        otp TEXT,
        has_attachments INTEGER DEFAULT 0,
        attachments TEXT,
        is_amazon INTEGER DEFAULT 0,
        is_banned INTEGER DEFAULT 0,
        ban_reason TEXT DEFAULT '',
        created_at TEXT,
        body_status TEXT DEFAULT 'available',
        raw_size INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        user_agent TEXT,
        ip TEXT
      );

      CREATE TABLE IF NOT EXISTS app_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        latest_version_code INTEGER NOT NULL,
        latest_version_name TEXT NOT NULL,
        download_url TEXT NOT NULL,
        sha256 TEXT DEFAULT '',
        release_notes TEXT DEFAULT '',
        mandatory INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oauth_accounts (
        email TEXT PRIMARY KEY,
        auth_type TEXT DEFAULT 'oauth',
        person_name TEXT,
        refresh_token TEXT,
        access_token TEXT,
        expiry_date INTEGER,
        status TEXT DEFAULT 'connected',
        last_error TEXT,
        last_sync_at TEXT,
        connected_at TEXT,
        synced_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS nivea_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        index_num INTEGER,
        person_name TEXT,
        mobile TEXT,
        real_email TEXT,
        city TEXT,
        receipt_number TEXT,
        registered_at TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_inboxes_email ON inboxes(email);
      CREATE INDEX IF NOT EXISTS idx_inboxes_official ON inboxes(is_official, is_amazon, is_banned);
      CREATE INDEX IF NOT EXISTS idx_messages_inbox_id ON messages(inbox_id);
      CREATE INDEX IF NOT EXISTS idx_messages_inbox_email ON messages(inbox_email);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_amazon ON messages(is_amazon);
      CREATE INDEX IF NOT EXISTS idx_messages_banned ON messages(is_banned);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `);
  }

  migrateFromJsonIfNeeded() {
    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM inboxes').get();
    if (countRow && countRow.cnt > 0) return; // Already migrated or populated

    const jsonDbPath = path.join(__dirname, 'inboxes_db.json');
    if (!fs.existsSync(jsonDbPath)) return;

    try {
      console.log('🔄 [SQLite] Migrating existing data from inboxes_db.json into SQLite...');
      const raw = fs.readFileSync(jsonDbPath, 'utf8');
      const data = JSON.parse(raw);
      const inboxes = Array.isArray(data.inboxes) ? data.inboxes : [];
      const messages = Array.isArray(data.messages) ? data.messages : [];

      const insertInbox = this.db.prepare(`
        INSERT OR REPLACE INTO inboxes (
          id, email, domain, is_official, is_real_gmail, is_dotted_gmail_alias,
          type, message_count, created_at, expires_at, is_banned, ban_status,
          ban_reason, ban_decision_source, ban_decision_at, is_amazon, password, token, meta
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?
        )
      `);

      this.db.exec('BEGIN IMMEDIATE TRANSACTION;');
      for (const item of inboxes) {
        if (!item.id || !item.email) continue;
        insertInbox.run(
          String(item.id),
          String(item.email).trim().toLowerCase(),
          item.domain || item.email.split('@')[1] || '',
          item.isOfficial ? 1 : 0,
          item.isRealGmail ? 1 : 0,
          item.isDottedGmailAlias ? 1 : 0,
          item.type || (item.isOfficial ? 'official' : 'temp'),
          Number(item.messageCount || 0),
          item.createdAt || new Date().toISOString(),
          item.expiresAt || null,
          item.isBanned ? 1 : 0,
          item.banStatus || (item.isBanned ? 'confirmed' : 'none'),
          item.banReason || '',
          item.banDecisionSource || '',
          item.banDecisionAt || '',
          item.isAmazon ? 1 : 0,
          item.password || null,
          item.token || null,
          JSON.stringify(item.meta || {})
        );
      }
      this.db.exec('COMMIT;');

      const insertMsg = this.db.prepare(`
        INSERT OR REPLACE INTO messages (
          id, inbox_id, inbox_email, sender, recipient, subject, intro,
          text, html, otp, has_attachments, attachments, is_amazon, is_banned,
          ban_reason, created_at, body_status, raw_size
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?
        )
      `);

      this.db.exec('BEGIN IMMEDIATE TRANSACTION;');
      for (const msg of messages) {
        if (!msg.id) continue;
        insertMsg.run(
          String(msg.id),
          msg.inboxId || null,
          String(msg.inboxEmail || '').toLowerCase(),
          typeof msg.from === 'object' ? (msg.from?.address || msg.from?.text || '') : String(msg.from || ''),
          typeof msg.to === 'object' ? (Array.isArray(msg.to) ? msg.to.map(t => t.address || t).join(', ') : (msg.to?.address || '')) : String(msg.to || ''),
          msg.subject || '',
          msg.intro || '',
          msg.text || '',
          msg.html || '',
          msg.otp || '',
          msg.hasAttachments ? 1 : 0,
          JSON.stringify(msg.attachments || []),
          msg.isAmazon ? 1 : 0,
          msg.isBanned ? 1 : 0,
          msg.banReason || '',
          msg.createdAt || new Date().toISOString(),
          msg.bodyStatus || 'available',
          Number(msg.rawSize || 0)
        );
      }
      this.db.exec('COMMIT;');

      if (data.activeInboxId) {
        this.setSetting('activeInboxId', data.activeInboxId);
      }

      console.log(`✅ [SQLite] Migration complete: ${inboxes.length} inboxes, ${messages.length} messages.`);
    } catch (e) {
      console.error('❌ [SQLite] Migration error:', e.message);
      try { this.db.exec('ROLLBACK;'); } catch (_) {}
    }

    // Migrate Nivea logs if present
    const niveaPath = path.join(__dirname, 'results_nivea_live.json');
    if (fs.existsSync(niveaPath)) {
      try {
        const raw = fs.readFileSync(niveaPath, 'utf8');
        const logs = JSON.parse(raw);
        if (Array.isArray(logs) && logs.length > 0) {
          const insertLog = this.db.prepare(`
            INSERT INTO nivea_logs (index_num, person_name, mobile, real_email, city, receipt_number, registered_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
          this.db.exec('BEGIN IMMEDIATE TRANSACTION;');
          for (const l of logs) {
            insertLog.run(
              l.index || null,
              l.personName || '',
              l.mobile || '',
              l.realEmail || '',
              l.city || '',
              l.receiptNumber || '',
              l.registeredAt || ''
            );
          }
          this.db.exec('COMMIT;');
          console.log(`✅ [SQLite] Migrated ${logs.length} Nivea registration logs.`);
        }
      } catch (e) {
        try { this.db.exec('ROLLBACK;'); } catch (_) {}
      }
    }

    // Initialize App Version from public/version.json if not present
    this.initAppVersion();
  }

  initAppVersion() {
    const row = this.db.prepare('SELECT * FROM app_version WHERE id = 1').get();
    if (row) return;

    let verData = {
      latestVersionCode: 10,
      latestVersionName: '1.4.0',
      downloadUrl: 'https://github.com/ahmedroou/batabitoo-mail-center/releases/download/v1.4.0/Batabitoo-Mail-Center-1.4.0.apk',
      sha256: '',
      releaseNotes: 'إصدار رسمي موحد ومحدث بالكامل لنظام الأمان وقاعدة بيانات SQLite.',
      mandatory: 0,
      updatedAt: new Date().toISOString()
    };

    const verFile = path.join(__dirname, 'public', 'version.json');
    if (fs.existsSync(verFile)) {
      try {
        const f = JSON.parse(fs.readFileSync(verFile, 'utf8'));
        verData.latestVersionCode = f.latestVersionCode || 10;
        verData.latestVersionName = f.latestVersionName || '1.4.0';
        verData.downloadUrl = f.downloadUrl || verData.downloadUrl;
        verData.sha256 = f.sha256 || '';
        verData.releaseNotes = f.releaseNotes || verData.releaseNotes;
        verData.mandatory = f.mandatory ? 1 : 0;
        verData.updatedAt = f.updatedAt || verData.updatedAt;
      } catch (_) {}
    }

    this.db.prepare(`
      INSERT OR REPLACE INTO app_version (
        id, latest_version_code, latest_version_name, download_url, sha256, release_notes, mandatory, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      verData.latestVersionCode,
      verData.latestVersionName,
      verData.downloadUrl,
      verData.sha256,
      verData.releaseNotes,
      verData.mandatory,
      verData.updatedAt
    );
  }

  // --- Inbox Operations ---

  getAllInboxes() {
    const rows = this.db.prepare('SELECT * FROM inboxes ORDER BY created_at DESC').all();
    return rows.map(r => this.rowToInbox(r));
  }

  getOfficialInboxes() {
    const rows = this.db.prepare(`
      SELECT * FROM inboxes 
      WHERE is_official = 1 
         OR email LIKE '%@batabitoo.com' 
         OR email LIKE '%@gmail.com' 
         OR type = 'official'
      ORDER BY created_at DESC
    `).all();
    return rows.map(r => this.rowToInbox(r));
  }

  getTempInboxes() {
    const rows = this.db.prepare(`
      SELECT * FROM inboxes 
      WHERE is_official = 0 
        AND email NOT LIKE '%@batabitoo.com' 
        AND email NOT LIKE '%@gmail.com' 
        AND type != 'official'
      ORDER BY created_at DESC
    `).all();
    return rows.map(r => this.rowToInbox(r));
  }

  getAmazonInboxes() {
    const rows = this.db.prepare(`
      SELECT * FROM inboxes 
      WHERE is_amazon = 1 
         OR is_banned = 1 
         OR ban_status IN ('confirmed', 'suspected')
      ORDER BY created_at DESC
    `).all();
    return rows.map(r => this.rowToInbox(r));
  }

  getBannedInboxes() {
    const rows = this.db.prepare(`
      SELECT * FROM inboxes 
      WHERE is_banned = 1 
         OR ban_status = 'confirmed'
      ORDER BY created_at DESC
    `).all();
    return rows.map(r => this.rowToInbox(r));
  }

  getSuspectedInboxes() {
    const rows = this.db.prepare(`
      SELECT * FROM inboxes 
      WHERE ban_status = 'suspected' 
        AND is_banned = 0
      ORDER BY created_at DESC
    `).all();
    return rows.map(r => this.rowToInbox(r));
  }

  findInboxById(id) {
    if (!id) return null;
    const row = this.db.prepare('SELECT * FROM inboxes WHERE id = ?').get(String(id));
    return row ? this.rowToInbox(row) : null;
  }

  findInboxByEmail(email) {
    if (!email) return null;
    const clean = String(email).trim().toLowerCase();
    const row = this.db.prepare('SELECT * FROM inboxes WHERE email = ?').get(clean);
    return row ? this.rowToInbox(row) : null;
  }

  saveInbox(inbox) {
    if (!inbox || !inbox.id || !inbox.email) return false;
    const cleanEmail = String(inbox.email).trim().toLowerCase();
    const isOff = inbox.isOfficial || cleanEmail.endsWith('@batabitoo.com') || cleanEmail.endsWith('@gmail.com') || inbox.type === 'official';

    const stmt = this.db.prepare(`
      INSERT INTO inboxes (
        id, email, domain, is_official, is_real_gmail, is_dotted_gmail_alias,
        type, message_count, created_at, expires_at, is_banned, ban_status,
        ban_reason, ban_decision_source, ban_decision_at, is_amazon, password, token, meta
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        domain = excluded.domain,
        is_official = excluded.is_official,
        is_real_gmail = excluded.is_real_gmail,
        is_dotted_gmail_alias = excluded.is_dotted_gmail_alias,
        type = excluded.type,
        message_count = excluded.message_count,
        expires_at = excluded.expires_at,
        is_banned = excluded.is_banned,
        ban_status = excluded.ban_status,
        ban_reason = excluded.ban_reason,
        ban_decision_source = excluded.ban_decision_source,
        ban_decision_at = excluded.ban_decision_at,
        is_amazon = excluded.is_amazon,
        password = COALESCE(excluded.password, inboxes.password),
        token = COALESCE(excluded.token, inboxes.token),
        meta = excluded.meta
    `);

    stmt.run(
      String(inbox.id),
      cleanEmail,
      inbox.domain || cleanEmail.split('@')[1] || '',
      isOff ? 1 : 0,
      inbox.isRealGmail ? 1 : 0,
      inbox.isDottedGmailAlias ? 1 : 0,
      inbox.type || (isOff ? 'official' : 'temp'),
      Number(inbox.messageCount || 0),
      inbox.createdAt || new Date().toISOString(),
      inbox.expiresAt || null,
      inbox.isBanned ? 1 : 0,
      inbox.banStatus || (inbox.isBanned ? 'confirmed' : 'none'),
      inbox.banReason || '',
      inbox.banDecisionSource || '',
      inbox.banDecisionAt || '',
      inbox.isAmazon ? 1 : 0,
      inbox.password || null,
      inbox.token || null,
      JSON.stringify(inbox.meta || {})
    );
    return true;
  }

  deleteInbox(id) {
    if (!id) return false;
    this.db.prepare('DELETE FROM messages WHERE inbox_id = ?').run(String(id));
    this.db.prepare('DELETE FROM inboxes WHERE id = ?').run(String(id));
    return true;
  }

  updateInboxBanStatus(id, banStatus, reason = '', source = 'system') {
    if (!id) return false;
    const isBanned = banStatus === 'confirmed' ? 1 : 0;
    const isAmazon = banStatus === 'confirmed' || banStatus === 'suspected' ? 1 : 0;
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE inboxes SET
        ban_status = ?,
        is_banned = ?,
        is_amazon = CASE WHEN ? = 1 THEN 1 ELSE is_amazon END,
        ban_reason = ?,
        ban_decision_source = ?,
        ban_decision_at = ?
      WHERE id = ?
    `).run(banStatus, isBanned, isAmazon, reason, source, now, String(id));

    return true;
  }

  updateInboxAmazonFlag(id, isAmazon = true) {
    if (!id) return false;
    this.db.prepare('UPDATE inboxes SET is_amazon = ? WHERE id = ?').run(isAmazon ? 1 : 0, String(id));
    return true;
  }

  incrementMessageCount(inboxId) {
    if (!inboxId) return;
    this.db.prepare('UPDATE inboxes SET message_count = message_count + 1 WHERE id = ?').run(String(inboxId));
  }

  getActiveInboxId() {
    return this.getSetting('activeInboxId') || null;
  }

  setActiveInboxId(id) {
    this.setSetting('activeInboxId', id || '');
  }

  // --- Message Operations ---

  getAllMessages(limit = 1000) {
    const rows = this.db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map(r => this.rowToMessage(r));
  }

  getMessagesByInbox(inboxId, limit = 500) {
    if (!inboxId) return [];
    const rows = this.db.prepare('SELECT * FROM messages WHERE inbox_id = ? ORDER BY created_at DESC LIMIT ?').all(String(inboxId), limit);
    return rows.map(r => this.rowToMessage(r));
  }

  getMessagesByInboxEmail(email, limit = 500) {
    if (!email) return [];
    const clean = String(email).trim().toLowerCase();
    const rows = this.db.prepare('SELECT * FROM messages WHERE inbox_email = ? ORDER BY created_at DESC LIMIT ?').all(clean, limit);
    return rows.map(r => this.rowToMessage(r));
  }

  getAmazonMessages(limit = 500) {
    const rows = this.db.prepare('SELECT * FROM messages WHERE is_amazon = 1 OR is_banned = 1 ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map(r => this.rowToMessage(r));
  }

  getBannedMessages(limit = 500) {
    const rows = this.db.prepare('SELECT * FROM messages WHERE is_banned = 1 ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map(r => this.rowToMessage(r));
  }

  findMessageById(id) {
    if (!id) return null;
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(String(id));
    return row ? this.rowToMessage(row) : null;
  }

  saveMessage(msg) {
    if (!msg || !msg.id) return false;

    const stmt = this.db.prepare(`
      INSERT INTO messages (
        id, inbox_id, inbox_email, sender, recipient, subject, intro,
        text, html, otp, has_attachments, attachments, is_amazon, is_banned,
        ban_reason, created_at, body_status, raw_size
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        inbox_id = COALESCE(excluded.inbox_id, messages.inbox_id),
        inbox_email = excluded.inbox_email,
        sender = excluded.sender,
        recipient = excluded.recipient,
        subject = excluded.subject,
        intro = excluded.intro,
        text = excluded.text,
        html = excluded.html,
        otp = excluded.otp,
        has_attachments = excluded.has_attachments,
        attachments = excluded.attachments,
        is_amazon = excluded.is_amazon,
        is_banned = excluded.is_banned,
        ban_reason = excluded.ban_reason,
        body_status = excluded.body_status,
        raw_size = excluded.raw_size
    `);

    stmt.run(
      String(msg.id),
      msg.inboxId || null,
      String(msg.inboxEmail || '').toLowerCase(),
      typeof msg.from === 'object' ? (msg.from?.address || msg.from?.text || '') : String(msg.from || ''),
      typeof msg.to === 'object' ? (Array.isArray(msg.to) ? msg.to.map(t => t.address || t).join(', ') : (msg.to?.address || '')) : String(msg.to || ''),
      msg.subject || '',
      msg.intro || '',
      msg.text || '',
      msg.html || '',
      msg.otp || '',
      msg.hasAttachments ? 1 : 0,
      JSON.stringify(msg.attachments || []),
      msg.isAmazon ? 1 : 0,
      msg.isBanned ? 1 : 0,
      msg.banReason || '',
      msg.createdAt || new Date().toISOString(),
      msg.bodyStatus || 'available',
      Number(msg.rawSize || 0)
    );

    if (msg.inboxId) {
      this.incrementMessageCount(msg.inboxId);
    }
    return true;
  }

  deleteMessage(id) {
    if (!id) return false;
    this.db.prepare('DELETE FROM messages WHERE id = ?').run(String(id));
    return true;
  }

  // --- Session Management ---

  createSession(token, maxAgeSeconds = 30 * 24 * 3600, userAgent = '', ip = '') {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + maxAgeSeconds * 1000).toISOString();
    this.db.prepare(`
      INSERT INTO sessions (token, created_at, expires_at, user_agent, ip)
      VALUES (?, ?, ?, ?, ?)
    `).run(token, now.toISOString(), expiresAt, userAgent, ip);
    return { token, expiresAt };
  }

  validateSession(token) {
    if (!token || typeof token !== 'string') return false;
    const now = new Date().toISOString();
    const row = this.db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, now);
    return !!row;
  }

  deleteSession(token) {
    if (!token) return false;
    const res = this.db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token));
    return res.changes > 0;
  }

  cleanupExpiredSessions() {
    const now = new Date().toISOString();
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  }

  // --- App Version ---

  getAppVersion() {
    const row = this.db.prepare('SELECT * FROM app_version WHERE id = 1').get();
    if (!row) {
      return {
        latestVersionCode: 10,
        latestVersionName: '1.4.0',
        downloadUrl: 'https://github.com/ahmedroou/batabitoo-mail-center/releases/download/v1.4.0/Batabitoo-Mail-Center-1.4.0.apk',
        sha256: '',
        releaseNotes: 'الإصدار الموحد لنظام بريد بطابيطو مع SQLite وواجهة آمنة.',
        mandatory: false,
        updatedAt: new Date().toISOString()
      };
    }
    return {
      latestVersionCode: Number(row.latest_version_code),
      latestVersionName: row.latest_version_name,
      downloadUrl: row.download_url,
      sha256: row.sha256 || '',
      releaseNotes: row.release_notes || '',
      mandatory: Boolean(row.mandatory),
      updatedAt: row.updated_at
    };
  }

  updateAppVersion(versionData) {
    const current = this.getAppVersion();
    const updated = {
      latestVersionCode: Number(versionData.latestVersionCode ?? current.latestVersionCode),
      latestVersionName: String(versionData.latestVersionName || current.latestVersionName),
      downloadUrl: String(versionData.downloadUrl || current.downloadUrl),
      sha256: String(versionData.sha256 !== undefined ? versionData.sha256 : current.sha256).trim(),
      releaseNotes: String(versionData.releaseNotes || current.releaseNotes),
      mandatory: versionData.mandatory ? 1 : 0,
      updatedAt: new Date().toISOString()
    };

    this.db.prepare(`
      INSERT OR REPLACE INTO app_version (
        id, latest_version_code, latest_version_name, download_url, sha256, release_notes, mandatory, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      updated.latestVersionCode,
      updated.latestVersionName,
      updated.downloadUrl,
      updated.sha256,
      updated.releaseNotes,
      updated.mandatory,
      updated.updatedAt
    );

    return this.getAppVersion();
  }

  // --- Nivea Logs ---

  logNiveaRegistration(logEntry) {
    const stmt = this.db.prepare(`
      INSERT INTO nivea_logs (index_num, person_name, mobile, real_email, city, receipt_number, registered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      logEntry.index || null,
      logEntry.personName || '',
      logEntry.mobile || '',
      logEntry.realEmail || '',
      logEntry.city || '',
      logEntry.receiptNumber || '',
      logEntry.registeredAt || new Date().toISOString()
    );
    return true;
  }

  getNiveaLogs(limit = 100) {
    return this.db.prepare('SELECT * FROM nivea_logs ORDER BY id DESC LIMIT ?').all(limit);
  }

  // --- Settings Helper ---

  getSetting(key) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(String(key));
    return row ? row.value : null;
  }

  setSetting(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(String(key), String(value));
  }

  // --- Utility mapping helpers ---

  rowToInbox(r) {
    let meta = {};
    try { meta = JSON.parse(r.meta || '{}'); } catch (_) {}
    return {
      id: r.id,
      email: r.email,
      domain: r.domain,
      isOfficial: Boolean(r.is_official),
      isRealGmail: Boolean(r.is_real_gmail),
      isDottedGmailAlias: Boolean(r.is_dotted_gmail_alias),
      type: r.type,
      messageCount: Number(r.message_count || 0),
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      isBanned: Boolean(r.is_banned),
      banStatus: r.ban_status,
      banReason: r.ban_reason || '',
      banDecisionSource: r.ban_decision_source || '',
      banDecisionAt: r.ban_decision_at || '',
      isAmazon: Boolean(r.is_amazon),
      password: r.password || undefined,
      token: r.token || undefined,
      meta
    };
  }

  rowToMessage(r) {
    let attachments = [];
    try { attachments = JSON.parse(r.attachments || '[]'); } catch (_) {}
    return {
      id: r.id,
      inboxId: r.inbox_id,
      inboxEmail: r.inbox_email,
      from: r.sender,
      to: r.recipient,
      subject: r.subject,
      intro: r.intro,
      text: r.text,
      html: r.html,
      otp: r.otp,
      hasAttachments: Boolean(r.has_attachments),
      attachments,
      isAmazon: Boolean(r.is_amazon),
      isBanned: Boolean(r.is_banned),
      banReason: r.ban_reason,
      createdAt: r.created_at,
      bodyStatus: r.body_status,
      rawSize: Number(r.raw_size || 0)
    };
  }

  close() {
    try {
      this.db.close();
    } catch (_) {}
  }
}

const defaultMailDatabase = new MailDatabase();
module.exports = {
  MailDatabase,
  mailDatabase: defaultMailDatabase,
  defaultMailDatabase
};
