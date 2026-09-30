const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createInboundSignature,
  verifyInboundSignature
} = require('../inbox_server');

test('inbound webhook accepts only a fresh valid HMAC signature', () => {
  const secret = 'unit-test-secret';
  const timestamp = '1789905000';
  const nowMs = Number(timestamp) * 1000;
  const raw = Buffer.from('From: sender@example.com\r\nTo: box@batabitoo.com\r\n\r\nHello');
  const signature = createInboundSignature(secret, timestamp, raw);

  assert.deepEqual(verifyInboundSignature({
    'x-batabitoo-timestamp': timestamp,
    'x-batabitoo-signature': signature
  }, raw, secret, nowMs), { ok: true });

  assert.equal(verifyInboundSignature({
    'x-batabitoo-timestamp': timestamp,
    'x-batabitoo-signature': signature
  }, Buffer.from('tampered'), secret, nowMs).ok, false);

  assert.equal(verifyInboundSignature({
    'x-batabitoo-timestamp': timestamp,
    'x-batabitoo-signature': signature
  }, raw, secret, nowMs + 301000).ok, false);
});

test('Cloudflare Email Worker sends raw MIME and matching signed metadata', async () => {
  const worker = await import('../cloudflare-email-worker/src/index.mjs');
  const raw = Buffer.from('Message-ID: <delivery-test@example.com>\r\nFrom: sender@example.com\r\nTo: box@batabitoo.com\r\nSubject: Test\r\n\r\nCode 741852');
  let captured = null;
  const response = await worker.deliverEmail({
    raw: new ReadableStream({ start(controller) { controller.enqueue(raw); controller.close(); } }),
    from: 'sender@example.com',
    to: 'box@batabitoo.com'
  }, {
    INBOUND_EMAIL_SECRET: 'worker-test-secret',
    INGEST_URL: 'https://example.invalid/api/webhook/email'
  }, async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  });

  assert.equal(response.status, 200);
  assert.equal(captured.url, 'https://example.invalid/api/webhook/email');
  assert.equal(captured.init.headers['Content-Type'], 'message/rfc822');
  assert.deepEqual(Buffer.from(captured.init.body), raw);
  const timestamp = captured.init.headers['X-Batabitoo-Timestamp'];
  const signature = captured.init.headers['X-Batabitoo-Signature'];
  assert.equal(verifyInboundSignature({
    'x-batabitoo-timestamp': timestamp,
    'x-batabitoo-signature': signature
  }, raw, 'worker-test-secret', Number(timestamp) * 1000).ok, true);
});
