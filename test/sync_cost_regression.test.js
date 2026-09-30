'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('cloud jobs have one owner; revoked grants are skipped, connected accounts still sync each minute', async () => {
  let refreshes = 0, serverLoads = 0, tempScans = 0;
  const synced = [];
  const exports = {};
  const requireFake = name => {
    if (name === 'firebase-functions/v2/https') return { onRequest: (options, handler) => ({ options, handler }) };
    if (name === 'firebase-functions/v2/scheduler') return { onSchedule: (options, handler) => ({ options, handler }) };
    if (name === 'firebase-functions/params') return { defineSecret: name => name };
    if (name === './inbox_server') { serverLoads++; return { ready: Promise.resolve() }; }
    if (name === './CloudDatabase') return { mailDatabase: { refreshIfChanged: async () => { refreshes++; } } };
    if (name === './GmailSyncService') return { getAccounts: () => [{ email: 'revoked', status: 'auth_expired' }, { email: 'active', status: 'connected' }, { email: 'retry', status: 'refresh_failed' }], syncAccount: async email => { synced.push(email); } };
    if (name === './TempSyncService') return { syncAllInboxes: async () => { tempScans++; } };
    throw new Error(`Unexpected dependency ${name}`);
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../functions'), 'utf8'), { require: requireFake, exports, console });
  if (exports.syncMail) await exports.syncMail.handler();
  assert.equal(serverLoads, 0);
  assert.equal(refreshes, 0);
  assert.equal(tempScans, 0);
  await exports.syncGmail.handler();
  assert.deepEqual(synced, ['active', 'retry']);
  assert.equal(exports.syncGmail.options.schedule, 'every 1 minutes');
  assert.equal(exports.syncGmail.options.maxInstances, 1);
  // Temporary-mail jobs may be deliberately retired independently. If enabled,
  // only the primary worker may scan; the legacy export must remain a no-op.
  if (exports.syncTempMail) await exports.syncTempMail.handler();
  assert.equal(tempScans, exports.syncTempMail ? 1 : 0);
});

function gmailFixture(fetchResponse = async () => ({ ok: true, status: 200, json: async () => ({ messages: [] }) })) {
  const filename = require.resolve('../GmailSyncService');
  const source = fs.readFileSync(filename, 'utf8').replace('const gmailSync = new GmailSyncService();', 'const gmailSync = Object.create(GmailSyncService.prototype);');
  let saves = 0;
  const account = { email: 'user@gmail.com', accessToken: 'test-token', status: 'connected', authType: 'oauth2' };
  const cloud = { getOAuthAccounts: () => [account], getOAuthAccount: () => account, saveOAuthAccount: async patch => { saves++; Object.assign(account, patch); } };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, __dirname: path.dirname(filename), console, Date, Map, URLSearchParams,
    require: name => {
      if (name === './CloudDatabase') return { mailDatabase: cloud };
      if (name === './InboxDatabase') return { getAllMessages: () => [] };
      if (name === './eventBus') return { broadcast: () => {} };
      if (name === 'fs' || name === 'path') return require(name);
      return {};
    },
    fetch: fetchResponse,
  });
  return { sync: module.exports, account, saves: () => saves };
}

test('Gmail empty poll submits one combined status update instead of three saves', async () => {
  const f = gmailFixture();
  assert.equal(await f.sync.syncViaGmailApi(f.account), 0);
  assert.equal(f.saves(), 1);
});

test('concurrent alias and primary Gmail refresh share one provider request', async () => {
  const f = gmailFixture();
  let requests = 0;
  f.sync._syncAccount = async () => { requests++; await Promise.resolve(); return { success: true }; };
  await Promise.all([f.sync.syncAccount('user@gmail.com'), f.sync.syncAccount('u.ser@gmail.com')]);
  assert.equal(requests, 1);
  assert.equal(f.sync.pendingSyncs.size, 0);
});

test('failed Gmail sync clears in-flight state and allows retry', async () => {
  const f = gmailFixture();
  f.sync._syncAccount = async () => { throw new Error('offline'); };
  await assert.rejects(f.sync.syncAccount('user@gmail.com'), /offline/);
  assert.equal(f.sync.pendingSyncs.size, 0);
  f.sync._syncAccount = async () => 'retried';
  assert.equal(await f.sync.syncAccount('user@gmail.com'), 'retried');
});

test('temporary Google token errors remain retryable rather than demanding a relink', async () => {
  const f = gmailFixture(async () => ({ status: 503, json: async () => ({ error: 'temporarily_unavailable', error_description: 'retry later' }) }));
  Object.assign(f.account, { refreshToken: 'renewable', expiryDate: '2020-01-01' });
  f.sync.getOAuthConfig = () => ({ clientId: 'test', clientSecret: 'test' });
  await assert.rejects(f.sync.syncViaGmailApi(f.account));
  assert.equal(f.account.status, 'refresh_failed');
  assert.equal(f.account.lastError, 'retry later');
});

test('revoked Google grant still requires relinking and is not treated as transient', async () => {
  const f = gmailFixture(async () => ({ status: 400, json: async () => ({ error: 'invalid_grant' }) }));
  Object.assign(f.account, { refreshToken: 'revoked', expiryDate: '2020-01-01' });
  f.sync.getOAuthConfig = () => ({ clientId: 'test', clientSecret: 'test' });
  await assert.rejects(f.sync.syncViaGmailApi(f.account));
  assert.equal(f.account.status, 'auth_expired');
});
