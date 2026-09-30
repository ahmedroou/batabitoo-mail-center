"use strict";

const fs = require("fs");
const path = require("path");
const { mailDatabase } = require("../CloudDatabase");

async function main() {
  console.log("🔄 Initializing CloudDatabase for sanitization...");
  await mailDatabase.ready();

  // 1. Seed google_oauth_config into Firestore
  const configPath = path.join(__dirname, "..", "google_oauth_config.json");
  if (fs.existsSync(configPath)) {
    const configRaw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(configRaw);
    console.log("📝 Seeding google_oauth_config into Firestore settings...");
    await mailDatabase.setSetting("google_oauth_config", JSON.stringify(config));
    console.log("✅ google_oauth_config seeded successfully.");
  }

  // 2. Sanitize shatharoou55@gmail.com (clean dummy credentials)
  const cleanShatharoou = {
    email: "shatharoou55@gmail.com",
    authType: "oauth2",
    auth_type: "oauth2",
    personName: "shatharoou55",
    person_name: "shatharoou55",
    refreshToken: null,
    refresh_token: null,
    accessToken: null,
    access_token: null,
    expiryDate: null,
    expiry_date: null,
    status: "auth_expired",
    lastError: "حساب بحاجة إلى إعادة ربط عبر Google",
    last_error: "حساب بحاجة إلى إعادة ربط عبر Google",
    lastSyncAt: "2026-09-19T11:40:23.941Z",
    last_sync_at: "2026-09-19T11:40:23.941Z",
    connectedAt: "2026-09-19T11:40:23.941Z",
    connected_at: "2026-09-19T11:40:23.941Z",
    syncedCount: 0,
    synced_count: 0,
  };
  console.log("🧹 Sanitizing legacy record for shatharoou55@gmail.com...");
  await mailDatabase.saveOAuthAccount(cleanShatharoou);

  // 3. Ensure ahmedbatabitooroou@gmail.com exists in oauthAccounts
  const ahmedAccount = {
    email: "ahmedbatabitooroou@gmail.com",
    authType: "oauth2",
    auth_type: "oauth2",
    personName: "ahmedbatabitooroou",
    person_name: "ahmedbatabitooroou",
    refreshToken: null,
    refresh_token: null,
    accessToken: null,
    access_token: null,
    expiryDate: null,
    expiry_date: null,
    status: "connected",
    lastError: null,
    last_error: null,
    lastSyncAt: new Date().toISOString(),
    last_sync_at: new Date().toISOString(),
    connectedAt: "2026-09-20T04:44:15.993Z",
    connected_at: "2026-09-20T04:44:15.993Z",
    syncedCount: 0,
    synced_count: 0,
  };
  console.log("💾 Persisting ahmedbatabitooroou@gmail.com into Firestore oauthAccounts...");
  await mailDatabase.saveOAuthAccount(ahmedAccount);

  // 4. Verify Firestore state
  const accounts = mailDatabase.getOAuthAccounts();
  console.log("📋 Current OAuth accounts in database:", accounts);

  console.log("🎉 Sanitization complete!");
  process.exit(0);
}

main().catch(err => {
  console.error("❌ Sanitization error:", err);
  process.exit(1);
});
