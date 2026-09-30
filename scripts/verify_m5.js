"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

// Stub firebase-admin storage for test execution
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
const db = require("../InboxDatabase");
const auth = require("../auth");

const MASTER_PIN = "0530";
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
  console.log("================================================================");
  console.log("🚀 BATABITOO MAIL CENTER — MILESTONE M5 E2E SYSTEM PASS VERIFICATION");
  console.log("================================================================\n");

  console.log("🔍 [1/6] Initializing Ephemeral Server & Database...");
  await db.ready();

  await new Promise(resolve => {
    server = http.createServer(handleRequest).listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  console.log(`   ✅ Test server listening on ephemeral port: ${baseUrl}`);

  // -------------------------------------------------------------
  // Test 2: Live Static Asset Delivery & Integrity
  // -------------------------------------------------------------
  console.log("\n🔍 [2/6] Verifying Live Static Asset Delivery (Zero 404s, Strict MIME, Content Integrity)...");
  const assets = [
    { route: "/", expectedStatus: 200, mime: "text/html", checks: ["dir=\"rtl\"", "activeInboxBanner", "reader-shell"] },
    { route: "/index.html", expectedStatus: 200, mime: "text/html", checks: ["dir=\"rtl\"", "activeInboxBanner", "sidebar"] },
    { route: "/styles.css", expectedStatus: 200, mime: "text/css", checks: ["@media (max-width: 390px)", "height: 52px", "overflow-x: hidden"] },
    { route: "/style.css", expectedStatus: 200, mime: "text/css", checks: ["@media (max-width: 390px)"] },
    { route: "/reader.css", expectedStatus: 200, mime: "text/css", checks: ["layout-3panel", "@media (min-width: 1024px)"] },
    { route: "/app.js", expectedStatus: 200, mime: "application/javascript", checks: ["loadCurrent(true)", "layout-3panel", "is-reading", "is-selected"] }
  ];

  for (const asset of assets) {
    const res = await req(asset.route);
    assert.equal(res.status, asset.expectedStatus, `Asset ${asset.route} must return status ${asset.expectedStatus}`);
    assert.ok(res.headers.get("content-type").includes(asset.mime), `Asset ${asset.route} must have mime ${asset.mime}`);
    for (const check of asset.checks) {
      assert.ok(res.text.includes(check), `Asset ${asset.route} content must include snippet: "${check}"`);
    }
  }
  console.log("   ✅ All static assets (HTML, CSS, JS) served with 200 OK and verified content snippets.");

  // -------------------------------------------------------------
  // Test 3: Public vs Protected Endpoints Auth Security Matrix
  // -------------------------------------------------------------
  console.log("\n🔍 [3/6] Verifying Endpoint Security Matrix (Public Whitelist vs Protected 401)...");
  
  // Public endpoints must return 200 without auth
  const publicEndpoints = [
    { route: "/api/health", method: "GET", expectedStatus: 200 },
    { route: "/api/app/version", method: "GET", expectedStatus: 200 },
  ];
  for (const ep of publicEndpoints) {
    const res = await req(ep.route, { method: ep.method });
    assert.equal(res.status, ep.expectedStatus, `Public route ${ep.route} must return ${ep.expectedStatus}`);
  }
  console.log("   ✅ Public endpoints (/api/health, /api/app/version) accessible without auth.");

  // Protected endpoints must return 401 without auth
  const protectedEndpoints = [
    { route: "/api/inboxes", method: "GET" },
    { route: "/api/inbox/current", method: "GET" },
    { route: "/api/inbox/sync", method: "POST", body: "{}" },
    { route: "/api/official/create", method: "POST", body: "{}" },
    { route: "/api/status", method: "GET" },
    { route: "/api/storage/status", method: "GET" },
    { route: "/api/winners-sync/status", method: "GET" },
    { route: "/api/all-messages", method: "GET" },
    { route: "/api/auth/check", method: "GET" }
  ];
  for (const ep of protectedEndpoints) {
    const res = await req(ep.route, {
      method: ep.method,
      headers: { "Content-Type": "application/json" },
      body: ep.body
    });
    assert.equal(res.status, 401, `Protected route ${ep.route} must return 401 when unauthenticated`);
    assert.equal(res.json?.code, "AUTH_REQUIRED", `Protected route ${ep.route} must return AUTH_REQUIRED code`);
  }
  console.log("   ✅ Protected endpoints strictly return 401 AUTH_REQUIRED when unauthenticated.");

  // -------------------------------------------------------------
  // Test 4: Authentication Flow & Session Token Generation
  // -------------------------------------------------------------
  console.log("\n🔍 [4/6] Verifying Authentication Flow (PIN Verification, JWT Issuance, Auth Check)...");
  // 1. Invalid PIN -> 401
  const badLogin = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "wrong_pin" })
  });
  assert.equal(badLogin.status, 401, "Invalid PIN must return 401");
  assert.equal(badLogin.json?.success, false);

  // 2. Valid PIN -> 200 + Bearer Token
  const goodLogin = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: MASTER_PIN })
  });
  assert.equal(goodLogin.status, 200, "Valid PIN must return 200");
  assert.equal(goodLogin.json?.success, true);
  assert.ok(goodLogin.json?.token, "Login response must contain session token");
  const sessionToken = goodLogin.json.token;

  // 3. Check auth with Bearer token -> 200
  const checkRes = await req("/api/auth/check", {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  assert.equal(checkRes.status, 200);
  assert.equal(checkRes.json?.authenticated, true);
  console.log("   ✅ PIN authentication, session token issuance, and Bearer authorization fully verified.");

  // -------------------------------------------------------------
  // Test 5: Real-World Inbound Webhook -> Ingestion -> Query -> Sync Lifecycle
  // -------------------------------------------------------------
  console.log("\n🔍 [5/6] Verifying Full Inbound Webhook -> Ingestion -> Targeted Query Lifecycle...");
  const e2eEmail = `m5_e2e_${Date.now()}@batabitoo.com`;
  const e2eOtp = "918273";
  const e2eSubject = `E2E Final Pass Ingestion ${Date.now()}`;

  // Ingest via unauthenticated webhook
  const webhookRes = await req("/api/webhook/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: e2eEmail,
      sender: "security@amazon.com",
      subject: e2eSubject,
      text: `Hello, your Amazon login verification security code is ${e2eOtp}. Do not share this code.`,
    })
  });
  assert.equal(webhookRes.status, 200);
  assert.equal(webhookRes.json?.success, true);
  assert.equal(webhookRes.json?.otp, e2eOtp);
  const msgId = webhookRes.json?.messageId;
  assert.ok(msgId, "Webhook must return messageId");

  // Query by email using session token
  const queryRes = await req(`/api/inbox/current?email=${encodeURIComponent(e2eEmail)}`, {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  assert.equal(queryRes.status, 200);
  assert.equal(queryRes.json?.success, true);
  assert.equal(queryRes.json?.inbox?.email, e2eEmail);
  assert.ok(Array.isArray(queryRes.json?.messages));
  const foundMessage = queryRes.json.messages.find(m => m.id === msgId);
  assert.ok(foundMessage, "Message must appear in inbox messages list");
  assert.equal(foundMessage.otp, e2eOtp);

  // Fetch full message details
  const detailRes = await req(`/api/messages/${encodeURIComponent(msgId)}`, {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.json?.id, msgId);
  assert.equal(detailRes.json?.otp, e2eOtp);
  assert.ok(detailRes.json?.text.includes(e2eOtp));

  // Sync official inbox
  const syncRes = await req("/api/inbox/sync", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email: e2eEmail })
  });
  assert.equal(syncRes.status, 200);
  assert.equal(syncRes.json?.success, true);
  assert.ok(Array.isArray(syncRes.json?.messages));
  assert.ok(syncRes.json.messages.some(m => m.id === msgId));
  console.log(`   ✅ End-to-end lifecycle verified: Webhook -> Ingestion -> Targeted Query -> Detail -> Sync.`);

  // -------------------------------------------------------------
  // Test 6: Server-Sent Events (SSE) Stream Connection Verification
  // -------------------------------------------------------------
  console.log("\n🔍 [6/6] Verifying Server-Sent Events (SSE) Stream Connection...");
  const sseRes = await fetch(`${baseUrl}/api/events`, {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  assert.equal(sseRes.status, 200);
  assert.ok(sseRes.headers.get("content-type").includes("text/event-stream"));

  // Read initial chunk from SSE stream
  const reader = sseRes.body.getReader();
  const { value } = await reader.read();
  const initialText = new TextDecoder().decode(value);
  assert.ok(initialText.includes(": connected"), "SSE stream must emit initial ': connected' heartbeat");
  await reader.cancel();
  console.log("   ✅ SSE endpoint (/api/events) verified: returns 200 text/event-stream and initial connection ping.");

  if (server) server.close();

  console.log("\n================================================================");
  console.log("🎉 ALL MILESTONE M5 VERIFICATION CHECKS PASSED WITH 100% SUCCESS!");
  console.log("================================================================\n");
  process.exit(0);
}

run().catch(err => {
  console.error("❌ Milestone M5 Verification Failed:", err);
  if (server) server.close();
  process.exit(1);
});
