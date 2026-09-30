"use strict";
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { hash } = require('../lib/mobileAccess');
initializeApp({ credential: cert(require('../serviceAccountKey.json')) });
const db = getFirestore();
const base = 'https://batabitoo-mail-2026.web.app';
const cleanup = [];
async function request(path, body, token) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
(async () => {
  try {
    const pin = execFileSync('powershell.exe', ['-NoProfile', '-Command', 'gcloud secrets versions access latest --secret=MASTER_PIN --project=batabitoo-mail-2026'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const login = await request('/api/auth/login', { pin });
    assert.equal(login.status, 200);
    const token = login.body.token;
    const unauthed = await request('/api/inboxes');
    assert.equal(unauthed.status, 401);
    assert.equal((await request('/api/mobile/register', {})).status, 401);
    assert.equal((await request('/api/mobile/approve', { challenge: 'a'.repeat(43) })).status, 401);
    const verifier = crypto.randomBytes(32).toString('base64url');
    const approval = await request('/api/mobile/approve', { challenge: hash(verifier) }, token);
    assert.equal(approval.status, 200);
    cleanup.push(db.collection('mailDeviceCodes').doc(hash(approval.body.code)));
    assert.equal((await request('/api/mobile/exchange', { code: approval.body.code, verifier: 'x'.repeat(43) })).status, 401);
    const exchange = await request('/api/mobile/exchange', { code: approval.body.code, verifier });
    assert.equal(exchange.status, 200);
    cleanup.push(db.collection('mailDevices').doc(hash(exchange.body.credential)));
    assert.equal((await request('/api/mobile/exchange', { code: approval.body.code, verifier })).status, 401);
    const refreshed = await request('/api/mobile/refresh', { credential: exchange.body.credential });
    assert.equal(refreshed.status, 200);
    const inboxes = await request('/api/inboxes', null, refreshed.body.token);
    const messages = await request('/api/all-messages', null, refreshed.body.token);
    assert.equal(inboxes.status, 200);
    assert.equal(messages.status, 200);
    console.log(JSON.stringify({ secureHandoff: 'passed', unauthorizedAccess: 'blocked', replay: 'blocked', inboxCounts: inboxes.body.counts, messageCounts: messages.body.counts, messageCount: messages.body.messages?.length }, null, 2));
  } finally { await Promise.all(cleanup.map(ref => ref.delete())); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
