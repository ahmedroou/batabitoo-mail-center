#!/usr/bin/env node
"use strict";

/**
 * Safe Firestore v2 migration.
 *
 * Default: read-only dry run that merges the local export with current cloud
 * documents and prints the exact staged dataset plan.
 *
 *   node scripts/migrate_full_manifest_to_cloud.cjs
 *   node scripts/migrate_full_manifest_to_cloud.cjs --write
 *   node scripts/migrate_full_manifest_to_cloud.cjs --write --activate
 *
 * --write stages and verifies mailDatasets/v2 without deleting legacy data.
 * --activate atomically switches system/data_pointer only after verification.
 */

const fs = require("fs");
const path = require("path");
const {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const {
  TARGET_CHUNK_BYTES,
  buildChunkDocuments,
  buildDataset,
  mergeSources,
  sha256,
} = require("../lib/cloudDataModel");

const ROOT = path.join(__dirname, "..");
const LOCAL_EXPORT = path.join(ROOT, "inboxes_db.json");
const SERVICE_ACCOUNT = path.join(ROOT, "serviceAccountKey.json");
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "batabitoo-mail-2026";
const DATASET_ID = "v2";
const BATCH_LIMIT = 400;
const args = new Set(process.argv.slice(2));
const shouldWrite = args.has("--write");
const shouldActivate = args.has("--activate");
const LEGACY_SQLITE = path.join(ROOT, "data", "mail_center.db");
const LEGACY_OAUTH_CONFIG = path.join(ROOT, "google_oauth_config.json");

if (shouldActivate && !shouldWrite) {
  throw new Error("--activate requires --write so the dataset is verified before cutover.");
}
if (!fs.existsSync(LOCAL_EXPORT)) {
  throw new Error(`Migration source is missing: ${LOCAL_EXPORT}`);
}

function firebaseCredential() {
  if (fs.existsSync(SERVICE_ACCOUNT)) {
    return cert(JSON.parse(fs.readFileSync(SERVICE_ACCOUNT, "utf8")));
  }
  return applicationDefault();
}

if (!getApps().length) {
  initializeApp({ credential: firebaseCredential(), projectId: PROJECT_ID });
}
const firestore = getFirestore();

function plainFirestoreValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map(plainFirestoreValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plainFirestoreValue(child)]));
  }
  return value;
}

async function readCollection(name) {
  const snapshot = await firestore.collection(name).get();
  return snapshot.docs.map(doc => plainFirestoreValue({ id: doc.id, ...doc.data() }));
}

function migrationIdFor(localData, cloudInboxes, cloudMessages) {
  return `migration_${sha256({ localData, cloudInboxes, cloudMessages }).slice(0, 16)}`;
}

function readLegacyAuxiliary(dataset) {
  const auxiliary = {
    oauthAccounts: [],
    niveaLogs: [],
    aiFeedback: [],
    ignoredPatterns: [],
    settings: {},
    activeInboxId: null,
    appVersion: JSON.parse(fs.readFileSync(path.join(ROOT, "public", "version.json"), "utf8")),
  };
  if (fs.existsSync(LEGACY_OAUTH_CONFIG)) {
    auxiliary.settings.google_oauth_config = fs.readFileSync(LEGACY_OAUTH_CONFIG, "utf8");
  }
  if (!fs.existsSync(LEGACY_SQLITE)) return auxiliary;

  const { DatabaseSync } = require("node:sqlite");
  const sqlite = new DatabaseSync(LEGACY_SQLITE, { readOnly: true });
  const rows = table => {
    try { return sqlite.prepare(`SELECT * FROM ${table}`).all().map(item => ({ ...item })); }
    catch (_) { return []; }
  };
  auxiliary.oauthAccounts = rows("oauth_accounts").filter(item => !String(item.email || "").startsWith("oauth_test_"));
  auxiliary.niveaLogs = rows("nivea_logs");
  auxiliary.aiFeedback = rows("ai_feedback").filter(item => !String(item.subject || "").includes("Offer 50% Off"));
  auxiliary.ignoredPatterns = rows("ignored_patterns")
    .map(item => item.pattern)
    .filter(pattern => pattern && !pattern.startsWith("unwanted-domain-") && pattern !== "offer 50% off");
  const settings = rows("settings");
  for (const item of settings) {
    if (item.key !== "activeInboxId") auxiliary.settings[item.key] = item.value;
  }
  const activeId = settings.find(item => item.key === "activeInboxId")?.value;
  if (activeId && dataset.inboxChunks.some(chunk => chunk.data.items.some(item => item.id === activeId))) auxiliary.activeInboxId = activeId;
  sqlite.close();
  return auxiliary;
}

function buildAuxiliaryDataset(auxiliary, createdAt) {
  const niveaItems = auxiliary.niveaLogs.map(item => ({
    ...item,
    id: String(item.id || `nivea_${sha256(item).slice(0, 20)}`),
    registeredAt: item.registeredAt || item.registered_at || createdAt,
    createdAt: item.registeredAt || item.registered_at || createdAt,
  }));
  const feedbackItems = auxiliary.aiFeedback.map(item => ({
    ...item,
    id: String(item.id || `feedback_${sha256(item).slice(0, 20)}`),
    createdAt: item.createdAt || item.created_at || createdAt,
  }));
  const niveaChunks = buildChunkDocuments("nivea", niveaItems, { maxItems: 100, maxBytes: TARGET_CHUNK_BYTES, kind: "nivea" })
    .map(doc => ({ ...doc, data: { ...doc.data, entity: "nivea" } }));
  const feedbackChunks = buildChunkDocuments("aiFeedback", feedbackItems, { maxItems: 100, maxBytes: TARGET_CHUNK_BYTES, kind: "aiFeedback" })
    .map(doc => ({ ...doc, data: { ...doc.data, entity: "aiFeedback" } }));
  return {
    niveaChunks,
    feedbackChunks,
    chunkMap: {
      nivea: niveaChunks.map(doc => doc.id).sort().reverse(),
      aiFeedback: feedbackChunks.map(doc => doc.id).sort().reverse(),
    },
  };
}

function allWrites(dataset, auxiliary) {
  const root = firestore.collection("mailDatasets").doc(DATASET_ID);
  const writes = [{ ref: root, data: dataset.meta }];
  const addCollection = (name, docs) => {
    for (const doc of docs) writes.push({ ref: root.collection(name).doc(doc.id), data: doc.data });
  };
  addCollection("inboxChunks", dataset.inboxChunks);
  addCollection("messageChunks", dataset.messageChunks);
  addCollection("categoryChunks", dataset.categoryChunks);
  addCollection("locatorShards", dataset.locatorDocs);
  for (const [aliasId, canonicalId] of Object.entries(dataset.aliases)) {
    writes.push({
      ref: root.collection("aliases").doc(sha256(aliasId).slice(0, 32)),
      data: { aliasId, canonicalId },
    });
  }
  dataset.quarantine.forEach((entry, index) => {
    const identity = `${entry.entity}:${entry.record?.id || "unknown"}:${index}`;
    writes.push({
      ref: root.collection("quarantine").doc(sha256(identity).slice(0, 32)),
      data: { ...entry, quarantinedAt: dataset.createdAt, expiresAfterDays: 14 },
    });
  });
  const auxiliaryDataset = buildAuxiliaryDataset(auxiliary, dataset.createdAt);
  writes.push({
    ref: firestore.collection("mailRuntime").doc("bootstrap"),
    data: {
      activeInboxId: auxiliary.activeInboxId,
      values: auxiliary.settings,
      ignoredPatterns: auxiliary.ignoredPatterns,
      appVersion: auxiliary.appVersion,
      oauthAccounts: auxiliary.oauthAccounts,
      auxChunkMap: auxiliaryDataset.chunkMap,
      auxCounts: { nivea: auxiliary.niveaLogs.length, aiFeedback: auxiliary.aiFeedback.length },
      revision: 1,
      migratedAt: dataset.createdAt,
      updatedAt: dataset.createdAt,
    },
  });
  for (const doc of [...auxiliaryDataset.niveaChunks, ...auxiliaryDataset.feedbackChunks]) {
    writes.push({ ref: firestore.collection("mailAuxChunks").doc(doc.id), data: doc.data });
  }
  return writes;
}

async function commitWrites(writes) {
  let completed = 0;
  for (let offset = 0; offset < writes.length; offset += BATCH_LIMIT) {
    const batch = firestore.batch();
    for (const write of writes.slice(offset, offset + BATCH_LIMIT)) batch.set(write.ref, write.data);
    await batch.commit();
    completed = Math.min(offset + BATCH_LIMIT, writes.length);
    console.log(`  wrote ${completed}/${writes.length} documents`);
  }
}

async function verifyDataset(dataset, auxiliary) {
  const root = firestore.collection("mailDatasets").doc(DATASET_ID);
  const rootSnapshot = await root.get();
  if (!rootSnapshot.exists) throw new Error("Staged dataset metadata was not found after write.");
  const remoteMeta = plainFirestoreValue(rootSnapshot.data());
  if (remoteMeta.checksum !== dataset.checksum) throw new Error("Dataset checksum mismatch after write.");

  const [inboxChunks, messageChunks, categoryChunks, locators, bootstrap] = await Promise.all([
    root.collection("inboxChunks").get(),
    root.collection("messageChunks").get(),
    root.collection("categoryChunks").get(),
    root.collection("locatorShards").get(),
    firestore.collection("mailRuntime").doc("bootstrap").get(),
  ]);
  const inboxCount = inboxChunks.docs.reduce((sum, doc) => sum + Number(doc.data().itemCount || 0), 0);
  const messageCount = messageChunks.docs.reduce((sum, doc) => sum + Number(doc.data().itemCount || 0), 0);
  if (inboxCount !== dataset.counts.totalInboxes) throw new Error(`Inbox verification failed: ${inboxCount} != ${dataset.counts.totalInboxes}`);
  if (messageCount !== dataset.counts.totalMessages) throw new Error(`Message verification failed: ${messageCount} != ${dataset.counts.totalMessages}`);
  if (locators.size !== 32) throw new Error(`Locator verification failed: expected 32, found ${locators.size}`);
  if (!bootstrap.exists) throw new Error("Auxiliary bootstrap verification failed: document missing.");
  const bootstrapData = bootstrap.data();
  if (Number(bootstrapData.auxCounts?.nivea || 0) !== auxiliary.niveaLogs.length) throw new Error("Nivea auxiliary count mismatch.");
  if (Number(bootstrapData.auxCounts?.aiFeedback || 0) !== auxiliary.aiFeedback.length) throw new Error("AI feedback auxiliary count mismatch.");

  return {
    inboxChunks: inboxChunks.size,
    messageChunks: messageChunks.size,
    categoryChunks: categoryChunks.size,
    locatorShards: locators.size,
    auxiliaryBootstrapReads: 1,
    auxiliaryChunks: [...(bootstrapData.auxChunkMap?.nivea || []), ...(bootstrapData.auxChunkMap?.aiFeedback || [])].length,
  };
}

async function activate(dataset) {
  const datasetRef = firestore.collection("mailDatasets").doc(DATASET_ID);
  const pointerRef = firestore.collection("system").doc("data_pointer");
  await firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(datasetRef);
    if (!snapshot.exists || snapshot.data().checksum !== dataset.checksum) {
      throw new Error("Refusing activation because the staged dataset no longer matches verification.");
    }
    transaction.update(datasetRef, { status: "active", activatedAt: FieldValue.serverTimestamp() });
    transaction.set(pointerRef, {
      activeDatasetPath: `mailDatasets/${DATASET_ID}`,
      activeVersion: DATASET_ID,
      migrationId: dataset.migrationId,
      checksum: dataset.checksum,
      activatedAt: FieldValue.serverTimestamp(),
    });
  });
}

function printPlan(dataset, merged, cloudCounts, auxiliary) {
  const sizes = [...dataset.inboxChunks, ...dataset.messageChunks, ...dataset.categoryChunks]
    .map(doc => doc.data.encodedBytes);
  console.log("\nBatabitoo Firestore v2 migration plan");
  console.log("=====================================");
  console.log(`Mode: ${shouldWrite ? (shouldActivate ? "WRITE + ACTIVATE" : "WRITE/STAGE") : "DRY RUN (read only)"}`);
  console.log(`Cloud inputs: ${cloudCounts.inboxes} inboxes, ${cloudCounts.messages} messages`);
  console.log(`Final inboxes: ${dataset.counts.totalInboxes} (${dataset.counts.official} official, ${dataset.counts.temp} temp)`);
  console.log(`Final messages: ${dataset.counts.totalMessages} (${dataset.counts.officialMessages} official, ${dataset.counts.tempMessages} temp)`);
  console.log(`Categories: ${dataset.counts.amazon} Amazon, ${dataset.counts.banned} banned, ${dataset.counts.suspected} suspected`);
  console.log(`Chunks: ${dataset.inboxChunks.length} inbox, ${dataset.messageChunks.length} message, ${dataset.categoryChunks.length} category`);
  console.log(`Largest chunk: ${Math.max(0, ...sizes).toLocaleString()} bytes (target ${TARGET_CHUNK_BYTES.toLocaleString()})`);
  console.log(`Aliases: ${Object.keys(merged.aliases).length}; quarantined: ${merged.quarantine.length}`);
  console.log(`Auxiliary: ${auxiliary.oauthAccounts.length} OAuth accounts, ${auxiliary.niveaLogs.length} Nivea logs, ${auxiliary.aiFeedback.length} AI feedback records`);
  console.log(`Checksum: ${dataset.checksum}`);
}

async function main() {
  const localData = JSON.parse(fs.readFileSync(LOCAL_EXPORT, "utf8"));
  const [cloudInboxes, cloudMessages] = await Promise.all([
    readCollection("inboxes"),
    readCollection("messages"),
  ]);
  const merged = mergeSources(localData, cloudInboxes, cloudMessages);
  const migrationId = migrationIdFor(localData, cloudInboxes, cloudMessages);
  const dataset = buildDataset(merged, { migrationId });
  const auxiliary = readLegacyAuxiliary(dataset);
  printPlan(dataset, merged, { inboxes: cloudInboxes.length, messages: cloudMessages.length }, auxiliary);

  if (!shouldWrite) {
    console.log("\nNo writes performed. Add --write to stage this verified plan.");
    return;
  }

  const writes = allWrites(dataset, auxiliary);
  console.log(`\nStaging ${writes.length} documents under mailDatasets/${DATASET_ID}...`);
  await commitWrites(writes);
  const verification = await verifyDataset(dataset, auxiliary);
  console.log("Verified staged dataset:", verification);

  if (shouldActivate) {
    await activate(dataset);
    console.log("Activated system/data_pointer -> mailDatasets/v2.");
  } else {
    console.log("Dataset remains staged. Re-run with --write --activate after the cloud runtime is deployed.");
  }
}

main().catch(error => {
  console.error("Migration failed:", error.stack || error.message);
  process.exitCode = 1;
});
