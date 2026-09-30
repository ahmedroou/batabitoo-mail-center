"use strict";

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const MASTER_PIN = defineSecret("MASTER_PIN");
const SESSION_SECRET = defineSecret("SESSION_SECRET");
const INBOUND_EMAIL_SECRET = defineSecret("INBOUND_EMAIL_SECRET");

const runtimeOptions = {
  region: "europe-west1",
  memory: "1GiB",
  timeoutSeconds: 120,
  minInstances: 0,
  maxInstances: 3,
  secrets: [MASTER_PIN, SESSION_SECRET, INBOUND_EMAIL_SECRET],
};

let serverInstance = null;
async function getServer() {
  if (!serverInstance) {
    const s = require("./inbox_server");
    await s.ready;
    serverInstance = s;
  }
  return serverInstance;
}

exports.api = onRequest(runtimeOptions, async (request, response) => {
  const s = await getServer();
  return s.handleRequest(request, response);
});

exports.syncGmail = onSchedule({
  region: "europe-west1",
  schedule: "every 1 minutes",
  timeZone: "Asia/Riyadh",
  memory: "1GiB",
  timeoutSeconds: 540,
  retryCount: 1,
  maxInstances: 1,
  concurrency: 1,
  secrets: [MASTER_PIN, SESSION_SECRET],
}, async () => {
  await getServer();
  const gmailSync = require("./GmailSyncService");
  await require("./CloudDatabase").mailDatabase.refreshIfChanged({ force: true });
  // A revoked Google grant cannot heal through per-minute retries. Relinking
  // persists "connected" and immediately re-enables scheduled synchronization.
  const accounts = gmailSync.getAccounts().filter(account => account.status !== 'auth_expired');
  for (const account of accounts) {
    await gmailSync.syncAccount(account.email).catch(error => {
      console.error(`Scheduled Gmail sync failed for ${account.email}:`, error.message);
    });
  }
});
