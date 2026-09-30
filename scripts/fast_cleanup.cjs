const { mailDatabase } = require('../CloudDatabase');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function fastCleanup() {
  console.log('🚀 Connecting to CloudDatabase for one-shot cleanup...');
  await mailDatabase.ready();

  const allInboxes = mailDatabase.getAllInboxes();
  console.log(`📋 Total inboxes currently in database: ${allInboxes.length}`);

  const testPatterns = [
    /^official_m2_/i,
    /^inbound_/i,
    /^test_/i,
    /_test_/i,
    /test_inbox_/i,
    /^stress_/i,
    /^temp_test_/i,
    /sample/i,
    /dummy/i,
    /verification/i,
    /^box_res_/i,
    /^box_del_/i,
    /^ban_res_/i,
    /^del1_/i,
    /^del2_/i
  ];

  const testInboxes = allInboxes.filter(inbox => {
    const id = String(inbox.id || '');
    const email = String(inbox.email || '');
    const label = String(inbox.label || '');
    return testPatterns.some(p => p.test(id) || p.test(email) || p.test(label));
  });

  console.log(`🧹 Identified ${testInboxes.length} test inboxes to delete.`);
  if (testInboxes.length === 0) {
    console.log('✅ Database is already completely clean of test inboxes!');
    process.exit(0);
  }

  const testIds = new Set(testInboxes.map(i => String(i.id)));
  const testEmails = new Set(testInboxes.map(i => normalizeEmail(i.email)));

  console.log(`⚡ Executing ONE-SHOT atomic mutation to delete all ${testInboxes.length} inboxes and their messages...`);
  
  const deletedCount = await mailDatabase._mutateCore(state => {
    const beforeInboxes = state.inboxes.length;
    const beforeMessages = state.messages.length;

    state.inboxes = state.inboxes.filter(item => !testIds.has(String(item.id)) && !testEmails.has(normalizeEmail(item.email)));
    state.messages = state.messages.filter(item => !testEmails.has(normalizeEmail(item.inboxEmail)));

    const inboxesRemoved = beforeInboxes - state.inboxes.length;
    const messagesRemoved = beforeMessages - state.messages.length;

    console.log(`🗑️ Removed ${inboxesRemoved} inboxes and ${messagesRemoved} messages inside transaction.`);
    return inboxesRemoved;
  });

  // Ensure activeInboxId is valid
  const remainingInboxes = mailDatabase.getAllInboxes();
  if (!remainingInboxes.some(i => i.id === mailDatabase.getActiveInboxId())) {
    const nextId = remainingInboxes[0]?.id || null;
    await mailDatabase.setActiveInboxId(nextId);
  }

  console.log(`🎉 SUCCESS! Cleaned up ${deletedCount} test inboxes. Remaining real inboxes: ${remainingInboxes.length}`);
  for (const r of remainingInboxes) {
    console.log(`  ⭐ [Real Inbox] ${r.id} | ${r.email} | ${r.label}`);
  }
  process.exit(0);
}

fastCleanup().catch(err => {
  console.error('❌ Fast cleanup failed:', err);
  process.exit(1);
});
