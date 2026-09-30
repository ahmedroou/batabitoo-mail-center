'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const db = require('./InboxDatabase');
const content = require('./MailContent');
const emailParser = require('./EmailParser');
const { broadcast } = require('./eventBus');

class NiveaWinnerSyncWorker {
  constructor() {
    this.intervalHours = 12;
    this.intervalMs = this.intervalHours * 60 * 60 * 1000;
    this.timer = null;
    this.initialTimer = null;
    this.isRunning = false;
    this.lastScanAt = null;
    this.nextScanAt = null;
    this.lastStats = {
      totalInboxes: 0,
      scannedCount: 0,
      newMessages: 0,
      genuineWinningMessages: 0,
      durationSeconds: 0,
      errors: 0
    };

    this.winnersFilePath = path.join(__dirname, 'nivea_our_confirmed_winners.json');
    this.altWinnersFilePath = path.join(__dirname, '..', 'dazzling-oppenheimer', 'nivea_our_confirmed_winners.json');
    this.thirdWinnersFilePath = path.join(__dirname, '..', 'batabitoo-mail-center', 'nivea_our_confirmed_winners.json');
  }

  loadWinnersList() {
    let p = this.winnersFilePath;
    if (!fs.existsSync(p) && fs.existsSync(this.altWinnersFilePath)) {
      p = this.altWinnersFilePath;
    } else if (!fs.existsSync(p) && fs.existsSync(this.thirdWinnersFilePath)) {
      p = this.thirdWinnersFilePath;
    }
    if (!fs.existsSync(p)) {
      console.warn('⚠️ [NiveaWinnerSync] Winners list file not found at:', p);
      return [];
    }
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      return data.winners || [];
    } catch (e) {
      console.error('❌ [NiveaWinnerSync] Error loading winners list:', e.message);
      return [];
    }
  }

  /**
   * Determine if an email is GENUINELY a winning email (strict, no false positives)
   * Must match both:
   * 1. Contest entity (Nivea / Qiddiya / e-Copon / Scan & Draw)
   * 2. Winning / Prize cue (Ticket / Voucher / Congratulations you won / Claim prize)
   */
  isGenuineWinningEmail(subject = '', text = '', from = '', html = '') {
    const combined = `${subject} ${text} ${from} ${html}`.toLowerCase();

    // Must match contest identity (Nivea, Qiddiya, e-Copon)
    const hasContestEntity = (
      combined.includes('القدية') || combined.includes('qiddiya') ||
      combined.includes('نيفيا') || combined.includes('nivea') ||
      combined.includes('e-copon') || combined.includes('ecopon') ||
      combined.includes('امسح واربح') || combined.includes('scan & draw') ||
      combined.includes('scananddraw')
    );

    // Must match actual winning / prize claim cues
    const hasWinningCue = (
      combined.includes('تذكرة') || combined.includes('تذاكر') ||
      combined.includes('ticket') || combined.includes('tickets') ||
      combined.includes('بطاقة استلام') || combined.includes('كود التذكرة') ||
      combined.includes('رمز الاستلام') || combined.includes('voucher') ||
      combined.includes('مبروك فوزك') || combined.includes('تهانينا لقد فزت') ||
      combined.includes('لقد ربحت') || combined.includes('congratulations you have won') ||
      combined.includes('you won') || combined.includes('claim your prize')
    );

    const isGenuine = hasContestEntity && hasWinningCue;

    return {
      isGenuine,
      hasContestEntity,
      hasWinningCue,
      tag: isGenuine ? '🏆 رسالة مسابقة وفوز مؤكدة' : null
    };
  }

  // Request helper
  httpsRequest(url, options = {}, data = null) {
    return new Promise((resolve) => {
      const parsed = new URL(url);
      const reqOptions = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BatabitooMailCenter/2.0',
          'Accept': 'application/json',
          ...(options.headers || {})
        },
        timeout: 9000
      };

      if (data) {
        const bodyStr = typeof data === 'string' ? data : JSON.stringify(data);
        reqOptions.headers['Content-Type'] = 'application/json';
        reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);
      }

      const req = https.request(reqOptions, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          let parsedBody;
          try { parsedBody = JSON.parse(body); } catch (e) { parsedBody = body; }
          resolve({ statusCode: res.statusCode, data: parsedBody });
        });
      });

      req.on('error', err => resolve({ error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ error: 'Timeout' }); });

      if (data) {
        const bodyStr = typeof data === 'string' ? data : JSON.stringify(data);
        req.write(bodyStr);
      }
      req.end();
    });
  }

  /**
   * Fetch messages from Mail.tm / Mail.gw
   */
  async fetchMailTm(email, password) {
    const host = email.includes('emalupe.com') ? 'api.mail.tm' : 'api.mail.gw';
    const loginRes = await this.httpsRequest(`https://${host}/token`, { method: 'POST' }, {
      address: email,
      password: password
    });

    if (!loginRes || !loginRes.data || !loginRes.data.token) {
      return [];
    }

    const token = loginRes.data.token;
    const msgsRes = await this.httpsRequest(`https://${host}/messages`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!msgsRes || !msgsRes.data) return [];
    const rawItems = msgsRes.data['hydra:member'] || msgsRes.data || [];
    if (!Array.isArray(rawItems)) return [];

    const messages = [];
    for (const m of rawItems) {
      // Fetch full body for each message
      const fullRes = await this.httpsRequest(`https://${host}/messages/${m.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const full = fullRes?.data || m;
      messages.push({
        id: String(m.id),
        from: emailParser.formatAddress(full.from || m.from),
        to: email,
        subject: emailParser.decodeRfc2047(full.subject || m.subject || '(بدون عنوان)'),
        intro: full.intro || m.intro || '',
        text: full.text || full.intro || '',
        html: full.html && full.html.length > 0 ? (Array.isArray(full.html) ? full.html.join('') : full.html) : '',
        createdAt: full.createdAt || m.createdAt || new Date().toISOString(),
        hasAttachments: Boolean(full.hasAttachments || (Array.isArray(full.attachments) && full.attachments.length > 0)),
        attachments: Array.isArray(full.attachments) ? full.attachments : []
      });
    }
    return messages;
  }

  /**
   * Fetch messages from Inboxes.com
   */
  async fetchInboxesCom(email) {
    const res = await this.httpsRequest(`https://getnada.com/api/v2/inbox/${encodeURIComponent(email)}`);
    if (!res || !res.data || !Array.isArray(res.data.msgs)) {
      return [];
    }

    const messages = [];
    for (const m of res.data.msgs) {
      const msgId = m.uid || m.id;
      let fullBody = '';
      let fullHtml = '';
      let attachments = [];
      try {
        const bodyRes = await this.httpsRequest(`https://getnada.com/api/v2/message/${msgId}`);
        if (bodyRes && bodyRes.data) {
          fullBody = bodyRes.data.text || bodyRes.data.html || '';
          fullHtml = bodyRes.data.html || '';
          if (Array.isArray(bodyRes.data.at) && bodyRes.data.at.length > 0) {
            attachments = bodyRes.data.at.map(a => ({
              id: String(a.id),
              filename: a.filename,
              size: a.size,
              contentType: a.type || 'application/pdf',
              downloadUrl: `https://inboxes.com/api/v2/message/at/download/${a.id}/${encodeURIComponent(a.filename)}`
            }));
          }
        }
      } catch (e) {}

      messages.push({
        id: String(msgId),
        from: emailParser.formatAddress(m.f || m.from),
        to: email,
        subject: emailParser.decodeRfc2047(m.s || m.subject || '(بدون عنوان)'),
        intro: m.s || '',
        text: fullBody || m.s || '',
        html: fullHtml || '',
        createdAt: m.created_at || new Date().toISOString(),
        hasAttachments: attachments.length > 0,
        attachments
      });
    }
    return messages;
  }

  /**
   * Main scan execution
   */
  async runSync() {
    if (this.isRunning) {
      console.log('⏳ [NiveaWinnerSync] Scan is already running in background.');
      return { success: false, reason: 'Already running' };
    }

    this.isRunning = true;
    const startTime = Date.now();
    console.log(`\n======================================================`);
    console.log(`🚀 [NiveaWinnerSync] Starting 12-Hour Winner Inboxes Scan...`);
    console.log(`⏰ Time: ${new Date().toISOString()}`);
    console.log(`======================================================`);

    try {
      const winners = this.loadWinnersList();
      if (!winners || winners.length === 0) {
        console.warn('⚠️ [NiveaWinnerSync] No winners found in list.');
        return { success: false, reason: 'Empty winners list' };
      }

      // Ensure Cloud Firestore cache is hydrated and ready
      await db.ready();
      const allInboxes = db.getAllInboxes();
      const passMap = new Map();
      allInboxes.forEach(ib => {
        if (ib.email && ib.password) {
          passMap.set(String(ib.email).toLowerCase().trim(), ib.password);
        }
      });

      let totalNewMessages = 0;
      let genuineWinningCount = 0;
      let scannedCount = 0;
      let errorCount = 0;

      for (let i = 0; i < winners.length; i++) {
        const w = winners[i];
        const email = String(w.randomEmail || '').toLowerCase().trim();
        if (!email) continue;

        scannedCount++;
        const domain = email.split('@')[1];
        const isMailTm = domain === 'emalupe.com' || domain === 'westcast-systems.com';

        try {
          let remoteMessages = [];

          if (isMailTm) {
            const password = passMap.get(email) || w.password;
            if (password) {
              remoteMessages = await this.fetchMailTm(email, password);
            }
          } else {
            remoteMessages = await this.fetchInboxesCom(email);
          }

          if (remoteMessages.length > 0) {
            console.log(`📨 [NiveaWinnerSync] Found ${remoteMessages.length} message(s) for ${email} (${w.winnerName})!`);

            const toSave = [];
            let hasNewGenuineWin = false;

            for (const msg of remoteMessages) {
              const winEval = this.isGenuineWinningEmail(msg.subject, msg.text, msg.from?.address || msg.from, msg.html);

              if (winEval.isGenuine) {
                genuineWinningCount++;
                hasNewGenuineWin = true;
                console.log(`🎉🏆 [NiveaWinnerSync] GENUINE WINNING EMAIL CONFIRMED: "${msg.subject}" for ${w.winnerName}!`);
              }

              const normalized = await content.normalize(msg, msg.id, { complete: true });
              const extractedOtp = emailParser.extractOtp(msg.text, msg.html, msg.subject) || normalized.otp || null;

              const fullRecord = {
                ...normalized,
                ...msg,
                id: String(msg.id),
                inboxEmail: email,
                to: email,
                from: emailParser.formatAddress(msg.from),
                subject: msg.subject,
                intro: (msg.text ? msg.text.slice(0, 140).trim() : msg.subject) || 'رسالة مسابقة',
                text: msg.text,
                html: msg.html,
                otp: extractedOtp,
                winnerName: w.winnerName,
                winnerPhone: w.mobile,
                winnerRank: w.drawRank,
                isWinning: winEval.isGenuine,
                winningTag: winEval.tag,
                isOfficialDomain: false,
                source: 'nivea_winner_sync',
                contentComplete: true,
                bodyStatus: 'available',
                bodyStored: true,
                hasAttachments: Boolean((msg.attachments && msg.attachments.length) || (normalized.attachments && normalized.attachments.length)),
                attachments: (msg.attachments && msg.attachments.length) ? msg.attachments : (normalized.attachments || []),
                createdAt: msg.createdAt || new Date().toISOString(),
                savedLocallyAt: new Date().toISOString()
              };

              toSave.push(fullRecord);
              totalNewMessages++;
            }

            // Save permanently in Cloud Firestore & partitioned memory cache
            await db.saveMessages(email, toSave);

            // Update inbox winning flag if genuine winning email detected
            if (hasNewGenuineWin) {
              const inbox = db.findInboxByEmail(email);
              if (inbox && !inbox.hasWinningMessage) {
                inbox.hasWinningMessage = true;
                inbox.winningTag = '🏆 رسالة مسابقة وفوز مؤكدة';
                await db.saveInbox(inbox);
                try {
                  broadcast('inbox:updated', inbox);
                } catch (_) {}
              }
            }

            // Real-time broadcast to connected UI clients via SSE
            try {
              for (const savedMsg of toSave) {
                broadcast('message:new', { inboxEmail: email, message: content.summary(savedMsg) });
              }
              broadcast('status:counts', db.getStatusCounts());
            } catch (_) {}
          }
        } catch (err) {
          errorCount++;
          console.warn(`⚠️ [NiveaWinnerSync] Error scanning ${email}:`, err.message);
        }

        // Polite delay (400ms) between inboxes to respect API rates and preserve service limits
        await new Promise(r => setTimeout(r, 400));

        if ((i + 1) % 30 === 0 || i === winners.length - 1) {
          console.log(`  ⏳ [NiveaWinnerSync] Progress: ${i + 1}/${winners.length} inboxes scanned...`);
        }
      }

      const durationSeconds = Math.round((Date.now() - startTime) / 1000);
      this.lastScanAt = new Date().toISOString();
      this.nextScanAt = new Date(Date.now() + this.intervalMs).toISOString();
      this.lastStats = {
        totalInboxes: winners.length,
        scannedCount,
        newMessages: totalNewMessages,
        genuineWinningMessages: genuineWinningCount,
        durationSeconds,
        errors: errorCount
      };

      console.log(`\n======================================================`);
      console.log(`✅ [NiveaWinnerSync] 12-Hour Scan Finished in ${durationSeconds}s!`);
      console.log(`   📊 Scanned: ${scannedCount}/${winners.length}`);
      console.log(`   ✉️ New Messages Captured: ${totalNewMessages}`);
      console.log(`   🏆 Genuine Winning Emails: ${genuineWinningCount}`);
      console.log(`   ⏭️ Next Scan Scheduled: ${this.nextScanAt}`);
      console.log(`======================================================\n`);

      return { success: true, stats: this.lastStats };
    } catch (e) {
      console.error('❌ [NiveaWinnerSync] Fatal scan error:', e);
      return { success: false, error: e.message };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start recurring 12-hour timer
   */
  startScheduler() {
    if (this.timer) return;
    console.log(`🚀 [NiveaWinnerSync] 12-Hour Scheduled Worker Activated (Interval: ${this.intervalHours}h)`);

    // Initial check after 25 seconds
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      this.runSync().catch(err => console.error('Initial sync error:', err.message));
    }, 25000);

    if (this.initialTimer.unref) this.initialTimer.unref();

    this.timer = setInterval(() => {
      this.runSync().catch(err => console.error('Recurring sync error:', err.message));
    }, this.intervalMs);

    if (this.timer.unref) this.timer.unref();
  }

  stopScheduler() {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('⏹️ [NiveaWinnerSync] Scheduled worker stopped.');
  }

  getStatus() {
    return {
      active: !!this.timer,
      isRunning: this.isRunning,
      intervalHours: this.intervalHours,
      lastScanAt: this.lastScanAt,
      nextScanAt: this.nextScanAt,
      lastStats: this.lastStats
    };
  }
}

const defaultWorker = new NiveaWinnerSyncWorker();
module.exports = defaultWorker;
