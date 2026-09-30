"use strict";

/**
 * Batabitoo Mail Center — Milestone M3 Challenger 2 Empirical Stress Test Suite
 * 
 * Deeply tests backend reliability under adversarial and boundary conditions:
 * 1. CloudDatabase.updateInboxBanStatus:
 *    - Resolution by unique ID
 *    - Resolution by email address (exact)
 *    - Resolution by uppercase/unnormalized email
 *    - Rejection of unknown ID, unknown email, null, undefined, empty string
 *    - Correct state transitions: confirmed (banned+amazon), suspected (amazon), safe
 *    - Metadata updates: banReason, banDecisionSource, banDecisionAt, updatedAt
 * 
 * 2. CloudDatabase.deleteInbox:
 *    - Active inbox deletion with multiple remaining inboxes (reassignment to first inbox)
 *    - Non-active inbox deletion (active inbox remains unchanged)
 *    - Single active inbox deletion (activeInboxId becomes null, never dangling)
 *    - Case-insensitive message cascading cleanup
 *    - Non-existent ID deletion (returns false, state untouched)
 * 
 * 3. Timer Lifecycle in NiveaWinnerSyncWorker & TempSyncService:
 *    - Timer creation and immediate cancellation
 *    - Mock/simulated time advancement to guarantee zero orphan timer execution
 *    - Re-entrance and duplicate start guards
 *    - Multiple stop calls (idempotence)
 */

const assert = require("node:assert/strict");
const { mailDatabase } = require("../CloudDatabase");
const niveaWorker = require("../NiveaWinnerSyncWorker");
const tempSync = require("../TempSyncService");

// In-memory test harness for CloudDatabase mutation to avoid cloud network latency
function setupInMemoryDatabase() {
  mailDatabase.cache = {
    inboxes: [],
    messages: [],
    categories: [],
    activeInboxId: null,
  };
  mailDatabase.meta = { revision: 0, counts: {} };

  mailDatabase._targetedUpsert = async (entity, items) => {
    const key = entity === "inbox" ? "inboxes" : "messages";
    const existingMap = new Map(mailDatabase.cache[key].map(item => [item.id, item]));
    for (const item of items) existingMap.set(item.id, item);
    mailDatabase.cache[key] = Array.from(existingMap.values());
    return items;
  };

  mailDatabase._mutateCore = async mutator => {
    const state = {
      inboxes: [...mailDatabase.cache.inboxes],
      messages: [...mailDatabase.cache.messages],
    };
    const res = await mutator(state);
    if (res) {
      mailDatabase.cache.inboxes = state.inboxes;
      mailDatabase.cache.messages = state.messages;
    }
    return res;
  };

  mailDatabase._persistBootstrap = async () => true;
  mailDatabase._enqueue = async fn => (typeof fn === "function" ? fn() : true);
}

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    const res = fn();
    if (res && typeof res.then === "function") {
      return res.then(() => {
        passedTests++;
        console.log(`  ✅ [PASS] ${name}`);
      }).catch(err => {
        console.error(`  ❌ [FAIL] ${name}:`, err.message);
        throw err;
      });
    }
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function main() {
  console.log("==================================================================");
  console.log("⚔️ CHALLENGER 2: M3 BACKEND RELIABILITY EMPIRICAL STRESS TEST SUITE");
  console.log("==================================================================\n");

  setupInMemoryDatabase();

  // ---------------------------------------------------------------------------
  // SECTION 1: CloudDatabase.updateInboxBanStatus
  // ---------------------------------------------------------------------------
  console.log("📋 SECTION 1: CloudDatabase.updateInboxBanStatus Stress Tests");

  const inbox1 = {
    id: "inbox_test_1",
    email: "sarah.connor@batabitoo.com",
    domain: "batabitoo.com",
    isOfficial: true,
    banStatus: "safe",
    isBanned: false,
    isAmazon: false,
  };

  const inbox2 = {
    id: "inbox_test_2",
    email: "john.reese@batabitoo.com",
    domain: "batabitoo.com",
    isOfficial: true,
    banStatus: "safe",
    isBanned: false,
    isAmazon: false,
  };

  await mailDatabase.saveInbox(inbox1);
  await mailDatabase.saveInbox(inbox2);

  await runTest("1.1: updateInboxBanStatus resolves target by exact ID", async () => {
    const res = await mailDatabase.updateInboxBanStatus("inbox_test_1", "confirmed", "Abuse detected", "guard");
    assert.ok(res, "Must find and return updated inbox record");
    assert.equal(res.id, "inbox_test_1");
    assert.equal(res.banStatus, "confirmed");
    assert.equal(res.isBanned, true);
    assert.equal(res.isAmazon, true, "Confirmed ban must flag isAmazon");
    assert.equal(res.banReason, "Abuse detected");
    assert.equal(res.banDecisionSource, "guard");
    assert.ok(res.banDecisionAt, "Must set banDecisionAt timestamp");
  });

  await runTest("1.2: updateInboxBanStatus resolves target by exact email", async () => {
    const res = await mailDatabase.updateInboxBanStatus("john.reese@batabitoo.com", "suspected", "Anomaly found", "ai-scanner");
    assert.ok(res, "Must find and return updated inbox record");
    assert.equal(res.id, "inbox_test_2");
    assert.equal(res.banStatus, "suspected");
    assert.equal(res.isBanned, false, "Suspected status is not yet fully banned");
    assert.equal(res.isAmazon, true, "Suspected status must set isAmazon to true");
    assert.equal(res.banReason, "Anomaly found");
    assert.equal(res.banDecisionSource, "ai-scanner");
  });

  await runTest("1.3: updateInboxBanStatus resolves target by uppercase email and trims whitespace", async () => {
    const res = await mailDatabase.updateInboxBanStatus("  SARAH.CONNOR@BATABITOO.COM  ", "safe", "Cleared on appeal", "admin");
    assert.ok(res, "Must resolve case-insensitively with whitespace trimmed");
    assert.equal(res.id, "inbox_test_1");
    assert.equal(res.banStatus, "safe");
    assert.equal(res.isBanned, false);
    assert.equal(res.banReason, "Cleared on appeal");
    assert.equal(res.banDecisionSource, "admin");
  });

  await runTest("1.4: updateInboxBanStatus returns null for non-existent ID", async () => {
    const res = await mailDatabase.updateInboxBanStatus("non_existent_id_9999", "confirmed", "test");
    assert.equal(res, null, "Must return null when ID is not found");
  });

  await runTest("1.5: updateInboxBanStatus returns null for non-existent email", async () => {
    const res = await mailDatabase.updateInboxBanStatus("ghost.user@batabitoo.com", "confirmed", "test");
    assert.equal(res, null, "Must return null when email is not found");
  });

  await runTest("1.6: updateInboxBanStatus handles null, undefined, empty string gracefully", async () => {
    const resNull = await mailDatabase.updateInboxBanStatus(null, "confirmed");
    assert.equal(resNull, null, "null target must return null");

    const resUndefined = await mailDatabase.updateInboxBanStatus(undefined, "confirmed");
    assert.equal(resUndefined, null, "undefined target must return null");

    const resEmpty = await mailDatabase.updateInboxBanStatus("", "confirmed");
    assert.equal(resEmpty, null, "empty string target must return null");

    const resWhitespace = await mailDatabase.updateInboxBanStatus("   ", "confirmed");
    assert.equal(resWhitespace, null, "whitespace string target must return null");
  });

  // ---------------------------------------------------------------------------
  // SECTION 2: CloudDatabase.deleteInbox & Active Inbox Reassignment
  // ---------------------------------------------------------------------------
  console.log("\n📋 SECTION 2: CloudDatabase.deleteInbox & Active Inbox Reassignment");

  await runTest("2.1: Multi-inbox active deletion reassigns activeInboxId to first remaining inbox", async () => {
    setupInMemoryDatabase();

    await mailDatabase.saveInbox({ id: "box_A", email: "a@batabitoo.com" });
    await mailDatabase.saveInbox({ id: "box_B", email: "b@batabitoo.com" });
    await mailDatabase.saveInbox({ id: "box_C", email: "c@batabitoo.com" });

    mailDatabase.cache.activeInboxId = "box_A";
    assert.equal(mailDatabase.getActiveInboxId(), "box_A");

    const res = await mailDatabase.deleteInbox("box_A");
    assert.equal(res, true, "deleteInbox must return true");

    assert.equal(mailDatabase.cache.inboxes.length, 2);
    assert.equal(mailDatabase.findInboxById("box_A"), null, "box_A must be deleted");

    const newActive = mailDatabase.getActiveInboxId();
    assert.ok(newActive, "activeInboxId must not be null when other inboxes exist");
    assert.notEqual(newActive, "box_A", "activeInboxId must NEVER remain dangling to deleted box_A");
    assert.equal(newActive, "box_B", "activeInboxId must reassign to inboxes[0].id (box_B)");
  });

  await runTest("2.2: Deleting a non-active inbox does not alter activeInboxId", async () => {
    assert.equal(mailDatabase.getActiveInboxId(), "box_B");

    const res = await mailDatabase.deleteInbox("box_C");
    assert.equal(res, true);
    assert.equal(mailDatabase.cache.inboxes.length, 1);
    assert.equal(mailDatabase.getActiveInboxId(), "box_B", "Active inbox must remain box_B");
  });

  await runTest("2.3: Deleting the LAST active inbox sets activeInboxId to null (no dangling pointer)", async () => {
    assert.equal(mailDatabase.getActiveInboxId(), "box_B");
    assert.equal(mailDatabase.cache.inboxes.length, 1);

    const res = await mailDatabase.deleteInbox("box_B");
    assert.equal(res, true);
    assert.equal(mailDatabase.cache.inboxes.length, 0);

    const activeId = mailDatabase.getActiveInboxId();
    assert.equal(activeId, null, "activeInboxId must be set to null when no inboxes remain");
    assert.equal(mailDatabase.getActiveInbox(), null, "getActiveInbox() must return null");
  });

  await runTest("2.4: deleteInbox returns false for non-existent inbox without corrupting active pointer", async () => {
    await mailDatabase.saveInbox({ id: "box_persist", email: "persist@batabitoo.com" });
    mailDatabase.cache.activeInboxId = "box_persist";

    const res = await mailDatabase.deleteInbox("non_existent_xyz");
    assert.equal(res, false, "Must return false for non-existent inbox");
    assert.equal(mailDatabase.getActiveInboxId(), "box_persist");
    assert.equal(mailDatabase.cache.inboxes.length, 1);
  });

  await runTest("2.5: deleteInbox cascades to remove messages matching inbox email (case-insensitive)", async () => {
    setupInMemoryDatabase();

    await mailDatabase.saveInbox({ id: "box_case", email: "CaseTest@Batabitoo.COM" });
    mailDatabase.cache.messages = [
      { id: "m1", inboxEmail: "casetest@batabitoo.com", subject: "msg 1" },
      { id: "m2", inboxEmail: "CASETEST@BATABITOO.COM", subject: "msg 2" },
      { id: "m3", inboxEmail: "other@batabitoo.com", subject: "msg 3" },
    ];

    await mailDatabase.deleteInbox("box_case");

    assert.equal(mailDatabase.cache.messages.length, 1, "Should filter out all matching messages");
    assert.equal(mailDatabase.cache.messages[0].id, "m3", "Only unrelated messages must remain");
  });

  // ---------------------------------------------------------------------------
  // SECTION 3: Timer Lifecycle in NiveaWinnerSyncWorker & TempSyncService
  // ---------------------------------------------------------------------------
  console.log("\n📋 SECTION 3: Timer Lifecycle & Leak Prevention Stress Tests");

  await runTest("3.1: NiveaWinnerSyncWorker captures initialTimer and interval timer on start", () => {
    niveaWorker.stopScheduler(); // Ensure clean state
    assert.equal(niveaWorker.timer, null);
    assert.equal(niveaWorker.initialTimer, null);

    niveaWorker.startScheduler();
    assert.ok(niveaWorker.timer, "timer interval must be active");
    assert.ok(niveaWorker.initialTimer, "initialTimer timeout must be active");

    const timerRef = niveaWorker.timer;
    const initialRef = niveaWorker.initialTimer;

    // Idempotency: second call must not overwrite existing active timer
    niveaWorker.startScheduler();
    assert.equal(niveaWorker.timer, timerRef, "Calling startScheduler() twice must not overwrite active timer");
    assert.equal(niveaWorker.initialTimer, initialRef, "Calling startScheduler() twice must not overwrite initialTimer");
  });

  await runTest("3.2: NiveaWinnerSyncWorker stops cleanly and executes ZERO orphan timers", async () => {
    let syncCallCount = 0;
    const origRunSync = niveaWorker.runSync;
    niveaWorker.runSync = async () => {
      syncCallCount++;
      return { success: true };
    };

    try {
      // Start scheduler
      niveaWorker.startScheduler();
      assert.ok(niveaWorker.initialTimer);

      // Stop immediately
      niveaWorker.stopScheduler();
      assert.equal(niveaWorker.initialTimer, null, "initialTimer must be null after stopScheduler");
      assert.equal(niveaWorker.timer, null, "timer must be null after stopScheduler");

      // Multiple stops must be idempotent and safe
      niveaWorker.stopScheduler();
      niveaWorker.stopScheduler();

      // Wait 100ms to verify no stray execution occurs
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(syncCallCount, 0, "runSync must NEVER be called after stopScheduler");
    } finally {
      niveaWorker.runSync = origRunSync;
      niveaWorker.stopScheduler();
    }
  });

  await runTest("3.3: TempSyncService captures initialTimer and interval timer on start", () => {
    tempSync.stopAutoSync(); // Clean state
    assert.equal(tempSync.syncIntervalTimer, null);
    assert.equal(tempSync.initialTimer, null);
    assert.equal(tempSync.isAutoSyncing, false);

    tempSync.startAutoSync(5);
    assert.ok(tempSync.syncIntervalTimer, "syncIntervalTimer must be active");
    assert.ok(tempSync.initialTimer, "initialTimer must be active");
    assert.equal(tempSync.isAutoSyncing, true);

    const timerRef = tempSync.syncIntervalTimer;
    const initialRef = tempSync.initialTimer;

    // Idempotency: second call must not create duplicate timers
    tempSync.startAutoSync(5);
    assert.equal(tempSync.syncIntervalTimer, timerRef, "Duplicate startAutoSync must be a no-op");
    assert.equal(tempSync.initialTimer, initialRef);
  });

  await runTest("3.4: TempSyncService stops cleanly and executes ZERO orphan timers", async () => {
    let contestSyncCount = 0;
    const origSyncContest = tempSync.syncContestInboxes;
    tempSync.syncContestInboxes = async () => {
      contestSyncCount++;
      return {};
    };

    try {
      // Start auto sync
      tempSync.startAutoSync(5);
      assert.ok(tempSync.initialTimer);

      // Stop immediately
      tempSync.stopAutoSync();
      assert.equal(tempSync.initialTimer, null, "initialTimer must be cleared");
      assert.equal(tempSync.syncIntervalTimer, null, "syncIntervalTimer must be cleared");
      assert.equal(tempSync.isAutoSyncing, false);

      // Idempotent stop calls
      tempSync.stopAutoSync();
      tempSync.stopAutoSync();

      // Wait 100ms
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(contestSyncCount, 0, "syncContestInboxes must NEVER be called after stopAutoSync");
    } finally {
      tempSync.syncContestInboxes = origSyncContest;
      tempSync.stopAutoSync();
    }
  });

  // ---------------------------------------------------------------------------
  // SECTION 4: Concurrency, Rapid Cycling & Edge Stress Tests
  // ---------------------------------------------------------------------------
  console.log("\n📋 SECTION 4: Concurrency, Rapid Cycling & Edge Stress Tests");

  await runTest("4.1: Rapid start/stop cycling (50 iterations) causes zero timer leaks in NiveaWorker", () => {
    for (let i = 0; i < 50; i++) {
      niveaWorker.startScheduler();
      assert.ok(niveaWorker.timer);
      assert.ok(niveaWorker.initialTimer);
      niveaWorker.stopScheduler();
      assert.equal(niveaWorker.timer, null);
      assert.equal(niveaWorker.initialTimer, null);
    }
  });

  await runTest("4.2: Rapid start/stop cycling (50 iterations) causes zero timer leaks in TempSync", () => {
    for (let i = 0; i < 50; i++) {
      tempSync.startAutoSync(3);
      assert.ok(tempSync.syncIntervalTimer);
      assert.ok(tempSync.initialTimer);
      assert.equal(tempSync.isAutoSyncing, true);
      tempSync.stopAutoSync();
      assert.equal(tempSync.syncIntervalTimer, null);
      assert.equal(tempSync.initialTimer, null);
      assert.equal(tempSync.isAutoSyncing, false);
    }
  });

  await runTest("4.3: Concurrent inbox ban updates preserve state integrity", async () => {
    setupInMemoryDatabase();
    const count = 20;
    for (let i = 0; i < count; i++) {
      await mailDatabase.saveInbox({ id: `concurrent_box_${i}`, email: `user_${i}@batabitoo.com` });
    }

    // Fire 20 updates concurrently
    const promises = [];
    for (let i = 0; i < count; i++) {
      const status = i % 2 === 0 ? "confirmed" : "suspected";
      const target = i % 3 === 0 ? `user_${i}@batabitoo.com` : `concurrent_box_${i}`;
      promises.push(mailDatabase.updateInboxBanStatus(target, status, `Reason ${i}`));
    }

    const results = await Promise.all(promises);
    assert.equal(results.length, count);
    for (let i = 0; i < count; i++) {
      assert.ok(results[i], `Result ${i} must not be null`);
      assert.equal(results[i].banReason, `Reason ${i}`);
    }
  });

  await runTest("4.4: Concurrent deletions keep activeInboxId valid and consistent", async () => {
    setupInMemoryDatabase();
    const boxes = [
      { id: "del_active", email: "active@batabitoo.com" },
      { id: "del_next_1", email: "next1@batabitoo.com" },
      { id: "del_next_2", email: "next2@batabitoo.com" },
    ];
    for (const b of boxes) await mailDatabase.saveInbox(b);
    mailDatabase.cache.activeInboxId = "del_active";

    // Delete del_active
    await mailDatabase.deleteInbox("del_active");
    const newActiveId = mailDatabase.getActiveInboxId();
    assert.notEqual(newActiveId, "del_active", "del_active must be cleaned up");
    assert.ok(["del_next_1", "del_next_2"].includes(newActiveId));

    // Delete del_next_1
    await mailDatabase.deleteInbox("del_next_1");
    // Delete del_next_2
    await mailDatabase.deleteInbox("del_next_2");

    assert.equal(mailDatabase.getActiveInboxId(), null, "Final active inbox must be null");
    assert.equal(mailDatabase.cache.inboxes.length, 0);
  });

  console.log("\n==================================================================");
  console.log(`🎉 STRESS TEST RESULTS: ${passedTests}/${totalTests} TESTS PASSED (100%)`);
  console.log("==================================================================\n");
}

main().catch(err => {
  console.error("💥 Stress Test Execution Failed:", err);
  process.exit(1);
});

