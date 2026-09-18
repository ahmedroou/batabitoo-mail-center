/**
 * migrate_full_manifest_to_cloud.cjs
 * Full migration + Chunked Manifest builder for Firestore.
 * Run once after Firestore quota resets.
 *
 * Structure written:
 *   system/manifest_meta
 *   system/manifest_official_0  (≤100 official inboxes, newest first)
 *   system/manifest_temp_0 ... manifest_temp_9  (≤100 temp inboxes each)
 *   system/manifest_messages_official_0
 *   system/manifest_messages_temp_0
 *   + all 1006 inboxes in inboxes/ collection (slim)
 *   + all 27 messages in messages/ collection (slim)
 */
"use strict";

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SA   = path.join(ROOT, "serviceAccountKey.json");
const DB   = path.join(ROOT, "inboxes_db.json");

if (!fs.existsSync(SA)) {
  console.error("❌ serviceAccountKey.json not found in project root.");
  process.exit(1);
}
if (!fs.existsSync(DB)) {
  console.error("❌ inboxes_db.json not found.");
  process.exit(1);
}

const { initializeApp, getApps, cert: adminCert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const serviceAccount = require(SA);

if (!getApps().length) {
  initializeApp({ credential: adminCert(serviceAccount), projectId: "batabitoo-mail-2026" });
}
const db = getFirestore();


const CHUNK_SIZE  = 100;
const BATCH_LIMIT = 400;

const EXCLUDED = new Set(["raw","rawBase64","content","contentBase64","originalRaw","html","attachments"]);

function sanitize(obj) {
  if (!obj || typeof obj !== "object") return obj == null ? null : obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (EXCLUDED.has(k)) continue;
    if (v === undefined) { out[k] = null; continue; }
    if (typeof v === "string") { out[k] = v.length > 20000 ? v.slice(0, 20000) : v; continue; }
    if (Array.isArray(v)) { out[k] = v.slice(0, 500).map(i => typeof i === "object" ? sanitize(i) : i); continue; }
    if (v && typeof v === "object" && !(v instanceof Date)) { out[k] = sanitize(v); continue; }
    out[k] = v;
  }
  return out;
}

function slimInbox(i) {
  return {
    id:                 i.id || "",
    email:              i.email || "",
    domain:             i.domain || "",
    label:              i.label || i.personName || (i.email||"").split("@")[0] || "",
    personName:         i.personName || i.label || (i.email||"").split("@")[0] || "",
    isOfficial:         i.isOfficial || false,
    type:               i.type || (i.isOfficial ? "official" : "temp"),
    isAmazon:           i.isAmazon || false,
    isBanned:           i.isBanned || false,
    banStatus:          i.banStatus || "none",
    banReason:          i.banReason || "",
    messageCount:       i.messageCount || 0,
    createdAt:          i.createdAt || new Date().toISOString(),
    isRealGmail:        i.isRealGmail || false,
    isDottedGmailAlias: i.isDottedGmailAlias || false,
  };
}

function slimMsg(m) {
  return {
    id:               m.id || "",
    inboxEmail:       m.inboxEmail || m.to || "",
    from:             m.from || "",
    subject:          m.subject || "",
    intro:            m.intro || "",
    otp:              m.otp || null,
    isAmazon:         m.isAmazon || false,
    isBanned:         m.isBanned || false,
    isWinning:        m.isWinning || false,
    isOfficialDomain: m.isOfficialDomain || false,
    createdAt:        m.createdAt || new Date().toISOString(),
  };
}

function isOfficialInbox(i) {
  const email = String(i.email || "").toLowerCase();
  return i.isOfficial === true || i.type === "official" || email.endsWith("@batabitoo.com") || email.endsWith("@gmail.com");
}
function isOfficialMsg(m) {
  const email = String(m.inboxEmail || m.to || "").toLowerCase();
  return m.isOfficialDomain === true || email.endsWith("@batabitoo.com") || email.endsWith("@gmail.com");
}

function chunkArray(arr) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += CHUNK_SIZE) chunks.push(arr.slice(i, i + CHUNK_SIZE));
  return chunks.length ? chunks : [[]];
}

async function writeBatches(items, handler) {
  let done = 0;
  for (let i = 0; i < items.length; i += BATCH_LIMIT) {
    const slice = items.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const item of slice) handler(batch, item);
    await batch.commit();
    done += slice.length;
    process.stdout.write(`   ⏳ ${done}/${items.length} written...\r`);
  }
  console.log(`   ✅ ${done} documents committed.              `);
}

async function main() {
  console.log("\n🚀 Batabitoo — Full Migration + Chunked Manifest");
  console.log("══════════════════════════════════════════════════\n");

  const localData = JSON.parse(fs.readFileSync(DB, "utf8"));
  const allInboxes  = (localData.inboxes  || []).filter(i => i.id && i.email);
  const allMessages = (localData.messages || []).filter(m => m.id);
  console.log(`📦 Local DB: ${allInboxes.length} inboxes, ${allMessages.length} messages\n`);

  // ── 1: Individual inboxes ───────────────────────────────────────────────
  console.log("📁 Step 1: Writing inboxes/ collection...");
  await writeBatches(allInboxes, (batch, inbox) => {
    batch.set(db.collection("inboxes").doc(inbox.id), sanitize({ ...inbox, updatedAt: new Date().toISOString() }), { merge: true });
  });

  // ── 2: Individual messages ──────────────────────────────────────────────
  console.log("\n✉️  Step 2: Writing messages/ collection...");
  await writeBatches(allMessages, (batch, msg) => {
    batch.set(db.collection("messages").doc(msg.id), sanitize({ ...msg, updatedAt: new Date().toISOString() }), { merge: true });
  });

  // ── 3: Build Chunked Manifest ───────────────────────────────────────────
  console.log("\n🗂️  Step 3: Building Chunked Manifest (system/)...");
  const now = new Date().toISOString();

  const officialInboxes = allInboxes.filter(isOfficialInbox).sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0)).map(slimInbox);
  const tempInboxes     = allInboxes.filter(i => !isOfficialInbox(i)).sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0)).map(slimInbox);
  const officialMsgs    = allMessages.filter(isOfficialMsg).sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0)).map(slimMsg);
  const tempMsgs        = allMessages.filter(m => !isOfficialMsg(m)).sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0)).map(slimMsg);

  const officialChunks = chunkArray(officialInboxes);
  const tempChunks     = chunkArray(tempInboxes);
  const msgOffChunks   = chunkArray(officialMsgs);
  const msgTempChunks  = chunkArray(tempMsgs);

  console.log(`   📊 official: ${officialInboxes.length} in ${officialChunks.length} chunk(s)`);
  console.log(`   📊 temp:     ${tempInboxes.length} in ${tempChunks.length} chunk(s)`);
  console.log(`   📊 messages_official: ${officialMsgs.length} in ${msgOffChunks.length} chunk(s)`);
  console.log(`   📊 messages_temp:     ${tempMsgs.length} in ${msgTempChunks.length} chunk(s)`);

  const sysCol = db.collection("system");
  const allOps = [];

  allOps.push({ ref: sysCol.doc("manifest_meta"), data: sanitize({
    official:          { chunks: officialChunks.length, total: officialInboxes.length },
    temp:              { chunks: tempChunks.length,      total: tempInboxes.length },
    messages_official: { chunks: msgOffChunks.length,   total: officialMsgs.length },
    messages_temp:     { chunks: msgTempChunks.length,  total: tempMsgs.length },
    totalInboxes:      allInboxes.length,
    totalMessages:     allMessages.length,
    updatedAt: now,
  }) });

  officialChunks.forEach((chunk, idx) =>
    allOps.push({ ref: sysCol.doc(`manifest_official_${idx}`), data: sanitize({ chunk: idx, type: "official", inboxes: chunk, updatedAt: now }) }));
  tempChunks.forEach((chunk, idx) =>
    allOps.push({ ref: sysCol.doc(`manifest_temp_${idx}`), data: sanitize({ chunk: idx, type: "temp", inboxes: chunk, updatedAt: now }) }));
  msgOffChunks.forEach((chunk, idx) =>
    allOps.push({ ref: sysCol.doc(`manifest_messages_official_${idx}`), data: sanitize({ chunk: idx, type: "official", messages: chunk, updatedAt: now }) }));
  msgTempChunks.forEach((chunk, idx) =>
    allOps.push({ ref: sysCol.doc(`manifest_messages_temp_${idx}`), data: sanitize({ chunk: idx, type: "temp", messages: chunk, updatedAt: now }) }));

  await writeBatches(allOps, (batch, op) => { batch.set(op.ref, op.data, { merge: true }); });

  // ── 4: Verify ───────────────────────────────────────────────────────────
  console.log("\n🔍 Step 4: Verifying manifest_meta...");
  const metaSnap = await sysCol.doc("manifest_meta").get();
  if (metaSnap.exists) {
    const meta = metaSnap.data();
    console.log("   ✅ manifest_meta OK:");
    console.log(`      Official: ${meta.official?.total} in ${meta.official?.chunks} chunk(s)`);
    console.log(`      Temp:     ${meta.temp?.total} in ${meta.temp?.chunks} chunk(s)`);
    console.log(`      Total inboxes: ${meta.totalInboxes} | Total messages: ${meta.totalMessages}`);
  } else {
    console.warn("   ⚠️ manifest_meta not found after write!");
  }

  console.log("\n══════════════════════════════════════════════════");
  console.log(`🎉 MIGRATION COMPLETE! ${allInboxes.length} inboxes + ${allMessages.length} messages + ${allOps.length} manifest docs`);
  console.log("══════════════════════════════════════════════════\n");
  process.exit(0);
}

main().catch(err => {
  console.error("\n❌ Migration failed:", err.message);
  process.exit(1);
});

