"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { mailDatabase } = require("../CloudDatabase");
const gmailSync = require("../GmailSyncService");

async function run() {
  console.log("🔍 [1/6] Initializing CloudDatabase & GmailSyncService...");
  await mailDatabase.ready();
  await gmailSync.readyPromise;

  console.log("🔍 [2/6] Verifying OAuth Config Fallback & Seeding...");
  const config = gmailSync.getOAuthConfig();
  assert.ok(config.clientId, "clientId must be present");
  assert.ok(config.clientSecret, "clientSecret must not be empty");
  assert.equal(config.clientSecret, "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");
  assert.ok(config.redirectUri, "redirectUri must be present");
  console.log("   ✅ OAuth config properly loaded and clientSecret is non-empty.");

  const dbSetting = mailDatabase.getSetting("google_oauth_config");
  assert.ok(dbSetting, "google_oauth_config should be seeded in mailDatabase settings");
  console.log("   ✅ google_oauth_config successfully seeded into Firestore.");

  console.log("🔍 [3/6] Verifying Sanitized Firestore Accounts...");
  const accounts = mailDatabase.getOAuthAccounts();
  const ahmedAcc = accounts.find(a => a.email === "ahmedbatabitooroou@gmail.com");
  const shathaAcc = accounts.find(a => a.email === "shatharoou55@gmail.com");

  assert.ok(ahmedAcc, "ahmedbatabitooroou@gmail.com must be present in oauthAccounts");
  assert.equal(ahmedAcc.status, "connected");

  assert.ok(shathaAcc, "shatharoou55@gmail.com must be present in oauthAccounts");
  assert.equal(shathaAcc.accessToken, null, "shatharoou55 dummy accessToken must be cleared");
  assert.equal(shathaAcc.status, "auth_expired");
  console.log("   ✅ Sanitized records verified: ahmedbatabitooroou present and shatharoou dummy cleared.");

  console.log("🔍 [4/6] Verifying Account Resolution in GmailSyncService...");
  const resolvedAhmed = gmailSync.findAccount("ahmedbatabitooroou@gmail.com");
  assert.ok(resolvedAhmed, "findAccount must resolve ahmedbatabitooroou@gmail.com");
  assert.equal(resolvedAhmed.email, "ahmedbatabitooroou@gmail.com");

  const resolvedAlias = gmailSync.findAccount("s.hatharoou.55@gmail.com");
  assert.ok(resolvedAlias, "findAccount must resolve dotted alias to parent");
  assert.equal(resolvedAlias.email, "shatharoou55@gmail.com");
  console.log("   ✅ Account resolution verified for both real account and dotted alias.");

  console.log("🔍 [5/6] Verifying Isolation of setActiveInboxId & _persistBootstrap...");
  const testId1 = "inbox_test_" + Date.now();
  await mailDatabase.setActiveInboxId(testId1);
  assert.equal(mailDatabase.getActiveInboxId(), testId1);

  // Directly check Firestore remote document
  const snap1 = await mailDatabase.firestore.collection("mailRuntime").doc("bootstrap").get();
  const remoteAccounts1 = snap1.data()?.oauthAccounts || [];
  assert.ok(remoteAccounts1.some(a => a.email === "ahmedbatabitooroou@gmail.com"), "remote bootstrap must retain ahmedbatabitooroou after setActiveInboxId");
  assert.ok(remoteAccounts1.some(a => a.email === "shatharoou55@gmail.com"), "remote bootstrap must retain shatharoou after setActiveInboxId");
  assert.equal(snap1.data()?.activeInboxId, testId1);

  // Switch to another inbox
  const testId2 = "gmail_ahmedbatabitooroou_gmail_com";
  await mailDatabase.setActiveInboxId(testId2);
  const snap2 = await mailDatabase.firestore.collection("mailRuntime").doc("bootstrap").get();
  const remoteAccounts2 = snap2.data()?.oauthAccounts || [];
  assert.ok(remoteAccounts2.some(a => a.email === "ahmedbatabitooroou@gmail.com"), "remote bootstrap must still retain ahmedbatabitooroou");
  assert.equal(snap2.data()?.activeInboxId, testId2);
  console.log("   ✅ setActiveInboxId successfully verified: never clobbers oauthAccounts in Firestore.");

  console.log("🔍 [6/6] Verifying Frontend app.js Changes...");
  const appJs = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.ok(appJs.includes("await loadCurrent(true);"), "selectInbox must call loadCurrent(true)");
  assert.ok(!appJs.includes("await loadCurrent(false);"), "selectInbox must not call loadCurrent(false)");
  console.log("   ✅ public/app.js verified: calls loadCurrent(true) on selectInbox.");

  console.log("\n=============================================");
  console.log("🎉 ALL WORKER M1 VERIFICATIONS PASSED 100%!");
  console.log("=============================================\n");
  process.exit(0);
}

run().catch(err => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
