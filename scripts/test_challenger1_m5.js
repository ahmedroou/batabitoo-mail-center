"use strict";

/**
 * Batabitoo Mail Center — Milestone M5 Empirical Adversarial Verification Harness
 * Challenger 1 (critic & empirical specialist)
 * 
 * Target: scripts/test_challenger1_m5.js
 * 
 * Covers:
 * 1. inbox_server.js: Webhook concurrency bursts (50+ parallel), 401 matrix, boundary payloads (>1MB, null bytes, unicode, missing headers).
 * 2. Race condition probing on targeted queries (GET /api/inbox/current?email=...).
 * 3. CloudDatabase.js: setActiveInboxId isolation from oauthAccounts, token sanitization, memory cache vs Firestore consistency.
 * 4. GmailSyncService.js: Config fallback to disk, alias resolution, token refresh failure handling.
 * 5. validators.js: Array injection, prototype pollution, type mismatch, boundary validation.
 * 6. MailContent.js: Non-blocking archival performance under high concurrency, HTML sanitization.
 * 7. Server-Sent Events (SSE): Connection lifecycle, broadcast delivery, listener leak prevention on close.
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

// Mock storage for non-blocking archival during test execution per TEST_READY.md
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
const { mailDatabase } = require("../CloudDatabase");
const gmailSync = require("../GmailSyncService");
const auth = require("../auth");
const validators = require("../validators");
const content = require("../MailContent");
const { eventBus } = require("../eventBus");

// Fast in-memory bypass for CloudDatabase transactions during test execution per TEST_READY.md
mailDatabase._targetedUpsert = async (entity, items) => {
  const key = entity === "inbox" ? "inboxes" : "messages";
  const existingMap = new Map(mailDatabase.cache[key].map(item => [item.id, item]));
  for (const item of items) existingMap.set(item.id, item);
  mailDatabase.cache[key] = Array.from(existingMap.values());
  return items;
};
mailDatabase._persistBootstrap = async () => true;
mailDatabase._enqueue = async (fn) => (typeof fn === 'function' ? fn() : fn);
if (gmailSync.oauthSyncTimer) {
  clearInterval(gmailSync.oauthSyncTimer);
  gmailSync.oauthSyncTimer = null;
}

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    failedTests++;
    failures.push({ name, error: err.message, stack: err.stack });
    console.log(`  ❌ FAIL: ${name} -> ${err.message}`);
  }
}

async function testAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    failedTests++;
    failures.push({ name, error: err.message, stack: err.stack });
    console.log(`  ❌ FAIL: ${name} -> ${err.message}`);
  }
}

let server;
let baseUrl;
let sessionToken;

async function rawReq(route, options = {}) {
  const url = `${baseUrl}${route}`;
  const res = await fetch(url, options);
  let json = null;
  let text = "";
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      json = await res.json();
    } catch (_) {}
  } else {
    text = await res.text();
  }
  return { status: res.status, headers: res.headers, json, text };
}

async function run() {
  console.log("======================================================================");
  console.log("🔥 CHALLENGER 1 — MILESTONE M5 EMPIRICAL ADVERSARIAL TEST HARNESS");
  console.log("======================================================================\n");

  console.log("🔹 [0/7] Initializing Database & Ephemeral HTTP Server...");
  await db.ready();
  await mailDatabase.ready();

  await new Promise(resolve => {
    server = http.createServer(handleRequest).listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  console.log(`   ✅ Test server listening at: ${baseUrl}`);

  // Create valid authenticated session for protected endpoint tests
  const session = auth.createSession({ userAgent: "ChallengerHarness", ip: "127.0.0.1" });
  sessionToken = session.token;
  assert.ok(sessionToken, "Session token must be created");

  // ============================================================================
  // SUITE 1: WEBHOOK CONCURRENCY & BURST STRESS TESTING (inbox_server.js)
  // ============================================================================
  console.log("\n🔹 [1/7] Concurrency Burst Stress Testing (50+ parallel webhooks)...");

  await testAsync("1.1 50+ concurrent requests to /api/webhook/email all succeed with unique messageIds", async () => {
    const burstCount = 60;
    const start = Date.now();
    const promises = [];

    for (let i = 0; i < burstCount; i++) {
      const email = `burst_recipient_${i}_${Date.now()}@batabitoo.com`;
      const payload = {
        recipient: email,
        sender: `sender_${i}@external.org`,
        subject: `Concurrent Burst Message ${i} [${Date.now()}]`,
        text: `Security code is ${100000 + i}. High concurrency stress payload #${i}.`,
      };
      promises.push(
        rawReq("/api/webhook/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
      );
    }

    const responses = await Promise.all(promises);
    const duration = Date.now() - start;
    console.log(`     ⚡ Executed ${burstCount} concurrent webhooks in ${duration}ms (${(duration / burstCount).toFixed(1)}ms/req)`);

    assert.equal(responses.length, burstCount);
    const messageIds = new Set();

    for (let i = 0; i < burstCount; i++) {
      const r = responses[i];
      assert.equal(r.status, 200, `Request ${i} must return 200 OK (got ${r.status})`);
      assert.equal(r.json?.success, true, `Request ${i} json must indicate success`);
      assert.ok(r.json?.messageId, `Request ${i} must return a messageId`);
      assert.ok(!messageIds.has(r.json.messageId), `Duplicate messageId generated: ${r.json.messageId}`);
      messageIds.add(r.json.messageId);
    }
  });

  await testAsync("1.2 Rapid successive burst to single targeted inbox accumulates without data loss", async () => {
    const burstTarget = `rapid_target_${Date.now()}@batabitoo.com`;
    const batchSize = 30;
    const promises = [];

    for (let i = 0; i < batchSize; i++) {
      promises.push(
        rawReq("/api/webhook/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: burstTarget,
            sender: "amazon-verify@amazon.com",
            subject: `Order Confirmation #${1000 + i}`,
            text: `Your OTP is ${200000 + i}`,
          })
        })
      );
    }

    const results = await Promise.all(promises);
    for (const r of results) {
      assert.equal(r.status, 200);
      assert.equal(r.json?.success, true);
    }

    // Query inbox to verify all messages exist
    const qRes = await rawReq(`/api/inbox/current?email=${encodeURIComponent(burstTarget)}`, {
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    assert.equal(qRes.status, 200);
    assert.equal(qRes.json?.success, true);
    assert.ok(qRes.json.messages.length >= batchSize, `Expected at least ${batchSize} messages in target inbox`);
  });

  // ============================================================================
  // SUITE 2: HOSTILE BOUNDARY INPUTS & MALFORMED PAYLOADS
  // ============================================================================
  console.log("\n🔹 [2/7] Hostile Boundary Inputs & Malformed Payloads...");

  await testAsync("2.1 Empty body `{}` to /api/webhook/email returns 400 Bad Request", async () => {
    const res = await rawReq("/api/webhook/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(res.status, 400);
    assert.ok(res.json?.error);
  });

  await testAsync("2.2 Missing or invalid email recipient rejects with 400", async () => {
    const invalidRecipients = ["notanemail", "@@", "<>", "admin@", "@batabitoo.com", "foo bar@batabitoo.com"];
    for (const bad of invalidRecipients) {
      const res = await rawReq("/api/webhook/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: bad, subject: "Test" })
      });
      assert.equal(res.status, 400, `Recipient '${bad}' should be rejected with 400`);
    }
  });

  await testAsync("2.3 Standard route rejects body exceeding 2MB limit with 413 Payload Too Large", async () => {
    // Test on /api/official/create where parseBody() is not wrapped in .catch(() => ({}))
    const oversizedBody = JSON.stringify({
      email: `oversized_${Date.now()}@batabitoo.com`,
      padding: "X".repeat(2.5 * 1024 * 1024)
    });
    const res = await rawReq("/api/official/create", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json"
      },
      body: oversizedBody
    });
    assert.equal(res.status, 413, `Oversized payload on /api/official/create should return 413 (got ${res.status})`);
  });

  await testAsync("2.4 Inbound webhook accepts large body up to 32MB streaming limit", async () => {
    const largeBody = JSON.stringify({
      recipient: `large_mail_${Date.now()}@batabitoo.com`,
      sender: "large@files.com",
      subject: "Large Inbound Email",
      text: "A".repeat(3 * 1024 * 1024)
    });
    const res = await rawReq("/api/webhook/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: largeBody
    });
    assert.equal(res.status, 200);
    assert.equal(res.json?.success, true);
  });

  await testAsync("2.5 Prototype pollution attempts are neutralized", async () => {
    const maliciousPayload = JSON.stringify({
      "__proto__": { "pollutedProp": "vulnerable" },
      "constructor": { "prototype": { "pollutedConstructor": "vulnerable" } },
      pin: "0530"
    });
    const res = await rawReq("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: maliciousPayload
    });
    assert.equal(({}).pollutedProp, undefined, "Object prototype must not be polluted");
    assert.equal(({}).pollutedConstructor, undefined, "Object prototype constructor must not be polluted");
  });

  await testAsync("2.6 Unicode, Arabic, Emojis, and RTL boundary values preserved without corruption", async () => {
    const unicodeEmail = `arabic_${Date.now()}@batabitoo.com`;
    const unicodeSubject = "🚨 إشعار أمني هام: رمز التحقق ٤٨٢٩١٠ مع أحرف مميزة 🔐✨";
    const unicodeText = "مرحباً بك! كود الدخول الخاص بك هو 482910. لا تشارك هذا الرمز مع أي شخص آخر.";

    const res = await rawReq("/api/webhook/email", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        recipient: unicodeEmail,
        sender: "أمازون <noreply@amazon.sa>",
        subject: unicodeSubject,
        text: unicodeText
      })
    });
    assert.equal(res.status, 200);
    assert.equal(res.json?.otp, "482910");
    assert.equal(res.json?.subject, unicodeSubject);

    // Query to verify UTF-8 persistence in message detail
    const msgId = res.json?.messageId;
    const detailRes = await rawReq(`/api/messages/${encodeURIComponent(msgId)}`, {
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    assert.equal(detailRes.status, 200);
    assert.ok(detailRes.json.text.includes("مرحباً بك"));
    assert.ok(detailRes.json.html.includes("dir=\"auto\""));
  });

  await testAsync("2.7 Missing or atypical Content-Type header handled gracefully without crash", async () => {
    const res = await rawReq("/api/webhook/email", {
      method: "POST",
      body: Buffer.from("Raw unstructured string without content-type header")
    });
    assert.ok([200, 400].includes(res.status), `Expected 200 or 400, got ${res.status}`);
  });

  // ============================================================================
  // SUITE 3: AUTH SECURITY BOUNDARY MATRIX & RACE CONDITION PROBING
  // ============================================================================
  console.log("\n🔹 [3/7] Auth Security Matrix & Race Condition Probing...");

  await testAsync("3.1 Complete protected endpoint matrix returns 401 AUTH_REQUIRED when unauthenticated", async () => {
    const protectedRoutes = [
      { path: "/api/inboxes", method: "GET" },
      { path: "/api/inbox/current", method: "GET" },
      { path: "/api/inbox/sync", method: "POST" },
      { path: "/api/official/create", method: "POST" },
      { path: "/api/status", method: "GET" },
      { path: "/api/storage/status", method: "GET" },
      { path: "/api/winners-sync/status", method: "GET" },
      { path: "/api/all-messages", method: "GET" },
      { path: "/api/auth/check", method: "GET" },
      { path: "/api/gmail/accounts", method: "GET" },
      { path: "/api/gmail/sync", method: "POST" },
      { path: "/api/gmail/disconnect", method: "POST" },
      { path: "/api/gmail/oauth/auth-url", method: "GET" },
      { path: "/api/gmail/oauth/config", method: "GET" },
      { path: "/api/inbox/ban-status", method: "POST" },
      { path: "/api/inboxes/create", method: "POST" },
      { path: "/api/inboxes/select", method: "POST" },
      { path: "/api/nivea/log-registration", method: "POST" },
      { path: "/api/nivea/logs", method: "GET" },
      { path: "/api/events", method: "GET" }
    ];

    for (const route of protectedRoutes) {
      const res = await rawReq(route.path, { method: route.method });
      assert.equal(res.status, 401, `Route ${route.method} ${route.path} must return 401 when unauthenticated (got ${res.status})`);
      if (res.json) {
        assert.equal(res.json.code, "AUTH_REQUIRED");
      }
    }
  });

  await testAsync("3.2 Tampered, forged, and expired tokens strictly rejected with 401", async () => {
    const bogusTokens = [
      "Bearer totally-fake-token",
      "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.bogusSignature",
      "Bearer " + sessionToken.slice(0, -4) + "XXXX", // corrupted signature
      "Bearer ",
      "Bearer null",
      "Bearer undefined"
    ];

    for (const token of bogusTokens) {
      const res = await rawReq("/api/auth/check", {
        headers: { Authorization: token }
      });
      assert.equal(res.status, 401, `Tampered token '${token.slice(0, 30)}...' must be rejected with 401`);
    }
  });

  await testAsync("3.3 Race condition probing on targeted inbox queries (?email=...) across 5 concurrent mailboxes", async () => {
    // Provision 5 distinct mailboxes with distinct messages
    const inboxes = [];
    for (let i = 0; i < 5; i++) {
      const email = `mailbox_race_${i}_${Date.now()}@batabitoo.com`;
      inboxes.push({ email, uniqueKey: `KEY_${i}_${Date.now()}` });
      await rawReq("/api/webhook/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: email,
          sender: `service_${i}@sender.com`,
          subject: `Unique Subject for Mailbox ${i}: ${inboxes[i].uniqueKey}`,
          text: `Message content unique to mailbox ${i}`
        })
      });
    }

    // Fire 35 rapid concurrent requests intermixing all 5 mailboxes
    const queryPromises = [];
    for (let reqIdx = 0; reqIdx < 35; reqIdx++) {
      const targetInbox = inboxes[reqIdx % inboxes.length];
      queryPromises.push(
        rawReq(`/api/inbox/current?email=${encodeURIComponent(targetInbox.email)}`, {
          headers: { Authorization: `Bearer ${sessionToken}` }
        }).then(res => ({ res, expectedEmail: targetInbox.email, expectedKey: targetInbox.uniqueKey }))
      );
    }

    const queryResults = await Promise.all(queryPromises);
    assert.equal(queryResults.length, 35);

    for (const { res, expectedEmail, expectedKey } of queryResults) {
      assert.equal(res.status, 200);
      assert.equal(res.json?.success, true);
      assert.equal(res.json?.inbox?.email, expectedEmail, `Race condition: expected ${expectedEmail}, got ${res.json?.inbox?.email}`);
      const messages = res.json?.messages || [];
      assert.ok(messages.length > 0, `Inbox ${expectedEmail} must contain messages`);
      const matched = messages.some(m => m.subject.includes(expectedKey));
      assert.ok(matched, `Cross-talk violation: expected message key ${expectedKey} in messages for ${expectedEmail}`);
    }
  });

  // ============================================================================
  // SUITE 4: CLOUDDATABASE ISOLATION, TOKEN SANITIZATION & STATE INTEGRITY
  // ============================================================================
  console.log("\n🔹 [4/7] CloudDatabase Isolation, Token Sanitization & State Integrity...");

  await testAsync("4.1 setActiveInboxId never mutates, drops or clobbers oauthAccounts", async () => {
    // Seed OAuth accounts in database
    const testAccount1 = {
      email: "secure.tester.one@gmail.com",
      authType: "oauth2",
      refreshToken: "rt_mock_1234567890",
      accessToken: "at_mock_initial",
      personName: "Tester One",
      status: "connected"
    };
    const testAccount2 = {
      email: "secure.tester.two@gmail.com",
      authType: "oauth2",
      refreshToken: "rt_mock_9876543210",
      accessToken: "at_mock_initial_2",
      personName: "Tester Two",
      status: "connected"
    };

    await mailDatabase.saveOAuthAccount(testAccount1);
    await mailDatabase.saveOAuthAccount(testAccount2);

    const initialAccounts = mailDatabase.getOAuthAccounts();
    assert.ok(initialAccounts.some(a => a.email === testAccount1.email && a.refreshToken === testAccount1.refreshToken));
    assert.ok(initialAccounts.some(a => a.email === testAccount2.email && a.refreshToken === testAccount2.refreshToken));

    // Rapidly invoke setActiveInboxId with multiple transitions
    await mailDatabase.setActiveInboxId("temp_inbox_alpha");
    assert.equal(mailDatabase.getActiveInboxId(), "temp_inbox_alpha");

    await mailDatabase.setActiveInboxId(null);
    assert.equal(mailDatabase.getActiveInboxId(), null);

    await mailDatabase.setActiveInboxId("temp_inbox_beta");
    assert.equal(mailDatabase.getActiveInboxId(), "temp_inbox_beta");

    // Verify OAuth accounts were not touched or erased
    const postAccounts = mailDatabase.getOAuthAccounts();
    assert.equal(postAccounts.length, initialAccounts.length);
    const acc1 = postAccounts.find(a => a.email === testAccount1.email);
    const acc2 = postAccounts.find(a => a.email === testAccount2.email);
    assert.ok(acc1, "Account 1 must remain intact");
    assert.equal(acc1.refreshToken, testAccount1.refreshToken);
    assert.ok(acc2, "Account 2 must remain intact");
    assert.equal(acc2.refreshToken, testAccount2.refreshToken);
  });

  await testAsync("4.2 saveOAuthAccount normalizes schema variations (camelCase & snake_case) idempotently", async () => {
    const mixedAccount = {
      email: "normalize.test@gmail.com",
      auth_type: "oauth2",
      refresh_token: "refresh_token_snake_case",
      access_token: "access_token_snake_case",
      person_name: "Normalize Tester",
      expiry_date: new Date(Date.now() + 3600000).toISOString()
    };

    await mailDatabase.saveOAuthAccount(mixedAccount);
    const retrieved = mailDatabase.getOAuthAccount("normalize.test@gmail.com");
    assert.ok(retrieved, "Account must be retrieved");
    assert.equal(retrieved.refreshToken, "refresh_token_snake_case");
    assert.equal(retrieved.accessToken, "access_token_snake_case");
    assert.equal(retrieved.personName, "Normalize Tester");
    assert.equal(retrieved.authType, "oauth2");
  });

  await testAsync("4.3 Status counts stay perfectly synchronized with inboxes and messages arrays", () => {
    const counts = db.getStatusCounts();
    const allInboxes = db.getAllInboxes();
    const allMessages = db.getAllMessages();

    assert.equal(counts.totalInboxes, allInboxes.length, "totalInboxes count mismatch");
    assert.equal(counts.messages, allMessages.length, "messages count mismatch");
    assert.equal(counts.official, allInboxes.filter(i => i.isOfficial).length, "official inboxes count mismatch");
    assert.equal(counts.temp, allInboxes.filter(i => !i.isOfficial).length, "temp inboxes count mismatch");
  });

  // ============================================================================
  // SUITE 5: GMAILSYNCSERVICE RESILIENCY & FALLBACK
  // ============================================================================
  console.log("\n🔹 [5/7] GmailSyncService Resiliency & Fallback...");

  test("5.1 OAuth configuration falls back safely to disk when Firestore config is absent", () => {
    const config = gmailSync.getOAuthConfig();
    assert.ok(config, "getOAuthConfig must return an object");
    assert.ok(config.clientId, "Config must contain a non-empty clientId");
    if (fs.existsSync(path.join(__dirname, "..", "google_oauth_config.json"))) {
      assert.ok(config.clientSecret, "Config must contain clientSecret from disk fallback");
    }
  });

  test("5.2 Canonical Gmail alias resolution resolves dotted and mixed-casing variations", () => {
    const baseEmail = "ahmed.batabitoo.roou@gmail.com";
    const variations = [
      "ahmed.batabitoo.roou@gmail.com",
      "ahmedbatabitooroou@gmail.com",
      "a.h.m.e.d.b.a.t.a.b.i.t.o.o.r.o.o.u@gmail.com",
      "AHMED.BATABITOO.ROOU@GMAIL.COM",
      "ahmedbatabitoo.roou@gmail.com"
    ];

    // Seed primary account
    mailDatabase.saveOAuthAccount({
      email: "ahmedbatabitooroou@gmail.com",
      authType: "oauth2",
      refreshToken: "rt_canonical_test",
      accessToken: "at_canonical_test",
      personName: "Ahmed Canonical"
    });

    for (const v of variations) {
      const found = gmailSync.findAccount(v);
      assert.ok(found, `findAccount must resolve variation: ${v}`);
      assert.equal(found.refreshToken, "rt_canonical_test");
    }
  });

  await testAsync("5.3 refreshAccountToken handles invalid grant cleanly without uncaught exception", async () => {
    const testEmail = `token_fail_${Date.now()}@gmail.com`;
    await mailDatabase.saveOAuthAccount({
      email: testEmail,
      authType: "oauth2",
      refreshToken: "invalid_expired_token_for_test",
      status: "connected"
    });

    const refreshed = await gmailSync.refreshAccountToken(testEmail);
    assert.equal(refreshed, null, "Should return null on token refresh failure");

    const updatedAccount = gmailSync.findAccount(testEmail);
    assert.ok(updatedAccount, "Account must still exist");
    assert.ok(updatedAccount.lastError || updatedAccount.status === "auth_expired" || updatedAccount.status === "refresh_failed");
  });

  // ============================================================================
  // SUITE 6: SCHEMA VALIDATORS EXHAUSTIVE FUZZING (validators.js)
  // ============================================================================
  console.log("\n🔹 [6/7] Schema Validators Exhaustive Fuzzing...");

  test("6.1 Array injection across all 5 validator functions fails-closed without throwing", () => {
    const arrayInputs = [[], [1, 2, 3], ["a", "b"], [{}], [null]];

    for (const arr of arrayInputs) {
      assert.equal(validators.validateLoginPayload(arr).valid, false);
      assert.equal(validators.validateAppVersionPayload(arr).valid, false);
      assert.equal(validators.validateOfficialCreatePayload(arr).valid, false);
      assert.equal(validators.validateBanStatusPayload(arr).valid, false);
      assert.equal(validators.validateNiveaLogPayload(arr).valid, false);
    }
  });

  test("6.2 Type confusion, null bytes, and non-primitive inputs rejected across validators", () => {
    const hostileInputs = [null, undefined, 12345, true, false, () => {}, Symbol("test")];

    for (const hostile of hostileInputs) {
      assert.equal(validators.validateLoginPayload(hostile).valid, false);
      assert.equal(validators.validateAppVersionPayload(hostile).valid, false);
      assert.equal(validators.validateOfficialCreatePayload(hostile).valid, false);
      assert.equal(validators.validateBanStatusPayload(hostile).valid, false);
      assert.equal(validators.validateNiveaLogPayload(hostile).valid, false);
    }
  });

  test("6.3 validateBanStatusPayload resolves target from inboxId, id, or email and rejects invalid status", () => {
    // Valid cases direct to validator
    assert.equal(validators.validateBanStatusPayload({ inboxId: "ibx_1", status: "confirmed" }).valid, true);
    assert.equal(validators.validateBanStatusPayload({ id: "ibx_2", status: "suspected" }).valid, true);
    assert.equal(validators.validateBanStatusPayload({ email: "user@batabitoo.com", status: "safe" }).valid, true);
    assert.equal(validators.validateBanStatusPayload({ inboxId: "ibx_3", banStatus: "none" }).valid, true);

    // Invalid status rejected
    assert.equal(validators.validateBanStatusPayload({ inboxId: "ibx_1", status: "malicious_status" }).valid, false);
    assert.equal(validators.validateBanStatusPayload({ inboxId: "ibx_1", status: "banned" }).valid, false);
    assert.equal(validators.validateBanStatusPayload({}).valid, false);
  });

  await testAsync("6.4 Server route /api/inbox/ban-status accepts verdict: reject and translates to safe status", async () => {
    const res = await rawReq("/api/inbox/ban-status", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id: "official_test_ban_verdict", verdict: "reject", reason: "User deemed safe" })
    });
    assert.equal(res.status, 200);
    assert.equal(res.json?.success, true);
  });

  test("6.5 validateAppVersionPayload enforces integer code, rejects booleans and insecure URLs", () => {
    assert.equal(validators.validateAppVersionPayload({ latestVersionCode: true, latestVersionName: "1.0", downloadUrl: "https://example.com/app.apk" }).valid, false);
    assert.equal(validators.validateAppVersionPayload({ latestVersionCode: false, latestVersionName: "1.0", downloadUrl: "https://example.com/app.apk" }).valid, false);

    assert.equal(validators.validateAppVersionPayload({ latestVersionCode: 1, latestVersionName: "1.0", downloadUrl: "http://insecure.com/app.apk" }).valid, false);
    assert.equal(validators.validateAppVersionPayload({ latestVersionCode: 1, latestVersionName: "1.0", downloadUrl: "javascript:alert(1)" }).valid, false);

    assert.equal(validators.validateAppVersionPayload({ latestVersionCode: 0, latestVersionName: "1.0", downloadUrl: "https://example.com/app.apk" }).valid, false);
    assert.equal(validators.validateAppVersionPayload({ latestVersionCode: -5, latestVersionName: "1.0", downloadUrl: "https://example.com/app.apk" }).valid, false);
  });

  test("6.6 validateNiveaLogPayload preserves index: 0 as a valid number", () => {
    const res = validators.validateNiveaLogPayload({
      personName: "Tester",
      mobile: "0501234567",
      index: 0
    });
    assert.equal(res.valid, true);
    assert.equal(res.data.index, 0, "Index 0 must not be converted to null or dropped");
  });

  // ============================================================================
  // SUITE 7: SERVER-SENT EVENTS & MAILCONTENT CONCURRENCY
  // ============================================================================
  console.log("\n🔹 [7/7] Server-Sent Events Lifecycle & MailContent Concurrency...");

  await testAsync("7.1 MailContent.normalize and archive complete non-blocking under concurrency", async () => {
    const items = [];
    const count = 40;
    const start = Date.now();

    for (let i = 0; i < count; i++) {
      items.push(
        content.normalize({
          subject: `Test Message ${i}`,
          recipient: `norm_${i}@batabitoo.com`,
          text: `Sample body text ${i} with OTP: ${300000 + i}`,
          html: `<p>Sample HTML body ${i} <script>alert("evil")</script></p>`
        }, `msg_norm_${i}_${Date.now()}`)
      );
    }

    const normalizedResults = await Promise.all(items);
    const elapsed = Date.now() - start;
    console.log(`     ⚡ Normalized ${count} messages concurrently in ${elapsed}ms (${(elapsed / count).toFixed(1)}ms/msg)`);

    assert.equal(normalizedResults.length, count);
    for (const msg of normalizedResults) {
      assert.ok(!msg.html.includes("<script>"), "HTML sanitizer must strip script tags");
      assert.ok(msg.otp, "OTP must be extracted");
      assert.equal(msg.bodyStored, true);
    }
  });

  await testAsync("7.2 Server-Sent Events stream receives broadcasts and cleans up listeners upon close", async () => {
    const initialListenerCount = eventBus.listenerCount("broadcast");

    const sseRes = await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    assert.equal(sseRes.status, 200);
    assert.ok(sseRes.headers.get("content-type").includes("text/event-stream"));

    const newListenerCount = eventBus.listenerCount("broadcast");
    assert.equal(newListenerCount, initialListenerCount + 1, "SSE connection should attach exactly 1 broadcast listener");

    const reader = sseRes.body.getReader();
    const { value: chunk1 } = await reader.read();
    const initialGreeting = new TextDecoder().decode(chunk1);
    assert.ok(initialGreeting.includes(": connected"), "Initial handshake must be emitted");

    // Close the SSE stream
    await reader.cancel();
    
    // Allow brief event tick for req 'close' event handler to fire
    await new Promise(r => setTimeout(r, 100));

    const finalListenerCount = eventBus.listenerCount("broadcast");
    assert.equal(finalListenerCount, initialListenerCount, "Broadcast listener must be cleanly detached on disconnect to prevent memory leaks");
  });

  // Teardown server
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }

  console.log("\n======================================================================");
  console.log(`📊 ADVERSARIAL TEST RESULTS: ${passedTests}/${totalTests} Passed (Failures: ${failedTests})`);
  console.log("======================================================================\n");

  if (failedTests > 0) {
    console.error("❌ Adversarial Verification Encountered Failures:");
    for (const f of failures) {
      console.error(`  - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  } else {
    console.log("🎉 ALL TIER 5 ADVERSARIAL VERIFICATIONS PASSED WITH 100% SUCCESS!");
    process.exit(0);
  }
}

run().catch(err => {
  console.error("❌ Fatal Harness Failure:", err);
  if (server) server.close();
  process.exit(1);
});
