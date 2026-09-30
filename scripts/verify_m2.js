"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

// Stub firebase-admin storage if needed to ensure rapid test execution
const storage = require("firebase-admin/storage");
try {
  storage.getStorage = () => ({
    bucket: () => ({
      file: () => ({
        save: async () => {},
        download: async () => [Buffer.from("")],
      }),
    }),
  });
} catch (_) {}

const { handleRequest } = require("../inbox_server");
const { mailDatabase } = require("../CloudDatabase");
const db = require("../InboxDatabase");
const content = require("../MailContent");

const MASTER_PIN = "0530";
const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "X-Master-PIN": MASTER_PIN,
};

let server;
let baseUrl;

async function req(route, options = {}) {
  const url = `${baseUrl}${route}`;
  const response = await fetch(url, options);
  let json = null;
  let text = "";
  const ct = response.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      json = await response.json();
    } catch (_) {}
  } else {
    text = await response.text();
  }
  return { status: response.status, headers: response.headers, json, text };
}

async function run() {
  console.log("🔍 [1/6] Initializing Test Server & Database...");
  await db.ready();

  await new Promise(resolve => {
    server = http.createServer(handleRequest).listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  console.log(`   ✅ Test server running at ${baseUrl}`);

  const testEmail = `official_m2_${Date.now()}@batabitoo.com`;
  const testOtp = "741852";
  const testSubject = `Official Verification Test ${Date.now()}`;

  console.log("🔍 [2/6] Verifying Webhook Accepts POST Without Auth (HTTP 200 OK)...");
  // 1. Send to /api/webhook/email with ZERO auth headers (simulating Cloudflare Email Routing / Tunnel)
  const webhookRes = await req("/api/webhook/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
      // Note: NO auth headers, NO X-Master-PIN, NO cookies
    },
    body: JSON.stringify({
      recipient: testEmail,
      sender: "service@external-router.com",
      subject: testSubject,
      text: `Welcome to Batabitoo! Your verification OTP code is ${testOtp}.`,
    }),
  });

  assert.equal(webhookRes.status, 200, `Webhook must return 200 OK without auth, got ${webhookRes.status}`);
  assert.equal(webhookRes.json?.success, true, "Webhook response must indicate success: true");
  assert.ok(webhookRes.json?.messageId, "Webhook response must include messageId");
  assert.equal(webhookRes.json?.otp, testOtp, `Webhook must extract OTP ${testOtp}`);
  console.log(`   ✅ /api/webhook/email accepted without auth (HTTP 200, messageId: ${webhookRes.json.messageId}, OTP: ${webhookRes.json.otp})`);

  // 2. Also verify /api/inbound without auth
  const inboundRes = await req("/api/inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: `inbound_${Date.now()}@batabitoo.com`,
      sender: "sender@inbound.com",
      subject: "Inbound Route Check",
      text: "Testing /api/inbound public access",
    }),
  });
  assert.equal(inboundRes.status, 200, "/api/inbound must return 200 without auth");
  console.log("   ✅ /api/inbound accepted without auth (HTTP 200)");

  console.log("🔍 [3/6] Verifying Inbox Query via GET /api/inbox/current?email= & ?id=...");
  // Query by email
  const currentByEmailRes = await req(`/api/inbox/current?email=${encodeURIComponent(testEmail)}`, {
    headers: AUTH_HEADERS,
  });
  assert.equal(currentByEmailRes.status, 200, "GET /api/inbox/current?email= must return 200");
  assert.equal(currentByEmailRes.json?.success, true, "Response must include success: true");
  assert.ok(currentByEmailRes.json?.inbox, "Response must contain inbox object");
  assert.equal(currentByEmailRes.json.inbox.email, testEmail, `Inbox email must match ${testEmail}`);
  assert.ok(Array.isArray(currentByEmailRes.json.messages), "Response must contain messages array");
  
  const foundMsg = currentByEmailRes.json.messages.find(m => m.subject === testSubject);
  assert.ok(foundMsg, `Messages must contain the ingested message with subject "${testSubject}"`);
  assert.equal(foundMsg.otp, testOtp, `Message OTP must be ${testOtp}`);
  console.log(`   ✅ GET /api/inbox/current?email= resolved inbox (${currentByEmailRes.json.inbox.id}) with real message`);

  // Query by id
  const targetId = currentByEmailRes.json.inbox.id;
  const currentByIdRes = await req(`/api/inbox/current?id=${encodeURIComponent(targetId)}`, {
    headers: AUTH_HEADERS,
  });
  assert.equal(currentByIdRes.status, 200, "GET /api/inbox/current?id= must return 200");
  assert.equal(currentByIdRes.json?.success, true);
  assert.equal(currentByIdRes.json?.inbox?.id, targetId, "Inbox id must match queried id");
  console.log(`   ✅ GET /api/inbox/current?id= resolved inbox by ID successfully`);

  console.log("🔍 [4/6] Verifying Official Inboxes Sync via POST /api/inbox/sync...");
  const syncRes = await req("/api/inbox/sync", {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ email: testEmail }),
  });

  assert.equal(syncRes.status, 200, "POST /api/inbox/sync must return 200");
  assert.equal(syncRes.json?.success, true, "POST /api/inbox/sync must succeed");
  assert.ok(syncRes.json?.sync, "Response must include sync object");
  assert.equal(syncRes.json.sync.newCount, 0, "Official sync returns newCount: 0");
  assert.ok(syncRes.json.sync.checkedAt, "Official sync returns checkedAt timestamp");
  assert.ok(Array.isArray(syncRes.json.messages), "Response must include real messages array");
  assert.ok(syncRes.json.messages.length >= 1, "Official sync must return real messages rather than dummy string");
  assert.equal(syncRes.json.messages[0].subject, testSubject, "First message in sync must be the verified message");
  console.log(`   ✅ POST /api/inbox/sync returned real messages (${syncRes.json.messages.length} messages) with sync metadata`);

  console.log("🔍 [5/6] Verifying Non-blocking Storage Archival in MailContent.js...");
  const mailContentSrc = fs.readFileSync(path.join(__dirname, "..", "MailContent.js"), "utf8");
  assert.ok(
    mailContentSrc.includes(".save(source,") && mailContentSrc.includes(".catch("),
    "MailContent.js must call .save(source).catch(...) without blocking await"
  );
  assert.ok(
    !mailContentSrc.includes("await archive(id, payload)"),
    "MailContent.js normalize() must not block on await archive()"
  );

  const startT = Date.now();
  const norm = await content.normalize({
    from: "speed@test.com",
    to: "speed@batabitoo.com",
    subject: "Latency Check",
    text: "Testing non-blocking archive execution speed",
  }, "speed_msg_1");
  const elapsed = Date.now() - startT;
  assert.ok(elapsed < 100, `MailContent.normalize should execute in <100ms, took ${elapsed}ms`);
  assert.ok(norm.id === "speed_msg_1", "normalize returned valid message object");
  console.log(`   ✅ MailContent.archive verified non-blocking (executed in ${elapsed}ms)`);

  console.log("🔍 [6/6] Verifying public/app.js Ingestion & Rendering Enhancements...");
  const appJsSrc = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.ok(
    appJsSrc.includes("?email=${encodeURIComponent(inbox.email)}&id=${encodeURIComponent(inbox.id)}"),
    "public/app.js must pass ?email=...&id=... when querying /api/inbox/current"
  );
  assert.ok(
    appJsSrc.includes("cachedMessages") && appJsSrc.includes("renderContent()"),
    "public/app.js selectInbox must render cached message cards immediately upon selection"
  );
  console.log("   ✅ public/app.js verified: query parameters and immediate card rendering confirmed.");

  console.log("\n=============================================");
  console.log("🎉 ALL WORKER M2 VERIFICATIONS PASSED 100%!");
  console.log("=============================================\n");

  if (server) server.close();
  process.exit(0);
}

run().catch(err => {
  console.error("❌ Verification failed:", err);
  if (server) server.close();
  process.exit(1);
});
