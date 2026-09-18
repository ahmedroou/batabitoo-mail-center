'use strict';

const db = require('./InboxDatabase');
const RealInboxService = require('./RealInboxService');
const emailParser = require('./EmailParser');
const content = require('./MailContent');

class TempSyncService {
  constructor() {
    this.service = new RealInboxService();
    this.isAutoSyncing = false;
    this.syncIntervalTimer = null;
    this.lastSyncAt = null;
    this.lastSyncStats = { totalScanned: 0, newMessages: 0, winningFound: 0 };
    this.isSyncAllRunning = false;
  }

  /**
   * Detect if an email is a contest/winning notification (Nivea, Amazon, Raffles, Prizes)
   */
  detectWinningEmail(subject = '', text = '', from = '') {
    const combined = `${subject} ${text} ${from}`.toLowerCase();
    
    const arabicKeywords = [
      'مبروك', 'تهانينا', 'فائز', 'فزت', 'ربحت', 'جائزة', 
      'مسابقة', 'سحب', 'هدية', 'قسيمة', 'كوبون', 'نيفيا'
    ];

    const englishKeywords = [
      'winner', 'won', 'congratulations', 'congrats', 'prize', 
      'contest', 'giveaway', 'gift card', 'voucher', 'nivea', 'raffle'
    ];

    const matchedArabic = arabicKeywords.filter(kw => combined.includes(kw));
    const matchedEnglish = englishKeywords.filter(kw => combined.includes(kw));
    const allMatches = [...matchedArabic, ...matchedEnglish];

    const isWinning = allMatches.length > 0;
    return {
      isWinning,
      keywords: allMatches,
      winningTag: isWinning ? '🏆 رسالة مسابقة وفوز' : null
    };
  }

  /**
   * Sync a single temporary inbox on demand (fetches list + full body of pending/new messages)
   */
  async syncInbox(inbox, { forceFull = false } = {}) {
    if (!inbox || !inbox.email || inbox.isOfficial) {
      return { success: false, reason: 'Invalid or official inbox' };
    }

    try {
      const remoteMsgs = await this.service.getMessages(inbox);
      if (!remoteMsgs || remoteMsgs.length === 0) {
        return { success: true, inboxEmail: inbox.email, total: 0, newCount: 0 };
      }

      let newCount = 0;
      let hasWinning = false;

      for (const m of remoteMsgs) {
        const msgId = m.id;
        const existing = db.getAllMessages().find(item => item.id === msgId);

        // If message is new or its full body was never fetched:
        if (!existing || !existing.contentComplete || existing.bodyStatus === 'pending' || forceFull) {
          let fullMsg = await this.service.getMessage(inbox, msgId);
          if (!fullMsg) {
            fullMsg = {
              id: msgId,
              from: emailParser.formatAddress(m.from),
              to: inbox.email,
              subject: emailParser.decodeRfc2047(m.subject || '(بدون عنوان)'),
              intro: m.intro || '',
              text: m.intro || '',
              html: '',
              createdAt: m.createdAt || new Date().toISOString()
            };
          }

          const normalized = await content.normalize(fullMsg, msgId, { complete: true });
          const subject = emailParser.decodeRfc2047(fullMsg.subject || '(بدون عنوان)');
          const text = fullMsg.text || normalized.text || '';
          const html = fullMsg.html || normalized.html || '';

          // Extract OTP code
          const extractedOtp = emailParser.extractOtp(text, html, subject) || normalized.otp || null;

          // Detect Contest / Winning Email
          const winAnalysis = this.detectWinningEmail(subject, text, fullMsg.from?.address || fullMsg.from || '');
          if (winAnalysis.isWinning) {
            hasWinning = true;
          }

          const record = {
            ...normalized,
            ...fullMsg,
            id: msgId,
            inboxEmail: inbox.email,
            to: inbox.email,
            from: emailParser.formatAddress(fullMsg.from),
            subject: subject,
            intro: (text ? text.slice(0, 140).trim() : subject) || 'رسالة جديدة',
            text: text,
            html: html,
            otp: extractedOtp,
            isWinning: winAnalysis.isWinning,
            winningTag: winAnalysis.winningTag,
            winningKeywords: winAnalysis.keywords,
            isOfficialDomain: false,
            domain: inbox.domain || 'inboxes.com',
            createdAt: fullMsg.createdAt || normalized.createdAt || new Date().toISOString(),
            contentComplete: true,
            bodyStatus: 'available',
            bodyStored: true,
            syncedFromRemoteAt: new Date().toISOString()
          };

          await db.saveMessages(inbox.email, [record]);
          newCount++;

          console.log(`📥 [TempSync] Fetched full message for ${inbox.email} | Subj: "${subject}" | OTP: ${extractedOtp || 'N/A'}${winAnalysis.isWinning ? ' | 🏆 WINNING DETECTED!' : ''}`);
        }
      }

      // Update inbox message count and winning badge
      const localMsgs = db.getMessagesForInbox(inbox.email);
      let updatedInbox = false;
      if (inbox.messageCount !== localMsgs.length) {
        inbox.messageCount = localMsgs.length;
        updatedInbox = true;
      }
      if (hasWinning && !inbox.hasWinningMessage) {
        inbox.hasWinningMessage = true;
        updatedInbox = true;
      }
      if (updatedInbox) {
        await db.saveInbox(inbox);
      }

      return {
        success: true,
        inboxEmail: inbox.email,
        total: remoteMsgs.length,
        newCount,
        hasWinning
      };
    } catch (err) {
      console.error(`❌ [TempSync] Error syncing ${inbox.email}:`, err.message);
      return { success: false, inboxEmail: inbox.email, error: err.message };
    }
  }

  /**
   * Sync all temp inboxes sequentially with a controlled delay to prevent 403 Rate Limits
   */
  async syncAllInboxes({ intervalMs = 2500, maxInboxes = 300, onProgress } = {}) {
    if (this.isSyncAllRunning) {
      return { running: true, message: 'Sync cycle already in progress' };
    }
    this.isSyncAllRunning = true;

    try {
      const allInboxes = db.getTempInboxes();
      // Get competition registered emails to prioritize them first
      const niveaLogs = db.getNiveaLogs() || [];
      const contestEmails = new Set(niveaLogs.map(l => String(l.email || '').toLowerCase().trim()));

      // Sort: Contest registered first, then inboxes with messages, then others
      const sortedInboxes = [...allInboxes].sort((a, b) => {
        const aContest = contestEmails.has(String(a.email || '').toLowerCase());
        const bContest = contestEmails.has(String(b.email || '').toLowerCase());
        if (aContest && !bContest) return -1;
        if (!aContest && bContest) return 1;
        return (b.messageCount || 0) - (a.messageCount || 0);
      }).slice(0, maxInboxes);

      console.log(`🔄 [TempSync] Starting bulk sync for ${sortedInboxes.length} temp inboxes (Interval: ${intervalMs}ms)...`);

      let totalNew = 0;
      let totalWinning = 0;

      for (let i = 0; i < sortedInboxes.length; i++) {
        const inbox = sortedInboxes[i];

        // Check if rate limited
        if (this.service.isRateLimited()) {
          const waitMs = Math.max(5000, this.service.rateLimitUntil - Date.now() + 2000);
          console.warn(`⏳ [TempSync] Pausing bulk sync for ${Math.round(waitMs / 1000)}s due to provider rate limit...`);
          await new Promise(r => setTimeout(r, waitMs));
        }

        const result = await this.syncInbox(inbox);
        if (result.newCount > 0) totalNew += result.newCount;
        if (result.hasWinning) totalWinning++;

        if (typeof onProgress === 'function') {
          onProgress({ index: i + 1, total: sortedInboxes.length, current: inbox.email, result });
        }

        // Polite pause between requests to preserve API quotas
        if (i < sortedInboxes.length - 1) {
          await new Promise(r => setTimeout(r, intervalMs));
        }
      }

      this.lastSyncAt = new Date().toISOString();
      this.lastSyncStats = {
        totalScanned: sortedInboxes.length,
        newMessages: totalNew,
        winningFound: totalWinning
      };

      console.log(`✅ [TempSync] Bulk sync completed: ${sortedInboxes.length} scanned, ${totalNew} new messages, ${totalWinning} winning messages.`);
      return { success: true, stats: this.lastSyncStats };
    } catch (e) {
      console.error('❌ [TempSync] Bulk sync failed:', e.message);
      return { success: false, error: e.message };
    } finally {
      this.isSyncAllRunning = false;
    }
  }

  /**
   * Fast sync targeted specifically for contest / Nivea / recent inboxes
   */
  async syncContestInboxes() {
    const niveaLogs = db.getNiveaLogs() || [];
    const contestEmails = new Set(niveaLogs.map(l => String(l.email || '').toLowerCase().trim()));
    const allTemp = db.getTempInboxes();
    const targets = allTemp.filter(i => contestEmails.has(String(i.email || '').toLowerCase()) || (i.messageCount && i.messageCount > 0));

    if (targets.length === 0) return;

    for (let i = 0; i < targets.length; i++) {
      if (this.service.isRateLimited()) break;
      await this.syncInbox(targets[i]);
      if (i < targets.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  /**
   * Start 24/7 background worker
   */
  startAutoSync(intervalMinutes = 3) {
    if (this.syncIntervalTimer) return;
    this.isAutoSyncing = true;
    console.log(`🚀 [TempSync] Auto-Sync service started (Running every ${intervalMinutes} minutes)`);

    // Initial check after 10 seconds
    setTimeout(() => {
      this.syncContestInboxes().catch(() => {});
    }, 10000);

    this.syncIntervalTimer = setInterval(() => {
      this.syncContestInboxes().catch(() => {});
    }, intervalMinutes * 60 * 1000);
  }

  stopAutoSync() {
    if (this.syncIntervalTimer) {
      clearInterval(this.syncIntervalTimer);
      this.syncIntervalTimer = null;
    }
    this.isAutoSyncing = false;
  }

  getStatus() {
    return {
      autoSyncActive: this.isAutoSyncing,
      isBulkSyncRunning: this.isSyncAllRunning,
      lastSyncAt: this.lastSyncAt,
      lastStats: this.lastSyncStats,
      isRateLimited: this.service.isRateLimited(),
      rateLimitCooldownSeconds: this.service.isRateLimited() ? Math.ceil((this.service.rateLimitUntil - Date.now()) / 1000) : 0
    };
  }
}

const defaultTempSync = new TempSyncService();
module.exports = defaultTempSync;
