'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');
const { buildDataset, canonicalInbox, canonicalMessage } = require('../lib/cloudDataModel');
const { oauthNeedsWrite } = require('../lib/cloudWritePolicy');

// Execute the real class, but never construct its production singleton or use
// credentials. Every document and every transaction below is in memory.
const filename = require.resolve('../CloudDatabase');
const sandbox = { require: createRequire(filename), __dirname: path.dirname(filename), module: { exports: {} }, process, Buffer, console, Date };
vm.runInNewContext(fs.readFileSync(filename, 'utf8').replace('const mailDatabase = new CloudMailDatabase();', 'const mailDatabase = null;'), sandbox);
const { CloudMailDatabase } = sandbox.module.exports;
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));

function fixture(inboxCount = 1) {
  const inboxes = Array.from({ length: inboxCount }, (_, i) => canonicalInbox({ id: `box_${i}`, email: `box${i}@gmail.com`, messageCount: 0, createdAt: '2026-09-01T00:00:00Z' }));
  const dataset = buildDataset({ inboxes, messages: [] }, { migrationId: 'cost-test', createdAt: '2026-09-01T00:00:00Z' });
  const records = new Map();
  const root = 'mailDatasets/v2';
  records.set(root, copy(dataset.meta));
  records.set('system/data_pointer', { activeDatasetPath: root, revision: dataset.meta.revision, checksum: dataset.meta.checksum });
  records.set('mailRuntime/bootstrap', { oauthAccounts: [], oauthManifestVersion: 1 });
  for (const [collection, docs] of Object.entries({ inboxChunks: dataset.inboxChunks, messageChunks: dataset.messageChunks, categoryChunks: dataset.categoryChunks, locatorShards: dataset.locatorDocs })) {
    for (const doc of docs) records.set(`${root}/${collection}/${doc.id}`, copy(doc.data));
  }
  const stats = { reads: 0, writes: 0, deletes: 0, paths: [] };
  function ref(key) {
    return { path: key, id: key.split('/').at(-1), parent: { id: key.split('/').at(-2) }, collection: name => ({ doc: id => ref(`${key}/${name}/${id}`) }),
      get: async () => { stats.reads++; return { id: key.split('/').at(-1), ref: ref(key), exists: records.has(key), data: () => copy(records.get(key)) }; },
      set: async (data, options) => { stats.writes++; stats.paths.push(key); records.set(key, options?.merge ? { ...records.get(key), ...copy(data) } : copy(data)); },
      delete: async () => { stats.deletes++; records.delete(key); },
    };
  }
  let retryNext = false;
  const firestore = {
    collection: name => ({ doc: id => ref(`${name}/${id}`) }),
    getAll: (...refs) => Promise.all(refs.map(item => item.get())),
    runTransaction: async callback => {
      async function attempt(commit) {
        let wrote = false;
        const writes = [];
        const tx = {
          get: item => { assert.equal(wrote, false, 'all reads precede writes'); return item.get(); },
          getAll: (...refs) => { assert.equal(wrote, false); return Promise.all(refs.map(item => item.get())); },
          set: (...args) => { wrote = true; writes.push(() => args[0].set(args[1], args[2])); },
          delete: item => { wrote = true; writes.push(() => item.delete()); },
        };
        const result = await callback(tx);
        if (commit) for (const write of writes) await write();
        return result;
      }
      if (retryNext) { retryNext = false; await attempt(false); }
      return attempt(true);
    },
  };
  const db = Object.create(CloudMailDatabase.prototype);
  Object.assign(db, { firestore, datasetPath: root, meta: copy(dataset.meta), cache: { inboxes, messages: [], oauthAccounts: [], deletedAmazonAccounts: [], settings: {}, activeInboxId: null }, readyPromise: Promise.resolve(), _writeQueue: Promise.resolve() });
  return { db, records, stats, root, retry: () => { retryNext = true; }, reset: () => { stats.reads = stats.writes = stats.deletes = 0; stats.paths = []; } };
}

test('24 hours of idle Gmail checks: at most 48 writes instead of 8640, and no message writes', async () => {
  const f = fixture();
  const start = Date.parse('2026-09-01T00:00:00Z');
  await f.db.saveOAuthAccount({ email: 'box0@gmail.com', status: 'connected', lastError: null, lastSyncAt: new Date(start).toISOString() });
  f.reset();
  for (let minute = 1; minute <= 1440; minute++) {
    await f.db.saveOAuthAccount({ email: 'box0@gmail.com', status: 'connected', lastError: null, lastSyncAt: new Date(start + minute * 60000).toISOString() });
  }
  assert.equal(f.stats.writes, 48);
  assert.equal(f.stats.reads, 48);
  assert(f.stats.paths.every(key => key === 'mailRuntime/bootstrap'));
});

test('token, UID and error changes persist immediately, not after the heartbeat interval', async () => {
  const f = fixture();
  await f.db.saveOAuthAccount({ email: 'box0@gmail.com', accessToken: 'old', lastSyncAt: '2026-09-01T00:00:00Z' });
  f.reset();
  await f.db.saveOAuthAccount({ email: 'box0@gmail.com', accessToken: 'new', expiryDate: '2026-09-01T01:00:00Z', lastSeenUid: 20, lastError: 'problem' });
  assert.equal(f.stats.writes, 1);
  assert.equal(f.db.getOAuthAccount('box0@gmail.com').accessToken, 'new');
  assert.equal(f.db.getOAuthAccount('box0@gmail.com').lastSeenUid, 20);
  await f.db.saveOAuthAccount({ email: 'box0@gmail.com', lastError: null });
  assert.equal(f.stats.writes, 2);
});

test('OAuth transaction preserves concurrently changed cloud token and other accounts', async () => {
  const f = fixture();
  await f.db.saveOAuthAccount({ email: 'box0@gmail.com', accessToken: 'old', lastSyncAt: '2026-09-01T00:00:00Z' });
  const remote = f.records.get('mailRuntime/bootstrap');
  remote.oauthAccounts[0].accessToken = remote.oauthAccounts[0].access_token = 'new-on-other-instance';
  remote.oauthAccounts.push({ email: 'other@gmail.com', accessToken: 'untouched' });
  await f.db.saveOAuthAccount({ ...f.db.getOAuthAccount('box0@gmail.com'), lastSyncAt: '2026-09-01T00:30:00Z' });
  assert.equal(f.db.getOAuthAccount('box0@gmail.com').accessToken, 'new-on-other-instance');
  assert.equal(f.db.getOAuthAccount('other@gmail.com').accessToken, 'untouched');
});

test('failed OAuth commit does not update cache or suppress a retry', async () => {
  const f = fixture();
  const transaction = f.db.firestore.runTransaction;
  f.db.firestore.runTransaction = async () => { throw new Error('offline'); };
  await assert.rejects(f.db.saveOAuthAccount({ email: 'box0@gmail.com' }), /offline/);
  assert.equal(f.db.getOAuthAccount('box0@gmail.com'), null);
  f.db.firestore.runTransaction = transaction;
  await f.db.saveOAuthAccount({ email: 'box0@gmail.com' });
  assert.equal(f.stats.writes, 1);
});

test('no-op inbox upsert and timestamp-only polling perform zero writes', async () => {
  const f = fixture();
  await f.db.saveInbox({ ...f.db.cache.inboxes[0], updatedAt: new Date().toISOString() });
  assert.equal(f.stats.writes, 0);
  assert.equal(f.db.meta.revision, 1);
});

test('new message saves once, count changes once, duplicate delivery writes nothing', async () => {
  const f = fixture();
  const message = canonicalMessage({ id: 'm1', inboxEmail: 'box0@gmail.com', text: 'hello', createdAt: '2026-09-02T00:00:00Z' });
  assert.equal(await f.db.saveMessages('box0@gmail.com', [message]), 1);
  assert.equal(f.db.cache.inboxes[0].messageCount, 1);
  f.reset();
  assert.equal(await f.db.saveMessages('box0@gmail.com', [message]), 0);
  assert.equal(f.stats.writes, 0);
  assert.equal(f.db.cache.messages.length, 1);
});

test('changed record does not rewrite a locator that still points to the same chunk', async () => {
  const f = fixture();
  await f.db.saveInbox({ ...f.db.cache.inboxes[0], label: 'Changed' });
  assert.equal(f.stats.writes, 3); // chunk + meta + pointer, not locator
  assert(!f.stats.paths.some(key => key.includes('locatorShards')));
});

test('transaction retry returns each committed record exactly once', async () => {
  const f = fixture();
  f.retry();
  const saved = await f.db._targetedUpsert('inbox', [{ ...f.db.cache.inboxes[0], label: 'retry' }]);
  assert.equal(saved.length, 1);
  assert.equal(f.db.meta.counts.totalInboxes, 1);
  assert.equal(f.stats.writes, 3);
});

test('no-op deletion does not rebuild or rewrite the entire dataset', async () => {
  const f = fixture(150);
  assert.equal(await f.db.deleteInbox('not-found'), false);
  assert.equal(f.stats.writes, 0);
  assert.equal(f.stats.deletes, 0);
});

test('real deletion preserves the others without rewriting every locator', async () => {
  const f = fixture(3);
  assert.equal(await f.db.deleteInbox('box_0'), true);
  assert.equal(f.db.cache.inboxes.length, 2);
  assert(f.stats.writes < 10, `unexpected full rewrite: ${f.stats.writes}`);
});

test('writing after another instance changed core does not hide stale cached records', async () => {
  const f = fixture();
  f.records.get(f.root).revision++;
  await f.db.saveInbox({ ...f.db.cache.inboxes[0], label: 'changed' });
  assert.equal(f.db._coreDirty, true);
});

test('no-op status/time differences are ignored but data changes are not', () => {
  const old = { email: 'a@gmail.com', status: 'connected', lastSyncAt: '2026-09-01T00:00:00Z' };
  assert.equal(oauthNeedsWrite(old, { ...old, lastSyncAt: '2026-09-01T00:01:00Z' }), false);
  assert.equal(oauthNeedsWrite(old, { ...old, status: 'auth_expired' }), true);
});

test('background OAuth save cannot resurrect a concurrently deleted account', async () => {
  const f = fixture();
  await f.db.saveOAuthAccount({ email: 'box0@gmail.com', lastSyncAt: '2026-09-01T00:00:00Z' });
  f.records.get('mailRuntime/bootstrap').oauthAccounts = [];
  f.reset();
  await f.db.saveOAuthAccount({ email: 'box0@gmail.com', lastSyncAt: '2026-09-01T00:30:00Z' });
  assert.equal(f.stats.writes, 0);
  assert.equal(f.db.getOAuthAccount('box0@gmail.com'), null);
});

test('settings preserve other cloud keys and identical settings incur no read/write', async () => {
  const f = fixture();
  f.records.get('mailRuntime/bootstrap').values = { other: 'keep' };
  await f.db.setSetting('changed', 'new');
  assert.equal(f.records.get('mailRuntime/bootstrap').values.other, 'keep');
  f.reset();
  await f.db.setSetting('changed', 'new');
  assert.equal(f.stats.reads, 0);
  assert.equal(f.stats.writes, 0);
});

test('failed setting write remains retryable', async () => {
  const f = fixture();
  const run = f.db.firestore.runTransaction;
  f.db.firestore.runTransaction = async () => { throw new Error('offline'); };
  await assert.rejects(f.db.setSetting('setting', 'value'), /offline/);
  assert.equal(f.db.getSetting('setting'), null);
  f.db.firestore.runTransaction = run;
  await f.db.setSetting('setting', 'value');
  assert.equal(f.stats.writes, 1);
});

test('repeating the same ban decision and Amazon flag does not write again', async () => {
  const f = fixture();
  await f.db.updateInboxBanStatus('box_0', 'confirmed', 'user decision', 'user');
  f.reset();
  await f.db.updateInboxBanStatus('box_0', 'confirmed', 'user decision', 'user');
  await f.db.updateInboxAmazonFlag('box_0', true);
  assert.equal(f.stats.writes, 0);
  assert.equal(f.stats.reads, 0);
});

test('alias recipient count updates without saving the same message twice', async () => {
  const f = fixture(2);
  await f.db.saveMessages('box0@gmail.com', [{ id: 'alias', inboxEmail: 'box1@gmail.com', exactRecipient: 'box1@gmail.com', parentEmail: 'box0@gmail.com', text: 'hello' }]);
  assert.equal(f.db.cache.messages.length, 1);
  assert.equal(f.db.findInboxByEmail('box1@gmail.com').messageCount, 1);
});
