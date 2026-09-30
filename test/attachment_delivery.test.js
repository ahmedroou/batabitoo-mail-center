const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contentSource = fs.readFileSync(require.resolve('../MailContent'), 'utf8');
const method = contentSource.slice(contentSource.indexOf('async function attachment('), contentSource.indexOf('function recoverSource('));
function fixture() {
  let cloudReads = 0;
  const attachment = vm.runInNewContext(`${method}; attachment`, {
    __dirname: path.resolve(__dirname, '..'), path,
    fs: { existsSync: () => false },
    getStorage: () => ({ bucket: () => ({ file: () => ({ download: async () => { cloudReads++; return [Buffer.from('%PDF-test')]; } }) }) }),
  });
  return { attachment, reads: () => cloudReads };
}
test('legacy non-hash attachment IDs resolve to their private cloud bytes', async () => {
  const f = fixture();
  const file = await f.attachment({ attachments: [{ id: 'legacy-id-12', storagePath: 'mail-content/test/ticket.bin', filename: 'ticket.pdf' }] }, 'legacy-id-12');
  assert.equal(file.content.toString(), '%PDF-test');
  assert.equal(f.reads(), 1);
});
test('unknown attachment does not silently return the first prize ticket', async () => {
  const f = fixture();
  assert.equal(await f.attachment({ attachments: [{ id: 'known', storagePath: 'mail-content/test/ticket.bin' }] }, 'wrong'), null);
  assert.equal(f.reads(), 0);
});
test('provider downloads reject HTTP, unrelated hosts and internal endpoints without network access', async () => {
  const source = fs.readFileSync(require.resolve('../inbox_server'), 'utf8');
  const method = source.slice(source.indexOf('function fetchRemoteBuffer('), source.indexOf('const RealInboxService'));
  let networkRequests = 0;
  const fetchBuffer = vm.runInNewContext(`${method}; fetchRemoteBuffer`, { URL, Buffer, https: { request() { networkRequests++; throw new Error('Network must not be used'); } } });
  for (const url of ['http://inboxes.com/file', 'https://127.0.0.1/file', 'https://metadata.google.internal/file', 'https://inboxes.com.attacker.test/file', 'https://user:pass@inboxes.com/file', 'https://inboxes.com:8080/file']) {
    assert.equal(await fetchBuffer(url), null);
  }
  assert.equal(networkRequests, 0);
});
