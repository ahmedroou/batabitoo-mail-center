const { mailDatabase } = require('../CloudDatabase');

async function main() {
  console.log('🔍 Connecting to CloudDatabase...');
  await mailDatabase.ready();

  const allInboxes = mailDatabase.getAllInboxes();
  console.log(`📋 Total inboxes in database: ${allInboxes.length}`);

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
    /verification/i
  ];

  const testInboxes = allInboxes.filter(inbox => {
    const id = String(inbox.id || '');
    const email = String(inbox.email || '');
    const label = String(inbox.label || '');
    return testPatterns.some(p => p.test(id) || p.test(email) || p.test(label));
  });

  console.log(`🧹 Found ${testInboxes.length} test inboxes to delete:`);
  for (const t of testInboxes) {
    console.log(`  - [${t.id}] ${t.email} (${t.label})`);
  }

  if (testInboxes.length === 0) {
    console.log('✅ No test inboxes found in the database. Clean state!');
    process.exit(0);
  }

  for (const inbox of testInboxes) {
    console.log(`🗑️ Deleting test inbox: ${inbox.id} (${inbox.email})...`);
    await mailDatabase.deleteInbox(inbox.id);
  }

  console.log(`🎉 Successfully cleaned up all ${testInboxes.length} test inboxes and their messages!`);
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error during cleanup:', err);
  process.exit(1);
});
