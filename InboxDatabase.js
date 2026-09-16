const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const content = require('./MailContent');
const { defaultGemini } = require('./GeminiAI');

const DB_FILE = process.env.MAIL_DB_FILE || path.join(__dirname, 'inboxes_db.json');
const NIVEA_FILE = path.join(__dirname, 'results_nivea_live.json');
const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'serviceAccountKey.json');

const EXCLUDED_FIRESTORE_FIELDS = new Set([
  'raw',
  'rawBase64',
  'contentBase64',
  'content',
  'originalRaw'
]);

function sanitizeForFirestore(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clean = {};
  for (const key of Object.keys(obj)) {
    if (EXCLUDED_FIRESTORE_FIELDS.has(key)) continue;
    const val = obj[key];
    if (val === undefined) {
      clean[key] = null;
    } else if (typeof val === 'string') {
      clean[key] = val.length > 32000 ? val.slice(0, 32000) : val;
    } else if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      clean[key] = sanitizeForFirestore(val);
    } else if (Array.isArray(val)) {
      clean[key] = val.map(item => typeof item === 'object' ? sanitizeForFirestore(item) : item);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

class InboxDatabase {
  constructor() {
    this.db = null;
    this.isCloudConnected = false;
    this.initFirebase();
    this.initLocal();
    this.scanAndClassifyAmazonInboxes().catch(() => {});
    this.enforceStorageLimits().catch(() => {});
    if (typeof setInterval !== 'undefined') {
      // 10-minute passive Amazon classification scan
      const TEN_MINUTES_MS = 10 * 60 * 1000;
      this.amazonScanInterval = setInterval(() => {
        this.scanAndClassifyAmazonInboxes().catch(() => {});
      }, TEN_MINUTES_MS);
      if (this.amazonScanInterval.unref) this.amazonScanInterval.unref();

      // 6-hour automatic storage quota & retention maintenance
      const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
      this.storageCleanupInterval = setInterval(() => {
        this.enforceStorageLimits().catch(() => {});
      }, SIX_HOURS_MS);
      if (this.storageCleanupInterval.unref) this.storageCleanupInterval.unref();
    }
  }

  initFirebase() {
    if (process.env.MAIL_OFFLINE === '1') return;
    try {
      if (fs.existsSync(SERVICE_ACCOUNT_FILE)) {
        const serviceAccount = require(SERVICE_ACCOUNT_FILE);
        const app = initializeApp({
          credential: cert(serviceAccount),
          projectId: 'batabitoo-mail-2026'
        }, 'batabitoo-app-' + Date.now());
        this.db = getFirestore(app);
        this.db.settings({ ignoreUndefinedProperties: true });
        this.isCloudConnected = true;
        console.log('☁️ Firebase Cloud Firestore connected successfully! (Project: batabitoo-mail-2026)');
        this.syncVersionFromFirestore().catch(() => {});
      } else {
        console.warn('⚠️ serviceAccountKey.json not found. Operating in local-only fallback mode.');
      }
    } catch (err) {
      console.error('⚠️ Firebase initialization error:', err.message);
      this.isCloudConnected = false;
    }
  }

  initLocal() {
    if (!fs.existsSync(DB_FILE)) {
      const initialData = {
        activeInboxId: null,
        inboxes: [],
        messages: []
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    }
  }

  readLocal() {
    try {
      if (!fs.existsSync(DB_FILE)) this.initLocal();
      const content = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      console.error('Error reading local DB:', err.message);
      return { activeInboxId: null, inboxes: [], messages: [] };
    }
  }

  writeLocal(data) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('Error writing local DB:', err.message);
      return false;
    }
  }

  // Get all inboxes
  getAllInboxes() {
    const data = this.readLocal();
    return data.inboxes || [];
  }

  // Get Official inboxes (@batabitoo.com)
  getOfficialInboxes() {
    const inboxes = this.getAllInboxes();
    return inboxes.filter(i => i.isOfficial === true || (i.email && i.email.toLowerCase().endsWith('@batabitoo.com')) || i.type === 'official');
  }

  // Get Temporary/Random inboxes
  getTempInboxes() {
    const inboxes = this.getAllInboxes();
    return inboxes.filter(i => !(i.isOfficial === true || (i.email && i.email.toLowerCase().endsWith('@batabitoo.com')) || i.type === 'official'));
  }

  isOfficialInbox(inbox) {
    if (!inbox) return false;
    const email = String(inbox.email || '').toLowerCase().trim();
    return inbox.isOfficial === true || inbox.type === 'official' || email.endsWith('@batabitoo.com') || inbox.domain === 'batabitoo.com';
  }

  // Amazon detection helpers (Official inboxes only, O(1) skip for classified accounts)
  isAmazonMessage(msg) {
    if (!msg) return false;
    if (msg.isAmazon === true || msg.isBanned === true) return true;
    const textToCheck = [
      msg.from,
      msg.to,
      msg.subject,
      msg.intro,
      msg.text,
      msg.inboxEmail
    ].filter(Boolean).join(' ').toLowerCase();

    return /amazon|أمازون|امازون|إمازون|amazon\.sa|amazon\.com|amazon\.ae|amazon\.co\.uk|amazon\.de|ofm@|cis@/i.test(textToCheck);
  }

  // Banned / Restricted Amazon Accounts Detection (Strict Content-based, NEVER sender-only)
  isBannedMessage(msg) {
    if (!msg) return false;
    if (msg.isBanned === true) return true;

    const data = this.readLocal();
    const ignored = data.ignoredBanPatterns || [];
    const subj = String(msg.subject || '').toLowerCase().trim();
    if (subj && ignored.some(p => subj.includes(p))) {
      return false;
    }

    // Normal notifications with OTP are verification codes, not account closures
    const textToCheck = [
      msg.subject,
      msg.intro,
      msg.text
    ].filter(Boolean).join(' ').toLowerCase();

    // 1. Digital purchases only restriction phrases
    const hasDigitalRestriction = /المشتريات الرقمية فقط|يقتصر على المشتريات الرقمية|قصرنا حسابك على المشتريات الرقمية|مشتريات رقمية فقط|digital purchases only|digital orders only|غير الرقمية|انتهاكات متعددة لسياسة المرتجعات|انتهاكات متكررة لشروط الاستخدام/i.test(textToCheck);

    // 2. Account closure / termination / ban phrases
    const hasAccountClosure = /أغلقنا هذا الحساب|اغلقنا هذا الحساب|تم إغلاق حسابك|تم اغلاق حسابك|تم حظر حسابك|تم تعليق حسابك|حسابك (?:معلق|محظور|مغلق)|إنهاء الحسابات|انهاء الحسابات|رفض الخدمة|إنهاء استخدام خدمات أمازون|انهاء استخدام خدمات امازون|closed this account|account has been closed|account closure|terminate your account|terminated your account|refuse service, terminate accounts|account (?:is|was|has been)?\s*(?:suspended|locked|on hold|closed)/i.test(textToCheck);

    return hasDigitalRestriction || hasAccountClosure;
  }

  getBanReason(msg) {
    if (!msg) return "حساب مقيد / محظور";
    const textToCheck = [msg.subject, msg.intro, msg.text].filter(Boolean).join(' ').toLowerCase();
    if (/المشتريات الرقمية|مشتريات رقمية|digital purchases/i.test(textToCheck)) {
      return "مشتريات رقمية فقط";
    }
    if (/أغلقنا هذا الحساب|تم إغلاق|closed this account|إنهاء الحسابات|terminate/i.test(textToCheck)) {
      return "إغلاق وحظر الحساب";
    }
    return "حساب مقيد / محظور";
  }

  isAmazonInbox(inbox, allMessages = null) {
    if (!inbox) return false;
    // Strictly Official inboxes only!
    if (!this.isOfficialInbox(inbox)) return false;

    // Fast path: if already classified as Amazon or Banned, return true
    if (inbox.isAmazon === true || inbox.isBanned === true || inbox.banStatus === 'confirmed' || inbox.banStatus === 'suspected') return true;

    // Check metadata for unclassified official inboxes
    const meta = [inbox.email, inbox.label, inbox.personName].filter(Boolean).join(' ').toLowerCase();
    if (/amazon|أمازون|امازون|إمازون/i.test(meta)) return true;

    // Check incoming messages for this official inbox
    const messages = allMessages || this.getAllMessages();
    const inboxEmail = String(inbox.email || '').toLowerCase().trim();
    return messages.some(m => String(m.inboxEmail || '').toLowerCase().trim() === inboxEmail && this.isAmazonMessage(m));
  }

  isBannedInbox(inbox) {
    if (!inbox) return false;
    if (!this.isOfficialInbox(inbox)) return false;
    // An inbox is strictly considered banned ONLY if confirmed by user or explicitly marked
    return inbox.banStatus === 'confirmed' || inbox.isBanned === true;
  }

  isSuspectedInbox(inbox, allMessages = null) {
    if (!inbox) return false;
    if (!this.isOfficialInbox(inbox)) return false;
    if (inbox.banStatus === 'safe') return false; // User confirmed healthy
    if (inbox.banStatus === 'confirmed' || inbox.isBanned === true) return false; // Already confirmed banned
    if (inbox.banStatus === 'suspected') return true;

    // Check if any message contains genuine ban restriction phrases
    const messages = allMessages || this.getAllMessages();
    const inboxEmail = String(inbox.email || '').toLowerCase().trim();
    return messages.some(m => String(m.inboxEmail || '').toLowerCase().trim() === inboxEmail && this.isBannedMessage(m));
  }

  // Periodic incremental scan: classifies Amazon and detects Suspected bans
  async scanAndClassifyAmazonInboxes() {
    const data = this.readLocal();
    const inboxes = data.inboxes || [];
    const messages = data.messages || [];

    let updatedCount = 0;
    const newlyClassified = [];

    for (const inbox of inboxes) {
      if (!this.isOfficialInbox(inbox)) continue;

      let changed = false;
      // Suspected Ban detection (does NOT automatically confirm ban!)
      if (inbox.banStatus !== 'safe' && inbox.banStatus !== 'confirmed' && !inbox.isBanned) {
        if (this.isSuspectedInbox(inbox, messages)) {
          inbox.banStatus = 'suspected';
          inbox.isAmazon = true;
          const matchingMsg = messages.find(m => String(m.inboxEmail || '').toLowerCase().trim() === String(inbox.email || '').toLowerCase().trim() && this.isBannedMessage(m));
          inbox.banReason = this.getBanReason(matchingMsg);
          inbox.bannedDetectedAt = inbox.bannedDetectedAt || new Date().toISOString();
          changed = true;

          // Asynchronously trigger AI evaluation
          setTimeout(() => {
            this.aiVerifyInbox(inbox.id).catch(err => {
              console.warn(`[Auto-AI Verify] Check failed for ${inbox.email}:`, err.message);
            });
          }, 100);
        }
      }

      if (!inbox.isAmazon && this.isAmazonInbox(inbox, messages)) {
        inbox.isAmazon = true;
        inbox.amazonDetectedAt = inbox.amazonDetectedAt || new Date().toISOString();
        changed = true;
      }

      if (changed) {
        newlyClassified.push(inbox);
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      this.writeLocal(data);
      if (this.isCloudConnected && this.db) {
        try {
          const batch = this.db.batch();
          for (const inbox of newlyClassified) {
            const inboxRef = this.db.collection('inboxes').doc(inbox.id);
            batch.set(inboxRef, sanitizeForFirestore({
              isAmazon: inbox.isAmazon,
              isBanned: inbox.isBanned === true,
              banStatus: inbox.banStatus || 'none',
              banReason: inbox.banReason || null,
              bannedDetectedAt: inbox.bannedDetectedAt || null,
              amazonDetectedAt: inbox.amazonDetectedAt || null
            }), { merge: true });
          }
          await batch.commit();
        } catch (e) {
          console.error('⚠️ Firestore batch classification error:', e.message);
        }
      }
    }

    return updatedCount;
  }

  getAmazonInboxes() {
    const official = this.getOfficialInboxes();
    const messages = this.getAllMessages();
    return official.filter(i => {
      if (i.isAmazon === true || i.isBanned === true) return true;
      return this.isAmazonInbox(i, messages);
    });
  }

  getBannedInboxes() {
    const official = this.getOfficialInboxes();
    return official.filter(i => i.isBanned === true || i.banStatus === 'confirmed');
  }

  getSuspectedInboxes() {
    const official = this.getOfficialInboxes();
    const messages = this.getAllMessages();
    return official.filter(i => this.isSuspectedInbox(i, messages));
  }

  async setInboxBanStatus(inboxId, status, reason = '') {
    const data = this.readLocal();
    data.inboxes = data.inboxes || [];

    const clean = String(inboxId || '').trim().toLowerCase();
    let inbox = data.inboxes.find(i =>
      String(i.id).toLowerCase() === clean ||
      (i.email && i.email.toLowerCase() === clean) ||
      (i.email && i.email.toLowerCase().split('@')[0] === clean)
    );

    if (!inbox) {
      // Auto-register missing inbox record on-the-fly
      const isEmail = clean.includes('@');
      const email = isEmail ? clean : `${clean}@batabitoo.com`;
      const isOfficial = email.endsWith('@batabitoo.com');

      inbox = {
        id: isEmail ? `inbox_${clean.replace(/[^a-z0-9]/g, '_')}` : (clean || `official_${Date.now()}`),
        email: email,
        domain: isOfficial ? 'batabitoo.com' : (email.split('@')[1] || 'temp'),
        host: isOfficial ? 'batabitoo.com (Official Trusted)' : 'Temp Mail Service',
        isOfficial: isOfficial,
        type: isOfficial ? 'official' : 'temp',
        label: email.split('@')[0],
        personName: email.split('@')[0],
        createdAt: new Date().toISOString(),
        messageCount: 0
      };
      data.inboxes.push(inbox);
    }

    inbox.banStatus = status; // 'confirmed' | 'safe' | 'suspected'
    inbox.isBanned = status === 'confirmed';
    if (status === 'confirmed') {
      inbox.isAmazon = true;
      if (reason) inbox.banReason = reason;
      inbox.bannedConfirmedAt = new Date().toISOString();
    } else if (status === 'safe') {
      inbox.banDismissedAt = new Date().toISOString();
    }
    inbox.updatedAt = new Date().toISOString();

    this.writeLocal(data);

    if (this.isCloudConnected && this.db) {
      try {
        await this.db.collection('inboxes').doc(inbox.id).set(sanitizeForFirestore({
          id: inbox.id,
          email: inbox.email,
          isOfficial: inbox.isOfficial,
          type: inbox.type,
          isBanned: inbox.isBanned,
          banStatus: inbox.banStatus,
          banReason: inbox.banReason || null,
          bannedConfirmedAt: inbox.bannedConfirmedAt || null,
          banDismissedAt: inbox.banDismissedAt || null,
          updatedAt: inbox.updatedAt
        }), { merge: true });
      } catch (e) {
        console.error('⚠️ Firestore setInboxBanStatus error:', e.message);
      }
    }

    return inbox;
  }

  async saveAiFeedback({ inboxId, messageId, verdict, subject, sender, reason }) {
    const data = this.readLocal();
    data.aiFeedbackLogs = data.aiFeedbackLogs || [];

    const entry = {
      id: `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      inboxId,
      messageId,
      verdict, // 'confirm' | 'reject'
      subject: subject || '',
      sender: sender || '',
      reason: reason || (verdict === 'confirm' ? 'تأكيد المستخدم لقاعدة الحظر' : 'استبعاد النمط من قبل المستخدم وتدريب الكود'),
      timestamp: new Date().toISOString()
    };

    data.aiFeedbackLogs.unshift(entry);

    if (verdict === 'reject') {
      data.ignoredBanPatterns = data.ignoredBanPatterns || [];
      const cleanSubj = (subject || '').toLowerCase().trim();
      if (cleanSubj && !data.ignoredBanPatterns.includes(cleanSubj)) {
        data.ignoredBanPatterns.push(cleanSubj);
      }
      await this.setInboxBanStatus(inboxId, 'safe', `[تم استبعاد النمط] ${subject || reason}`);
    } else if (verdict === 'confirm') {
      await this.setInboxBanStatus(inboxId, 'confirmed', `[تأكيد المستخدم] ${reason || 'إغلاق وتأكيد الحظر'}`);
    }

    this.writeLocal(data);

    if (this.isCloudConnected && this.db) {
      try {
        await this.db.collection('ai_feedback_logs').doc(entry.id).set(sanitizeForFirestore(entry));
      } catch (e) {
        console.error('⚠️ Firestore saveAiFeedback error:', e.message);
      }
    }

    return entry;
  }

  getAiFeedbackLogs() {
    const data = this.readLocal();
    return data.aiFeedbackLogs || [];
  }

  /**
   * Run Gemini AI verification on an inbox to accurately check if it is really banned or safe.
   * If AI confirms banned -> updates to 'confirmed'.
   * If AI confirms safe -> updates to 'safe'.
   * If AI is uncertain or fails -> remains 'suspected' for user manual confirmation.
   * @param {string} inboxId - inbox id or email
   * @returns {Promise<{ success: boolean, aiResult?: Object, error?: string, inbox: Object }>}
   */
  async aiVerifyInbox(inboxId) {
    const data = this.readLocal();
    data.inboxes = data.inboxes || [];

    const clean = String(inboxId || '').trim().toLowerCase();
    let inbox = data.inboxes.find(i =>
      String(i.id).toLowerCase() === clean ||
      (i.email && i.email.toLowerCase() === clean) ||
      (i.email && i.email.toLowerCase().split('@')[0] === clean)
    );

    if (!inbox) {
      const isEmail = clean.includes('@');
      const email = isEmail ? clean : `${clean}@batabitoo.com`;
      const isOfficial = email.endsWith('@batabitoo.com');
      inbox = {
        id: isEmail ? `inbox_${clean.replace(/[^a-z0-9]/g, '_')}` : (clean || `official_${Date.now()}`),
        email: email,
        domain: isOfficial ? 'batabitoo.com' : (email.split('@')[1] || 'temp'),
        host: isOfficial ? 'batabitoo.com (Official Trusted)' : 'Temp Mail Service',
        isOfficial: isOfficial,
        type: isOfficial ? 'official' : 'temp',
        label: email.split('@')[0],
        personName: email.split('@')[0],
        createdAt: new Date().toISOString(),
        messageCount: 0
      };
      data.inboxes.push(inbox);
      this.writeLocal(data);
    }

    const messages = data.messages || [];
    const matchingMsgs = messages.filter(m => (String(m.inboxEmail || '').toLowerCase().trim() === String(inbox.email || '').toLowerCase().trim()));
    const targetMsg = matchingMsgs.find(m => this.isBannedMessage(m)) || matchingMsgs.find(m => this.isAmazonMessage(m)) || matchingMsgs[0];

    if (!targetMsg) {
      return { success: false, reason: "لا توجد رسائل كافية للفحص بواسطة الذكاء الاصطناعي", inbox };
    }

    try {
      const fromStr = typeof targetMsg.from === 'object' ? (targetMsg.from?.address || targetMsg.from?.email || JSON.stringify(targetMsg.from)) : String(targetMsg.from || '');
      const aiResult = await defaultGemini.classifyAmazonEmail({
        subject: targetMsg.subject || '',
        text: targetMsg.text || '',
        intro: targetMsg.intro || '',
        from: fromStr
      });

      console.log(`🤖 [Gemini AI] Evaluated ${inbox.email}: ${aiResult.classification} (${aiResult.confidence}) - ${aiResult.reason} [${aiResult.model} in ${aiResult.latencyMs}ms]`);

      if (aiResult.classification === 'banned' && (aiResult.confidence === 'high' || aiResult.confidence === 'medium')) {
        await this.setInboxBanStatus(inbox.id, 'confirmed', `[AI] ${aiResult.reason}`);
      } else if (aiResult.classification === 'safe') {
        await this.setInboxBanStatus(inbox.id, 'safe', `[AI] ${aiResult.reason}`);
      } else {
        // Uncertain: keep as suspected for user decision
        await this.setInboxBanStatus(inbox.id, 'suspected', `[AI غير متأكد] ${aiResult.reason}`);
      }

      const updatedData = this.readLocal();
      const updatedInbox = (updatedData.inboxes || []).find(i => i.id === inbox.id);
      return { success: true, aiResult, inbox: updatedInbox };
    } catch (err) {
      console.error(`⚠️ [Gemini AI Error] evaluating ${inbox.email}:`, err.message);
      return { success: false, error: err.message, inbox };
    }
  }

  getAmazonMessages() {
    const messages = this.getAllMessages();
    return messages.filter(m => {
      if (!this.isAmazonMessage(m)) return false;
      const cleanEmail = String(m.inboxEmail || m.to || '').toLowerCase();
      return cleanEmail.endsWith('@batabitoo.com') || m.isOfficialDomain === true;
    });
  }

  getBannedMessages() {
    const messages = this.getAllMessages();
    return messages.filter(m => {
      if (!this.isBannedMessage(m)) return false;
      const cleanEmail = String(m.inboxEmail || m.to || '').toLowerCase();
      return cleanEmail.endsWith('@batabitoo.com') || m.isOfficialDomain === true;
    });
  }

  getActiveInbox() {
    const data = this.readLocal();
    const inboxes = data.inboxes || [];
    if (!data.activeInboxId && inboxes.length > 0) {
      return inboxes[0];
    }
    return inboxes.find(i => i.id === data.activeInboxId) || inboxes[0] || null;
  }

  setActiveInbox(inboxId) {
    const data = this.readLocal();
    const found = (data.inboxes || []).some(i => i.id === inboxId);
    if (found) {
      data.activeInboxId = inboxId;
      this.writeLocal(data);
      return true;
    }
    return false;
  }

  async saveInbox(inboxRecord) {
    const email = (inboxRecord.email || '').toLowerCase().trim();
    const isOfficial = inboxRecord.isOfficial === true || email.endsWith('@batabitoo.com') || inboxRecord.domain === 'batabitoo.com';
    const type = isOfficial ? 'official' : 'temp';

    const cleanRecord = {
      ...inboxRecord,
      email: email,
      isOfficial: isOfficial,
      type: type,
      updatedAt: new Date().toISOString()
    };

    // 1. Update local cache
    const data = this.readLocal();
    if (!data.inboxes) data.inboxes = [];

    const existingIndex = data.inboxes.findIndex(i => i.email === email);
    if (existingIndex >= 0) {
      data.inboxes[existingIndex] = { ...data.inboxes[existingIndex], ...cleanRecord };
    } else {
      data.inboxes.unshift(cleanRecord);
      data.activeInboxId = cleanRecord.id;
    }
    this.writeLocal(data);

    // 2. Sync to Cloud Firestore in background
    if (this.isCloudConnected && this.db) {
      try {
        await this.db.collection('inboxes').doc(cleanRecord.id).set(sanitizeForFirestore(cleanRecord), { merge: true });
      } catch (e) {
        console.error('⚠️ Firestore saveInbox error:', e.message);
      }
    }

    return cleanRecord;
  }

  async saveMessages(inboxEmail, newMessages) {
    const cleanEmail = String(inboxEmail || '').toLowerCase().trim();
    const data = this.readLocal();
    if (!data.messages) data.messages = [];

    let addedCount = 0;
    const changedMessages = [];

    newMessages.forEach(msg => {
      const existingIndex = data.messages.findIndex(m => m.id === msg.id);
      const record = {
        ...(existingIndex >= 0 ? data.messages[existingIndex] : {}),
        ...msg,
        inboxEmail: cleanEmail,
        savedLocallyAt: new Date().toISOString()
      };
      if (existingIndex < 0) {
        data.messages.unshift(record);
        addedCount++;
      } else {
        data.messages[existingIndex] = record;
      }
      changedMessages.push(record);
    });

    // Update message count and dynamically auto-classify inbox for Amazon / Banned
    const inbox = data.inboxes.find(i => i.email === cleanEmail);
    if (inbox) {
      const totalForThis = data.messages.filter(m => m.inboxEmail === cleanEmail).length;
      inbox.messageCount = totalForThis;
      inbox.lastCheckedAt = new Date().toISOString();

      if (this.isOfficialInbox(inbox)) {
        if (inbox.banStatus !== 'safe' && inbox.banStatus !== 'confirmed' && !inbox.isBanned) {
          const matchingBanMsg = changedMessages.find(m => this.isBannedMessage(m)) || data.messages.find(m => String(m.inboxEmail || '').toLowerCase() === cleanEmail && this.isBannedMessage(m));
          if (matchingBanMsg) {
            inbox.banStatus = 'suspected';
            inbox.isAmazon = true;
            inbox.banReason = this.getBanReason(matchingBanMsg);
            inbox.bannedDetectedAt = inbox.bannedDetectedAt || new Date().toISOString();

            // Asynchronously trigger AI evaluation
            setTimeout(() => {
              this.aiVerifyInbox(inbox.id).catch(err => {
                console.warn(`[Auto-AI Verify] Check failed for ${inbox.email}:`, err.message);
              });
            }, 100);
          }
        }
        if (!inbox.isAmazon && (this.isAmazonInbox(inbox, data.messages) || changedMessages.some(m => this.isAmazonMessage(m)))) {
          inbox.isAmazon = true;
          inbox.amazonDetectedAt = inbox.amazonDetectedAt || new Date().toISOString();
        }
      }
    }

    if (changedMessages.length > 0) {
      this.writeLocal(data);

      // Sync new or enriched messages to Cloud Firestore
      if (this.isCloudConnected && this.db) {
        try {
          const batch = this.db.batch();
          for (const msg of changedMessages) {
            const docRef = this.db.collection('messages').doc(msg.id);
            batch.set(docRef, sanitizeForFirestore(msg), { merge: true });
          }
          if (inbox) {
            const inboxRef = this.db.collection('inboxes').doc(inbox.id);
            batch.set(inboxRef, sanitizeForFirestore({
              messageCount: inbox.messageCount,
              lastCheckedAt: inbox.lastCheckedAt,
              isAmazon: inbox.isAmazon,
              isBanned: inbox.isBanned === true,
              banStatus: inbox.banStatus || 'none',
              banReason: inbox.banReason || null,
              bannedDetectedAt: inbox.bannedDetectedAt || null,
              amazonDetectedAt: inbox.amazonDetectedAt || null
            }), { merge: true });
          }
          await batch.commit();
        } catch (e) {
          console.error('⚠️ Firestore saveMessages error:', e.message);
        }
      }
    }

    return addedCount;
  }

  saveAllMessages(messages) {
    const data = this.readLocal();
    data.messages = messages;
    this.writeLocal(data);
    return true;
  }

  getMessagesForInbox(inboxEmail) {
    const cleanEmail = String(inboxEmail || '').toLowerCase().trim();
    const data = this.readLocal();
    return (data.messages || []).filter(m => String(m.inboxEmail || '').toLowerCase().trim() === cleanEmail);
  }

  getAllMessages(filterType = null) {
    const data = this.readLocal();
    const all = data.messages || [];
    if (filterType === 'official') {
      return all.filter(m => m.isOfficialDomain === true || String(m.inboxEmail || '').toLowerCase().endsWith('@batabitoo.com'));
    }
    if (filterType === 'temp') {
      return all.filter(m => !(m.isOfficialDomain === true || String(m.inboxEmail || '').toLowerCase().endsWith('@batabitoo.com')));
    }
    return all;
  }

  getOfficialMessages() {
    return this.getAllMessages('official');
  }

  getTempMessages() {
    return this.getAllMessages('temp');
  }

  async deleteInbox(inboxId) {
    const data = this.readLocal();
    const inboxToDelete = data.inboxes.find(i => i.id === inboxId);
    if (!inboxToDelete) return false;

    const msgsToDelete = (data.messages || []).filter(m => String(m.inboxEmail || '').toLowerCase() === String(inboxToDelete.email || '').toLowerCase());
    for (const m of msgsToDelete) {
      if (m.id) content.purge(m.id);
    }

    data.inboxes = data.inboxes.filter(i => i.id !== inboxId);
    data.messages = (data.messages || []).filter(m => String(m.inboxEmail || '').toLowerCase() !== String(inboxToDelete.email || '').toLowerCase());
    if (data.activeInboxId === inboxId) {
      data.activeInboxId = data.inboxes.length > 0 ? data.inboxes[0].id : null;
    }
    this.writeLocal(data);

    if (this.isCloudConnected && this.db) {
      try {
        await this.db.collection('inboxes').doc(inboxId).delete();
        const snapshot = await this.db.collection('messages').where('inboxEmail', '==', inboxToDelete.email).get();
        if (!snapshot.empty) {
          const chunks = [];
          for (let i = 0; i < snapshot.docs.length; i += 400) chunks.push(snapshot.docs.slice(i, i + 400));
          for (const chunk of chunks) {
            const batch = this.db.batch();
            chunk.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
          }
        }
      } catch (e) {
        console.error('⚠️ Firestore deleteInbox error:', e.message);
      }
    }
    return true;
  }

  // Storage Quota Protection, Retention Policy & Auto-Pruning
  async enforceStorageLimits() {
    console.log('🧹 [Storage Manager] Running quota check and retention maintenance...');
    let totalFreedDisk = 0;
    let prunedMessagesCount = 0;

    // 1. Prune raw MIME eml & webhook source JSON files older than 3 days
    const rawResult = content.pruneRawFiles(3);
    totalFreedDisk += rawResult.freedBytes;

    // 2. Clean excess backups (keep max 3)
    const backupResult = content.cleanupBackups(3);
    totalFreedDisk += backupResult.freedBytes;

    // 3. Rolling message count limit per inbox (max 100 messages per inbox)
    const data = this.readLocal();
    const inboxes = data.inboxes || [];
    let messages = data.messages || [];
    const MAX_PER_INBOX = 100;
    const removedMessageIds = [];

    const messagesByInbox = new Map();
    for (const msg of messages) {
      const email = String(msg.inboxEmail || '').toLowerCase().trim();
      if (!messagesByInbox.has(email)) messagesByInbox.set(email, []);
      messagesByInbox.get(email).push(msg);
    }

    const remainingMessages = [];
    for (const [email, inboxMsgs] of messagesByInbox.entries()) {
      inboxMsgs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      if (inboxMsgs.length > MAX_PER_INBOX) {
        const keep = inboxMsgs.slice(0, MAX_PER_INBOX);
        const discard = inboxMsgs.slice(MAX_PER_INBOX);
        remainingMessages.push(...keep);
        for (const d of discard) {
          if (d.isBanned || d.isAmazon) {
            remainingMessages.push(d);
          } else {
            removedMessageIds.push(d.id);
            content.purge(d.id);
            prunedMessagesCount++;
          }
        }
      } else {
        remainingMessages.push(...inboxMsgs);
      }
    }

    // 4. Inactive Temporary Inbox TTL (14 days)
    const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const activeInboxes = [];
    const deletedInboxIds = [];

    for (const inbox of inboxes) {
      if (this.isOfficialInbox(inbox) || inbox.isAmazon || inbox.isBanned) {
        activeInboxes.push(inbox);
      } else {
        const createdTime = new Date(inbox.createdAt || 0).getTime();
        const lastChecked = new Date(inbox.lastCheckedAt || inbox.createdAt || 0).getTime();
        const isExpired = (now - createdTime > FOURTEEN_DAYS_MS) && (now - lastChecked > FOURTEEN_DAYS_MS);
        if (isExpired) {
          deletedInboxIds.push(inbox.id);
          const toDelete = remainingMessages.filter(m => String(m.inboxEmail || '').toLowerCase() === String(inbox.email || '').toLowerCase());
          for (const m of toDelete) {
            removedMessageIds.push(m.id);
            content.purge(m.id);
            prunedMessagesCount++;
          }
        } else {
          activeInboxes.push(inbox);
        }
      }
    }

    // 5. Hard Storage Ceiling Check (150 MB)
    let stats = content.getStorageStats();
    const MAX_STORAGE_BYTES = 150 * 1024 * 1024;
    if (stats.totalBytes > MAX_STORAGE_BYTES) {
      console.warn(`⚠️ Disk storage exceeded 150MB (${stats.totalMegabytes} MB). Pruning oldest non-essential messages...`);
      const candidates = remainingMessages.filter(m => !m.isOfficialDomain && !m.isAmazon && !m.isBanned);
      candidates.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
      for (const m of candidates) {
        removedMessageIds.push(m.id);
        content.purge(m.id);
        prunedMessagesCount++;
        stats = content.getStorageStats();
        if (stats.totalBytes <= MAX_STORAGE_BYTES) break;
      }
    }

    const removedSet = new Set(removedMessageIds);
    const finalMessages = remainingMessages.filter(m => !removedSet.has(m.id));

    // 6. Purge orphan disk folders
    const allActiveIds = new Set(finalMessages.map(m => m.id));
    const orphanResult = content.purgeOrphans(allActiveIds);
    totalFreedDisk += orphanResult.freedBytes;

    // 7. Save local DB if changes occurred
    if (removedMessageIds.length > 0 || deletedInboxIds.length > 0) {
      data.inboxes = activeInboxes;
      data.messages = finalMessages;
      if (!activeInboxes.some(i => i.id === data.activeInboxId)) {
        data.activeInboxId = activeInboxes.length > 0 ? activeInboxes[0].id : null;
      }
      this.writeLocal(data);

      if (this.isCloudConnected && this.db) {
        try {
          const batch = this.db.batch();
          for (const id of removedMessageIds.slice(0, 450)) {
            batch.delete(this.db.collection('messages').doc(id));
          }
          for (const id of deletedInboxIds.slice(0, 40)) {
            batch.delete(this.db.collection('inboxes').doc(id));
          }
          await batch.commit();
        } catch (e) {
          console.error('⚠️ Firestore storage pruning cleanup error:', e.message);
        }
      }
    }

    console.log(`✅ [Storage Manager] Complete: Pruned ${prunedMessagesCount} messages, freed ${(totalFreedDisk / (1024*1024)).toFixed(2)} MB, current disk: ${stats.totalMegabytes} MB.`);
    return {
      freedBytes: totalFreedDisk,
      prunedMessagesCount,
      orphanDirsDeleted: orphanResult.cleanedCount,
      currentUsage: stats
    };
  }

  getStorageStats() {
    const disk = content.getStorageStats();
    const data = this.readLocal();
    return {
      diskUsageBytes: disk.totalBytes,
      diskUsageFormatted: `${disk.totalMegabytes} MB`,
      messageDirsCount: disk.messageDirs,
      totalInboxes: (data.inboxes || []).length,
      totalMessages: (data.messages || []).length,
      officialInboxes: this.getOfficialInboxes().length,
      tempInboxes: this.getTempInboxes().length,
      isCloudConnected: this.isCloudConnected
    };
  }

  // Nivea Registration Logging
  async saveNiveaSubmission(submission) {
    let logData = { campaign: "Nivea Scan & Draw Live Registrations", submissions: [] };
    if (fs.existsSync(NIVEA_FILE)) {
      try { logData = JSON.parse(fs.readFileSync(NIVEA_FILE, 'utf8')); } catch(e) {}
    }

    logData.submissions = logData.submissions || [];
    const index = logData.submissions.length + 1;
    const newEntry = {
      index: index,
      personName: submission.personName || submission.name || "مشارك",
      mobile: submission.mobile || "0500000000",
      realEmail: submission.realEmail || submission.email,
      city: submission.city || "الرياض",
      receiptNumber: submission.receiptNumber || submission.receipt || "123456",
      registeredAt: new Date().toISOString(),
      status: "مسجل ومؤكد بنجاح (Congratulations) ✅"
    };

    logData.submissions.push(newEntry);
    logData.totalRegistrations = logData.submissions.length;
    logData.lastUpdated = new Date().toISOString();

    fs.writeFileSync(NIVEA_FILE, JSON.stringify(logData, null, 2), 'utf8');

    // Sync to Cloud Firestore
    if (this.isCloudConnected && this.db) {
      try {
        const docId = `sub_${String(index).padStart(6, '0')}`;
        await this.db.collection('nivea_submissions').doc(docId).set(sanitizeForFirestore(newEntry), { merge: true });
        await this.db.collection('campaigns').doc('nivea_live').set({
          totalRegistrations: logData.totalRegistrations,
          lastUpdated: logData.lastUpdated
        }, { merge: true });
      } catch (e) {
        console.error('⚠️ Firestore saveNiveaSubmission error:', e.message);
      }
    }

    return { entry: newEntry, total: logData.totalRegistrations };
  }

  getNiveaLogs() {
    if (fs.existsSync(NIVEA_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(NIVEA_FILE, 'utf8'));
      } catch(e) {}
    }
    return { totalRegistrations: 0, submissions: [] };
  }

  // App Version & In-App Dynamic Update Management
  async syncVersionFromFirestore() {
    if (!this.isCloudConnected || !this.db) return;
    try {
      let snap = await this.db.collection('app_config').doc('version').get();
      if (!snap.exists) {
        snap = await this.db.collection('system').doc('app_version').get();
      }
      if (snap.exists) {
        const cloudVersion = snap.data();
        const data = this.readLocal();
        data.appVersion = { ...data.appVersion, ...cloudVersion };
        this.writeLocal(data);
        console.log(`☁️ Synced App Version from Firestore: v${cloudVersion.latestVersionName || '1.2.0'} (code: ${cloudVersion.latestVersionCode})`);
      }
    } catch (e) {
      console.warn('Could not sync app version from Firestore:', e.message);
    }
  }

  getAppVersion() {
    const data = this.readLocal();
    const defaultVersion = {
      latestVersionCode: 7,
      latestVersionName: "1.3.3",
      downloadUrl: "https://github.com/ahmedroou/batabitoo-mail-center/releases/download/v1.3.3/Batabitoo-Mail-Center-1.3.3.apk",
      releaseNotes: "إصلاح خطأ تأكيد الحظر (Not Found)، وإعادة تصميم أزرار تصفية أمازون وبطاقات الحسابات لإظهار البريد كاملاً وتنظيم الأزرار بالأسفل.",
      mandatory: false,
      updatedAt: new Date().toISOString()
    };
    return data.appVersion || defaultVersion;
  }

  async updateAppVersion(versionData) {
    const current = this.getAppVersion();
    const updated = {
      latestVersionCode: Number(versionData.latestVersionCode !== undefined ? versionData.latestVersionCode : current.latestVersionCode),
      latestVersionName: String(versionData.latestVersionName || current.latestVersionName || "1.2.0"),
      downloadUrl: String(versionData.downloadUrl || current.downloadUrl || ""),
      releaseNotes: String(versionData.releaseNotes !== undefined ? versionData.releaseNotes : current.releaseNotes),
      mandatory: Boolean(versionData.mandatory !== undefined ? versionData.mandatory : current.mandatory),
      updatedAt: new Date().toISOString()
    };

    const data = this.readLocal();
    data.appVersion = updated;
    this.writeLocal(data);

    // Sync to Cloud Firestore (dual sync to both app_config/version and system/app_version)
    if (this.isCloudConnected && this.db) {
      try {
        const sanitized = sanitizeForFirestore(updated);
        await Promise.all([
          this.db.collection('app_config').doc('version').set(sanitized, { merge: true }),
          this.db.collection('system').doc('app_version').set(sanitized, { merge: true })
        ]);
        console.log(`☁️ Saved App Version v${updated.latestVersionName} (code: ${updated.latestVersionCode}) to Firestore!`);
      } catch (e) {
        console.error('⚠️ Firestore updateAppVersion error:', e.message);
      }
    }

    return updated;
  }
}

module.exports = new InboxDatabase();
