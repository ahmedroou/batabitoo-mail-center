'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../inbox_server'), 'utf8');
const start = source.indexOf("    if (url.pathname === '/api/official/create'");
const end = source.indexOf('    // 2.1 REAL GMAIL', start);
const route = source.slice(start, end);

async function request(existing, payload) {
  let writes = 0, events = 0;
  const context = {
    url: { pathname: '/api/official/create' }, req: { method: 'POST' },
    parseBody: async () => payload,
    sendJSON: (status, body) => ({ status, body }),
    validators: require('../validators'), crypto: require('node:crypto'),
    broadcast: () => { events++; },
    db: { findInboxByEmail: () => existing, getDeletedAmazonAccounts: () => [], getStatusCounts: () => ({}), saveInbox: async item => { writes++; return item; } },
  };
  const result = await vm.runInNewContext(`(async () => { ${route} })()`, context);
  return { ...result, writes, events };
}

test('re-discovering an existing alias does not reset dates, message count or ban decision', async () => {
  const existing = { id: 'persist', email: 'u.ser@gmail.com', createdAt: '2026-01-01', messageCount: 8, isAmazon: true, isDottedGmailAlias: true, isBanned: true, banStatus: 'confirmed' };
  for (let i = 0; i < 20; i++) {
    const result = await request(existing, { email: existing.email, isAmazon: true, isDottedGmailAlias: true });
    assert.equal(result.writes, 0);
    assert.equal(result.events, 0);
    assert.equal(result.body.inbox, existing);
    assert.equal(result.status, 200);
  }
});

test('alias metadata can be upgraded without erasing existing mailbox data', async () => {
  const existing = { id: 'persist', email: 'u.ser@gmail.com', createdAt: '2026-01-01', messageCount: 8, banStatus: 'confirmed' };
  const result = await request(existing, { email: existing.email, isAmazon: true, isDottedGmailAlias: true, parentEmail: 'user@gmail.com' });
  assert.equal(result.writes, 1);
  assert.equal(result.body.inbox.messageCount, 8);
  assert.equal(result.body.inbox.createdAt, '2026-01-01');
  assert.equal(result.body.inbox.banStatus, 'confirmed');
});

test('new account identity is deterministic across concurrent registration attempts', async () => {
  const [a, b] = await Promise.all([request(null, { email: 'u.ser@gmail.com' }), request(null, { email: 'u.ser@gmail.com' })]);
  assert.equal(a.body.inbox.id, b.body.inbox.id);
  assert.equal(a.status, 200);
});
