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
const validators = require("../validators");
const parser = require("../EmailParser");
const niveaWorker = require("../NiveaWinnerSyncWorker");
const tempSync = require("../TempSyncService");

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
  console.log("================================================================");
  console.log("🚀 BATABITOO MAIL CENTER — MILESTONE M3 END-TO-END VERIFICATION");
  console.log("================================================================\n");

  console.log("🔍 [1/7] Initializing Database & Ephemeral Server...");
  await db.ready();
  await new Promise(resolve => {
    server = http.createServer(handleRequest).listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  console.log(`   ✅ Test server running at ${baseUrl}`);

  console.log("\n🔍 [2/7] Verifying Schema Validator Hardening...");
  // 1. validateBanStatusPayload resolves target identifier correctly
  const banById = validators.validateBanStatusPayload({ id: "inbox_m3_test", banStatus: "confirmed" });
  assert.equal(banById.valid, true);
  assert.equal(banById.data.inboxId, "inbox_m3_test", "validateBanStatusPayload must resolve target 'id' into inboxId");
  assert.notEqual(banById.data.inboxId, "undefined", "inboxId must never be the string 'undefined'");

  const banByEmail = validators.validateBanStatusPayload({ email: "ban_test@batabitoo.com", banStatus: "safe" });
  assert.equal(banByEmail.valid, true);
  assert.equal(banByEmail.data.inboxId, "ban_test@batabitoo.com", "validateBanStatusPayload must resolve target 'email' into inboxId");

  const banByInboxId = validators.validateBanStatusPayload({ inboxId: "inbox_direct", banStatus: "suspected" });
  assert.equal(banByInboxId.valid, true);
  assert.equal(banByInboxId.data.inboxId, "inbox_direct");
  console.log("   ✅ validateBanStatusPayload correctly resolves target from id, email, and inboxId.");

  // 2. validateNiveaLogPayload preserves index: 0
  const niveaZero = validators.validateNiveaLogPayload({ personName: "سارة", mobile: "0551234567", index: 0 });
  assert.equal(niveaZero.valid, true);
  assert.equal(niveaZero.data.index, 0, "validateNiveaLogPayload must preserve index 0 as numeric 0");

  const niveaNonZero = validators.validateNiveaLogPayload({ personName: "سارة", mobile: "0551234567", index: 42 });
  assert.equal(niveaNonZero.data.index, 42);
  console.log("   ✅ validateNiveaLogPayload preserves registration index 0 without falsy conversion.");

  // 3. Array payload rejection across all validators
  assert.equal(validators.validateLoginPayload([]).valid, false, "validateLoginPayload must reject arrays");
  assert.equal(validators.validateAppVersionPayload([]).valid, false, "validateAppVersionPayload must reject arrays");
  assert.equal(validators.validateOfficialCreatePayload([]).valid, false, "validateOfficialCreatePayload must reject arrays");
  assert.equal(validators.validateBanStatusPayload([]).valid, false, "validateBanStatusPayload must reject arrays");
  assert.equal(validators.validateNiveaLogPayload([]).valid, false, "validateNiveaLogPayload must reject arrays");
  console.log("   ✅ Array payloads rejected across all schema validators.");

  // 4. validateAppVersionPayload rejects boolean latestVersionCode: true
  const boolCode = validators.validateAppVersionPayload({ latestVersionCode: true, latestVersionName: "1.0", downloadUrl: "https://x.com/a.apk" });
  assert.equal(boolCode.valid, false, "validateAppVersionPayload must reject boolean latestVersionCode");
  console.log("   ✅ validateAppVersionPayload rejects boolean latestVersionCode: true.");

  console.log("\n🔍 [3/7] Verifying EmailParser Dual-Signature & OTP Ingestion...");
  // 1. 2-argument signature: extractOtp(text, subject)
  const otp2Arg = parser.extractOtp("رمز التحقق الخاص بك هو 948210", "رسالة أمان");
  assert.equal(otp2Arg, "948210");

  // 2. 3-argument signature: extractOtp(text, html, subject) with subject priority
  const otp3ArgSubject = parser.extractOtp("Body text", "<div>Code: 112233</div>", "Verification Code: 556677");
  assert.equal(otp3ArgSubject, "556677", "Must extract from subject first in 3-argument call");

  // 3. 3-argument signature fallback to html
  const otp3ArgHtml = parser.extractOtp("Plain text without digits", "<div>رمز التأكيد: 889900</div>", "Important Notification");
  assert.equal(otp3ArgHtml, "889900", "Must extract from HTML body when subject lacks code");

  // 4. 2-argument with HTML second arg: extractOtp(text, html)
  const otpHtmlOnly = parser.extractOtp("", "<p>Your login code is 445566</p>");
  assert.equal(otpHtmlOnly, "445566");
  console.log("   ✅ EmailParser.extractOtp handles (text, subject), (text, html, subject), and HTML-only callers.");

  console.log("\n🔍 [4/7] Verifying CloudDatabase Ban Resolution & Active ID Cleanup...");
  // 1. updateInboxBanStatus resolves target by email or id
  const testBoxEmail = `ban_res_${Date.now()}@batabitoo.com`;
  const savedInbox = await mailDatabase.saveInbox({
    id: `box_res_${Date.now()}`,
    email: testBoxEmail,
    domain: "batabitoo.com",
    isOfficial: true,
  });

  const updatedByEmail = await mailDatabase.updateInboxBanStatus(testBoxEmail, "confirmed", "Automated ban by email");
  assert.ok(updatedByEmail, "updateInboxBanStatus must find inbox by email");
  assert.equal(updatedByEmail.banStatus, "confirmed");
  assert.equal(updatedByEmail.isBanned, true);

  const updatedById = await mailDatabase.updateInboxBanStatus(savedInbox.id, "safe", "Automated unban by id");
  assert.ok(updatedById, "updateInboxBanStatus must find inbox by id");
  assert.equal(updatedById.banStatus, "safe");
  assert.equal(updatedById.isBanned, false);
  console.log("   ✅ CloudDatabase.updateInboxBanStatus resolves targets by email or id.");

  // 2. deleteInbox reassigns or clears activeInboxId without dangling orphaned reference
  const delBox1 = await mailDatabase.saveInbox({ id: `box_del_1_${Date.now()}`, email: `del1_${Date.now()}@batabitoo.com` });
  const delBox2 = await mailDatabase.saveInbox({ id: `box_del_2_${Date.now()}`, email: `del2_${Date.now()}@batabitoo.com` });

  mailDatabase.cache.activeInboxId = delBox1.id;
  assert.equal(mailDatabase.getActiveInboxId(), delBox1.id);

  // Use test bypass or actual delete
  const origMutate = mailDatabase._mutateCore;
  mailDatabase._mutateCore = async mutator => {
    const state = { inboxes: [...mailDatabase.cache.inboxes], messages: [...mailDatabase.cache.messages] };
    const res = await mutator(state);
    if (res) {
      mailDatabase.cache.inboxes = state.inboxes;
      mailDatabase.cache.messages = state.messages;
    }
    return res;
  };

  try {
    await mailDatabase.deleteInbox(delBox1.id);
    assert.notEqual(mailDatabase.getActiveInboxId(), delBox1.id, "activeInboxId must not remain dangling after deletion");
    console.log("   ✅ CloudDatabase.deleteInbox cleans up activeInboxId on deletion.");
  } finally {
    mailDatabase._mutateCore = origMutate;
  }

  console.log("\n🔍 [5/7] Verifying Sync Worker Timer Management...");
  // 1. NiveaWorker timer tracking & cancellation
  niveaWorker.startScheduler();
  assert.ok(niveaWorker.initialTimer, "NiveaWinnerSyncWorker must capture initialTimer handle");
  niveaWorker.stopScheduler();
  assert.equal(niveaWorker.initialTimer, null, "NiveaWinnerSyncWorker must clear initialTimer on stopScheduler");
  assert.equal(niveaWorker.timer, null, "NiveaWinnerSyncWorker must clear recurring timer on stopScheduler");

  // 2. TempSync timer tracking & cancellation
  tempSync.startAutoSync();
  assert.ok(tempSync.initialTimer, "TempSyncService must capture initialTimer handle");
  tempSync.stopAutoSync();
  assert.equal(tempSync.initialTimer, null, "TempSyncService must clear initialTimer on stopAutoSync");
  assert.equal(tempSync.syncIntervalTimer, null, "TempSyncService must clear interval timer on stopAutoSync");
  console.log("   ✅ NiveaWinnerSyncWorker and TempSyncService cleanly track and cancel initialTimer handles.");

  console.log("\n🔍 [6/7] Verifying Route Validation in POST /api/official/create...");
  // 1. Unauthorized domain rejected with 400
  const badDomainRes = await req("/api/official/create", {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ email: "unauthorized@evil-domain.com" }),
  });
  assert.equal(badDomainRes.status, 400, "POST /api/official/create must return 400 for unauthorized domain");
  assert.equal(badDomainRes.json.success, false);

  // 2. Valid domain accepted with 200
  const validDomainRes = await req("/api/official/create", {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ email: `verified_official_${Date.now()}@batabitoo.com`, label: "Official Admin" }),
  });
  assert.equal(validDomainRes.status, 200, "POST /api/official/create must return 200 for valid domain");
  assert.equal(validDomainRes.json.success, true);
  assert.ok(validDomainRes.json.inbox);
  assert.equal(validDomainRes.json.inbox.isOfficial, true);
  console.log("   ✅ POST /api/official/create validates payloads and rejects unauthorized domains.");

  console.log("\n🔍 [7/7] Verifying Test Suite Updates in Existing Test Suites...");
  const mailCenterTestSrc = fs.readFileSync(path.join(__dirname, "..", "test", "mail_center.test.js"), "utf8");
  assert.ok(
    mailCenterTestSrc.includes("assert.equal(banById.data.inboxId, \"inbox_1\");"),
    "test/mail_center.test.js must assert banById.data.inboxId directly"
  );
  assert.ok(
    mailCenterTestSrc.includes("assert.equal(banByEmail.data.inboxId, \"test@batabitoo.com\");"),
    "test/mail_center.test.js must assert banByEmail.data.inboxId directly"
  );

  const e2eTestSrc = fs.readFileSync(path.join(__dirname, "..", "test", "e2e_suite.test.js"), "utf8");
  assert.ok(
    e2eTestSrc.includes("assert.equal(byEmail.data.inboxId, \"ban_test@batabitoo.com\");"),
    "test/e2e_suite.test.js must assert byEmail.data.inboxId directly"
  );
  console.log("   ✅ Existing test suites updated to assert data.inboxId directly.");

  if (server) server.close();

  console.log("\n================================================================");
  console.log("🎉 ALL MILESTONE M3 VERIFICATION CHECKS PASSED WITH 100% SUCCESS!");
  console.log("================================================================\n");
  process.exit(0);
}

run().catch(err => {
  console.error("❌ Milestone M3 Verification Failed:", err);
  if (server) server.close();
  process.exit(1);
});
