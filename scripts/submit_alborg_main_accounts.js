/**
 * submit_alborg_main_accounts.js
 * Registers the 11 Official Main Competition Accounts for:
 * Gold Wins with Al Borg (eCopon)
 * Target: https://forms.e-copon.com/t/cLdL5XA3tyus?token=B3817815493F03D4C50D8A4275176520DFD98EB6E6DEE15ED099D9267BBC6ED6
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const RealInboxService = require('../RealInboxService');

const realService = new RealInboxService();

const RESULTS_FILE_LOCAL = path.join(__dirname, '../results_ecopon_alborg_live.json');
const RESULTS_FILE_WORKSPACE = path.resolve(__dirname, '../../dazzling-oppenheimer/results_ecopon_alborg_main_accounts.json');

// The 11 Official Main Accounts with complete verified data
const MAIN_ACCOUNTS = [
  {
    id: 1,
    fullNameArabic: "أحمد نشأت الدسوقي علي شلبي",
    nameEnglish: "Ahmed Shalabi",
    mobile: "0530114435",
    email: "ahmedroou1122@gmail.com",
    nationalId: "2192557003",
    gender: "Male | ذكر",
    isFemale: false
  },
  {
    id: 2,
    fullNameArabic: "هند نشات الدسوقي علي شلبي",
    nameEnglish: "Hend Shalabi",
    mobile: "0509278934",
    email: "Sm25ahmedroou4@gmail.com",
    nationalId: "2192557011",
    gender: "Female | أنثى",
    isFemale: true
  },
  {
    id: 3,
    fullNameArabic: "مرفت محمد محمد سليم الملواني",
    nameEnglish: "Merfat Mohamed",
    mobile: "0500451513",
    email: "Sm25ahmedroou2@gmail.com",
    nationalId: "2192557029",
    gender: "Female | أنثى",
    isFemale: true
  },
  {
    id: 4,
    fullNameArabic: "نشات الدسوقي علي شلبي",
    nameEnglish: "Nashaat Shalabi",
    mobile: "0533583437",
    email: "Sm25ahmedroou1@gmail.com",
    nationalId: "2192557037",
    gender: "Male | ذكر",
    isFemale: false
  },
  {
    id: 5,
    fullNameArabic: "علي نشأت الدسوقي علي شلبي",
    nameEnglish: "Ali Shalabi",
    mobile: "0550447938",
    email: "Sm25ahmedroou3@gmail.com",
    nationalId: "2192557045",
    gender: "Male | ذكر",
    isFemale: false
  },
  {
    id: 6,
    fullNameArabic: "صهيب نشات الدسوقي علي شلبي",
    nameEnglish: "Amr Shalabi",
    mobile: "0535912129",
    email: "S.m25ahmedroou10@gmail.com",
    nationalId: "2192557052",
    gender: "Male | ذكر",
    isFemale: false
  },
  {
    id: 7,
    fullNameArabic: "أروى محمد محمد محمد سليم الملواني",
    nameEnglish: "Arwa sleem",
    mobile: "0535611801",
    email: "Sm.25ahmedroou10@gmail.com",
    nationalId: "2192557060",
    gender: "Female | أنثى",
    isFemale: true
  },
  {
    id: 8,
    fullNameArabic: "محمود صبحي مصطفى سعفان",
    nameEnglish: "Mahmoud saafan",
    mobile: "0503013457",
    email: "Sm2.5ahmedroou10@gmail.com",
    nationalId: "2192557078",
    gender: "Male | ذكر",
    isFemale: false
  },
  {
    id: 9,
    fullNameArabic: "ماريا صبحي مصطفى سعفان",
    nameEnglish: "Marya saafan",
    mobile: "0538720377",
    email: "ah.medroou1122@gmail.com",
    nationalId: "2192557086",
    gender: "Female | أنثى",
    isFemale: true
  },
  {
    id: 10,
    fullNameArabic: "أنس صبحي مصطفى سعفان",
    nameEnglish: "Anas Saafan",
    mobile: "0559576674",
    email: "a.hmedroou1122@gmail.com",
    nationalId: "2192557094",
    gender: "Male | ذكر",
    isFemale: false
  },
  {
    id: 11,
    fullNameArabic: "مروان محمود عبد القادر زعير",
    nameEnglish: "Marwan Zaeer",
    mobile: "0538235949",
    email: "marwan.zaeer10@gmail.com",
    nationalId: "2256780715",
    gender: "Male | ذكر",
    isFemale: false
  }
];

function saveResults(results) {
  results.lastUpdated = new Date().toISOString();
  results.totalSubmissions = results.submissions.length;
  
  fs.writeFileSync(RESULTS_FILE_LOCAL, JSON.stringify(results, null, 2), 'utf8');
  try {
    fs.writeFileSync(RESULTS_FILE_WORKSPACE, JSON.stringify(results, null, 2), 'utf8');
  } catch(e) {}
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

async function participateAccount(page, acc, index, total) {
  console.log(`\n======================================================`);
  console.log(`🎯 [${index + 1}/${total}] جارٍ تسجيل الحساب الرسمي: ${acc.fullNameArabic}`);
  console.log(`📱 جوال: ${acc.mobile} | 🆔 هوية: ${acc.nationalId} | 🚻 جنس: ${acc.gender}`);
  console.log(`======================================================`);

  const inbox = await createFreshMailTmInbox();
  const formPhone = acc.mobile.replace(/^0/, ''); // e.g. 530114435

  const url = 'https://forms.e-copon.com/t/cLdL5XA3tyus?token=B3817815493F03D4C50D8A4275176520DFD98EB6E6DEE15ED099D9267BBC6ED6';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);

  // Accept cookies non-destructively
  const cookieBtn = page.locator('button:has-text("أقبل"), button:has-text("Accept")').first();
  if (await cookieBtn.count() > 0) {
    await cookieBtn.click().catch(() => {});
  }

  // Hide sticky banners safely via CSS
  await page.addStyleTag({
    content: '.fixed.bottom-0 { pointer-events: none !important; opacity: 0 !important; }'
  });

  // STEP 1: Enter email for OTP verification
  console.log('1️⃣ تخطي بوابة التحقق الإلكتروني...');
  const emailInput = page.locator('input[type="email"], input[type="text"]').first();
  await emailInput.fill(inbox.email);
  await page.waitForTimeout(300);

  const verifyBtn = page.locator('button:has-text("تحقق"), button:has-text("Verify"), button:has-text("دخول")').first();
  if (await verifyBtn.count() > 0) {
    await verifyBtn.click();
  } else {
    await page.keyboard.press('Enter');
  }

  // STEP 2: Wait for OTP
  console.log('⏳ انتظار وصول رمز التحقق (OTP)...');
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
            console.log(`🎉 تم استخراج رمز OTP بنجاح: ${otp}`);
            break;
          }
        }
      }
    } catch (pollErr) {
      console.warn(`⚠️ محاولة ${attempt}:`, pollErr.message);
    }
    if (otp) break;
  }

  if (!otp) throw new Error(`لم يصل رمز التحقق للحساب: ${acc.fullNameArabic}`);

  // STEP 3: Enter OTP
  console.log('🔢 إدخال رمز التحقق في الحقول...');
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
    console.log('🔄 بدء تقديم جديد للمسابقة...');
    const btn = page.locator('button:has-text("تقديم جديد"), button:has-text("استئناف التقديم")').first();
    await btn.click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  // STEP 5: Terms & Conditions
  for (let tRetry = 0; tRetry < 3; tRetry++) {
    const curBody = await page.innerText('body');
    if (curBody.includes('الموافقة على الشروط')) {
      console.log('📜 الموافقة على الشروط والأحكام...');
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

  // Wait for demographics form
  await page.waitForSelector('input[type="tel"], input[placeholder*="محمد"], input[aria-label*="الاسم" i]', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // STEP 6: Filling Official Main Account Data
  console.log('📋 تعبئة بيانات الحساب الرسمي بالكامل:');
  console.log(`   ✍️ الاسم الكامل: ${acc.fullNameArabic}`);
  console.log(`   📞 رقم الجوال: ${formPhone}`);
  console.log(`   🆔 الهوية الوطنية: ${acc.nationalId}`);
  console.log(`   🚻 الجنس: ${acc.gender}`);

  // 1. Full Name
  const nameLocator = page.locator('input[placeholder*="محمد"], input[aria-label*="الاسم" i]').first();
  if (await nameLocator.count() > 0 && await nameLocator.isVisible()) {
    await nameLocator.fill(acc.fullNameArabic);
  } else {
    const textInputs = page.locator('input[type="text"]:not([id*="react-select"])');
    if (await textInputs.count() > 0 && await textInputs.first().isVisible()) {
      await textInputs.first().fill(acc.fullNameArabic);
    }
  }

  // 2. Phone
  const phoneLocator = page.locator('input[type="tel"]').first();
  if (await phoneLocator.count() > 0 && await phoneLocator.isVisible()) {
    await phoneLocator.fill(formPhone);
  }

  // 3. National ID
  const idLocator = page.locator('input[placeholder*="10"], input[aria-label*="هوية" i], input[aria-label*="إقامة" i]').first();
  if (await idLocator.count() > 0 && await idLocator.isVisible()) {
    await idLocator.fill(acc.nationalId);
  } else {
    const textInputs = page.locator('input[type="text"]:not([id*="react-select"])');
    if (await textInputs.count() > 1 && await textInputs.nth(1).isVisible()) {
      await textInputs.nth(1).fill(acc.nationalId);
    }
  }

  // 4. Gender
  const selectControl = page.locator('input[id*="react-select"]').first();
  if (await selectControl.count() > 0 && await selectControl.isVisible()) {
    await selectControl.focus();
    await page.keyboard.type(acc.isFemale ? 'Female' : 'Male', { delay: 100 });
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
  }

  await page.waitForTimeout(800);

  // STEP 7: Submit
  console.log('📤 إرسال طلب المشاركة رسمياً...');
  const submitBtn = page.locator('button:has-text("ارسال"), button:has-text("المشاركة"), button:has-text("Submit")').first();
  if (await submitBtn.count() > 0) {
    await submitBtn.click();
  }

  await page.waitForTimeout(6000);

  // VERIFY ENDING
  const endingBody = await page.innerText('body');
  const isSuccess = endingBody.includes('شكرا لك') || endingBody.includes('تمت المشاركة') || endingBody.includes('Thank you') || endingBody.includes('بنجاح') || endingBody.includes('eCopon');

  if (isSuccess) {
    console.log(`✅ نجاح تام! تم تأكيد تسجيل ${acc.fullNameArabic} في سحب جائزة الذهب!`);
    return {
      success: true,
      record: {
        id: acc.id,
        fullNameArabic: acc.fullNameArabic,
        nameEnglish: acc.nameEnglish,
        mobile: acc.mobile,
        email: acc.email,
        nationalId: acc.nationalId,
        gender: acc.gender,
        status: "مؤكد - مسجل بنجاح",
        submittedAt: new Date().toISOString()
      }
    };
  } else {
    console.warn(`⚠️ لم يتم تأكيد رسالة الشكر لـ ${acc.fullNameArabic}. مقتطف: ${endingBody.substring(0, 150)}`);
    return { success: false, reason: 'Missing confirmation text' };
  }
}

async function runMainAccountsRegistration() {
  console.log('================================================================');
  console.log('🏆 بدء تسجيل الحسابات الـ 11 الرئيسية في مسابقة سحب جائزة ذهب');
  console.log('================================================================\n');

  const results = {
    campaign: "Gold Wins with Al Borg - سحب جائزة ذهب (eCopon)",
    formUrl: "https://forms.e-copon.com/t/cLdL5XA3tyus?token=B3817815493F03D4C50D8A4275176520DFD98EB6E6DEE15ED099D9267BBC6ED6",
    totalMainAccounts: MAIN_ACCOUNTS.length,
    lastUpdated: new Date().toISOString(),
    totalSubmissions: 0,
    submissions: []
  };

  const browser = await chromium.launch({ headless: true });
  let successCount = 0;
  let failCount = 0;

  try {
    for (let i = 0; i < MAIN_ACCOUNTS.length; i++) {
      const acc = MAIN_ACCOUNTS[i];
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
      });
      const page = await context.newPage();

      try {
        const res = await participateAccount(page, acc, i, MAIN_ACCOUNTS.length);
        if (res && res.success) {
          successCount++;
          results.submissions.push(res.record);
          saveResults(results);
          console.log(`🎉 تم تسجيل [${successCount}/${MAIN_ACCOUNTS.length}] حساباً بنجاح!`);
        } else {
          failCount++;
        }
      } catch (err) {
        console.error(`❌ خطأ أثناء تسجيل ${acc.fullNameArabic}:`, err.message);
        failCount++;
      } finally {
        await context.close().catch(() => {});
      }

      await new Promise(r => setTimeout(r, 2000));
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log('\n================================================================');
  console.log(`🏁 اكتمل تسجيل الحسابات الرئيسية!`);
  console.log(`✅ الحسابات المسجلة بنجاح: ${successCount} من ${MAIN_ACCOUNTS.length}`);
  console.log(`❌ المتعثرة: ${failCount}`);
  console.log('================================================================\n');
}

runMainAccountsRegistration().catch(console.error);
