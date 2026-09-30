'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { testDatabaseOptions } = require('../lib/testDatabaseSafety');
const { spawnSync } = require('node:child_process');

test('normal server initialization remains unchanged', () => {
  assert.equal(testDatabaseOptions({}), null);
});
test('test runner cannot accidentally load production database credentials', () => {
  assert.throws(() => testDatabaseOptions({ NODE_TEST_CONTEXT: 'child-v8' }), /Production Firestore access is blocked/);
  assert.throws(() => testDatabaseOptions({ NODE_TEST_CONTEXT: 'child-v8', FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }));
});
test('local emulator tests always use a separate demo project and bucket', () => {
  for (const host of ['localhost:8080', '127.0.0.1:8080', '[::1]:8080']) {
    assert.deepEqual(testDatabaseOptions({ NODE_TEST_CONTEXT: 'child-v8', FIRESTORE_EMULATOR_HOST: host, FIREBASE_PROJECT_ID: 'production' }), { projectId: 'demo-mail-center-tests', storageBucket: 'demo-mail-center-tests.appspot.com' });
  }
});

test('production singleton actually refuses initialization inside the test runner', () => {
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(require.resolve('../CloudDatabase'))})`], {
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8', FIRESTORE_EMULATOR_HOST: '' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Production Firestore access is blocked/);
});
