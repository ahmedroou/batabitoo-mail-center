/**
 * Auto Ecopon Runner - Gold Wins with Al Borg
 * Automated Headless Automation & Verification Engine
 * Target: https://forms.e-copon.com/t/cLdL5XA3tyus?token=B3817815493F03D4C50D8A4275176520DFD98EB6E6DEE15ED099D9267BBC6ED6
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const db = require('../InboxDatabase');
const RealInboxService = require('../RealInboxService');

const realService = new RealInboxService();
const RESULTS_FILE = path.join(__dirname, '../results_ecopon_alborg_live.json');

const MALE_FIRST_NAMES = [
  'محمد', 'عبدالله', 'أحمد', 'خالد', 'سعد', 'فهد', 'سلمان', 'عبدالعزيز', 'سلطان', 'فيصل',
  'عمر', 'علي', 'إبراهيم', 'تركي', 'بندر', 'مشاري', 'سعود', 'منصور', 'صالح', 'حمد',
  'ياسر', 'نايف', 'وليد', 'بدر', 'ناصر', 'ماجد', 'فارس', 'زياد', 'ريان', 'طلال',
  'طارق', 'حسام', 'مهند', 'باسم', 'هيثم', 'مازن', 'عادل', 'حاتم', 'سامي', 'عماد'
];

const FEMALE_FIRST_NAMES = [
  'سارة', 'نورة', 'ريم', 'منى', 'هند', 'مها', 'عبير', 'غادة', 'خلود', 'أسماء',
  'أمل', 'شهد', 'فاطمة', 'لطيفة', 'لمى', 'دانة', 'جواهر', 'رهف', 'العنود', 'هيا',
  'مريم', 'وفاء', 'منيرة', 'أريج', 'بيان', 'أفنان', 'هالة', 'رنا', 'نجلاء', 'حنان',
  'روان', 'شذى', 'خلود', 'تسنيم', 'يارا', 'لجين', 'سحر', 'ليلى', 'أروى', 'بدور'
];

const FATHER_NAMES = [
  'محمد', 'عبدالله', 'أحمد', 'علي', 'خالد', 'سعد', 'فهد', 'صالح', 'إبراهيم', 'حسن',
  'سلمان', 'ناصر', 'عبدالعزيز', 'منصور', 'سلطان', 'حمد', 'عمر', 'عبدالرحمن', 'يوسف', 'سالم',
  'ماجد', 'سعود', 'فارس', 'بندر', 'تركي', 'وليد', 'طارق', 'فيصل', 'عثمان', 'سعيد'
];

const FAMILY_NAMES = [
  'القحطاني', 'العتيبي', 'الدوسري', 'الشهري', 'الحربي', 'الشمري', 'الغامدي', 'الزهراني',
  'المطيري', 'العنزي', 'السبيعي', 'الخالدي', 'المالكي', 'العسيري', 'التميمي', 'الرشيدي',
  'الجهني', 'العمري', 'القرني', 'السالمي', 'الشهراني', 'الظفيري', 'السهلي', 'الحازمي',
  'البقمي', 'الفيفي', 'الثبيتي', 'الخثعمي', 'الغامدي', 'الهذلي', 'البلوي', 'البارقي'
];

function generateSaudiPerson(email = '') {
  const isFemale = /sara|noura|reem|maha|hind|fatima|amal|shatha|shaza|ghyda|mona|rawan|bayan|afnan|latifa|hajar|abeer|khulood|asmaa|monira|arwa|dana|jawaher|rahaf|anoud|haya|maryam|wafaa|layla|bdoor|tasneem|yara/i.test(email);
  const firstList = isFemale ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES;
  
  const firstName = firstList[Math.floor(Math.random() * firstList.length)];
  const fatherName = FATHER_NAMES[Math.floor(Math.random() * FATHER_NAMES.length)];
  const familyName = FAMILY_NAMES[Math.floor(Math.random() * FAMILY_NAMES.length)];
  const fullName = `${firstName} ${fatherName} ${familyName}`;

  // Phone: 9 digits starting with 5
  const prefixes = ['50', '53', '54', '55', '56', '57', '58', '59'];
  const pfx = prefixes[Math.floor(Math.random() * prefixes.length)];
  const rest = Math.floor(1000000 + Math.random() * 9000000).toString().substring(0, 7);
  const phone = `${pfx}${rest}`;

  // ID: 10 digits starting with 1 (Citizen) or 2 (Resident)
  const idPrefix = Math.random() > 0.15 ? '1' : '2';
  const idRest = Math.floor(100000000 + Math.random() * 900000000).toString();
  const saudiId = `${idPrefix}${idRest}`;

  return {
    isFemale,
    genderText: isFemale ? 'Female | أنثى' : 'Male | ذكر',
    fullName,
    phone,
    saudiId
  };
}

function loadResults() {
  if (fs.existsSync(RESULTS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    } catch (e) {}
  }
  return {
    campaign: 'Gold Wins with Al Borg - سحب جائزة ذهب',
    formUrl: 'https://forms.e-copon.com/t/cLdL5XA3tyus?token=B3817815493F03D4C50D8A4275176520DFD98EB6E6DEE15ED099D9267BBC6ED6',
    lastUpdated: new Date().toISOString(),
    totalRegistrations: 0,
    submissions: []
  };
}

function saveResults(data) {
  data.lastUpdated = new Date().toISOString();
  data.totalRegistrations = data.submissions.length;
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2), 'utf8');

  // Sync to Firestore if connected
  if (db.isCloudConnected && db.db) {
    try {
      const summaryDoc = {
        campaign: data.campaign,
        totalRegistrations: data.totalRegistrations,
        lastUpdated: data.lastUpdated,
        formUrl: data.formUrl
      };
      db.db.collection('ecopon_campaigns').doc('alborg_gold').set(summaryDoc, { merge: true }).catch(() => {});
    } catch (e) {}
  }
}

async function createFreshMailTmInbox() {
  return new Promise((resolve, reject) => {
    const rand = Math.floor(10000 + Math.random() * 90000);
    const email = 'sa' + rand + '@uberip.com';
    const password = 'Pass' + Math.floor(100000 + Math.random() * 900000) + '!';
    const postData = JSON.stringify({ address: email, password: password });
    
    const req = https.request({
      hostname: 'api.mail.tm',
      path: '/accounts',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        const req2 = https.request({
          hostname: 'api.mail.tm',
          path: '/token',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        }, r2 => {
          let d2 = '';
          r2.on('data', c => d2 += c);
          r2.on('end', () => {
            try {
              const parsed = JSON.parse(d2);
              if (parsed.token) {
                resolve({ email, password, host: 'api.mail.tm', provider: 'api.mail.tm', token: parsed.token });
              } else {
                reject(new Error('No token returned: ' + d2));
              }
            } catch (err) {
              reject(err);
            }
          });
        });
        req2.write(postData);
        req2.end();
      });
    });
    req.write(postData);
    req.end();
  });
}

async function participateWithAccount(page, inbox) {
  const person = generateSaudiPerson(inbox.email);

  console.log(`\n======================================================`);
  console.log(`🚀 Starting Participation for: ${inbox.email}`);
  console.log(`👤 Profile: ${person.fullName} | ${person.genderText} | Phone: ${person.phone} | ID: ${person.saudiId}`);
  console.log(`======================================================`);

  const url = 'https://forms.e-copon.com/t/cLdL5XA3tyus?token=B3817815493F03D4C50D8A4275176520DFD98EB6E6DEE15ED099D9267BBC6ED6';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);

  // Accept cookies non-destructively
  const cookieBtn = page.locator('button:has-text("أقبل"), button:has-text("Accept")').first();
  if (await cookieBtn.count() > 0) {
    await cookieBtn.click().catch(() => {});
  }

  // Hide sticky banners via CSS so React fiber tree remains intact
  await page.addStyleTag({
    content: '.fixed.bottom-0 { pointer-events: none !important; opacity: 0 !important; }'
  });

  // STEP 1: Enter email
  console.log('📝 Step 1: Entering email...');
  const emailInput = page.locator('input[type="email"], input[type="text"]').first();
  await emailInput.fill(inbox.email);
  await page.waitForTimeout(300);

  const verifyBtn = page.locator('button:has-text("تحقق"), button:has-text("Verify"), button:has-text("دخول")').first();
  if (await verifyBtn.count() > 0) {
    await verifyBtn.click();
  } else {
    await page.keyboard.press('Enter');
  }

  // STEP 2: Wait & Extract OTP
  console.log('⏳ Waiting for OTP in inbox...');
  let otp = null;
  for (let attempt = 1; attempt <= 15; attempt++) {
    await page.waitForTimeout(2500);
    try {
      const msgs = await realService.getMessages(inbox);
      if (msgs && msgs.length > 0) {
        msgs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        for (const m of msgs) {
          const full = await realService.getMessage(inbox, m.id);
          const content = (full.text || full.intro || '') + ' ' + (full.subject || '');
          const match = content.match(/\b\d{6}\b/);
          if (match) {
            otp = match[0];
            console.log(`🎉 [Attempt ${attempt}] Extracted OTP Code: ${otp}`);
            break;
          }
        }
      }
    } catch (pollErr) {
      console.warn(`⚠️ Polling error [attempt ${attempt}]:`, pollErr.message);
    }
    if (otp) break;
  }

  if (!otp) throw new Error(`OTP timeout: No verification code arrived for ${inbox.email}`);

  // STEP 3: Enter OTP
  console.log('🔢 Entering 6-digit OTP...');
  const pinInputs = await page.$$('input[aria-label*="pin" i], input[placeholder="o"]');
  if (pinInputs.length > 0) {
    await pinInputs[0].click();
    for (const c of otp) {
      await page.keyboard.press(c);
      await page.waitForTimeout(100);
    }
  }

  await page.waitForTimeout(2000);

  // Click continue button if present
  const continueBtn = page.locator('button:has-text("استمر"), button:has-text("Continue")').first();
  if (await continueBtn.count() > 0 && await continueBtn.isVisible()) {
    await continueBtn.click().catch(() => {});
  }

  await page.waitForTimeout(2500);

  // STEP 4: Resume / Start New Submission prompt if present
  let bodyText = await page.innerText('body');
  if (bodyText.includes('تقديم جديد') || bodyText.includes('استئناف التقديم')) {
    console.log('🔄 Selecting start new submission...');
    const btn = page.locator('button:has-text("تقديم جديد"), button:has-text("استئناف التقديم")').first();
    await btn.click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  // STEP 5: Terms & Conditions loop until Demographics is reached
  for (let tRetry = 0; tRetry < 3; tRetry++) {
    const curBody = await page.innerText('body');
    if (curBody.includes('الموافقة على الشروط')) {
      console.log('📜 Step 2: Agreeing to Terms & Conditions...');
      const checkbox = page.locator('input[type="checkbox"], [role="checkbox"]').first();
      if (await checkbox.count() > 0) {
        await checkbox.click({ force: true }).catch(() => {});
      } else {
        await page.locator('text=الموافقة على الشروط').first().click({ force: true }).catch(() => {});
      }
      await page.waitForTimeout(600);

      const nextBtn = page.locator('button:has-text("التالي"), button:has-text("Next")').first();
      if (await nextBtn.count() > 0) {
        await nextBtn.click({ force: true }).catch(() => {});
      }
      await page.waitForTimeout(2000);
    } else {
      break;
    }
  }

  // Wait for demographics input
  await page.waitForSelector('input[type="tel"], input[placeholder*="محمد"], input[aria-label*="الاسم" i]', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // STEP 6: Demographics Information
  console.log('📋 Step 3: Filling Demographics Information...');
  // 1. Full Name
  const nameLocator = page.locator('input[placeholder*="محمد"], input[aria-label*="الاسم" i]').first();
  if (await nameLocator.count() > 0 && await nameLocator.isVisible()) {
    await nameLocator.fill(person.fullName);
  } else {
    const textInputs = page.locator('input[type="text"]:not([id*="react-select"])');
    if (await textInputs.count() > 0 && await textInputs.first().isVisible()) {
      await textInputs.first().fill(person.fullName);
    }
  }

  // 2. Phone
  const phoneLocator = page.locator('input[type="tel"]').first();
  if (await phoneLocator.count() > 0 && await phoneLocator.isVisible()) {
    await phoneLocator.fill(person.phone);
  }

  // 3. National ID
  const idLocator = page.locator('input[placeholder*="10"], input[aria-label*="هوية" i], input[aria-label*="إقامة" i]').first();
  if (await idLocator.count() > 0 && await idLocator.isVisible()) {
    await idLocator.fill(person.saudiId);
  } else {
    const textInputs = page.locator('input[type="text"]:not([id*="react-select"])');
    if (await textInputs.count() > 1 && await textInputs.nth(1).isVisible()) {
      await textInputs.nth(1).fill(person.saudiId);
    }
  }

  // 4. Gender Selection via react-select input typing filter
  console.log(`🚻 Selecting Gender: ${person.genderText}`);
  const selectControl = page.locator('input[id*="react-select"]').first();
  if (await selectControl.count() > 0 && await selectControl.isVisible()) {
    await selectControl.focus();
    await page.keyboard.type(person.isFemale ? 'Female' : 'Male', { delay: 100 });
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
  }

  await page.waitForTimeout(800);

  // STEP 7: Submit Participation Request
  console.log('📤 Submitting Participation Request...');
  const submitBtn = page.locator('button:has-text("ارسال"), button:has-text("المشاركة"), button:has-text("Submit")').first();
  if (await submitBtn.count() > 0) {
    await submitBtn.click();
  }

  await page.waitForTimeout(6000);

  // VERIFY ENDING
  const endingBody = await page.innerText('body');
  const isSuccess = endingBody.includes('شكرا لك') || endingBody.includes('تمت المشاركة') || endingBody.includes('Thank you') || endingBody.includes('بنجاح') || endingBody.includes('eCopon');

  if (isSuccess) {
    console.log(`✅ SUCCESS! Registered ${inbox.email} successfully!`);
    const record = {
      email: inbox.email,
      fullName: person.fullName,
      phone: person.phone,
      saudiId: person.saudiId,
      gender: person.genderText,
      status: 'submitted',
      submittedAt: new Date().toISOString()
    };
    return { success: true, record };
  } else {
    console.warn(`⚠️ Submission ending status inconclusive for ${inbox.email}. Page snippet: ${endingBody.substring(0, 150)}`);
    return { success: false, reason: 'Confirmation text missing' };
  }
}

async function runAutoEcopon(limit = 100) {
  await db.ready();
  console.log('================================================================');
  console.log('🏆 STARTING ECOPON AL BORG GOLD AUTOMATION ENGINE');
  console.log(`🎯 Target Submissions: ${limit}`);
  console.log('================================================================\n');

  const results = loadResults();
  const completedEmails = new Set(results.submissions.map(s => s.email.toLowerCase()));
  console.log(`📊 Already completed submissions: ${completedEmails.size}`);

  // Gather eligible inboxes (filter strictly for active api.mail.tm)
  const inboxesToUse = [];

  // Existing usable inboxes come exclusively from the active Firestore dataset.
  for (const ib of db.getTempInboxes()) {
    if (ib.host === 'api.mail.tm' && !completedEmails.has(ib.email.toLowerCase())) {
      if (!inboxesToUse.some(x => x.email.toLowerCase() === ib.email.toLowerCase())) {
        inboxesToUse.push(ib);
      }
    }
  }

  console.log(`📦 Available existing usable inboxes: ${inboxesToUse.length}`);

  const browser = await chromium.launch({ headless: true });
  let successCount = 0;
  let failCount = 0;

  try {
    let index = 0;
    while (results.submissions.length < limit && (index < inboxesToUse.length || true)) {
      let currentInbox = inboxesToUse[index];

      // If we ran out of existing inboxes or need a fresh one dynamically
      if (!currentInbox) {
        console.log(`✨ Creating fresh account on uberip.com for slot ${results.submissions.length + 1}/${limit}...`);
        try {
          currentInbox = await createFreshMailTmInbox();
          await db.saveInbox({
            id: `tm_${Date.now()}`,
            email: currentInbox.email,
            password: currentInbox.password,
            token: currentInbox.token,
            host: 'api.mail.tm',
            provider: 'api.mail.tm',
            domain: 'uberip.com',
            type: 'temp',
            createdAt: new Date().toISOString()
          });
        } catch (createErr) {
          console.error('❌ Failed to create fresh inbox:', createErr.message);
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
      }

      index++;
      if (completedEmails.has(currentInbox.email.toLowerCase())) continue;

      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
      });
      const page = await context.newPage();

      try {
        const result = await participateWithAccount(page, currentInbox);
        if (result && result.success) {
          successCount++;
          completedEmails.add(currentInbox.email.toLowerCase());
          results.submissions.push(result.record);
          saveResults(results);
          console.log(`🎉 Progress: [${results.submissions.length} / ${limit}] (${successCount} successful in current batch, ${failCount} failed)`);
        } else {
          failCount++;
        }
      } catch (accErr) {
        console.error(`❌ Error on account ${currentInbox.email}:`, accErr.message);
        failCount++;
      } finally {
        await context.close().catch(() => {});
      }

      // 2s delay between accounts
      await new Promise(r => setTimeout(r, 2000));
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log('\n================================================================');
  console.log(`🏁 AUTOMATION BATCH FINISHED!`);
  console.log(`📊 Total Submissions Stored: ${results.submissions.length}`);
  console.log(`✅ Successful in this batch: ${successCount}`);
  console.log(`❌ Failed in this batch: ${failCount}`);
  console.log('================================================================\n');
}

// Run directly if invoked from CLI
if (require.main === module) {
  const targetCount = parseInt(process.argv[2], 10) || 50;
  runAutoEcopon(targetCount).catch(console.error);
}

module.exports = { runAutoEcopon, participateWithAccount };
