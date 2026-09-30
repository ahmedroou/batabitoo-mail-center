// Copy only the known legacy ticket PDFs to private Firebase Storage; retain originals.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { getStorage } = require('firebase-admin/storage');
const { mailDatabase: db } = require('../CloudDatabase');
const root = path.resolve(__dirname, '../../dazzling-oppenheimer/downloaded_tickets_pdf');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
(async () => {
  await db.ready();
  const write = process.argv.includes('--write');
  let copied = 0, totalBytes = 0;
  for (const message of db.getAllMessages()) {
    if (!message.downloadedPdf) continue;
    const local = path.resolve(message.downloadedPdf);
    if (!local.startsWith(root + path.sep) || !fs.existsSync(local)) continue;
    const pdfs = (message.attachments || []).filter(item => /\.pdf$/i.test(item.filename || ''));
    if (pdfs.length !== 1) continue;
    const bytes = fs.readFileSync(local);
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    const storagePath = `mail-content/${hash(String(message.id))}/attachments/${hash(bytes)}.bin`;
    if (write) {
      const file = getStorage().bucket().file(storagePath);
      await file.save(bytes, { resumable: false, metadata: { contentType: 'application/pdf', cacheControl: 'private, no-store' } });
      const [stored] = await file.download();
      assert.equal(hash(stored), hash(bytes));
      await db.saveMessages(message.inboxEmail, [{ ...message, attachments: message.attachments.map(item => item === pdfs[0] ? { ...item, storagePath, contentType: 'application/pdf', size: bytes.length } : item) }]);
    }
    copied++;
    totalBytes += bytes.length;
  }
  console.log(JSON.stringify({ write, pdfs: copied, bytes: totalBytes, originalsRetained: true }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
