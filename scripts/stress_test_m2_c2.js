"use strict";

/**
 * Challenger 2 — Empirical Concurrency & Stress Test Harness for Milestone M2
 * Verified scenarios:
 * 1. Multi-inbox rapid concurrent webhook ingestion (/api/webhook/email)
 * 2. Simultaneous message delivery across distinct official inboxes
 * 3. Atomic storage verification & zero lost updates
 * 4. Official inbox sync (/api/inbox/sync) validation across scenarios (email, id, empty inbox)
 * 5. Concurrent targeted inbox retrieval (/api/inbox/current?email=... & ?id=...) isolation
 * 6. Non-blocking latency and throughput profiling
 */

const assert = require("node:assert/strict");
const http = require("node:http");

// Stub GCS storage to avoid cloud socket latency during automated testing
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
  console.log("=================================================================");
  console.log("⚡ CHALLENGER 2: EMPIRICAL CONCURRENCY & STRESS TEST HARNESS (M2)");
  console.log("=================================================================");

  await db.ready();

  await new Promise(resolve => {
    server = http.createServer(handleRequest).listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  console.log(`✅ Test server running at ${baseUrl}\n`);

  const report = {
    tests: 0,
    passed: 0,
    failed: 0,
    failures: [],
    metrics: {}
  };

  function evaluate(testName, condition, detail = "") {
    report.tests++;
    if (condition) {
      report.passed++;
      console.log(`  ✅ [PASS] ${testName}`);
    } else {
      report.failed++;
      console.error(`  ❌ [FAIL] ${testName} — ${detail}`);
      report.failures.push({ testName, detail });
    }
  }

  // -------------------------------------------------------------
  // TEST 1: Multi-Inbox Concurrent Webhook Ingestion Across Different Inboxes
  // 3 distinct official inboxes, 4 messages each = 12 rapid concurrent requests
  // Tests simultaneous delivery across distinct accounts
  // -------------------------------------------------------------
  console.log("--- TEST 1: Multi-Inbox Concurrent Ingestion (12 concurrent requests) ---");
  const numInboxes = 3;
  const msgsPerInbox = 4;
  const testRunId = Date.now();
  
  const inboxes = [];
  for (let i = 0; i < numInboxes; i++) {
    const email = `c2_stress_${i}_${testRunId}@batabitoo.com`;
    // Pre-provision inboxes cleanly to test concurrent multi-inbox ingestion
    const savedInbox = await db.saveInbox({
      id: `official_c2_${i}_${testRunId}`,
      email,
      domain: "batabitoo.com",
      host: "batabitoo.com (Official Trusted)",
      isOfficial: true,
      type: "official",
      label: `Stress Inbox ${i}`,
      createdAt: new Date().toISOString(),
      messageCount: 0
    });
    inboxes.push({
      id: savedInbox.id,
      email,
      expectedMessages: []
    });
  }

  // Generate 12 unique messages distributed across the 3 inboxes
  const allWebhookPayloads = [];
  for (let i = 0; i < numInboxes; i++) {
    for (let j = 0; j < msgsPerInbox; j++) {
      const otp = String(200000 + (i * 10 + j)).slice(-6);
      const msg = {
        recipient: inboxes[i].email,
        sender: `partner_${j}@sender-${i}.com`,
        subject: `Stress Test [Inbox ${i} Msg ${j}] - Run ${testRunId}`,
        text: `Your security OTP code is ${otp}. Verification payload index ${j}.`,
        otp
      };
      inboxes[i].expectedMessages.push(msg);
      allWebhookPayloads.push(msg);
    }
  }

  // Shuffle payloads to interleave requests across all inboxes concurrently
  const shuffledPayloads = [...allWebhookPayloads].sort(() => Math.random() - 0.5);

  const startTime = Date.now();
  const webhookPromises = shuffledPayloads.map(payload => {
    return req("/api/webhook/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(res => ({
      payload,
      status: res.status,
      json: res.json
    }));
  });

  const webhookResults = await Promise.all(webhookPromises);
  const totalDuration = Date.now() - startTime;
  const avgLatency = (totalDuration / webhookResults.length).toFixed(2);

  report.metrics.multiInboxReqs = {
    totalRequests: webhookResults.length,
    totalDurationMs: totalDuration,
    avgLatencyPerReqMs: avgLatency,
    throughputReqsPerSec: ((webhookResults.length / totalDuration) * 1000).toFixed(1)
  };
  console.log(`   ⏱️ Executed 12 concurrent webhooks in ${totalDuration}ms (avg: ${avgLatency}ms/req, ~${report.metrics.multiInboxReqs.throughputReqsPerSec} req/s)`);

  const allOk = webhookResults.every(r => r.status === 200 && r.json?.success === true);
  evaluate(
    "1.1 All 12 concurrent webhooks returned HTTP 200 OK without errors",
    allOk,
    `Statuses: ${webhookResults.map(r => r.status).join(",")}`
  );

  const allOtpsMatched = webhookResults.every(r => r.json?.otp === r.payload.otp);
  evaluate(
    "1.2 All 12 webhook responses contained correctly extracted OTP codes",
    allOtpsMatched,
    "One or more OTPs did not match expected value"
  );

  // -------------------------------------------------------------
  // TEST 2: Atomicity & Zero Lost Updates Verification
  // Verify that EVERY single one of the 4 messages for each inbox is stored and retrievable!
  // -------------------------------------------------------------
  console.log("\n--- TEST 2: Atomicity & Zero Lost Updates across All Inboxes ---");
  for (let i = 0; i < numInboxes; i++) {
    const targetEmail = inboxes[i].email;
    const qRes = await req(`/api/inbox/current?email=${encodeURIComponent(targetEmail)}`, {
      headers: AUTH_HEADERS
    });

    const isSuccess = qRes.status === 200 && qRes.json?.success === true;
    const retrievedMessages = qRes.json?.messages || [];
    const countMatches = retrievedMessages.length === msgsPerInbox;

    const missingMessages = [];
    for (const expected of inboxes[i].expectedMessages) {
      const found = retrievedMessages.some(m => m.subject === expected.subject && m.otp === expected.otp);
      if (!found) {
        missingMessages.push(expected.subject);
      }
    }

    evaluate(
      `2.${i+1} Inbox ${i} (${targetEmail}): Retrieved all ${msgsPerInbox}/${msgsPerInbox} messages (Zero Lost Updates)`,
      isSuccess && countMatches && missingMessages.length === 0,
      `Retrieved ${retrievedMessages.length}/${msgsPerInbox}. Missing: ${missingMessages.join(", ") || "none"}`
    );
  }

  // -------------------------------------------------------------
  // TEST 3: Official Inbox Sync (POST /api/inbox/sync) Comprehensive Validation
  // -------------------------------------------------------------
  console.log("\n--- TEST 3: Official Inbox Sync Verification (POST /api/inbox/sync) ---");
  
  // 3.1 Sync by email for an official inbox with messages
  const syncInbox = inboxes[0];
  const syncEmailRes = await req("/api/inbox/sync", {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ email: syncInbox.email })
  });

  evaluate(
    "3.1 POST /api/inbox/sync by email returns 200 OK with success: true",
    syncEmailRes.status === 200 && syncEmailRes.json?.success === true,
    `Status: ${syncEmailRes.status}`
  );

  evaluate(
    "3.2 POST /api/inbox/sync returns proper sync metadata object ({ newCount: 0, checkedAt })",
    syncEmailRes.json?.sync && typeof syncEmailRes.json?.sync?.newCount === "number" && Boolean(syncEmailRes.json?.sync?.checkedAt),
    `Sync object: ${JSON.stringify(syncEmailRes.json?.sync)}`
  );

  evaluate(
    `3.3 POST /api/inbox/sync returns genuine message summaries array (${syncInbox.expectedMessages.length} messages)`,
    Array.isArray(syncEmailRes.json?.messages) && syncEmailRes.json?.messages.length === msgsPerInbox,
    `Returned ${syncEmailRes.json?.messages?.length} messages, expected ${msgsPerInbox}`
  );

  // Check message summary structure
  const firstMsg = syncEmailRes.json?.messages?.[0];
  evaluate(
    "3.4 Returned message summaries have valid structure (id, subject, from, to, date/createdAt, otp)",
    Boolean(firstMsg?.id && firstMsg?.subject && firstMsg?.from && firstMsg?.otp),
    `First message keys: ${Object.keys(firstMsg || {}).join(", ")}`
  );

  // 3.5 Sync by id
  const syncIdRes = await req("/api/inbox/sync", {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ id: syncInbox.id })
  });
  evaluate(
    "3.5 POST /api/inbox/sync by id returns 200 OK and matches inbox",
    syncIdRes.status === 200 && syncIdRes.json?.inbox?.id === syncInbox.id,
    `Status: ${syncIdRes.status}, id: ${syncIdRes.json?.inbox?.id}`
  );

  // 3.6 Sync on an official inbox with 0 messages
  const emptyOfficialEmail = `empty_c2_${testRunId}@batabitoo.com`;
  await db.saveInbox({
    id: `official_empty_c2_${testRunId}`,
    email: emptyOfficialEmail,
    domain: "batabitoo.com",
    host: "batabitoo.com (Official Trusted)",
    isOfficial: true,
    type: "official",
    label: "Empty Official C2",
    createdAt: new Date().toISOString(),
    messageCount: 0
  });

  const syncEmptyRes = await req("/api/inbox/sync", {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ email: emptyOfficialEmail })
  });
  evaluate(
    "3.6 POST /api/inbox/sync on empty official inbox returns 200 OK and empty messages array []",
    syncEmptyRes.status === 200 && Array.isArray(syncEmptyRes.json?.messages) && syncEmptyRes.json?.messages.length === 0,
    `Status: ${syncEmptyRes.status}, messages length: ${syncEmptyRes.json?.messages?.length}`
  );

  // -------------------------------------------------------------
  // TEST 4: Interleaved Concurrent Targeted Inboxes Query Isolation
  // Fire simultaneous GET requests for inbox 0 and inbox 1 in parallel
  // Verify inbox 0 never sees inbox 1's messages and vice versa
  // -------------------------------------------------------------
  console.log("\n--- TEST 4: Interleaved Concurrent Inbox Query Isolation ---");
  const interleavedReqs = [];
  for (let i = 0; i < 20; i++) {
    const target = (i % 2 === 0) ? inboxes[0] : inboxes[1];
    interleavedReqs.push(
      req(`/api/inbox/current?email=${encodeURIComponent(target.email)}`, {
        headers: AUTH_HEADERS
      }).then(r => ({ expectedEmail: target.email, res: r }))
    );
  }

  const interleavedResults = await Promise.all(interleavedReqs);
  const isolationIntact = interleavedResults.every(item => {
    const json = item.res.json;
    if (json?.inbox?.email !== item.expectedEmail) return false;
    return (json?.messages || []).every(m => !m.subject.includes(item.expectedEmail === inboxes[0].email ? "[Inbox 1" : "[Inbox 0"));
  });

  evaluate(
    "4.1 20 parallel interleaved queries strictly preserve inbox data isolation (no cross-talk/leakage)",
    isolationIntact,
    "Cross-inbox leakage or mismatch detected"
  );

  // -------------------------------------------------------------
  // TEST 5: UTF-8 Arabic and Special Characters Under Concurrency
  // -------------------------------------------------------------
  console.log("\n--- TEST 5: Internationalization & HTML Payload Concurrency ---");
  const specialEmail = `arabic_c2_${testRunId}@batabitoo.com`;
  const specialPayloads = [
    {
      recipient: specialEmail,
      sender: "أمازون السعودية <support@amazon.sa>",
      subject: "تأكيد طلب الشراء رقم #402-9847123-11234 📦",
      html: "<div dir='rtl'><h1>شكراً لتسوقك معنا</h1><p>رمز التأكيد الخاص بك هو <b>938104</b></p></div>",
      text: "شكراً لتسوقك معنا رمز التأكيد هو 938104"
    },
    {
      recipient: specialEmail,
      sender: "بطابيطو ميل سنتر <security@batabitoo.com>",
      subject: "تنبيه أمان عاجل: تم تسجيل دخول جديد ⚠️",
      html: "<p>كود التحقق الثنائي هو: <strong>554433</strong></p>",
      text: "كود التحقق الثنائي هو: 554433"
    },
    {
      recipient: specialEmail,
      sender: "خدمات المشتركين <service@domain.com>",
      subject: "فاتورة الاشتراك لشهر سبتمبر 2026 (150 ريال)",
      text: "مرحباً، رمز الدخول السريع: 112233"
    }
  ];

  const specialRes = await Promise.all(
    specialPayloads.map(p => req("/api/webhook/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p)
    }))
  );

  evaluate(
    "5.1 Concurrent Arabic/special character webhooks all succeed (200 OK)",
    specialRes.every(r => r.status === 200 && r.json?.success === true),
    `Statuses: ${specialRes.map(r => r.status).join(",")}`
  );

  const specialQuery = await req(`/api/inbox/current?email=${encodeURIComponent(specialEmail)}`, {
    headers: AUTH_HEADERS
  });

  evaluate(
    "5.2 All Arabic messages retrieved with correct Arabic subjects, senders, and OTPs",
    specialQuery.status === 200 &&
    specialQuery.json?.messages?.length === 3 &&
    specialQuery.json?.messages?.some(m => m.otp === "938104") &&
    specialQuery.json?.messages?.some(m => m.otp === "554433") &&
    specialQuery.json?.messages?.some(m => m.otp === "112233"),
    `Retrieved messages: ${specialQuery.json?.messages?.map(m => m.subject).join(" | ")}`
  );

  // -------------------------------------------------------------
  // TEST 6: Boundary Tests & Security Guard
  // -------------------------------------------------------------
  console.log("\n--- TEST 6: Boundary Tests & Security Guard ---");

  // 6.1 POST /api/inbox/sync unauthenticated returns 401
  const syncUnauth = await req("/api/inbox/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: syncInbox.email })
  });
  evaluate(
    "6.1 POST /api/inbox/sync without authentication blocked by auth guard (401)",
    syncUnauth.status === 401 && syncUnauth.json?.code === "AUTH_REQUIRED",
    `Status: ${syncUnauth.status}`
  );

  // 6.2 GET /api/inbox/current unauthenticated returns 401
  const getUnauth = await req(`/api/inbox/current?email=${encodeURIComponent(syncInbox.email)}`);
  evaluate(
    "6.2 GET /api/inbox/current without authentication blocked by auth guard (401)",
    getUnauth.status === 401 && getUnauth.json?.code === "AUTH_REQUIRED",
    `Status: ${getUnauth.status}`
  );

  // -------------------------------------------------------------
  // Summary & Verdict
  // -------------------------------------------------------------
  console.log("\n=================================================================");
  console.log(`TOTAL CHECKS: ${report.tests}`);
  console.log(`PASSED:       ${report.passed}`);
  console.log(`FAILED:       ${report.failed}`);
  console.log("=================================================================");

  if (server) server.close();

  if (report.failed > 0) {
    console.error("❌ STRESS TEST SUITE ENCOUNTERED FAILURES!");
    process.exit(1);
  } else {
    console.log("🎉 ALL CHALLENGER 2 EMPIRICAL STRESS TESTS PASSED 100%!");
    process.exit(0);
  }
}

run().catch(err => {
  console.error("FATAL ERROR in stress test:", err);
  if (server) server.close();
  process.exit(1);
});
