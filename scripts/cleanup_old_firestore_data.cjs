/**
 * cleanup_old_firestore_data.cjs
 * Deletes old individual inboxes/ and messages/ collection documents.
 * Keeps ONLY the system/manifest_* documents (Chunked Manifest).
 * Run once after quota resets.
 */
"use strict";
const path = require("path");
const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const SA = path.join(__dirname, "..", "serviceAccountKey.json");
const serviceAccount = require(SA);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount), projectId: "batabitoo-mail-2026" });
}
const db = getFirestore();

const BATCH_LIMIT = 400;

async function deleteCollection(colName) {
  let total = 0;
  let lastDoc = null;
  while (true) {
    let q = db.collection(colName).limit(BATCH_LIMIT);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    total += snap.docs.length;
    lastDoc = snap.docs[snap.docs.length - 1];
    process.stdout.write(`   ⏳ Deleted ${total} docs from ${colName}/...\r`);
  }
  console.log(`   ✅ Deleted ${total} documents from ${colName}/ collection.        `);
  return total;
}

async function main() {
  console.log("\n🧹 Batabitoo — Firestore Cleanup (Old Individual Docs)");
  console.log("════════════════════════════════════════════════════════\n");
  console.log("⚠️  This deletes all individual inboxes/ and messages/ docs.");
  console.log("    The Chunked Manifest (system/) is kept intact.\n");

  console.log("🗑️  Step 1: Deleting inboxes/ collection (1006 individual docs)...");
  const inboxCount = await deleteCollection("inboxes");

  console.log("\n🗑️  Step 2: Deleting messages/ collection (27 individual docs)...");
  const msgCount = await deleteCollection("messages");

  // Verify system/ manifest is still intact
  console.log("\n🔍 Step 3: Verifying system/manifest_meta is still intact...");
  const metaSnap = await db.collection("system").doc("manifest_meta").get();
  if (metaSnap.exists) {
    const m = metaSnap.data();
    console.log("   ✅ manifest_meta OK — Total inboxes:", m.totalInboxes, "| Total messages:", m.totalMessages);
    console.log("   ✅ Official chunks:", m.official?.chunks, "| Temp chunks:", m.temp?.chunks);
  } else {
    console.warn("   ⚠️ manifest_meta NOT FOUND — Something went wrong!");
  }

  console.log("\n════════════════════════════════════════════════════════");
  console.log(`🎉 CLEANUP DONE: Deleted ${inboxCount} inbox docs + ${msgCount} message docs`);
  console.log("   Firestore now only contains Chunked Manifest (≤15 docs total)");
  console.log("════════════════════════════════════════════════════════\n");
  process.exit(0);
}

main().catch(e => {
  console.error("\n❌ Cleanup failed:", e.message);
  process.exit(1);
});
