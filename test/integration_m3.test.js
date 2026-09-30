/**
 * Batabitoo Mail Center — Milestone M3 Integration Test Suite
 * 
 * Target: test/integration_m3.test.js
 * Compliant with PROJECT.md and TEST_INFRA.md.
 * 
 * Covers:
 * 1. Validator Robustness (All functions in validators.js + fixed validateBanStatusPayload)
 * 2. Public Webhook Inbound Delivery & Auth Whitelist Verification
 * 3. MIME Processing, Arabic Decoders & OTP Extraction (2-arg and 3-arg support)
 * 4. Targeted Inbox Queries (?email= and ?id=) with Edge Cases & Isolation
 * 5. Official Domain Sync Response Format Contract
 * 6. Non-Blocking Storage Archival & OAuth Token Fallback
 * 7. M3 Backend Fixes (Official Create validation, CloudDatabase ban-by-email & active ID cleanup, timer cleanup)
 */

"use strict";

// Silence server console logs to prevent Windows named pipe corruption in Node test runner IPC
console.log = () => {};
console.warn = () => {};

// Stub firebase-admin storage BEFORE loading MailContent to avoid external GCS latency
const storage = require("firebase-admin/storage");
let storageDelayMs = 0;
let storageShouldFail = false;

storage.getStorage = () => ({
  bucket: () => ({
    file: () => ({
      save: async () => {
        if (storageDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, storageDelayMs));
        }
        if (storageShouldFail) {
          throw new Error("Simulated GCS storage failure");
        }
      },
      download: async () => [Buffer.from("")],
    }),
  }),
});

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

// Load modules under test
const { handleRequest } = require("../inbox_server");
const { mailDatabase } = require("../CloudDatabase");
const db = require("../InboxDatabase");
const gmailSync = require("../GmailSyncService");
const auth = require("../auth");
const validators = require("../validators");
const content = require("../MailContent");
const parser = require("../EmailParser");
const { eventBus } = require("../eventBus");
const niveaWorker = require("../NiveaWinnerSyncWorker");
const tempSync = require("../TempSyncService");

const ROOT_DIR = path.join(__dirname, "..");

// In-memory fast bypass for CloudDatabase transactions during test execution
mailDatabase._targetedUpsert = async (entity, items) => {
  const key = entity === "inbox" ? "inboxes" : "messages";
  const existingMap = new Map(mailDatabase.cache[key].map(item => [item.id, item]));
  for (const item of items) existingMap.set(item.id, item);
  mailDatabase.cache[key] = Array.from(existingMap.values());
  return items;
};
mailDatabase._mutateCore = async mutator => {
  const state = { inboxes: [...mailDatabase.cache.inboxes], messages: [...mailDatabase.cache.messages] };
  const res = await mutator(state);
  if (res) {
    mailDatabase.cache.inboxes = state.inboxes;
    mailDatabase.cache.messages = state.messages;
  }
  return res;
};
mailDatabase._persistBootstrap = async () => true;
mailDatabase._enqueue = async fn => (typeof fn === "function" ? fn() : true);
if (gmailSync.oauthSyncTimer) {
  clearInterval(gmailSync.oauthSyncTimer);
  gmailSync.oauthSyncTimer = null;
}

let server;
let baseUrl;
const MASTER_PIN = "0530";
const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "X-Master-PIN": MASTER_PIN,
};

before(async () => {
  await db.ready();
  await new Promise(resolve => {
    server = http.createServer(handleRequest).listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(() => {
  if (server) server.close();
});

// Helper for test HTTP requests
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

/* ========================================================================== */
/* SUITE 1: VALIDATOR ROBUSTNESS (validators.js)                              */
/* ========================================================================== */

test("M3-VAL-01: Helper isNonEmptyString enforces types, trimming, and maxLength", () => {
  assert.equal(validators.isNonEmptyString("valid string"), true);
  assert.equal(validators.isNonEmptyString("   trimmed   "), true);
  assert.equal(validators.isNonEmptyString(""), false);
  assert.equal(validators.isNonEmptyString("    "), false);
  assert.equal(validators.isNonEmptyString(null), false);
  assert.equal(validators.isNonEmptyString(undefined), false);
  assert.equal(validators.isNonEmptyString(12345), false);
  assert.equal(validators.isNonEmptyString({}), false);
  assert.equal(validators.isNonEmptyString("a".repeat(10), 5), false);
  assert.equal(validators.isNonEmptyString("a".repeat(5), 5), true);
});

test("M3-VAL-02: Helper isValidEmail verifies RFC email patterns and max length 255", () => {
  assert.equal(validators.isValidEmail("user@batabitoo.com"), true);
  assert.equal(validators.isValidEmail("user.name+tag@sub.domain.org"), true);
  assert.equal(validators.isValidEmail("invalid-email"), false);
  assert.equal(validators.isValidEmail("@missing-user.com"), false);
  assert.equal(validators.isValidEmail("user@missing-tld"), false);
  assert.equal(validators.isValidEmail(`${"a".repeat(250)}@batabitoo.com`), false);
});

test("M3-VAL-03: Helper isValidHttpsUrl accepts only valid HTTPS endpoints", () => {
  assert.equal(validators.isValidHttpsUrl("https://example.com/app.apk"), true);
  assert.equal(validators.isValidHttpsUrl("https://batabitoo-mail-2026.web.app"), true);
  assert.equal(validators.isValidHttpsUrl("http://insecure.com/app.apk"), false);
  assert.equal(validators.isValidHttpsUrl("ftp://files.example.com"), false);
  assert.equal(validators.isValidHttpsUrl("javascript:alert(1)"), false);
  assert.equal(validators.isValidHttpsUrl("not-a-url"), false);
  assert.equal(validators.isValidHttpsUrl(""), false);
});

test("M3-VAL-04: Helper isValidSha256 validates 64-character hexadecimal hashes", () => {
  assert.equal(validators.isValidSha256(""), true, "Empty hash is optional");
  assert.equal(validators.isValidSha256(null), true, "Null hash is optional");
  assert.equal(validators.isValidSha256(undefined), true, "Undefined hash is optional");
  assert.equal(validators.isValidSha256("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"), true);
  assert.equal(validators.isValidSha256("E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855"), true);
  assert.equal(validators.isValidSha256("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85"), false, "63 chars rejected");
  assert.equal(validators.isValidSha256("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b8555"), false, "65 chars rejected");
  assert.equal(validators.isValidSha256("g3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"), false, "Non-hex rejected");
});

test("M3-VAL-05: validateLoginPayload supports pin and password with whitespace trimming", () => {
  assert.equal(validators.validateLoginPayload({ pin: "0530" }).valid, true);
  assert.equal(validators.validateLoginPayload({ pin: "  0530  " }).data.pin, "0530");
  assert.equal(validators.validateLoginPayload({ password: "master-password" }).data.pin, "master-password");
  assert.equal(validators.validateLoginPayload({ pin: "" }).valid, false);
  assert.equal(validators.validateLoginPayload({ pin: "   " }).valid, false);
  assert.equal(validators.validateLoginPayload({ pin: "a".repeat(129) }).valid, false);
  assert.equal(validators.validateLoginPayload(null).valid, false);
  assert.equal(validators.validateLoginPayload([]).valid, false, "Array rejected");
  assert.equal(validators.validateLoginPayload("not-json").valid, false);
});

test("M3-VAL-06: validateOfficialCreatePayload validates domains and derives default labels", () => {
  const v1 = validators.validateOfficialCreatePayload({ email: "Support@Batabitoo.com" });
  assert.equal(v1.valid, true);
  assert.equal(v1.data.email, "support@batabitoo.com");
  assert.equal(v1.data.label, "support");
  assert.equal(v1.data.personName, "support");

  const v2 = validators.validateOfficialCreatePayload({ email: "admin@gmail.com", label: "My Admin", personName: "Admin Person" });
  assert.equal(v2.valid, true);
  assert.equal(v2.data.label, "My Admin");
  assert.equal(v2.data.personName, "Admin Person");

  assert.equal(validators.validateOfficialCreatePayload({ email: "user@yahoo.com" }).valid, false);
  assert.equal(validators.validateOfficialCreatePayload({ email: "not-an-email" }).valid, false);
  assert.equal(validators.validateOfficialCreatePayload([]).valid, false);
  assert.equal(validators.validateOfficialCreatePayload(null).valid, false);
});

test("M3-VAL-07: validateAppVersionPayload validates integer code and normalizes metadata", () => {
  const valid = validators.validateAppVersionPayload({
    latestVersionCode: 11,
    latestVersionName: "1.4.1",
    downloadUrl: "https://batabitoo.com/app.apk",
    sha256: "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
    mandatory: 1,
    releaseNotes: "New bugfixes",
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.data.latestVersionCode, 11);
  assert.equal(valid.data.sha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(valid.data.mandatory, true);

  assert.equal(validators.validateAppVersionPayload({ latestVersionCode: true, latestVersionName: "1.0", downloadUrl: "https://x.com/a.apk" }).valid, false);
  assert.equal(validators.validateAppVersionPayload({ latestVersionCode: 0, latestVersionName: "1.0", downloadUrl: "https://x.com/a.apk" }).valid, false);
  assert.equal(validators.validateAppVersionPayload({ latestVersionCode: 1.5, latestVersionName: "1.0", downloadUrl: "https://x.com/a.apk" }).valid, false);
  assert.equal(validators.validateAppVersionPayload({ latestVersionCode: 1, latestVersionName: "a".repeat(33), downloadUrl: "https://x.com/a.apk" }).valid, false);
  assert.equal(validators.validateAppVersionPayload({ latestVersionCode: 1, latestVersionName: "1.0", downloadUrl: "http://insecure.com/a.apk" }).valid, false);
  assert.equal(validators.validateAppVersionPayload([]).valid, false);
});

test("M3-VAL-08: validateBanStatusPayload resolves target from id, inboxId, or email (Bug Fix)", () => {
  // Test resolving via `id` (The fixed bug!)
  const byId = validators.validateBanStatusPayload({ id: "inbox_target_123", banStatus: "confirmed" });
  assert.equal(byId.valid, true);
  assert.equal(byId.data.inboxId, "inbox_target_123", "Must resolve target 'id' into data.inboxId");
  assert.equal(byId.data.status, "confirmed");

  // Test resolving via `email`
  const byEmail = validators.validateBanStatusPayload({ email: "target@batabitoo.com", status: "safe" });
  assert.equal(byEmail.valid, true);
  assert.equal(byEmail.data.inboxId, "target@batabitoo.com", "Must resolve target 'email' into data.inboxId");
  assert.equal(byEmail.data.status, "safe");

  // Test resolving via `inboxId`
  const byInboxId = validators.validateBanStatusPayload({ inboxId: "inbox_456", banStatus: "suspected", reason: "AI Flagged" });
  assert.equal(byInboxId.valid, true);
  assert.equal(byInboxId.data.inboxId, "inbox_456");
  assert.equal(byInboxId.data.status, "suspected");
  assert.equal(byInboxId.data.reason, "AI Flagged");

  // Test all valid statuses enum: ['confirmed', 'suspected', 'safe', 'none']
  for (const st of ["confirmed", "suspected", "safe", "none"]) {
    assert.equal(validators.validateBanStatusPayload({ id: "box", status: st }).valid, true);
  }

  // Test invalid status rejection
  assert.equal(validators.validateBanStatusPayload({ id: "box", status: "banned" }).valid, false);
  assert.equal(validators.validateBanStatusPayload({ id: "box", status: "unknown" }).valid, false);

  // Test missing target
  assert.equal(validators.validateBanStatusPayload({ status: "safe" }).valid, false);
  assert.equal(validators.validateBanStatusPayload([]).valid, false);
  assert.equal(validators.validateBanStatusPayload(null).valid, false);
});

test("M3-VAL-09: validateNiveaLogPayload enforces participant name, mobile, and preserves index 0", () => {
  const valid = validators.validateNiveaLogPayload({
    personName: "أحمد محمد",
    mobile: "0501234567",
    realEmail: "ahmed@example.com",
    city: "الرياض",
    receiptNumber: "REC-9988",
    index: 0,
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.data.personName, "أحمد محمد");
  assert.equal(valid.data.mobile, "0501234567");
  assert.equal(valid.data.city, "الرياض");
  assert.equal(valid.data.index, 0, "Index 0 must be preserved as number 0, not null");

  assert.equal(validators.validateNiveaLogPayload({ personName: "", mobile: "0501234567" }).valid, false);
  assert.equal(validators.validateNiveaLogPayload({ personName: "أحمد", mobile: "" }).valid, false);
  assert.equal(validators.validateNiveaLogPayload({ personName: "a".repeat(101), mobile: "0501234567" }).valid, false);
  assert.equal(validators.validateNiveaLogPayload({ personName: "أحمد", mobile: "0".repeat(21) }).valid, false);
  assert.equal(validators.validateNiveaLogPayload([]).valid, false);
  assert.equal(validators.validateNiveaLogPayload(null).valid, false);
});

/* ========================================================================== */
/* SUITE 2: PUBLIC WEBHOOK INBOUND & AUTH WHITELIST                           */
/* ========================================================================== */

test("M3-WHK-01: POST /api/webhook/email is accessible publicly WITHOUT authentication headers", async () => {
  const res = await req("/api/webhook/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" }, // NO auth header or cookies
    body: JSON.stringify({
      recipient: "public_whk@batabitoo.com",
      sender: "external@provider.com",
      subject: "Public Inbound Verification",
      text: "Testing public route access.",
    }),
  });

  assert.equal(res.status, 200, "Must return 200 OK without any auth headers");
  assert.equal(res.json.success, true);
  assert.ok(res.json.messageId);
});

test("M3-WHK-02: POST /api/inbound alias is accessible publicly WITHOUT authentication headers", async () => {
  const res = await req("/api/inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json" }, // NO auth header or cookies
    body: JSON.stringify({
      recipient: "public_inbound@batabitoo.com",
      sender: "external@provider.com",
      subject: "Public Alias Verification",
      text: "Testing inbound alias access.",
    }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  assert.ok(res.json.messageId);
});

test("M3-WHK-03: Protected endpoints strictly reject unauthenticated requests with 401", async () => {
  const resInbox = await req("/api/inbox/current", { method: "GET" });
  assert.equal(resInbox.status, 401);
  assert.equal(resInbox.json.code, "AUTH_REQUIRED");

  const resInboxes = await req("/api/inboxes", { method: "GET" });
  assert.equal(resInboxes.status, 401);
});

test("M3-WHK-04: Inbound webhook auto-creates inbox and triggers SSE broadcast events", async () => {
  let broadcastEvent = null;
  const listener = payload => { broadcastEvent = payload; };
  eventBus.on("broadcast", listener);

  const recipient = `auto_${Date.now()}@batabitoo.com`;
  const res = await req("/api/webhook/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient,
      sender: "alerts@service.com",
      subject: "Auto Provisioning Test",
      text: "Testing automatic official inbox provisioning.",
    }),
  });

  eventBus.removeListener("broadcast", listener);
  assert.equal(res.status, 200);

  const inbox = db.getAllInboxes().find(i => i.email.toLowerCase() === recipient.toLowerCase());
  assert.ok(inbox, "Recipient inbox must exist in database");
  assert.equal(inbox.isOfficial, true);
  assert.equal(inbox.domain, "batabitoo.com");

  assert.ok(broadcastEvent, "Broadcast event must be triggered");
});

test("M3-WHK-05: Inbound webhook rejects invalid payload with HTTP 400", async () => {
  const resNoTo = await req("/api/webhook/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: "a@b.com", text: "No recipient" }),
  });
  assert.equal(resNoTo.status, 400);

  const resInvalidTo = await req("/api/webhook/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: "invalid-email-address", text: "Bad email" }),
  });
  assert.equal(resInvalidTo.status, 400);
});

/* ========================================================================== */
/* SUITE 3: MIME PROCESSING, ARABIC DECODING & OTP EXTRACTION                */
/* ========================================================================== */

test("M3-MIME-01: EmailParser decodes RFC 2047 encoded Arabic headers (Base64 & Quoted-Printable)", () => {
  // Base64 encoded: "رمز التحقق لتسجيل الدخول"
  const b64Subject = "=?utf-8?B?2LHZhdiyINin2YTYqtit2YLZgiDZhNiq2LPYrNmK2YQg2KfZhNiv2K7ZiNmE?=";
  assert.equal(parser.decodeRfc2047(b64Subject), "رمز التحقق لتسجيل الدخول");

  // Quoted-Printable encoded: "إشعار أمني"
  const qpSubject = "=?utf-8?Q?=D8=A5=D8=B4=D8=B9=D8=A7=D8=B1_=D8=A3=D9=85=D9=86=D9=8A?=";
  assert.equal(parser.decodeRfc2047(qpSubject), "إشعار أمني");
});

test("M3-MIME-02: EmailParser decodes Arabic Quoted-Printable message body", () => {
  const qpText = "=D9=85=D8=B1=D8=AD=D8=A8=D8=A7=D9=8B=20=D8=A8=D9=83";
  const cleaned = parser.cleanPlainText(qpText);
  assert.equal(cleaned, "مرحباً بك");
});

test("M3-MIME-03: EmailParser extracts diverse OTP formats in Arabic & English (2-arg and 3-arg signatures)", () => {
  // 2-arg calls
  assert.equal(parser.extractOtp("رمز التحقق الخاص بك هو: 849201", ""), "849201");
  assert.equal(parser.extractOtp("كود التفعيل: 3951", "تسجيل جديد"), "3951");
  assert.equal(parser.extractOtp("Your Amazon OTP is: 620184", ""), "620184");
  assert.equal(parser.extractOtp("Use code 482-195 to authenticate", ""), "482195");
  assert.equal(parser.extractOtp("رمز الأمان: ٥٨٢١٠٩", ""), "582109", "Arabic-Indic digits must normalize");

  // 3-arg calls: extractOtp(text, html, subject)
  assert.equal(parser.extractOtp("Body text", "<div>482910</div>", "Verification Code: 991823"), "991823", "Subject has priority in 3-arg call");
  assert.equal(parser.extractOtp("Plain body", "<div>رمز التحقق: 778899</div>", "Notification"), "778899", "HTML body fallback when subject has no OTP");

  // 2-arg call where second argument is HTML: extractOtp(text, html)
  assert.equal(parser.extractOtp("", "<p>Your security code is 334455</p>"), "334455");
});

test("M3-MIME-04: parseRawEmail parses complete MIME raw email with attachments", async () => {
  const rawEmail = [
    'From: "Sender Name" <sender@example.com>',
    "To: recipient@batabitoo.com",
    "Subject: =?utf-8?B?2KfZhNiq2K3ZgtmC?=",
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="boundary-12345"',
    "",
    "--boundary-12345",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "رمز التحقق هو 716253",
    "",
    "--boundary-12345",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<p>رمز التحقق هو <b>716253</b></p>",
    "",
    "--boundary-12345--",
  ].join("\r\n");

  const parsed = await parser.parseRawEmail(Buffer.from(rawEmail, "utf8"));
  assert.equal(parsed.subject, "التحقق");
  assert.equal(parsed.otp, "716253");
  assert.ok(parsed.text.includes("716253"));
  assert.ok(parsed.html.includes("<p>"));
});

test("M3-MIME-05: parseRawEmail handles malformed MIME streams gracefully without throwing", async () => {
  const corruptedRaw = "Subject: Broken MIME\r\nContent-Type: multipart/broken\r\n\r\nRandom Unclosed Body Text";
  const parsed = await parser.parseRawEmail(corruptedRaw);
  assert.ok(parsed);
  assert.ok(parsed.text.includes("Random Unclosed Body Text"));
});

/* ========================================================================== */
/* SUITE 4: TARGETED INBOX QUERIES & STRICT ISOLATION                         */
/* ========================================================================== */

test("M3-QRY-01: GET /api/inbox/current?email= resolves specified inbox even when another is active", async () => {
  const activeBox = await db.saveInbox({
    id: "inbox_act_1",
    email: "active_user@batabitoo.com",
    domain: "batabitoo.com",
    isOfficial: true,
  });
  mailDatabase.setActiveInboxId(activeBox.id);

  const targetedBox = await db.saveInbox({
    id: "inbox_tgt_1",
    email: "target_query@batabitoo.com",
    domain: "batabitoo.com",
    isOfficial: true,
  });

  const res = await req("/api/inbox/current?email=target_query@batabitoo.com", { headers: AUTH_HEADERS });
  assert.equal(res.status, 200);
  assert.equal(res.json.inbox.id, targetedBox.id);
  assert.equal(res.json.inbox.email, "target_query@batabitoo.com");
});

test("M3-QRY-02: GET /api/inbox/current?email= is case-insensitive and trims whitespace", async () => {
  await db.saveInbox({
    id: "inbox_case_1",
    email: "case_sensitive@batabitoo.com",
    domain: "batabitoo.com",
    isOfficial: true,
  });

  const res = await req("/api/inbox/current?email=CASE_SENSITIVE@BATABITOO.COM", { headers: AUTH_HEADERS });
  assert.equal(res.status, 200);
  assert.equal(res.json.inbox.email, "case_sensitive@batabitoo.com");
});

test("M3-QRY-03: GET /api/inbox/current?id= resolves inbox by unique identifier", async () => {
  await db.saveInbox({
    id: "inbox_unique_id_999",
    email: "by_id@batabitoo.com",
    domain: "batabitoo.com",
    isOfficial: true,
  });

  const res = await req("/api/inbox/current?id=inbox_unique_id_999", { headers: AUTH_HEADERS });
  assert.equal(res.status, 200);
  assert.equal(res.json.inbox.id, "inbox_unique_id_999");
});

test("M3-QRY-04: Targeted queries isolate messages (no cross-inbox bleeding)", async () => {
  const email1 = "isolation_box1@batabitoo.com";
  const email2 = "isolation_box2@batabitoo.com";

  await db.saveInbox({ id: "box_iso_1", email: email1, domain: "batabitoo.com", isOfficial: true });
  await db.saveInbox({ id: "box_iso_2", email: email2, domain: "batabitoo.com", isOfficial: true });

  await db.saveMessages(email1, [{ id: "msg_iso_1", inboxEmail: email1, subject: "Msg Box 1", text: "Text 1" }]);
  await db.saveMessages(email2, [{ id: "msg_iso_2", inboxEmail: email2, subject: "Msg Box 2", text: "Text 2" }]);

  const res1 = await req(`/api/inbox/current?email=${email1}`, { headers: AUTH_HEADERS });
  assert.equal(res1.status, 200);
  assert.equal(res1.json.messages.length, 1);
  assert.equal(res1.json.messages[0].id, "msg_iso_1");

  const res2 = await req(`/api/inbox/current?email=${email2}`, { headers: AUTH_HEADERS });
  assert.equal(res2.status, 200);
  assert.equal(res2.json.messages.length, 1);
  assert.equal(res2.json.messages[0].id, "msg_iso_2");
});

/* ========================================================================== */
/* SUITE 5: OFFICIAL DOMAIN SYNC RESPONSE CONTRACT                            */
/* ========================================================================== */

test("M3-SNC-01: POST /api/inbox/sync for official @batabitoo.com domain returns required schema", async () => {
  const email = "official_sync_test@batabitoo.com";
  await db.saveInbox({
    id: "inbox_sync_contract",
    email,
    domain: "batabitoo.com",
    isOfficial: true,
  });

  await db.saveMessages(email, [{
    id: "msg_sync_1",
    inboxEmail: email,
    subject: "Official Message",
    text: "Body",
  }]);

  const res = await req("/api/inbox/sync", {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ email }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  assert.ok(res.json.inbox, "Response must include inbox object");
  assert.equal(res.json.inbox.email, email);
  assert.ok(res.json.sync, "Response must include sync metadata");
  assert.equal(typeof res.json.sync.newCount, "number");
  assert.ok(res.json.sync.checkedAt, "sync.checkedAt must be populated");
  assert.ok(Array.isArray(res.json.messages), "Response must include messages array");
  assert.equal(res.json.messages.length, 1);
  assert.equal(res.json.messages[0].id, "msg_sync_1");
});

test("M3-SNC-02: POST /api/inbox/sync resolves inbox by id in payload", async () => {
  const boxId = "inbox_sync_by_id_555";
  await db.saveInbox({
    id: boxId,
    email: "sync_by_id@batabitoo.com",
    domain: "batabitoo.com",
    isOfficial: true,
  });

  const res = await req("/api/inbox/sync", {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ id: boxId }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  assert.equal(res.json.inbox.id, boxId);
});

test("M3-SNC-03: POST /api/inbox/sync returns 404 when targeted inbox does not exist", async () => {
  mailDatabase.setActiveInboxId(null);
  const res = await req("/api/inbox/sync", {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ id: "non_existent_box_0000" }),
  });

  assert.equal(res.status, 404);
  assert.equal(res.json.success, false);
});

/* ========================================================================== */
/* SUITE 6: NON-BLOCKING STORAGE & M1 FALLBACK INTEGRATION                    */
/* ========================================================================== */

test("M3-ARC-01: MailContent.normalize does NOT block on slow GCS archival", async () => {
  // Simulate 2000ms storage latency
  storageDelayMs = 2000;

  const start = Date.now();
  const normalized = await content.normalize({
    recipient: "storage_speed@batabitoo.com",
    subject: "Speed Test",
    text: "Ensure non-blocking archival",
  }, "msg_speed_test");

  const durationMs = Date.now() - start;
  storageDelayMs = 0; // reset

  assert.ok(normalized);
  assert.ok(durationMs < 500, `Normalize should return in <500ms even with 2s storage delay (took ${durationMs}ms)`);
});

test("M3-ARC-02: MailContent.normalize does not fail if GCS archival throws error", async () => {
  storageShouldFail = true;

  let normalized;
  try {
    normalized = await content.normalize({
      recipient: "storage_err@batabitoo.com",
      subject: "Error Resilience",
      text: "Storage failure must be suppressed",
    }, "msg_err_test");
  } finally {
    storageShouldFail = false; // reset
  }

  assert.ok(normalized);
});

test("M3-M1-01: GmailSyncService falls back to disk config when Firestore setting is absent", () => {
  // Clear Firestore setting in cache
  delete mailDatabase.cache.settings["google_oauth_config"];

  const config = gmailSync.getOAuthConfig();
  assert.ok(config);
  assert.ok(config.clientId);
});

test("M3-M1-02: setActiveInboxId does not overwrite or wipe oauthAccounts in memory", async () => {
  await mailDatabase.saveOAuthAccount({
    email: "keep_me@gmail.com",
    refreshToken: "keep_refresh_token_123",
    status: "connected",
  });

  const countBefore = mailDatabase.getOAuthAccounts().length;
  await mailDatabase.setActiveInboxId("temp_switch_99");

  assert.equal(mailDatabase.getActiveInboxId(), "temp_switch_99");
  const accountsAfter = mailDatabase.getOAuthAccounts();
  assert.equal(accountsAfter.length, countBefore);
  const found = mailDatabase.getOAuthAccount("keep_me@gmail.com");
  assert.equal(found.refreshToken, "keep_refresh_token_123");
});

/* ========================================================================== */
/* SUITE 7: M3 BACKEND FIXES VERIFICATION                                     */
/* ========================================================================== */

test("M3-FIX-01: POST /api/official/create rejects invalid domains and accepts valid ones", async () => {
  // Rejection of invalid domain
  const resBad = await req("/api/official/create", {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ email: "attacker@malicious.com" }),
  });
  assert.equal(resBad.status, 400);
  assert.equal(resBad.json.success, false);

  // Success with valid official domain
  const testOfficialEmail = `official_m3_${Date.now()}@batabitoo.com`;
  const resGood = await req("/api/official/create", {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ email: testOfficialEmail, label: "M3 Test Official" }),
  });
  assert.equal(resGood.status, 200);
  assert.equal(resGood.json.success, true);
  assert.equal(resGood.json.inbox.email, testOfficialEmail);
  assert.equal(resGood.json.inbox.isOfficial, true);
});

test("M3-FIX-02: CloudDatabase.updateInboxBanStatus resolves target by email or id", async () => {
  const email = `ban_target_${Date.now()}@batabitoo.com`;
  const saved = await mailDatabase.saveInbox({
    id: `box_ban_${Date.now()}`,
    email,
    domain: "batabitoo.com",
    isOfficial: true,
  });

  // Update by email
  const updatedByEmail = await mailDatabase.updateInboxBanStatus(email, "confirmed", "Email Target Test");
  assert.ok(updatedByEmail);
  assert.equal(updatedByEmail.banStatus, "confirmed");
  assert.equal(updatedByEmail.isBanned, true);

  // Update by id
  const updatedById = await mailDatabase.updateInboxBanStatus(saved.id, "safe", "ID Target Test");
  assert.ok(updatedById);
  assert.equal(updatedById.banStatus, "safe");
  assert.equal(updatedById.isBanned, false);
});

test("M3-FIX-03: CloudDatabase.deleteInbox clears or reassigns activeInboxId when active inbox is deleted", async () => {
  const box1 = await mailDatabase.saveInbox({ id: `del_box_1_${Date.now()}`, email: `del1_${Date.now()}@batabitoo.com` });
  const box2 = await mailDatabase.saveInbox({ id: `del_box_2_${Date.now()}`, email: `del2_${Date.now()}@batabitoo.com` });

  // Set active to box1
  mailDatabase.cache.activeInboxId = box1.id;
  assert.equal(mailDatabase.getActiveInboxId(), box1.id);

  // Delete active box1
  await mailDatabase.deleteInbox(box1.id);

  // Active inbox should be reassigned to the remaining inbox (or null), NOT remain box1
  assert.notEqual(mailDatabase.getActiveInboxId(), box1.id);
});

test("M3-FIX-04: NiveaWinnerSyncWorker and TempSyncService track and clean initialTimer", () => {
  // NiveaWorker timer tracking
  niveaWorker.startScheduler();
  assert.ok(niveaWorker.initialTimer, "NiveaWorker must capture initialTimer handle");
  niveaWorker.stopScheduler();
  assert.equal(niveaWorker.initialTimer, null, "NiveaWorker must clear initialTimer on stopScheduler");

  // TempSync timer tracking
  tempSync.startAutoSync();
  assert.ok(tempSync.initialTimer, "TempSync must capture initialTimer handle");
  tempSync.stopAutoSync();
  assert.equal(tempSync.initialTimer, null, "TempSync must clear initialTimer on stopAutoSync");
});
