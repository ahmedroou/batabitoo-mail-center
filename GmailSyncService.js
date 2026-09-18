const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const db = require('./InboxDatabase');
const content = require('./MailContent');
const emailParser = require('./EmailParser');

const CONNECTIONS_FILE = path.join(__dirname, 'gmail_connections.json');
const OAUTH_CONFIG_FILE = path.join(__dirname, 'google_oauth_config.json');

class GmailSyncService {
  constructor() {
    this.clients = new Map();
    this.loadAccounts();
  }

  loadAccounts() {
    try {
      if (fs.existsSync(CONNECTIONS_FILE)) {
        return JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf8'));
      }
    } catch (e) {
      console.error('⚠️ Error reading gmail_connections.json:', e.message);
    }
    return [];
  }

  saveAccounts(accounts) {
    try {
      fs.writeFileSync(CONNECTIONS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
    } catch (e) {
      console.error('⚠️ Error writing gmail_connections.json:', e.message);
    }
  }

  getOAuthConfig() {
    try {
      if (fs.existsSync(OAUTH_CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(OAUTH_CONFIG_FILE, 'utf8'));
      }
    } catch (e) {}
    return {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirectUri: process.env.GOOGLE_REDIRECT_URI || ''
    };
  }

  saveOAuthConfig(config) {
    fs.writeFileSync(OAUTH_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
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
      this.saveAccounts(accounts);

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

  async connectOAuth({ email, refreshToken, accessToken, personName }) {
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
    this.saveAccounts(accounts);

    this.syncAccount(cleanEmail).catch(() => {});

    return { success: true, email: cleanEmail, inbox: inboxRecord };
  }

  async disconnect(email) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    this.stopListener(cleanEmail);

    const accounts = this.loadAccounts().filter(a => a.email !== cleanEmail);
    this.saveAccounts(accounts);

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
                await this.fetchNewMessages(client, email, lastUid, (newMaxUid) => {
                  lastUid = newMaxUid;
                  this.updateAccountField(email, 'lastSeenUid', lastUid);
                  this.updateAccountField(email, 'lastSyncAt', new Date().toISOString());
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
        const msgId = `gmail_${email.replace(/[^a-z0-9]/g, '_')}_${message.uid}_${Date.now()}`;

        const fromAddress = parsed.from?.value?.[0]?.address || parsed.from?.text || 'unknown';
        const fromName = parsed.from?.value?.[0]?.name || parsed.from?.text || fromAddress;
        const subject = parsed.subject || '(بدون موضوع)';
        const textContent = parsed.text || '';
        const htmlContent = parsed.html || parsed.textAsHtml || textContent;

        const rawPayload = {
          id: msgId,
          from: { address: fromAddress, name: fromName },
          to: [{ address: email }],
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
          to: email,
          inboxEmail: email,
          isOfficialDomain: true,
          domain: 'gmail.com',
          isRealGmail: true,
          gmailUid: message.uid,
          createdAt: rawPayload.createdAt
        };

        messagesToSave.push(messageRecord);
        console.log(`✅ [GmailSync] Parsed incoming message: "${subject}" from ${fromAddress} for ${email} (OTP: ${messageRecord.otp || 'None'})`);
      } catch (err) {
        console.error(`⚠️ [GmailSync] Error parsing message uid ${message.uid}:`, err.message);
      }
    }

    if (messagesToSave.length > 0) {
      await db.saveMessages(email, messagesToSave);
      const accs = this.loadAccounts();
      const a = accs.find(x => x.email === email);
      if (a) {
        a.syncedCount = (a.syncedCount || 0) + messagesToSave.length;
        this.saveAccounts(accs);
      }
    }

    if (onUidUpdate) onUidUpdate(maxSeen);
  }

  async syncAccount(email) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const accounts = this.loadAccounts();
    const account = accounts.find(a => a.email === cleanEmail);
    if (!account) throw new Error('الحساب غير موجود');

    if (account.authType === 'app_password' && account.appPassword) {
      const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user: cleanEmail, pass: account.appPassword },
        logger: false
      });

      await client.connect();
      try {
        const lock = await client.getMailboxLock('INBOX');
        try {
          const lastUid = account.lastSeenUid || Math.max(1, (client.mailbox.uidNext || 10) - 5);
          await this.fetchNewMessages(client, cleanEmail, lastUid, (newUid) => {
            this.updateAccountField(cleanEmail, 'lastSeenUid', newUid);
            this.updateAccountField(cleanEmail, 'lastSyncAt', new Date().toISOString());
          });
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => {});
      }
    } else if (account.authType === 'oauth2' && account.refreshToken) {
      await this.syncViaGmailApi(account);
    }

    return { success: true, email: cleanEmail };
  }

  async syncViaGmailApi(account) {
    const config = this.getOAuthConfig();
    if (!config.clientId || !config.clientSecret) {
      throw new Error('لم يتم إعداد Google OAuth Client ID و Secret');
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: account.refreshToken,
        grant_type: 'refresh_token'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error('فشل تجديد رمز الوصول من جوجل: ' + (tokenData.error_description || tokenData.error));
    }

    const accessToken = tokenData.access_token;
    account.accessToken = accessToken;
    this.updateAccountField(account.email, 'accessToken', accessToken);

    const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=newer_than:2d', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const listData = await listRes.json();
    const messages = listData.messages || [];

    const messagesToSave = [];
    for (const item of messages) {
      const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=raw`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const msgData = await msgRes.json();
      if (!msgData.raw) continue;

      const rawBuffer = Buffer.from(msgData.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      const parsed = await simpleParser(rawBuffer);

      const msgId = `gmail_oauth_${item.id}`;
      const fromAddress = parsed.from?.value?.[0]?.address || parsed.from?.text || 'unknown';
      const fromName = parsed.from?.value?.[0]?.name || parsed.from?.text || fromAddress;
      const subject = parsed.subject || '(بدون موضوع)';
      const textContent = parsed.text || '';
      const htmlContent = parsed.html || parsed.textAsHtml || textContent;

      const rawPayload = {
        id: msgId,
        from: { address: fromAddress, name: fromName },
        to: [{ address: account.email }],
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
        to: account.email,
        inboxEmail: account.email,
        isOfficialDomain: true,
        domain: 'gmail.com',
        isRealGmail: true,
        createdAt: rawPayload.createdAt
      });
    }

    if (messagesToSave.length > 0) {
      await db.saveMessages(account.email, messagesToSave);
      this.updateAccountField(account.email, 'lastSyncAt', new Date().toISOString());
    }
  }

  updateAccountField(email, field, value) {
    const accs = this.loadAccounts();
    const a = accs.find(x => x.email === email);
    if (a) {
      a[field] = value;
      this.saveAccounts(accs);
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
  }
}

const gmailSync = new GmailSyncService();
module.exports = gmailSync;
