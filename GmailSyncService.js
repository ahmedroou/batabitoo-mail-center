const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const db = require('./InboxDatabase');
const { mailDatabase } = require('./CloudDatabase');
const content = require('./MailContent');
const emailParser = require('./EmailParser');
const { broadcast } = require('./eventBus');

function canonicalGmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean.endsWith('@gmail.com')) return clean;
  const [user] = clean.split('@');
  return user.replace(/\./g, '') + '@gmail.com';
}

const DEFAULT_GOOGLE_CLIENT_ID = '13228089590-38ofl0b0j69oqqr1bmr9s6mg0hbdv56n.apps.googleusercontent.com';

class GmailSyncService {
  constructor() {
    this.clients = new Map();
    this.oauthSyncTimer = null;
    this.oauthSyncRunning = false;
    this.readyPromise = mailDatabase.ready().then(async () => {
      await this.seedOAuthConfig();
    }).catch(err => {
      console.warn('⚠️ [GmailSync] mailDatabase ready error:', err.message);
    });
  }

  async seedOAuthConfig() {
    try {
      const existing = mailDatabase.getSetting('google_oauth_config');
      if (!existing) {
        const configPath = path.join(__dirname, 'google_oauth_config.json');
        if (fs.existsSync(configPath)) {
          const raw = fs.readFileSync(configPath, 'utf8');
          const parsed = JSON.parse(raw);
          if (parsed && (parsed.clientId || parsed.clientSecret)) {
            await mailDatabase.setSetting('google_oauth_config', JSON.stringify(parsed));
            console.log('✅ [GmailSync] Seeded google_oauth_config into Firestore settings.');
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ [GmailSync] Could not seed google_oauth_config:', e.message);
    }
  }

  loadAccounts() {
    const rows = mailDatabase.getOAuthAccounts();
    return rows.map(r => ({
      email: r.email,
      authType: r.authType || r.auth_type || 'app_password',
      personName: r.personName || r.person_name || r.email.split('@')[0],
      refreshToken: r.refreshToken || r.refresh_token || null,
      accessToken: r.accessToken || r.access_token || null,
      expiryDate: r.expiryDate || r.expiry_date || null,
      status: r.status || 'connected',
      lastError: r.lastError || r.last_error || null,
      lastSyncAt: r.lastSyncAt || r.last_sync_at || null,
      connectedAt: r.connectedAt || r.connected_at || null,
      syncedCount: Number(r.syncedCount ?? r.synced_count ?? 0),
      appPassword: r.appPassword || r.app_password || null,
      lastSeenUid: Number(r.lastSeenUid ?? r.last_seen_uid ?? 0) || null,
      gmailHistoryId: r.gmailHistoryId || r.gmail_history_id || null
    }));
  }

  findAccount(email) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const canonical = canonicalGmail(cleanEmail);
    const accounts = this.loadAccounts();
    let found = accounts.find(a => {
      const aEmail = String(a.email || '').trim().toLowerCase();
      return aEmail === cleanEmail || canonicalGmail(aEmail) === canonical;
    });
    if (!found) {
      const direct = mailDatabase.getOAuthAccount(cleanEmail);
      if (direct) {
        found = {
          email: direct.email,
          authType: direct.authType || direct.auth_type || 'oauth2',
          personName: direct.personName || direct.person_name || direct.email.split('@')[0],
          refreshToken: direct.refreshToken || direct.refresh_token || null,
          accessToken: direct.accessToken || direct.access_token || null,
          expiryDate: direct.expiryDate || direct.expiry_date || null,
          status: direct.status || 'connected',
          lastError: direct.lastError || direct.last_error || null,
          lastSyncAt: direct.lastSyncAt || direct.last_sync_at || null,
          connectedAt: direct.connectedAt || direct.connected_at || null,
          syncedCount: Number(direct.syncedCount ?? direct.synced_count ?? 0),
          appPassword: direct.appPassword || direct.app_password || null,
          lastSeenUid: Number(direct.lastSeenUid ?? direct.last_seen_uid ?? 0) || null,
          gmailHistoryId: direct.gmailHistoryId || direct.gmail_history_id || null
        };
      }
    }
    if (!found) {
      try {
        const allInboxes = mailDatabase.getAllInboxes ? mailDatabase.getAllInboxes() : (db.getAllInboxes ? db.getAllInboxes() : []);
        const inbox = allInboxes.find(i => {
          const iEmail = String(i.email || '').trim().toLowerCase();
          return iEmail === cleanEmail || canonicalGmail(iEmail) === canonical;
        });
        if (inbox && inbox.parentEmail) {
          const parentClean = String(inbox.parentEmail).trim().toLowerCase();
          const parentCanonical = canonicalGmail(parentClean);
          found = accounts.find(a => {
            const aEmail = String(a.email || '').trim().toLowerCase();
            return aEmail === parentClean || canonicalGmail(aEmail) === parentCanonical;
          });
        }
      } catch (_) {}
    }

    return found || null;
  }

  async saveAccounts(accounts) {
    if (!Array.isArray(accounts)) return;
    for (const acc of accounts) {
      await mailDatabase.saveOAuthAccount(acc);
    }
  }

  getOAuthConfig() {
    const raw = mailDatabase.getSetting('google_oauth_config');
    if (raw) {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && (parsed.clientSecret || parsed.clientId)) {
          return {
            clientId: parsed.clientId || process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID,
            clientSecret: parsed.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '',
            redirectUri: parsed.redirectUri || process.env.GOOGLE_REDIRECT_URI || ''
          };
        }
      } catch (_) {}
    }

    // Fallback to reading google_oauth_config.json from project root
    try {
      const configPath = path.join(__dirname, 'google_oauth_config.json');
      if (fs.existsSync(configPath)) {
        const fileContent = fs.readFileSync(configPath, 'utf8');
        const fileConfig = JSON.parse(fileContent);
        if (fileConfig && (fileConfig.clientSecret || fileConfig.clientId)) {
          if (!raw && mailDatabase.ready) {
            mailDatabase.ready().then(() => {
              if (!mailDatabase.getSetting('google_oauth_config')) {
                mailDatabase.setSetting('google_oauth_config', JSON.stringify(fileConfig)).catch(() => {});
              }
            }).catch(() => {});
          }
          return {
            clientId: fileConfig.clientId || process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID,
            clientSecret: fileConfig.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '',
            redirectUri: fileConfig.redirectUri || process.env.GOOGLE_REDIRECT_URI || ''
          };
        }
      }
    } catch (_) {}

    return {
      clientId: process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirectUri: process.env.GOOGLE_REDIRECT_URI || ''
    };
  }

  async saveOAuthConfig(config) {
    return mailDatabase.setSetting('google_oauth_config', JSON.stringify(config));
  }

  getAccounts() {
    const list = this.loadAccounts();
    return list.map(acc => {
      const active = this.clients.get(acc.email);
      return {
        email: acc.email,
        authType: acc.authType || 'app_password',
        personName: acc.personName || acc.email.split('@')[0],
        status: active?.status || acc.status || 'disconnected',
        lastError: active?.lastError || acc.lastError || null,
        lastSyncAt: acc.lastSyncAt || null,
        connectedAt: acc.connectedAt || null,
        syncedCount: acc.syncedCount || 0
      };
    });
  }

  async connectAppPassword({ email, appPassword, personName }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPass = String(appPassword || '').replace(/\s+/g, '');
    const cleanName = String(personName || cleanEmail.split('@')[0]).trim();

    if (!cleanEmail.endsWith('@gmail.com')) {
      throw new Error('يجب أن يكون البريد ينتهي بـ @gmail.com');
    }
    if (!cleanPass || cleanPass.length < 16) {
      throw new Error('كلمة مرور التطبيقات يجب أن تتكون من 16 حرفاً (Google App Password)');
    }

    console.log(`🔌 [GmailSync] Testing connection to ${cleanEmail}...`);

    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: cleanEmail,
        pass: cleanPass
      },
      logger: false,
      clientInfo: {
        name: 'Batabitoo Mail Center',
        version: '1.3.5'
      }
    });

    try {
      await client.connect();
      await client.mailboxOpen('INBOX');
      const nextUid = client.mailbox.uidNext || 1;
      await client.logout();
      console.log(`✅ [GmailSync] Authentication successful for ${cleanEmail}. uidNext: ${nextUid}`);

      const inboxRecord = {
        id: `gmail_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`,
        email: cleanEmail,
        domain: 'gmail.com',
        host: 'Gmail (Google Official Real)',
        isOfficial: true,
        type: 'official',
        label: cleanName,
        personName: cleanName,
        isRealGmail: true,
        gmailAuthType: 'app_password',
        createdAt: new Date().toISOString()
      };
      await db.saveInbox(inboxRecord);

      const accounts = this.loadAccounts();
      const idx = accounts.findIndex(a => a.email === cleanEmail);
      const accData = {
        email: cleanEmail,
        appPassword: cleanPass,
        personName: cleanName,
        authType: 'app_password',
        lastSeenUid: nextUid,
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
      await this.saveAccounts(accounts);

      this.startListener(cleanEmail, accData).catch(err => {
        console.error(`⚠️ [GmailSync] Error starting listener for ${cleanEmail}:`, err.message);
      });

      return { success: true, email: cleanEmail, inbox: inboxRecord };
    } catch (err) {
      console.error(`❌ [GmailSync] Auth failed for ${cleanEmail}:`, err.message);
      let arabicError = 'تعذر الاتصال بسيرفرات Gmail. تأكد من صحة البريد وكلمة مرور التطبيقات.';
      if (err.message.includes('Invalid credentials') || err.message.includes('authentication failed')) {
        arabicError = 'كلمة مرور التطبيقات غير صحيحة أو تم رفض تسجيل الدخول من جوجل. يرجى إنشاء كلمة مرور تطبيقات جديدة من myaccount.google.com/apppasswords';
      } else if (err.message.includes('ETIMEDOUT') || err.message.includes('ENOTFOUND')) {
        arabicError = 'تعذر الوصول إلى سيرفرات جوجل (مشكلة في الشبكة أو الاتصال).';
      }
      throw new Error(arabicError);
    }
  }

  async connectOAuth({ email, refreshToken, accessToken, expiryDate, personName }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanName = String(personName || cleanEmail.split('@')[0]).trim();

    if (!cleanEmail.endsWith('@gmail.com')) {
      throw new Error('يجب أن يكون البريد ينتهي بـ @gmail.com');
    }

    const inboxRecord = {
      id: `gmail_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`,
      email: cleanEmail,
      domain: 'gmail.com',
      host: 'Gmail (Google Official Real)',
      isOfficial: true,
      type: 'official',
      label: cleanName,
      personName: cleanName,
      isRealGmail: true,
      gmailAuthType: 'oauth2',
      createdAt: new Date().toISOString()
    };
    await db.saveInbox(inboxRecord);

    const accounts = this.loadAccounts();
    const idx = accounts.findIndex(a => a.email === cleanEmail);
    const accData = {
      email: cleanEmail,
      refreshToken: refreshToken || (idx >= 0 ? accounts[idx].refreshToken : null),
      accessToken: accessToken || null,
      expiryDate: expiryDate || null,
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
    await this.saveAccounts(accounts);

    // Do not tell the user that a mailbox is ready before its first Firestore
    // sync has actually completed. A failed first sync keeps the renewable
    // connection and returns a visible warning instead of failing silently.
    let syncWarning = null;
    let newCount = 0;
    try {
      const syncResult = await this.syncAccount(cleanEmail);
      newCount = Number(syncResult?.newCount || 0);
    } catch (error) {
      syncWarning = error.message;
      await mailDatabase.saveOAuthAccount({ ...accData, lastError: syncWarning, status: 'connected' });
      console.error(`⚠️ [GmailSync] Initial sync failed for ${cleanEmail}:`, syncWarning);
    }

    return { success: true, email: cleanEmail, inbox: inboxRecord, newCount, syncWarning };
  }

  async disconnect(email) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    this.stopListener(cleanEmail);
    await mailDatabase.deleteOAuthAccount(cleanEmail);

    return { success: true, email: cleanEmail };
  }

  stopListener(email) {
    const existing = this.clients.get(email);
    if (existing) {
      existing.isRunning = false;
      try {
        if (existing.client) {
          existing.client.close().catch(() => {});
        }
      } catch (e) {}
      this.clients.delete(email);
    }
  }

  async startListener(email, accountData) {
    this.stopListener(email);

    if (accountData.authType !== 'app_password' || !accountData.appPassword) {
      return;
    }

    const state = {
      client: null,
      isRunning: true,
      status: 'connecting',
      lastError: null
    };
    this.clients.set(email, state);

    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: email,
        pass: accountData.appPassword
      },
      logger: false
    });
    state.client = client;

    const runLoop = async () => {
      while (state.isRunning) {
        try {
          state.status = 'connecting';
          await client.connect();
          state.status = 'connected';
          state.lastError = null;
          console.log(`⚡ [GmailSync] Connected & listening to ${email}`);

          const lock = await client.getMailboxLock('INBOX');
          try {
            let lastUid = accountData.lastSeenUid || client.mailbox.uidNext || 1;

            client.on('exists', async (data) => {
              console.log(`📩 [GmailSync] New message arrival event in ${email}! Total messages: ${data.count}`);
              try {
                await this.fetchNewMessages(client, email, lastUid, async (newMaxUid) => {
                  lastUid = newMaxUid;
                  await this.updateAccountFields(email, { lastSeenUid: lastUid, lastSyncAt: new Date().toISOString() });
                });
              } catch (e) {
                console.error(`⚠️ [GmailSync] Fetch error on arrival:`, e.message);
              }
            });

            while (state.isRunning && client.usable) {
              state.status = 'idle_listening';
              await client.idle();
            }
          } finally {
            lock.release();
          }
        } catch (err) {
          state.status = 'error';
          state.lastError = err.message;
          console.error(`⚠️ [GmailSync] Listener disconnected for ${email}: ${err.message}. Retrying in 15s...`);
          if (state.isRunning) {
            await new Promise(r => setTimeout(r, 15000));
          }
        }
      }
    };

    runLoop().catch(e => {
      console.error(`❌ [GmailSync] Fatal loop error for ${email}:`, e.message);
    });
  }

  async fetchNewMessages(client, email, lastUid, onUidUpdate) {
    if (!client.mailbox) return;
    const currentMax = client.mailbox.uidNext ? client.mailbox.uidNext - 1 : client.mailbox.exists;
    if (!currentMax || currentMax < lastUid) return;

    const range = `${lastUid}:*`;
    console.log(`📥 [GmailSync] Fetching range ${range} for ${email}...`);

    let maxSeen = lastUid;
    const messagesToSave = [];

    for await (const message of client.fetch(range, { uid: true, source: true, envelope: true })) {
      if (!message.uid || message.uid < lastUid) continue;
      if (message.uid >= maxSeen) maxSeen = message.uid + 1;

      try {
        const parsed = await simpleParser(message.source);
        // Gmail UID is stable inside the mailbox. A deterministic ID makes a
        // retry idempotent even if the checkpoint write was interrupted.
        const msgId = `gmail_imap_${email.replace(/[^a-z0-9]/g, '_')}_${message.uid}`;

        // Look for Delivered-To header, or To header preserving dots
        let deliveredTo = '';
        if (parsed.headers) {
          const dTo = parsed.headers.get('delivered-to');
          if (dTo) {
            deliveredTo = typeof dTo === 'string' ? dTo : (dTo.text || dTo.value || '');
          }
        }
        const toAddress = parsed.to?.value?.[0]?.address || parsed.to?.text || '';

        const cleanStr = str => {
          if (!str) return '';
          const mAngle = String(str).match(/<([^>]+)>/);
          if (mAngle) return mAngle[1].trim().toLowerCase();
          const mPlain = String(str).match(/[a-zA-Z0-9_\.\+\-]+@[a-zA-Z0-9_\.\-]+\.[a-zA-Z]{2,}/);
          return mPlain ? mPlain[0].trim().toLowerCase() : String(str).trim().toLowerCase();
        };

        const deliveredClean = cleanStr(deliveredTo);
        const toClean = cleanStr(toAddress);
        const exactRecipient = (deliveredClean && deliveredClean.endsWith('@gmail.com')) ? deliveredClean : (toClean && toClean.endsWith('@gmail.com') ? toClean : email.toLowerCase().trim());
        const isDotted = exactRecipient !== email.toLowerCase().trim();

        const fromAddress = parsed.from?.value?.[0]?.address || parsed.from?.text || 'unknown';
        const fromName = parsed.from?.value?.[0]?.name || parsed.from?.text || fromAddress;
        const subject = parsed.subject || '(بدون موضوع)';
        const textContent = parsed.text || '';
        const htmlContent = parsed.html || parsed.textAsHtml || textContent;

        const rawPayload = {
          id: msgId,
          from: { address: fromAddress, name: fromName },
          to: [{ address: exactRecipient }],
          subject: subject,
          text: textContent,
          html: htmlContent,
          date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
          createdAt: parsed.date ? parsed.date.toISOString() : new Date().toISOString()
        };

        const normalized = await content.normalize(rawPayload, msgId, { complete: true });

        const messageRecord = {
          ...normalized,
          id: msgId,
          to: exactRecipient,
          inboxEmail: exactRecipient,
          exactRecipient: exactRecipient,
          parentEmail: email,
          isOfficialDomain: true,
          domain: 'gmail.com',
          isRealGmail: true,
          isDottedGmailAlias: isDotted,
          contentComplete: true,
          bodyStored: true,
          gmailUid: message.uid,
          createdAt: rawPayload.createdAt
        };

        if (isDotted && exactRecipient.endsWith('@gmail.com')) {
          const dottedInboxId = `gmail_amz_${exactRecipient.replace(/[^a-z0-9]/g, '_')}`;
          await db.saveInbox({
            id: dottedInboxId,
            email: exactRecipient,
            domain: 'gmail.com',
            host: 'Gmail (Dotted Alias)',
            isOfficial: true,
            isAmazon: true,
            isDottedGmailAlias: true,
            parentEmail: email,
            banStatus: 'none',
            isBanned: false,
            type: 'official',
            label: exactRecipient.split('@')[0],
            personName: exactRecipient.split('@')[0],
            createdAt: new Date().toISOString()
          }).catch(() => {});
        }

        messagesToSave.push(messageRecord);
        console.log(`✅ [GmailSync] Parsed incoming message: "${subject}" from ${fromAddress} for ${exactRecipient} (parent: ${email}) (OTP: ${messageRecord.otp || 'None'})`);
      } catch (err) {
        console.error(`⚠️ [GmailSync] Error parsing message uid ${message.uid}:`, err.message);
      }
    }

    if (messagesToSave.length > 0) {
      const insertedCount = await db.saveMessages(email, messagesToSave);
      if (insertedCount > 0) {
        broadcast('message:new', { inboxEmail: email, count: insertedCount });
        broadcast('status:counts', db.getStatusCounts());
      }
      for (const m of messagesToSave) {
        if (m.exactRecipient && m.exactRecipient !== email) {
          await db.saveMessages(m.exactRecipient, [m]).catch(() => {});
        }
      }
      const accs = this.loadAccounts();
      const a = accs.find(x => x.email === email);
      if (a && insertedCount > 0) {
        a.syncedCount = (a.syncedCount || 0) + insertedCount;
        await this.saveAccounts(accs);
      }
    }

    if (onUidUpdate) await onUidUpdate(maxSeen);
  }

  async syncAccount(email, options = {}) {
    this.pendingSyncs ||= new Map();
    const key = canonicalGmail(String(email || '').trim().toLowerCase());
    const pending = this.pendingSyncs.get(key);
    if (pending) {
      if (!options.accessToken) return pending;
      await pending.catch(() => {});
    }
    const run = this._syncAccount(email, options);
    this.pendingSyncs.set(key, run);
    try { return await run; }
    finally { if (this.pendingSyncs.get(key) === run) this.pendingSyncs.delete(key); }
  }

  async _syncAccount(email, options = {}) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    let account = this.findAccount(cleanEmail);

    if (options.accessToken) {
      if (account) {
        account.accessToken = options.accessToken;
        account.status = 'connected';
        account.lastError = null;
        await this.updateAccountField(account.email, 'accessToken', options.accessToken);
      } else {
        account = {
          email: cleanEmail,
          accessToken: options.accessToken,
          refreshToken: null,
          personName: cleanEmail.split('@')[0],
          authType: 'oauth2',
          status: 'connected',
          connectedAt: new Date().toISOString(),
          lastSyncAt: new Date().toISOString(),
          syncedCount: 0
        };
        const allAccs = this.loadAccounts();
        allAccs.push(account);
        await this.saveAccounts(allAccs);
      }
    }

    if (!account) {
      const allInboxes = db.getAllInboxes ? db.getAllInboxes() : [];
      const canonical = canonicalGmail(cleanEmail);
      const inboxExists = allInboxes.some(i => {
        const iEmail = String(i.email || '').trim().toLowerCase();
        return iEmail === cleanEmail || canonicalGmail(iEmail) === canonical;
      });

      if (inboxExists) {
        throw new Error(`حساب Gmail (${cleanEmail}) غير متصل بمصادقة Google. يرجى الضغط على [ربط حساب Google] لربطه أولاً.`);
      }
      throw new Error(`صندوق البريد (${cleanEmail}) غير مسجل في النظام. أضف الصندوق أولاً.`);
    }

    if (account.authType === 'app_password' && account.appPassword) {
      const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user: account.email, pass: account.appPassword },
        logger: false
      });

      await client.connect();
      try {
        const lock = await client.getMailboxLock('INBOX');
        try {
          const lastUid = account.lastSeenUid || Math.max(1, (client.mailbox.uidNext || 10) - 5);
          await this.fetchNewMessages(client, account.email, lastUid, async (newUid) => {
            await this.updateAccountFields(account.email, { lastSeenUid: newUid, lastSyncAt: new Date().toISOString() });
          });
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => {});
      }
    } else if (account.authType === 'oauth2' || account.authType === 'oauth') {
      const newCount = await this.syncViaGmailApi(account, options.accessToken || account.accessToken);
      return { success: true, email: cleanEmail, newCount };
    }

    return { success: true, email: cleanEmail, newCount: 0 };
  }

  async refreshAccountToken(accountOrEmail) {
    const account = typeof accountOrEmail === 'string' ? this.findAccount(accountOrEmail) : accountOrEmail;
    if (!account || !account.refreshToken) return null;
    const config = this.getOAuthConfig();
    const clientId = config.clientId || process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;
    const clientSecret = config.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
    if (!clientSecret) {
      console.warn(`⚠️ [GmailSync] Cannot refresh token for ${account.email}: missing OAuth clientSecret`);
      return null;
    }

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: account.refreshToken,
          grant_type: 'refresh_token'
        })
      });
      const tokenData = await tokenRes.json().catch(() => ({}));
      if (tokenData.access_token) {
        account.accessToken = tokenData.access_token;
        account.status = 'connected';
        account.lastError = null;
        const expiryDate = new Date(Date.now() + Number(tokenData.expires_in || 3600) * 1000).toISOString();
        account.expiryDate = expiryDate;
        await this.updateAccountFields(account.email, { accessToken: tokenData.access_token, expiryDate, status: 'connected', lastError: null });
        return tokenData.access_token;
      } else if (tokenData.error) {
        const errMsg = tokenData.error_description || tokenData.error || 'Token refresh failed';
        await this.updateAccountFields(account.email, {
          lastError: errMsg,
          status: tokenData.error === 'invalid_grant' ? 'auth_expired' : 'refresh_failed',
        });
      }
    } catch (error) {
      await this.updateAccountField(account.email, 'lastError', error.message);
    }
    return null;
  }

  async syncViaGmailApi(account, directAccessToken = null) {
    let accessToken = directAccessToken || account.accessToken;
    const expiresAt = Date.parse(account.expiryDate || 0);
    const expiresSoon = Number.isFinite(expiresAt) && expiresAt <= Date.now() + 2 * 60 * 1000;
    if (account.refreshToken && (!accessToken || expiresSoon)) {
      accessToken = await this.refreshAccountToken(account);
    }

    if (!accessToken) {
      const revoked = this.findAccount(account.email)?.status === 'auth_expired';
      const needsRelink = revoked || !account.refreshToken;
      await this.updateAccountField(account.email, 'status', needsRelink ? 'auth_expired' : 'refresh_failed');
      throw new Error(needsRelink
        ? `حساب Gmail (${account.email}) يحتاج إلى تسجيل الدخول. يرجى الضغط على [ربط حساب Google].`
        : `تعذر تجديد الاتصال مؤقتًا لحساب ${account.email}. ستتم إعادة المحاولة تلقائيًا.`);
    }

    let listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=newer_than:7d', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (listRes.status === 401 && account.refreshToken) {
      console.log(`🔄 [GmailSync] Access token expired for ${account.email}, refreshing via refresh_token...`);
      const newTok = await this.refreshAccountToken(account);
      if (newTok) {
        accessToken = newTok;
        listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=newer_than:7d', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      }
    }

    if (listRes.status === 401) {
      // Preserve a definitive invalid_grant recorded by refreshAccountToken.
      const currentAccount = this.findAccount(account.email);
      const revoked = currentAccount?.status === 'auth_expired';
      await this.updateAccountFields(account.email, {
        status: revoked || !account.refreshToken ? 'auth_expired' : 'refresh_failed',
        lastError: account.refreshToken ? (currentAccount?.lastError || 'Token refresh failed') : 'No renewable credential',
      });
      throw new Error(account.refreshToken
        ? `تعذر تجديد تصريح Google لحساب ${account.email}. تحقق من إعدادات OAuth في الخادم ثم أعد الربط مرة واحدة.`
        : `حساب Gmail (${account.email}) لم يحصل سابقاً على رمز تجديد دائم. أعد ربطه مرة واحدة عبر Google ليبقى متصلاً.`);
    }

    if (!listRes.ok) {
      throw new Error(`تعذر الاتصال بخدمة Gmail (رمز ${listRes.status})`);
    }

    const listData = await listRes.json();
    // Gmail returns the newest window on every poll. Avoid downloading and
    // parsing messages already present in Firestore, and only announce records
    // that were truly inserted during this run.
    const existingIds = new Set(db.getAllMessages().map(message => String(message.id)));
    const messages = (listData.messages || []).filter(item => !existingIds.has(`gmail_oauth_${item.id}`));

    const messagesToSave = [];
    for (const item of messages) {
      const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=raw`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const msgData = await msgRes.json().catch(() => ({}));
      if (!msgData.raw) continue;

      const rawBuffer = Buffer.from(msgData.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      const parsed = await simpleParser(rawBuffer);

      let deliveredTo = '';
      if (parsed.headers) {
        const dTo = parsed.headers.get('delivered-to');
        if (dTo) deliveredTo = typeof dTo === 'string' ? dTo : (dTo.text || dTo.value || '');
      }
      const toAddress = parsed.to?.value?.[0]?.address || parsed.to?.text || '';

      const cleanStr = str => {
        if (!str) return '';
        const mAngle = String(str).match(/<([^>]+)>/);
        if (mAngle) return mAngle[1].trim().toLowerCase();
        const mPlain = String(str).match(/[a-zA-Z0-9_\.\+\-]+@[a-zA-Z0-9_\.\-]+\.[a-zA-Z]{2,}/);
        return mPlain ? mPlain[0].trim().toLowerCase() : String(str).trim().toLowerCase();
      };

      const deliveredClean = cleanStr(deliveredTo);
      const toClean = cleanStr(toAddress);
      const exactRecipient = (deliveredClean && deliveredClean.endsWith('@gmail.com')) ? deliveredClean : (toClean && toClean.endsWith('@gmail.com') ? toClean : account.email.toLowerCase().trim());
      const isDotted = exactRecipient !== account.email.toLowerCase().trim();

      const msgId = `gmail_oauth_${item.id}`;
      const fromAddress = parsed.from?.value?.[0]?.address || parsed.from?.text || 'unknown';
      const fromName = parsed.from?.value?.[0]?.name || parsed.from?.text || fromAddress;
      const subject = parsed.subject || '(بدون موضوع)';
      const textContent = parsed.text || '';
      const htmlContent = parsed.html || parsed.textAsHtml || textContent;

      const rawPayload = {
        id: msgId,
        from: { address: fromAddress, name: fromName },
        to: [{ address: exactRecipient }],
        subject: subject,
        text: textContent,
        html: htmlContent,
        date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
        createdAt: parsed.date ? parsed.date.toISOString() : new Date().toISOString()
      };

      const normalized = await content.normalize(rawPayload, msgId, { complete: true });
      messagesToSave.push({
        ...normalized,
        id: msgId,
        to: exactRecipient,
        inboxEmail: exactRecipient,
        exactRecipient: exactRecipient,
        parentEmail: account.email,
        isOfficialDomain: true,
        domain: 'gmail.com',
        isRealGmail: true,
        isDottedGmailAlias: isDotted,
        contentComplete: true,
        bodyStored: true,
        createdAt: rawPayload.createdAt
      });
    }

    let insertedCount = 0;
    if (messagesToSave.length > 0) {
      insertedCount = await db.saveMessages(account.email, messagesToSave);
      if (insertedCount > 0) {
        broadcast('message:new', { inboxEmail: account.email, count: insertedCount });
        broadcast('status:counts', db.getStatusCounts());
      }
    }
    await this.updateAccountFields(account.email, { lastSyncAt: new Date().toISOString(), status: 'connected', lastError: null });
    return insertedCount;
  }

  async updateAccountField(email, field, value) {
    return this.updateAccountFields(email, { [field]: value });
  }

  async updateAccountFields(email, fields) {
    const a = this.findAccount(email);
    if (!a) return false;
    Object.assign(a, fields);
    try {
      await mailDatabase.saveOAuthAccount(a);
      return true;
    } catch (error) {
      console.error(`⚠️ [GmailSync] Could not persist account changes for ${email}:`, error.message);
      return false;
    }
  }

  startAll() {
    const accounts = this.loadAccounts();
    console.log(`🚀 [GmailSync] Initializing ${accounts.length} configured Gmail accounts...`);
    for (const acc of accounts) {
      if (acc.authType === 'app_password' && acc.appPassword) {
        this.startListener(acc.email, acc).catch(err => {
          console.error(`⚠️ [GmailSync] Failed to boot listener for ${acc.email}:`, err.message);
        });
      }
    }

    // OAuth accounts cannot use the browser as a durable token/message cache.
    // Poll them on the server at a conservative one-minute cadence; App
    // Password accounts remain truly real-time through IMAP IDLE above.
    const syncOAuthAccounts = async () => {
      if (this.oauthSyncRunning) return;
      this.oauthSyncRunning = true;
      try {
        const oauthAccounts = this.loadAccounts().filter(account =>
          account.authType === 'oauth2' &&
          account.status !== 'auth_expired' &&
          Boolean(account.refreshToken || account.accessToken)
        );
        for (const account of oauthAccounts) {
          await this.syncAccount(account.email).catch(error => {
            console.error(`⚠️ [GmailSync] OAuth poll failed for ${account.email}:`, error.message);
          });
        }
      } finally {
        this.oauthSyncRunning = false;
      }
    };
    if (!this.oauthSyncTimer) {
      const initialTimer = setTimeout(() => syncOAuthAccounts().catch(() => {}), 5000);
      initialTimer.unref?.();
      this.oauthSyncTimer = setInterval(() => syncOAuthAccounts().catch(() => {}), 60_000);
      this.oauthSyncTimer.unref?.();
    }
  }
}

const gmailSync = new GmailSyncService();
module.exports = gmailSync;
module.exports.canonicalGmail = canonicalGmail;
