const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileAccess, hash } = require('../lib/mobileAccess');

function fixture() {
  const records = new Map();
  const db = { collection: name => ({ doc: id => ({
    key: `${name}/${id}`,
    get: async () => ({ data: () => records.get(`${name}/${id}`) }),
    set: async data => records.set(`${name}/${id}`, data),
  }) }), runTransaction: async task => task({ get: ref => ref.get(), delete: ref => records.delete(ref.key), set: (ref, data) => records.set(ref.key, data) }) };
  return { access: mobileAccess(db, 'test-signing-secret'), records };
}
test('mobile approval exchanges once, credential never stored in plaintext', async () => {
  const { access, records } = fixture();
  const verifier = 'a'.repeat(43);
  const { code } = await access.approve(hash(verifier));
  const { credential } = await access.exchange(code, verifier);
  await access.refresh(credential);
  assert(!JSON.stringify([...records]).includes(credential));
  await assert.rejects(access.exchange(code, verifier), { status: 401 });
});
test('intercepted code cannot be exchanged by another phone', async () => {
  const { access } = fixture();
  const { code } = await access.approve(hash('a'.repeat(43)));
  await assert.rejects(access.exchange(code, 'b'.repeat(43)), { status: 401 });
  assert((await access.exchange(code, 'a'.repeat(43))).credential);
});
test('expired approval is rejected', async () => {
  const { access, records } = fixture();
  const { code } = await access.approve(hash('a'.repeat(43)));
  records.get(`mailDeviceCodes/${hash(code)}`).expiresAt = 0;
  await assert.rejects(access.exchange(code, 'a'.repeat(43)), { status: 401 });
});
test('device registration supports renewal and explicit revocation', async () => {
  const { access, records } = fixture();
  const { credential } = await access.register();
  await access.refresh(credential);
  records.get(`mailDevices/${hash(credential)}`).revoked = true;
  await assert.rejects(access.refresh(credential), { status: 401 });
});
test('expired device and unknown credentials fail closed', async () => {
  const { access, records } = fixture();
  const { credential } = await access.register();
  records.get(`mailDevices/${hash(credential)}`).expiresAt = 0;
  await assert.rejects(access.refresh(credential), { status: 401 });
  await assert.rejects(access.refresh('a'.repeat(43)), { status: 401 });
});
test('malformed device inputs are rejected before a database lookup', async () => {
  const { access } = fixture();
  for (const value of [undefined, null, {}, '../path', '']) {
    await assert.rejects(access.approve(value), { status: 401 });
    await assert.rejects(access.refresh(value), { status: 401 });
    await assert.rejects(access.exchange(value, value), { status: 401 });
  }
});
test('invented signed-shaped tokens never reach Firestore', async () => {
  const access = mobileAccess({ collection: () => { throw new Error('unexpected database read'); } }, 'test-secret');
  const fake = `${'a'.repeat(43)}.${'b'.repeat(43)}`;
  await assert.rejects(access.refresh(fake), { status: 401 });
  await assert.rejects(access.exchange(fake, 'a'.repeat(43)), { status: 401 });
});
