const https = require('https');

class RealInboxService {
  constructor() {
    this.allDomains = [
      'getairmail.com',
      'getnada.com',
      'inboxbear.com',
      'replyloop.com',
      'robot-mail.com',
      'dropjar.com',
      'fivermail.com',
      'getmule.com',
      'temptami.com',
      'vomoto.com',
      'tupmail.com',
      'tafmail.com',
      'clowmail.com',
      'chapsmail.com',
      'blondmail.com',
      'gimpmail.com',
      'givmail.com',
      'guysmail.com',
      'emalupe.com',
      'westcast-systems.com'
    ];

    this.lastUsedDomainIndex = 0;
  }

  request(url, options = {}, data = null) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json',
          ...(options.headers || {})
        },
        timeout: 8000
      };

      if (data) {
        const bodyStr = typeof data === 'string' ? data : JSON.stringify(data);
        reqOptions.headers['Content-Type'] = 'application/json';
        reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);
      }

      const req = https.request(reqOptions, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(body); } catch(e) { parsed = body; }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const err = new Error(typeof parsed === 'object' ? (parsed.message || JSON.stringify(parsed)) : `HTTP ${res.statusCode}`);
            err.statusCode = res.statusCode;
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });

      if (data) {
        req.write(typeof data === 'string' ? data : JSON.stringify(data));
      }
      req.end();
    });
  }

  // Get Next Domain (Round-Robin Shuffle to guarantee equal distribution across all 20 domains)
  getNextDomain() {
    this.lastUsedDomainIndex = (this.lastUsedDomainIndex + 1) % this.allDomains.length;
    return this.allDomains[this.lastUsedDomainIndex];
  }

  // Create a real inbox with guaranteed domain diversity
  async createInbox(customPrefix = 'user') {
    const cleanPrefix = customPrefix.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
    const randDigits = Math.floor(1000 + Math.random() * 9000).toString();
    const fullPrefix = `${cleanPrefix}${randDigits}`;
    const password = `SecretPass!${Math.floor(1000 + Math.random() * 9000)}#`;

    // Pick domain from the 20 domains pool
    const domain = this.getNextDomain();
    const email = `${fullPrefix}@${domain}`;

    // If domain is emalupe.com or westcast-systems.com, register on mail.tm / mail.gw
    if (domain === 'emalupe.com' || domain === 'westcast-systems.com') {
      const host = domain === 'emalupe.com' ? 'api.mail.tm' : 'api.mail.gw';
      try {
        const accRes = await this.request(`https://${host}/accounts`, { method: 'POST' }, {
          address: email,
          password: password
        });

        const tokenRes = await this.request(`https://${host}/token`, { method: 'POST' }, {
          address: email,
          password: password
        });

        return {
          provider: host,
          host: host,
          email: email,
          domain: domain,
          password: password,
          token: tokenRes.token,
          accountId: accRes.id,
          createdAt: new Date().toISOString()
        };
      } catch(e) {}
    }

    // For all other 18 inboxes.com domains:
    return {
      provider: 'inboxes.com',
      host: 'inboxes.com',
      email: email,
      domain: domain,
      password: password,
      token: null,
      accountId: email,
      createdAt: new Date().toISOString()
    };
  }

  // Get messages for an inbox
  async getMessages(inbox) {
    if (!inbox || !inbox.email) return [];

    if (inbox.provider === 'inboxes.com' || inbox.host === 'inboxes.com') {
      try {
        const res = await this.request(`https://inboxes.com/api/v2/inbox/${encodeURIComponent(inbox.email)}`);
        const msgs = res.msgs || [];
        return msgs.map(m => ({
          id: m.uid,
          from: { address: m.fe || m.f, name: m.f },
          to: [{ address: inbox.email }],
          subject: m.s || '(بدون عنوان)',
          intro: m.s || '',
          createdAt: m.dt || new Date().toISOString()
        }));
      } catch(e) {
        return [];
      }
    }

    const host = inbox.host || 'api.mail.tm';
    try {
      const res = await this.request(`https://${host}/messages`, {
        headers: { 'Authorization': `Bearer ${inbox.token}` }
      });
      return Array.isArray(res) ? res : (res['hydra:member'] || []);
    } catch(e) {
      return [];
    }
  }

  // Get single message details
  async getMessage(inbox, messageId) {
    if (!inbox || !messageId) return null;

    if (inbox.provider === 'inboxes.com' || inbox.host === 'inboxes.com') {
      try {
        const res = await this.request(`https://inboxes.com/api/v2/message/${encodeURIComponent(messageId)}`);
        return {
          id: res.uid || messageId,
          from: { address: res.fe || res.f, name: res.f },
          to: [{ address: inbox.email }],
          subject: res.s || '(بدون عنوان)',
          intro: res.text ? res.text.slice(0, 100) : res.s,
          text: res.text || '',
          html: res.html || '',
          raw: res.raw || '',
          attachments: res.attachments || [],
          createdAt: res.dt || new Date().toISOString()
        };
      } catch(e) {
        return null;
      }
    }

    const host = inbox.host || 'api.mail.tm';
    try {
      return await this.request(`https://${host}/messages/${messageId}`, {
        headers: { 'Authorization': `Bearer ${inbox.token}` }
      });
    } catch(e) {
      return null;
    }
  }
}

module.exports = RealInboxService;
