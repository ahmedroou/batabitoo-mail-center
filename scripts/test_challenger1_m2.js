"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");

// 1. Stub firebase-admin storage to avoid external GCS latency
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
const gmailSync = require("../GmailSyncService");

// Fast in-memory bypass for CloudDatabase transactions during test execution (same as e2e_suite)
mailDatabase._targetedUpsert = async (entity, items) => {
  const key = entity === "inbox" ? "inboxes" : "messages";
  const existingMap = new Map(mailDatabase.cache[key].map(item => [item.id, item]));
  for (const item of items) existingMap.set(item.id, item);
  mailDatabase.cache[key] = Array.from(existingMap.values());
  return items;
};
mailDatabase._persistBootstrap = async () => true;
mailDatabase._enqueue = async (task) => {
  if (typeof task === "function") return task();
  return true;
};
if (gmailSync.oauthSyncTimer) {
  clearInterval(gmailSync.oauthSyncTimer);
  gmailSync.oauthSyncTimer = null;
}

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
  console.log("=================================================");
  console.log("🔥 CHALLENGER 1: EMPIRICAL ADVERSARIAL TEST SUITE");
  console.log("=================================================");

  await db.ready();

  await new Promise(resolve => {
    server = http.createServer(handleRequest).listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  console.log(`Server listening at ${baseUrl}`);

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    details: []
  };

  function check(name, condition, errorMsg = "") {
    results.total++;
    if (condition) {
      results.passed++;
      console.log(`  ✅ [PASS] ${name}`);
      results.details.push({ name, status: "PASS" });
    } else {
      results.failed++;
      console.error(`  ❌ [FAIL] ${name} — ${errorMsg}`);
      results.details.push({ name, status: "FAIL", error: errorMsg });
    }
  }

  // Ensure active seed inbox exists
  let activeInbox = db.getActiveInbox();
  if (!activeInbox) {
    activeInbox = await db.saveInbox({
      id: `seed_inbox_${Date.now()}`,
      email: `active_seed_${Date.now()}@batabitoo.com`,
      domain: "batabitoo.com",
      host: "batabitoo.com (Official Trusted)",
      isOfficial: true,
      type: "official",
      label: "Active Seed Inbox",
      createdAt: new Date().toISOString(),
      messageCount: 0
    });
    db.setActiveInbox(activeInbox.id);
  }
  console.log(`Initial Active Inbox: ${activeInbox.id} (${activeInbox.email})`);

  // ============================================================
  // SECTION 1: Webhook Delivery Without Auth & Resiliency
  // ============================================================
  console.log("\n--- SECTION 1: Webhook Delivery Without Auth & Resiliency ---");

  // 1.1 Valid payload to /api/webhook/email without any auth headers or cookies
  const validEmail1 = `valid_wh_${Date.now()}@batabitoo.com`;
  const res1 = await req("/api/webhook/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: validEmail1,
      sender: "service@external.com",
      subject: "Valid Webhook Test",
      text: "Your security verification OTP is 123456"
    })
  });
  check(
    "1.1 /api/webhook/email accepts valid payload without auth (200 OK)",
    res1.status === 200 && res1.json?.success === true && res1.json?.otp === "123456",
    `Status: ${res1.status}, body: ${JSON.stringify(res1.json || res1.text)}`
  );

  // 1.2 Valid payload to /api/inbound without auth
  const validEmail2 = `valid_inb_${Date.now()}@batabitoo.com`;
  const res2 = await req("/api/inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: validEmail2,
      sender: "sender@external.com",
      subject: "Inbound Valid Test",
      text: "Testing inbound route"
    })
  });
  check(
    "1.2 /api/inbound accepts valid payload without auth (200 OK)",
    res2.status === 200 && res2.json?.success === true,
    `Status: ${res2.status}, body: ${JSON.stringify(res2.json || res2.text)}`
  );

  // 1.3 Malformed JSON to /api/webhook/email
  const res3 = await req("/api/webhook/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ malformed json: not valid at all... "
  });
  check(
    "1.3 Malformed JSON to /api/webhook/email returns 400 Bad Request without server crash",
    res3.status === 400,
    `Status: ${res3.status}, body: ${JSON.stringify(res3.json || res3.text)}`
  );

  // 1.4 Malformed JSON to /api/inbound
  const res4 = await req("/api/inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "}{invalid:true"
  });
  check(
    "1.4 Malformed JSON to /api/inbound returns 400 Bad Request without server crash",
    res4.status === 400,
    `Status: ${res4.status}, body: ${JSON.stringify(res4.json || res4.text)}`
  );

  // 1.5 Missing fields: No recipient, no sender, no subject ({})
  const res5 = await req("/api/webhook/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  check(
    "1.5 Completely empty payload {} returns 400 (Missing or invalid recipient)",
    res5.status === 400 && res5.json?.error?.includes("recipient"),
    `Status: ${res5.status}, body: ${JSON.stringify(res5.json || res5.text)}`
  );

  // 1.6 Missing fields: Recipient present, but no sender and no subject
  const missingSenderSubjectEmail = `partial_${Date.now()}@batabitoo.com`;
  const res6 = await req("/api/webhook/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: missingSenderSubjectEmail
    })
  });
  check(
    "1.6 Missing sender & subject succeeds gracefully without crash (defaults applied)",
    res6.status === 200 && res6.json?.success === true && res6.json?.subject === "(بدون عنوان)",
    `Status: ${res6.status}, body: ${JSON.stringify(res6.json || res6.text)}`
  );

  // 1.7 Missing recipient field (only sender and subject)
  const res7 = await req("/api/webhook/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: "boss@batabitoo.com",
      subject: "Hello there"
    })
  });
  check(
    "1.7 Missing recipient returns 400 Bad Request",
    res7.status === 400 && res7.json?.error?.includes("recipient"),
    `Status: ${res7.status}, body: ${JSON.stringify(res7.json || res7.text)}`
  );

  // 1.8 Server survives and is still responsive
  const healthRes = await req("/api/health");
  check(
    "1.8 Server remains healthy and alive after all malformed/missing deliveries",
    healthRes.status === 200 && healthRes.json?.status === "healthy",
    `Health status: ${healthRes.status}`
  );

  // ============================================================
  // SECTION 2: Targeted Query Parameters in GET /api/inbox/current
  // ============================================================
  console.log("\n--- SECTION 2: Targeted Query Parameters in GET /api/inbox/current ---");

  // Create a known official inbox for targeted queries
  const targetEmail = `official_${Date.now()}@batabitoo.com`;
  const targetInbox = await db.saveInbox({
    id: `inbox_target_${Date.now()}`,
    email: targetEmail,
    domain: "batabitoo.com",
    host: "batabitoo.com (Official Trusted)",
    isOfficial: true,
    type: "official",
    label: "Target Official Inbox",
    createdAt: new Date().toISOString(),
    messageCount: 0
  });

  // Also ingest a message into this targeted inbox
  await req("/api/webhook/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: targetEmail,
      sender: "service@targeted.com",
      subject: "Targeted Inbox Query Message",
      text: "Your secret verification code is 998877"
    })
  });

  // 2.1 Query with ?email=official@batabitoo.com (authenticated)
  const qEmailRes = await req(`/api/inbox/current?email=${encodeURIComponent(targetEmail)}`, {
    headers: AUTH_HEADERS
  });
  check(
    "2.1 GET /api/inbox/current?email= returns exact requested inbox and its messages",
    qEmailRes.status === 200 &&
    qEmailRes.json?.success === true &&
    qEmailRes.json?.inbox?.email === targetEmail &&
    qEmailRes.json?.messages?.some(m => m.subject === "Targeted Inbox Query Message"),
    `Status: ${qEmailRes.status}, inbox: ${qEmailRes.json?.inbox?.email}`
  );

  // 2.2 Query with non-existent email
  const nonExistentEmail = `doesnotexist_${Date.now()}@batabitoo.com`;
  const qNonExistentRes = await req(`/api/inbox/current?email=${encodeURIComponent(nonExistentEmail)}`, {
    headers: AUTH_HEADERS
  });
  console.log(`   [OBSERVATION 2.2] Non-existent email query status: ${qNonExistentRes.status}, inbox returned: ${qNonExistentRes.json?.inbox?.email || null}`);
  const fellBackToActive = qNonExistentRes.status === 200 && qNonExistentRes.json?.inbox?.email !== nonExistentEmail;
  check(
    "2.2 GET /api/inbox/current?email=nonexistent handled without crash (fallback/404)",
    qNonExistentRes.status === 404 || fellBackToActive,
    `Status: ${qNonExistentRes.status}, body: ${JSON.stringify(qNonExistentRes.json)}`
  );

  // 2.3 Query with ?id= (valid target ID)
  const qIdRes = await req(`/api/inbox/current?id=${encodeURIComponent(targetInbox.id)}`, {
    headers: AUTH_HEADERS
  });
  check(
    "2.3 GET /api/inbox/current?id= returns exact requested inbox by id",
    qIdRes.status === 200 &&
    qIdRes.json?.success === true &&
    qIdRes.json?.inbox?.id === targetInbox.id &&
    qIdRes.json?.inbox?.email === targetEmail,
    `Status: ${qIdRes.status}, inbox.id: ${qIdRes.json?.inbox?.id}`
  );

  // 2.4 Query with non-existent id
  const nonExistentId = `nonexistent_id_${Date.now()}`;
  const qNonExistentIdRes = await req(`/api/inbox/current?id=${encodeURIComponent(nonExistentId)}`, {
    headers: AUTH_HEADERS
  });
  console.log(`   [OBSERVATION 2.4] Non-existent ID query status: ${qNonExistentIdRes.status}, inbox returned: ${qNonExistentIdRes.json?.inbox?.id || null}`);
  check(
    "2.4 GET /api/inbox/current?id=nonexistent handled gracefully without crash",
    qNonExistentIdRes.status === 404 || qNonExistentIdRes.status === 200,
    `Status: ${qNonExistentIdRes.status}, body: ${JSON.stringify(qNonExistentIdRes.json)}`
  );

  // 2.5 Query with BOTH ?email= and ?id= (matching)
  const qBothRes = await req(`/api/inbox/current?email=${encodeURIComponent(targetEmail)}&id=${encodeURIComponent(targetInbox.id)}`, {
    headers: AUTH_HEADERS
  });
  check(
    "2.5 GET /api/inbox/current with both ?email= and ?id= returns matched inbox",
    qBothRes.status === 200 &&
    qBothRes.json?.success === true &&
    qBothRes.json?.inbox?.id === targetInbox.id &&
    qBothRes.json?.inbox?.email === targetEmail,
    `Status: ${qBothRes.status}, inbox: ${qBothRes.json?.inbox?.email}`
  );

  // 2.6 Query with NEITHER ?email nor ?id
  const qNeitherRes = await req("/api/inbox/current", {
    headers: AUTH_HEADERS
  });
  check(
    "2.6 GET /api/inbox/current with neither returns active inbox",
    qNeitherRes.status === 200 &&
    qNeitherRes.json?.success === true &&
    Boolean(qNeitherRes.json?.inbox?.id),
    `Status: ${qNeitherRes.status}, active inbox id: ${qNeitherRes.json?.inbox?.id}`
  );

  // 2.7 Query with ?id= (empty id parameter)
  const qEmptyIdRes = await req("/api/inbox/current?id=", {
    headers: AUTH_HEADERS
  });
  check(
    "2.7 GET /api/inbox/current?id= (empty parameter) falls back gracefully without crash",
    qEmptyIdRes.status === 200 && Boolean(qEmptyIdRes.json?.inbox),
    `Status: ${qEmptyIdRes.status}`
  );

  // 2.8 Unauthenticated GET /api/inbox/current is properly blocked (401)
  const qUnauthRes = await req("/api/inbox/current");
  check(
    "2.8 Unauthenticated GET /api/inbox/current blocked by auth guard (401 AUTH_REQUIRED)",
    qUnauthRes.status === 401 && qUnauthRes.json?.code === "AUTH_REQUIRED",
    `Status: ${qUnauthRes.status}, body: ${JSON.stringify(qUnauthRes.json)}`
  );

  // ============================================================
  // SECTION 3: Additional Adversarial & Stress Scenarios
  // ============================================================
  console.log("\n--- SECTION 3: Additional Adversarial & Stress Scenarios ---");

  // 3.1 Case insensitivity test on ?email= query
  const upperEmail = targetEmail.toUpperCase();
  const qCaseRes = await req(`/api/inbox/current?email=${encodeURIComponent(upperEmail)}`, {
    headers: AUTH_HEADERS
  });
  check(
    "3.1 GET /api/inbox/current?email= handles uppercase/mixed-case email query correctly",
    qCaseRes.status === 200 && qCaseRes.json?.inbox?.email.toLowerCase() === targetEmail.toLowerCase(),
    `Status: ${qCaseRes.status}, matched: ${qCaseRes.json?.inbox?.email}`
  );

  // 3.2 HTML and Arabic content decoding in inbound webhook
  const arabicEmail = `arabic_${Date.now()}@batabitoo.com`;
  const arabicSubject = "رمز التحقق لتسجيل الدخول في مركز بريد بطابيطو";
  const arabicHtml = "<div dir='rtl'><h1>مرحباً بك في بطابيطو</h1><p>رمز التأكيد الخاص بك هو <b>839201</b></p></div>";
  const resArabic = await req("/api/webhook/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: arabicEmail,
      sender: "auth@service.com",
      subject: arabicSubject,
      html: arabicHtml
    })
  });
  check(
    "3.2 Inbound webhook correctly ingests Arabic subject, HTML, and extracts OTP 839201",
    resArabic.status === 200 && resArabic.json?.otp === "839201" && resArabic.json?.subject === arabicSubject,
    `Status: ${resArabic.status}, otp: ${resArabic.json?.otp}, subject: ${resArabic.json?.subject}`
  );

  // 3.3 Verify Arabic message is queryable via GET /api/inbox/current
  const qArabicRes = await req(`/api/inbox/current?email=${encodeURIComponent(arabicEmail)}`, {
    headers: AUTH_HEADERS
  });
  const arabicMsg = qArabicRes.json?.messages?.find(m => m.otp === "839201");
  check(
    "3.3 Ingested Arabic message is queryable via GET /api/inbox/current?email=",
    qArabicRes.status === 200 && Boolean(arabicMsg) && arabicMsg?.subject === arabicSubject,
    `Status: ${qArabicRes.status}, found: ${Boolean(arabicMsg)}`
  );

  // 3.4 Inbound webhook with email formatted with display name: "Ahmed <ahmed@batabitoo.com>"
  const displayEmail = `display_${Date.now()}@batabitoo.com`;
  const resDisplay = await req("/api/webhook/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: `Batabitoo Official <${displayEmail}>`,
      sender: "Test Sender <sender@service.com>",
      subject: "Display name test",
      text: "Testing address parsing"
    })
  });
  check(
    "3.4 Inbound webhook cleanly handles recipient with display name <email@...>",
    resDisplay.status === 200 && resDisplay.json?.success === true,
    `Status: ${resDisplay.status}`
  );

  // 3.5 Query by that extracted email
  const qDisplayRes = await req(`/api/inbox/current?email=${encodeURIComponent(displayEmail)}`, {
    headers: AUTH_HEADERS
  });
  check(
    "3.5 Inbox created with clean extracted email without angle brackets",
    qDisplayRes.status === 200 && qDisplayRes.json?.inbox?.email === displayEmail,
    `Inbox email: ${qDisplayRes.json?.inbox?.email}`
  );

  // 3.6 POST /api/inbox/sync for official inbox with real message
  const syncRes = await req("/api/inbox/sync", {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ email: targetEmail })
  });
  check(
    "3.6 POST /api/inbox/sync returns real messages array and sync metadata for official inbox",
    syncRes.status === 200 &&
    syncRes.json?.success === true &&
    Array.isArray(syncRes.json?.messages) &&
    syncRes.json?.messages.length > 0 &&
    syncRes.json?.sync?.newCount === 0 &&
    Boolean(syncRes.json?.sync?.checkedAt),
    `Status: ${syncRes.status}, messages count: ${syncRes.json?.messages?.length}`
  );

  // 3.7 POST /api/inbox/sync unauthenticated is blocked (401)
  const syncUnauthRes = await req("/api/inbox/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: targetEmail })
  });
  check(
    "3.7 Unauthenticated POST /api/inbox/sync blocked (401 AUTH_REQUIRED)",
    syncUnauthRes.status === 401 && syncUnauthRes.json?.code === "AUTH_REQUIRED",
    `Status: ${syncUnauthRes.status}`
  );

  // 3.8 Rapid concurrent ingestion test (10 rapid requests to webhook)
  const concurrentPromises = [];
  const concurrentCount = 10;
  for (let i = 0; i < concurrentCount; i++) {
    concurrentPromises.push(
      req("/api/webhook/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: targetEmail,
          sender: `burst_${i}@burst.com`,
          subject: `Burst Message ${i}`,
          text: `Burst text content ${i}`
        })
      })
    );
  }
  const burstResults = await Promise.all(concurrentPromises);
  const allSucceeded = burstResults.every(r => r.status === 200 && r.json?.success === true);
  check(
    "3.8 Concurrent burst ingestion (10 parallel webhooks) all return 200 OK without dropping",
    allSucceeded,
    `Statuses: ${burstResults.map(r => r.status).join(",")}`
  );

  // 3.9 Raw MIME RFC822 email payload delivered to /api/webhook/email
  const rawMimeEmail = `rawmime_${Date.now()}@batabitoo.com`;
  const rawMimeBody = [
    `From: raw@sender.com`,
    `To: ${rawMimeEmail}`,
    `Subject: Raw MIME Delivery Test`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    `Your raw verification OTP is 445566`
  ].join("\r\n");

  const resRaw = await req("/api/webhook/email", {
    method: "POST",
    headers: { "Content-Type": "message/rfc822" },
    body: rawMimeBody
  });
  check(
    "3.9 Raw MIME RFC822 delivery to /api/webhook/email without auth is accepted and decoded",
    resRaw.status === 200 && resRaw.json?.success === true && resRaw.json?.otp === "445566",
    `Status: ${resRaw.status}, body: ${JSON.stringify(resRaw.json || resRaw.text)}`
  );

  // Summary
  console.log("\n=================================================");
  console.log(`TOTAL CHECKS: ${results.total}`);
  console.log(`PASSED:       ${results.passed}`);
  console.log(`FAILED:       ${results.failed}`);
  console.log("=================================================");

  if (server) server.close();

  if (results.failed > 0) {
    console.error("❌ Some checks failed!");
    process.exit(1);
  } else {
    console.log("🎉 ALL ADVERSARIAL CHECKS PASSED!");
    process.exit(0);
  }
}

run().catch(err => {
  console.error("FATAL ERROR in test harness:", err);
  if (server) server.close();
  process.exit(1);
});
