const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const base = 'https://batabitoo-mail-2026.web.app';
(async () => {
  const pin = execFileSync('powershell.exe', ['-NoProfile', '-Command', 'gcloud secrets versions access latest --secret=MASTER_PIN --project=batabitoo-mail-2026'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const headers = { Authorization: `Bearer ${token}` };
  const response = await fetch(base + '/api/all-messages', { headers });
  assert.equal(response.status, 200);
  const { messages } = await response.json();
  const pairs = messages.flatMap(message => (message.attachments || []).filter(a => !a.inline).map(attachment => ({ message, attachment })));
  const selected = process.argv.includes('--unarchived') ? pairs.find(p => !p.attachment.storagePath) : pairs.find(p => /\.pdf$/i.test(p.attachment.filename || '')) || pairs[0];
  assert(selected, 'No non-inline attachment is available for a live check');
  console.log(JSON.stringify({ attachmentCount: pairs.length, idLength: String(selected.attachment.id).length, hashId: /^[a-f0-9]{64}$/.test(selected.attachment.id), metadataKeys: Object.keys(selected.attachment), hasCloudPath: Boolean(selected.attachment.storagePath), hasLocalPdf: Boolean(selected.message.downloadedPdf), provider: selected.attachment.downloadUrl?.startsWith('http') ? new URL(selected.attachment.downloadUrl).hostname : 'relative' }));
  const url = `${base}/api/messages/${encodeURIComponent(selected.message.id)}/attachments/${encodeURIComponent(selected.attachment.id)}`;
  assert.equal((await fetch(url)).status, 401);
  const file = await fetch(url, { headers });
  if (file.status !== 200) console.log('Attachment error:', await file.text());
  assert.equal(file.status, 200, 'Authenticated attachment download failed');
  const bytes = Buffer.from(await file.arrayBuffer());
  assert(bytes.length > 0);
  assert(!file.headers.get('content-type')?.includes('application/json'));
  if (/\.pdf$/i.test(selected.attachment.filename || '')) assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
  console.log(JSON.stringify({ unauthorizedStatus: 401, authenticatedStatus: 200, bytes: bytes.length, pdf: bytes.subarray(0, 4).toString() === '%PDF' }));
  if (selected.attachment.storagePath) {
    const anonymous = await fetch(`https://firebasestorage.googleapis.com/v0/b/batabitoo-mail-2026.firebasestorage.app/o/${encodeURIComponent(selected.attachment.storagePath)}?alt=media`);
    assert([401, 403].includes(anonymous.status), 'Private ticket must not be publicly accessible');
    console.log(JSON.stringify({ anonymousStorageAccessBlocked: true }));
  }
  if (process.argv.includes('--all-pdfs')) {
    const pdfs = pairs.filter(p => p.attachment.storagePath && /\.pdf$/i.test(p.attachment.filename || ''));
    for (const { message, attachment } of pdfs) {
      const r = await fetch(`${base}/api/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}`, { headers });
      assert.equal(r.status, 200);
      const b = Buffer.from(await r.arrayBuffer());
      assert.equal(b.subarray(0, 4).toString(), '%PDF');
      assert.equal(b.length, attachment.size);
    }
    console.log(JSON.stringify({ verifiedCloudPdfs: pdfs.length }));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
