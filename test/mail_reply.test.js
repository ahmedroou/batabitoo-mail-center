'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { simpleParser } = require('mailparser');
const { createMailReply, firestoreReplyStore } = require('../lib/mailReply');

function fixture(options = {}) {
  const records = options.records || new Map();
  const sent = [];
  const accounts = options.accounts || [
    { email: 'owner@gmail.com', authType: 'oauth2', accessToken: 'test-owner', refreshToken: 'refresh', status: 'connected' },
    { email: 'other@gmail.com', authType: 'oauth2', accessToken: 'test-other', status: 'connected' },
  ];
  const store = { get: async k => records.get(k), claim: async (k, v) => { const prev = records.get(k); if (!prev) records.set(k, v); return prev; },
    finish: async (k, v) => { records.set(k, v); }, remove: async k => records.delete(k) };
  let refreshes = 0;
  const gmail = { loadAccounts: () => accounts, refreshAccountToken: async () => { refreshes++; return 'renewed-token'; } };
  const fetchImpl = async (url, init) => {
    if (url.includes('messages/send')) {
      sent.push({ ...JSON.parse(init.body), token: init.headers.Authorization });
      if (options.send) return options.send(sent.length);
      return { ok: true, status: 200, json: async () => ({ id: 'sent-id', threadId: 'original-thread' }) };
    }
    return { ok: true, status: 200, json: async () => ({ threadId: 'original-thread', payload: { headers: [
      { name: 'From', value: 'Sender <sender@example.com>' }, { name: 'Reply-To', value: options.replyTo || 'support@example.com' },
      { name: 'Subject', value: 'موضوع أصلي' }, { name: 'Message-ID', value: '<original@example.com>' },
      { name: 'References', value: '<earlier@example.com>' },
    ] } }) };
  };
  const service = createMailReply({ gmail, store, fetchImpl, smtp: options.smtp, imapMetadata: options.imapMetadata });
  const message = { id: 'gmail_oauth_abc123', inboxEmail: 'o.wner@gmail.com', parentEmail: 'owner@gmail.com', from: 'sender@example.com' };
  const payload = { text: 'مرحبًا، هذا هو الرد\nThank you', from: 'owner@gmail.com', to: 'support@example.com', requestId: 'test-request-000001' };
  return { service, message, payload, sent, records, refreshes: () => refreshes };
}

test('reply selects original account, respects Reply-To, and preserves Unicode/thread headers', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.context(f.message), { success: true, from: 'owner@gmail.com', to: 'support@example.com', subject: 'Re: موضوع أصلي' });
  assert.equal((await f.service.send(f.message, f.payload)).success, true);
  assert.equal(f.sent[0].token, 'Bearer test-owner');
  assert.equal(f.sent[0].threadId, 'original-thread');
  const mail = await simpleParser(Buffer.from(f.sent[0].raw, 'base64url'));
  assert.equal(mail.from.value[0].address, 'owner@gmail.com');
  assert.equal(mail.to.value[0].address, 'support@example.com');
  assert.equal(mail.inReplyTo, '<original@example.com>');
  assert.deepEqual(mail.references, ['<earlier@example.com>', '<original@example.com>']);
  assert.equal(mail.subject, 'Re: موضوع أصلي');
  assert.equal(mail.text.trim(), f.payload.text);
});

test('repeated request across service instances returns saved receipt without resending', async () => {
  const f = fixture();
  const first = await f.service.send(f.message, f.payload);
  const second = fixture({ records: f.records });
  assert.deepEqual(await second.service.send(f.message, f.payload), first);
  assert.equal(second.sent.length, 0);
  await assert.rejects(f.service.send(f.message, { ...f.payload, text: 'changed' }), { code: 'REPLY_REQUEST_CONFLICT' });
});

test('simultaneous duplicate requests send once', async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.service.send(f.message, f.payload), f.service.send(f.message, f.payload)]);
  assert.equal(f.sent.length, 1);
  assert.ok(results.some(r => r.status === 'fulfilled'));
  for (const result of results) if (result.status === 'fulfilled') assert.equal(result.value.messageId, 'sent-id');
});

test('account cannot be overridden by client or forged parent email', async () => {
  const f = fixture();
  await assert.rejects(f.service.send(f.message, { ...f.payload, from: 'other@gmail.com' }), { code: 'REPLY_CONTEXT_CHANGED' });
  await assert.rejects(f.service.context({ ...f.message, inboxEmail: 'unlinked@gmail.com', parentEmail: 'owner@gmail.com' }), { code: 'GMAIL_RECONNECT_REQUIRED' });
  await assert.rejects(f.service.context({ ...f.message, inboxEmail: 'box@batabitoo.com', parentEmail: 'owner@gmail.com' }), { code: 'REPLY_UNSUPPORTED' });
  assert.equal(f.sent.length, 0);
});

test('dotted and plus Gmail aliases reply through their original Google identity', async () => {
  const f = fixture();
  assert.equal((await f.service.context({ ...f.message, inboxEmail: 'o.w.ner+shop@gmail.com' })).from, 'owner@gmail.com');
});

test('unsafe recipient headers, empty text, and missing original ID do not send', async () => {
  const f = fixture({ replyTo: 'safe@example.com\r\nBcc: evil@example.com' });
  await assert.rejects(f.service.context(f.message), { code: 'INVALID_ADDRESS' });
  await assert.rejects(f.service.send(f.message, { ...f.payload, text: ' ' }), { code: 'INVALID_REPLY' });
  const other = fixture();
  await assert.rejects(other.service.context({ ...other.message, id: 'legacy', from: 'sender@example.com' }), { code: 'REPLY_METADATA_MISSING' });
  assert.equal(f.sent.length, 0);
});

test('scope rejection is visible and keeps request available after relinking', async () => {
  const f = fixture({ send: async () => ({ ok: false, status: 403, json: async () => ({}) }) });
  await assert.rejects(f.service.send(f.message, f.payload), { code: 'GMAIL_RECONNECT_REQUIRED' });
  assert.equal(f.records.size, 0);
});

test('expired token is renewed, only definitive 401 is retried', async () => {
  const f = fixture({ send: async count => ({ ok: count > 1, status: count > 1 ? 200 : 401, json: async () => ({ id: 'sent-id' }) }) });
  assert.equal((await f.service.send(f.message, f.payload)).success, true);
  assert.equal(f.refreshes(), 1);
  assert.equal(f.sent[1].token, 'Bearer renewed-token');
});

test('timeout after POST remains uncertain and cannot resend after restart', async () => {
  const f = fixture({ send: async () => { throw new Error('connection dropped'); } });
  await assert.rejects(f.service.send(f.message, f.payload), { code: 'REPLY_SEND_UNCERTAIN' });
  const restarted = fixture({ records: f.records });
  await assert.rejects(restarted.service.send(f.message, f.payload), { code: 'REPLY_SEND_UNCERTAIN' });
  assert.equal(restarted.sent.length, 0);
});

test('app-password reply uses Gmail TLS SMTP and stored RFC metadata', async () => {
  let smtpOptions, outgoing;
  const f = fixture({ accounts: [{ email: 'owner@gmail.com', authType: 'app_password', appPassword: 'test-password' }],
    smtp: opts => { smtpOptions = opts; return { sendMail: async mail => { outgoing = mail; return { accepted: ['support@example.com'], messageId: 'smtp-id' }; }, close() {} }; } });
  const message = { ...f.message, fromAddress: 'sender@example.com', replyTo: 'support@example.com', rfcMessageId: '<imap-original@example.com>', subject: 'Re: original' };
  assert.equal((await f.service.send(message, f.payload)).messageId, 'smtp-id');
  assert.equal(smtpOptions.secure, true);
  assert.equal(smtpOptions.host, 'smtp.gmail.com');
  assert.equal(outgoing.envelope.from, 'owner@gmail.com');
  const mail = await simpleParser(outgoing.raw);
  assert.equal(mail.inReplyTo, '<imap-original@example.com>');
  assert.equal(mail.subject, 'Re: original');
});

test('Firestore claim store preserves receipt and atomically rejects duplicate claims', async () => {
  const records = new Map();
  const db = { collection: name => ({ doc: id => ({ key: `${name}/${id}`, get: async () => ({ exists: records.has(`${name}/${id}`), data: () => records.get(`${name}/${id}`) }),
    set: async data => records.set(`${name}/${id}`, data), delete: async () => records.delete(`${name}/${id}`) }) }),
    runTransaction: task => task({ get: ref => ref.get(), set: (ref, data) => records.set(ref.key, data) }) };
  const store = firestoreReplyStore(db);
  assert.equal(await store.claim('key', { status: 'pending' }), null);
  assert.deepEqual(await store.claim('key', { status: 'new' }), { status: 'pending' });
  await store.finish('key', { status: 'sent' });
  assert.deepEqual(await store.get('key'), { status: 'sent' });
  await store.remove('key');
  assert.equal(await store.get('key'), null);
});

test('legacy IMAP messages recover Reply-To and RFC headers from their own mailbox', async () => {
  let mailbox;
  const f = fixture({ accounts: [{ email: 'owner@gmail.com', authType: 'app_password', appPassword: 'test-password' }],
    imapMetadata: async (account, uid) => { mailbox = [account.email, uid]; return { from: 'sender@example.com', replyTo: 'help@example.com', messageId: '<old@example.com>', subject: 'Old' }; } });
  const context = await f.service.context({ ...f.message, id: 'gmail_imap_owner_gmail_com_12', gmailUid: 12, from: 'Sender display name' });
  assert.deepEqual(mailbox, ['owner@gmail.com', 12]);
  assert.equal(context.to, 'help@example.com');
});

test('known read-only grant requests relinking before sending', async () => {
  const f = fixture({ accounts: [{ email: 'owner@gmail.com', authType: 'oauth2', accessToken: 'test-owner', scopes: 'https://www.googleapis.com/auth/gmail.readonly' }] });
  await assert.rejects(f.service.context(f.message), { code: 'GMAIL_RECONNECT_REQUIRED' });
  assert.equal(f.sent.length, 0);
});

test('provider 5xx does not make a potentially sent reply retryable', async () => {
  const f = fixture({ send: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  await assert.rejects(f.service.send(f.message, f.payload), { code: 'REPLY_SEND_UNCERTAIN' });
  await assert.rejects(f.service.send(f.message, f.payload), { code: 'REPLY_SEND_UNCERTAIN' });
  assert.equal(f.sent.length, 1);
});
