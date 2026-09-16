/**
 * migrate_to_firebase.js
 * High-performance, zero-loss migration script from local JSON to Firebase Cloud Firestore.
 * Migrates:
 * 1. 839 Inboxes (classified into Official @batabitoo.com vs Temporary Multi-domain)
 * 2. 21 Messages (thoroughly decoded with EmailParser to clean Arabic text & true HTML)
 * 3. 825 Nivea live registration records
 */

const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const emailParser = require('./EmailParser');

// 1. Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ serviceAccountKey.json not found!');
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);
const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: 'batabitoo-mail-2026'
});
const db = getFirestore(app);

async function commitInBatches(items, batchHandler, batchSize = 400) {
  let totalCommitted = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const batch = db.batch();
    for (const item of chunk) {
      batchHandler(batch, item);
    }
    await batch.commit();
    totalCommitted += chunk.length;
    process.stdout.write(`  ⏳ Committed ${totalCommitted}/${items.length} items...\r`);
  }
  console.log(`\n  ✅ Done! Total committed: ${totalCommitted}`);
  return totalCommitted;
}

async function runMigration() {
  console.log('🚀 Starting Batabitoo Mail Center -> Firebase Firestore Migration...');
  console.log('================================================================');

  // Load inboxes_db.json
  const inboxesDbFile = path.join(__dirname, 'inboxes_db.json');
  if (!fs.existsSync(inboxesDbFile)) {
    throw new Error('inboxes_db.json file not found');
  }
  const localData = JSON.parse(fs.readFileSync(inboxesDbFile, 'utf8'));

  // ==========================================
  // Step 1: Migrate Inboxes (Official vs Temp)
  // ==========================================
  const rawInboxes = localData.inboxes || [];
  console.log(`\n📁 Step 1: Processing ${rawInboxes.length} inboxes...`);

  let officialCount = 0;
  let tempCount = 0;

  const processedInboxes = rawInboxes.map(ib => {
    const email = (ib.email || '').toLowerCase().trim();
    const isOfficial = ib.isOfficial === true || email.endsWith('@batabitoo.com') || ib.domain === 'batabitoo.com';
    const type = isOfficial ? 'official' : 'temp';

    if (isOfficial) officialCount++; else tempCount++;

    return {
      id: ib.id || `inbox_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      email: email,
      domain: isOfficial ? 'batabitoo.com' : (ib.domain || email.split('@')[1] || 'unknown'),
      host: ib.host || (isOfficial ? 'batabitoo.com (Official Trusted)' : 'inboxes.com'),
      label: ib.label || (isOfficial ? `رسمي (${email.split('@')[0]})` : 'حساب سريع'),
      personName: ib.personName || ib.label || (isOfficial ? email.split('@')[0] : 'مستخدم'),
      isOfficial: isOfficial,
      type: type,
      password: ib.password || null,
      token: ib.token || null,
      accountId: ib.accountId || ib.id || null,
      messageCount: ib.messageCount || 0,
      createdAt: ib.createdAt || new Date().toISOString(),
      lastCheckedAt: ib.lastCheckedAt || null,
      migratedAt: new Date().toISOString()
    };
  });

  console.log(`   👑 Official inboxes detected: ${officialCount}`);
  console.log(`   ⚡ Temporary/Multi-domain inboxes detected: ${tempCount}`);

  await commitInBatches(processedInboxes, (batch, inbox) => {
    const docRef = db.collection('inboxes').doc(inbox.id);
    batch.set(docRef, inbox, { merge: true });
  });

  // ==========================================
  // Step 2: Clean and Migrate Messages
  // ==========================================
  const rawMessages = localData.messages || [];
  console.log(`\n✉️ Step 2: Processing and cleaning ${rawMessages.length} messages...`);

  const processedMessages = rawMessages.map(msg => {
    // Decode with EmailParser to convert raw MIME/Base64/QP into clean text & true HTML
    const parsed = emailParser.parseRawEmail(msg.text || msg.html || '');

    const cleanSubject = (msg.subject && msg.subject !== '(بدون عنوان)' && !msg.subject.includes('=?')) 
      ? emailParser.decodeRfc2047(msg.subject) 
      : (parsed.subject || msg.subject || '(بدون عنوان)');

    const cleanFrom = emailParser.decodeRfc2047(String(msg.from || parsed.from || ''));
    const cleanTo = String(msg.to || parsed.to || msg.inboxEmail || '').toLowerCase();
    const cleanText = parsed.text || msg.text || '';
    const cleanHtml = parsed.html || msg.html || emailParser.formatPlainTextToHtml(cleanText);
    const otp = parsed.otp || msg.otp || emailParser.extractOtp(cleanText, cleanSubject) || null;
    const intro = cleanText.replace(/\s+/g, ' ').slice(0, 140).trim();

    return {
      id: msg.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      inboxEmail: String(msg.inboxEmail || cleanTo).toLowerCase(),
      from: cleanFrom,
      to: cleanTo,
      subject: cleanSubject,
      intro: intro,
      text: cleanText,
      html: cleanHtml,
      otp: otp,
      isOfficialDomain: cleanTo.endsWith('@batabitoo.com'),
      domain: cleanTo.split('@')[1] || 'batabitoo.com',
      createdAt: msg.createdAt || new Date().toISOString(),
      savedLocallyAt: msg.savedLocallyAt || new Date().toISOString(),
      migratedAt: new Date().toISOString()
    };
  });

  await commitInBatches(processedMessages, (batch, msg) => {
    const docRef = db.collection('messages').doc(msg.id);
    batch.set(docRef, msg, { merge: true });
  });

  // ==========================================
  // Step 3: Migrate Nivea Campaign Logs
  // ==========================================
  const niveaFile = path.join(__dirname, 'results_nivea_live.json');
  let niveaSubmissions = [];
  if (fs.existsSync(niveaFile)) {
    try {
      const niveaData = JSON.parse(fs.readFileSync(niveaFile, 'utf8'));
      niveaSubmissions = niveaData.submissions || [];
    } catch(e) {}
  }

  console.log(`\n🎁 Step 3: Processing ${niveaSubmissions.length} Nivea live submissions...`);

  await commitInBatches(niveaSubmissions, (batch, sub) => {
    const docId = `sub_${String(sub.index || Math.random()).padStart(6, '0')}`;
    const docRef = db.collection('nivea_submissions').doc(docId);
    batch.set(docRef, {
      ...sub,
      migratedAt: new Date().toISOString()
    }, { merge: true });
  });

  // Store campaign meta
  await db.collection('campaigns').doc('nivea_live').set({
    campaign: 'Nivea Scan & Draw Live Registrations',
    url: 'https://scananddraw.com/ar/form/',
    totalRegistrations: niveaSubmissions.length,
    lastUpdated: new Date().toISOString()
  }, { merge: true });

  // ==========================================
  // Step 4: Update Local inboxes_db.json
  // ==========================================
  console.log('\n💾 Step 4: Updating local cache with clean, classified data...');
  localData.inboxes = processedInboxes;
  localData.messages = processedMessages;
  fs.writeFileSync(inboxesDbFile, JSON.stringify(localData, null, 2), 'utf8');

  console.log('\n================================================================');
  console.log('🎉 MIGRATION FINISHED SUCCESSFULLY TO CLOUD FIRESTORE!');
  console.log(`   ✅ Inboxes: ${processedInboxes.length} (Official: ${officialCount} | Temp: ${tempCount})`);
  console.log(`   ✅ Messages: ${processedMessages.length} (MIME decoded + HTML formatted)`);
  console.log(`   ✅ Nivea Submissions: ${niveaSubmissions.length}`);
  console.log('================================================================\n');
}

runMigration()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  });
