// Unified InboxDatabase Layer for Batabitoo Mail Center.
// Firestore is the only durable source of truth; memory is a disposable cache.

const content = require('./MailContent');
const { defaultGemini } = require('./GeminiAI');
const { mailDatabase } = require('./CloudDatabase');

class InboxDatabase {
  constructor() {
    this.db = mailDatabase.firestore;
    this.isCloudConnected = true;
    this._ignoredPatterns = new Set();
    this.readyPromise = mailDatabase.ready().then(() => {
      this.loadIgnoredPatterns();
      return this;
    });
  }

  ready() {
    return this.readyPromise;
  }

  loadIgnoredPatterns() {
    try {
      const patterns = mailDatabase.getIgnoredPatterns();
      this._ignoredPatterns = new Set(patterns.map(p => p.toLowerCase().trim()));
    } catch (_) {
      this._ignoredPatterns = new Set();
    }
  }

  // --- Read compatibility shim backed only by the Firestore memory snapshot ---

  readLocal() {
    return {
      activeInboxId: mailDatabase.getActiveInboxId(),
      inboxes: mailDatabase.getAllInboxes(),
      messages: mailDatabase.getAllMessages(),
      ignoredBanPatterns: Array.from(this._ignoredPatterns)
    };
  }

  writeLocal(data) {
    if (!data) return false;
    if (data.activeInboxId) {
      mailDatabase.setActiveInboxId(data.activeInboxId);
    }
    return true;
  }

  // --- Inbox Operations ---

  getAllInboxes() {
    return mailDatabase.getAllInboxes();
  }

  getOfficialInboxes() {
    return mailDatabase.getOfficialInboxes();
  }

  getTempInboxes() {
    return mailDatabase.getTempInboxes();
  }

  getAmazonInboxes() {
    return mailDatabase.getAmazonInboxes();
  }

  getBannedInboxes() {
    return mailDatabase.getBannedInboxes();
  }

  getSuspectedInboxes() {
    return mailDatabase.getSuspectedInboxes();
  }

  findInboxById(id) {
    return mailDatabase.findInboxById(id);
  }

  findInboxByEmail(email) {
    return mailDatabase.findInboxByEmail(email);
  }

  getActiveInbox() {
    return mailDatabase.getActiveInbox();
  }

  setActiveInbox(inboxId) {
    const inbox = mailDatabase.findInboxById(inboxId);
    if (inbox) {
      mailDatabase.setActiveInboxId(inbox.id);
      return true;
    }
    return false;
  }

  async saveInbox(inboxRecord) {
    return mailDatabase.saveInbox(inboxRecord);
  }

  async deleteInbox(inboxId) {
    if (!inboxId) return false;
    const inbox = mailDatabase.findInboxById(inboxId);
    if (!inbox) return false;

    const messages = mailDatabase.getMessagesByInboxEmail(inbox.email);
    // Purge cloud storage payloads in background without delaying the HTTP response
    Promise.all(messages.map(message => content.purge(message.id).catch(() => false))).catch(() => {});
    return mailDatabase.deleteInbox(inboxId);
  }

  async deleteInboxes(inboxIds) {
    if (!Array.isArray(inboxIds) || !inboxIds.length) return 0;
    const inboxes = inboxIds.map(id => mailDatabase.findInboxById(id)).filter(Boolean);
    const emails = inboxes.map(i => i.email);
    for (const email of emails) {
      const messages = mailDatabase.getMessagesByInboxEmail(email);
      Promise.all(messages.map(message => content.purge(message.id).catch(() => false))).catch(() => {});
    }
    return mailDatabase.deleteInboxes ? mailDatabase.deleteInboxes(inboxIds) : Promise.all(inboxIds.map(id => mailDatabase.deleteInbox(id))).then(res => res.filter(Boolean).length);
  }

  // --- Classification & Pattern Detection Helpers (Pure & Fast) ---

  isOfficialInbox(inbox) {
    if (!inbox) return false;
    const email = String(inbox.email || '').toLowerCase().trim();
    return Boolean(inbox.isOfficial) || inbox.type === 'official' || email.endsWith('@batabitoo.com') || email.endsWith('@gmail.com') || inbox.domain === 'batabitoo.com' || inbox.domain === 'gmail.com';
  }

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

  isBannedMessage(msg, customIgnoredPatterns = null) {
    if (!msg) return false;
    if (msg.isBanned === true) return true;

    const ignored = customIgnoredPatterns || this._ignoredPatterns;
    const subj = String(msg.subject || '').toLowerCase().trim();
    if (subj) {
      for (const pat of ignored) {
        if (subj.includes(pat)) return false;
      }
    }

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
    if (!msg) return 'حساب مقيد / محظور';
    const textToCheck = [msg.subject, msg.intro, msg.text].filter(Boolean).join(' ').toLowerCase();
    if (/المشتريات الرقمية|مشتريات رقمية|digital purchases/i.test(textToCheck)) {
      return 'مشتريات رقمية فقط';
    }
    if (/أغلقنا هذا الحساب|تم إغلاق|closed this account|إنهاء الحسابات|terminate/i.test(textToCheck)) {
      return 'إغلاق وحظر الحساب';
    }
    return 'حساب مقيد / محظور';
  }

  isAmazonInbox(inbox, messages = null) {
    if (!inbox) return false;
    if (!this.isOfficialInbox(inbox)) return false;

    if (inbox.isAmazon === true || inbox.isBanned === true || inbox.banStatus === 'confirmed' || inbox.banStatus === 'suspected') return true;

    const meta = [inbox.email, inbox.label, inbox.personName].filter(Boolean).join(' ').toLowerCase();
    if (/amazon|أمازون|امازون|إمازون/i.test(meta)) return true;

    const msgs = messages || mailDatabase.getMessagesByInboxEmail(inbox.email, 50);
    return msgs.some(m => this.isAmazonMessage(m));
  }

  isBannedInbox(inbox) {
    if (!inbox) return false;
    if (!this.isOfficialInbox(inbox)) return false;
    return inbox.banStatus === 'confirmed' || inbox.isBanned === true;
  }

  isSuspectedInbox(inbox, messages = null) {
    if (!inbox) return false;
    if (!this.isOfficialInbox(inbox)) return false;
    if (inbox.banStatus === 'safe') return false;
    if (inbox.banStatus === 'confirmed' || inbox.isBanned === true) return false;
    if (inbox.banStatus === 'suspected') return true;

    const msgs = messages || mailDatabase.getMessagesByInboxEmail(inbox.email, 50);
    return msgs.some(m => this.isBannedMessage(m));
  }

  async scanAndClassifyAmazonInboxes() {
    const inboxes = mailDatabase.getOfficialInboxes();
    let updatedCount = 0;

    for (const inbox of inboxes) {
      if (!this.isOfficialInbox(inbox)) continue;

      let changed = false;
      if (inbox.banStatus !== 'safe' && inbox.banStatus !== 'confirmed' && !inbox.isBanned) {
        if (inbox.banStatus !== 'suspected' && this.isSuspectedInbox(inbox)) {
          const msgs = mailDatabase.getMessagesByInboxEmail(inbox.email, 20);
          const matchingMsg = msgs.find(m => this.isBannedMessage(m));
          const reason = this.getBanReason(matchingMsg);
          await mailDatabase.updateInboxBanStatus(inbox.id, 'suspected', reason, 'scan');
          changed = true;

          // Asynchronously trigger AI evaluation
          setTimeout(() => {
            this.aiVerifyInbox(inbox.id).catch(() => {});
          }, 100);
        }
      }

      if (!inbox.isAmazon && this.isAmazonInbox(inbox)) {
        await mailDatabase.updateInboxAmazonFlag(inbox.id, true);
        changed = true;
      }

      if (changed) {
        updatedCount++;
      }
    }

    return updatedCount;
  }

  async setInboxBanStatus(inboxId, status, reason = '', source = 'user') {
    if (!inboxId) return null;
    return mailDatabase.updateInboxBanStatus(inboxId, status, reason, source);
  }

  // --- AI Feedback & Evaluation ---

  async saveAiFeedback({ inboxId, messageId, verdict, subject, sender, reason }) {
    const entry = mailDatabase.saveAiFeedback({ inboxId, messageId, verdict, subject, sender, reason });
    if (verdict === 'reject' && subject) {
      this._ignoredPatterns.add(subject.trim().toLowerCase());
      await this.setInboxBanStatus(inboxId, 'safe', `[تم استبعاد النمط] ${subject || reason}`);
    } else if (verdict === 'confirm') {
      await this.setInboxBanStatus(inboxId, 'confirmed', `[تأكيد المستخدم] ${reason || 'إغلاق وتأكيد الحظر'}`);
    }

    return entry;
  }

  getAiFeedbackLogs(limit = 100) {
    return mailDatabase.getAiFeedbackLogs(limit);
  }

  async aiVerifyInbox(inboxId) {
    const inbox = mailDatabase.findInboxById(inboxId) || mailDatabase.findInboxByEmail(inboxId);
    if (!inbox) {
      return { success: false, reason: 'Inbox not found' };
    }

    const messages = mailDatabase.getMessagesByInboxEmail(inbox.email, 20);
    const targetMsg = messages.find(m => this.isBannedMessage(m)) || messages.find(m => this.isAmazonMessage(m)) || messages[0];

    if (!targetMsg) {
      return { success: false, reason: 'لا توجد رسائل كافية للفحص بواسطة الذكاء الاصطناعي', inbox };
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
        await this.setInboxBanStatus(inbox.id, 'suspected', `[AI غير متأكد] ${aiResult.reason}`);
      }

      const updatedInbox = mailDatabase.findInboxById(inbox.id);
      return { success: true, aiResult, inbox: updatedInbox };
    } catch (err) {
      console.error(`⚠️ [Gemini AI Error] evaluating ${inbox.email}:`, err.message);
      return { success: false, error: err.message, inbox };
    }
  }

  // --- Message Operations ---

  getAllMessages(filterType = null, limit = 1000) {
    return mailDatabase.getAllMessages(filterType, limit);
  }

  getOfficialMessages(limit = 500) {
    return mailDatabase.getOfficialMessages(limit);
  }

  getTempMessages(limit = 500) {
    return mailDatabase.getTempMessages(limit);
  }

  getAmazonMessages(limit = 500) {
    return mailDatabase.getAmazonMessages(limit);
  }

  getBannedMessages(limit = 500) {
    return mailDatabase.getBannedMessages(limit);
  }

  getWinningMessages(limit = 500) {
    return mailDatabase.getWinningMessages(limit);
  }

  getMessagesForInbox(inboxEmail, limit = 500) {
    return mailDatabase.getMessagesByInboxEmail(inboxEmail, limit);
  }

  findMessageById(messageId) {
    return mailDatabase.findMessageById(messageId);
  }

  async saveMessages(inboxEmail, newMessages) {
    const cleanEmail = String(inboxEmail || '').toLowerCase().trim();
    return mailDatabase.saveMessages(cleanEmail, newMessages || []);
  }

  // --- Fast Aggregated System Counts ---

  getStatusCounts() {
    return mailDatabase.getStatusCounts();
  }

  // --- Cloud storage statistics ---

  async enforceStorageLimits() {
    return {
      freedBytes: 0,
      prunedMessagesCount: 0,
      orphanDirsDeleted: 0,
      storage: 'firebase'
    };
  }

  getStorageStats() {
    const counts = mailDatabase.getStatusCounts();
    return {
      storage: 'firebase',
      diskUsageBytes: 0,
      diskUsageFormatted: '0 MB (no local data storage)',
      messageDirsCount: 0,
      totalInboxes: counts.totalInboxes,
      totalMessages: counts.messages,
      officialInboxes: counts.official,
      tempInboxes: counts.temp,
      isCloudConnected: this.isCloudConnected
    };
  }

  // --- Nivea Logs Integration ---

  async saveNiveaSubmission(submission) {
    const entry = {
      personName: submission.personName || submission.name || 'مشارك',
      mobile: submission.mobile || '0500000000',
      realEmail: submission.realEmail || submission.email,
      city: submission.city || 'الرياض',
      receiptNumber: submission.receiptNumber || submission.receipt || '123456',
      registeredAt: new Date().toISOString()
    };
    mailDatabase.logNiveaRegistration(entry);
    const all = mailDatabase.getNiveaLogs(1000);
    return { entry, total: all.length };
  }

  getNiveaLogs(limit = 200) {
    const logs = mailDatabase.getNiveaLogs(limit);
    logs.submissions = logs;
    logs.totalRegistrations = logs.length;
    return logs;
  }

  // --- App Version ---

  getAppVersion() {
    return mailDatabase.getAppVersion();
  }

  async updateAppVersion(versionData) {
    return mailDatabase.updateAppVersion(versionData);
  }

  getDeletedAmazonAccounts() {
    return mailDatabase.getDeletedAmazonAccounts ? mailDatabase.getDeletedAmazonAccounts() : [];
  }

  addDeletedAmazonAccount(email) {
    return mailDatabase.addDeletedAmazonAccount ? mailDatabase.addDeletedAmazonAccount(email) : false;
  }

  removeDeletedAmazonAccount(email) {
    return mailDatabase.removeDeletedAmazonAccount ? mailDatabase.removeDeletedAmazonAccount(email) : false;
  }

  deleteMessagesForEmail(email) {
    return mailDatabase.deleteMessagesForEmail ? mailDatabase.deleteMessagesForEmail(email) : 0;
  }
}

module.exports = new InboxDatabase();
