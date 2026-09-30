const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
// Evaluate only the refresh method: no live Firebase credentials or writes.
const source = fs.readFileSync(require.resolve('../CloudDatabase'), 'utf8');
const method = source.slice(source.indexOf('  async refreshIfChanged('), source.indexOf('  async getCloudAppVersion('));
const proto = vm.runInNewContext(`({${method}})`, { Date });
function fixture(revision = 1) {
  let reads = 0, reloads = 0;
  const obj = {
    ...proto, ready: async () => {}, _enqueue: fn => Promise.resolve().then(fn),
    meta: { revision: 1, checksum: 'same' }, datasetPath: 'mailDatasets/v2', cache: {},
    firestore: { collection: name => ({ doc: () => ({ get: async () => { reads++; return { data: () => name === 'system' ? { activeDatasetPath: 'mailDatasets/v2', revision, checksum: 'same' } : { appVersion: { latestVersionCode: 12 } } }; } }) }) },
    _datasetRef: () => ({ get: async () => ({ data: () => ({ revision, checksum: 'same' }) }) }),
    _loadCore: async () => { reloads++; },
  };
  return { obj, reads: () => reads, reloads: () => reloads };
}
test('unchanged manifests skip chunk reads and concurrent requests coalesce', async () => {
  const f = fixture();
  await Promise.all([f.obj.refreshIfChanged(), f.obj.refreshIfChanged()]);
  await f.obj.refreshIfChanged();
  assert.equal(f.reads(), 2);
  assert.equal(f.reloads(), 0);
  assert.equal(f.obj.cache.appVersion.latestVersionCode, 12);
});
test('changed cloud revision refreshes warm instances', async () => {
  const f = fixture(2);
  await f.obj.refreshIfChanged();
  assert.equal(f.reloads(), 1);
});
test('failed refresh can be retried instead of poisoning the queue', async () => {
  const f = fixture();
  const firestore = f.obj.firestore;
  f.obj.firestore = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('offline'); } }) }) };
  await assert.rejects(f.obj.refreshIfChanged(), /offline/);
  assert.equal(f.obj._refreshPromise, null);
  f.obj.firestore = firestore;
  f.obj._coreDirty = true;
  await f.obj.refreshIfChanged();
  assert.equal(f.reloads(), 1);
});

test('modern unchanged pointers do not read the dataset root', async () => {
  const f = fixture();
  f.obj._datasetRef = () => { throw new Error('redundant root read'); };
  await f.obj.refreshIfChanged();
  assert.equal(f.reads(), 2);
});

test('failed loads are not marked fresh and retry on the next request', async () => {
  const f = fixture(2);
  f.obj._loadCore = async () => { throw new Error('read failure'); };
  await assert.rejects(f.obj.refreshIfChanged(), /read failure/);
  assert.equal(f.obj._lastRefreshAt, undefined);
});
