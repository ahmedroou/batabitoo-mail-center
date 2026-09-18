const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const RealInboxService = require('../RealInboxService');

const realService = new RealInboxService();

async function createFreshInbox() {
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

async function testGenderSelection(isFemale) {
  console.log(`\n======================================================`);
  console.log(`Testing with isFemale = ${isFemale}`);
  const inbox = await createFreshInbox();
  console.log('Inbox:', inbox.email);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
  });
  const page = await context.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  const url = 'https://forms.e-copon.com/t/cLdL5XA3tyus?token=B3817815493F03D4C50D8A4275176520DFD98EB6E6DEE15ED099D9267BBC6ED6';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);

  const cookieBtn = page.locator('button:has-text("أقبل"), button:has-text("Accept")').first();
  if (await cookieBtn.count() > 0) {
    await cookieBtn.click().catch(() => {});
  }

  await page.addStyleTag({
    content: '.fixed.bottom-0 { pointer-events: none !important; opacity: 0 !important; }'
  });

  const emailInput = page.locator('input[type="email"], input[type="text"]').first();
  await emailInput.fill(inbox.email);
  const verifyBtn = page.locator('button:has-text("تحقق"), button:has-text("Verify"), button:has-text("دخول")').first();
  if (await verifyBtn.count() > 0) {
    await verifyBtn.click();
  } else {
    await page.keyboard.press('Enter');
  }

  let otp = null;
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2500);
    const msgs = await realService.getMessages(inbox);
    if (msgs && msgs.length > 0) {
      msgs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      for (const m of msgs) {
        const full = await realService.getMessage(inbox, m.id);
        const content = (full.text || full.intro || '') + ' ' + (full.subject || '');
        const match = content.match(/\b\d{6}\b/);
        if (match) {
          otp = match[0];
          console.log('🎉 OTP FOUND:', otp);
          break;
        }
      }
    }
    if (otp) break;
  }

  const pinInputs = await page.$$('input[aria-label*="pin" i], input[placeholder="o"]');
  if (pinInputs.length > 0) {
    await pinInputs[0].click();
    for (let c of otp) {
      await page.keyboard.press(c);
      await page.waitForTimeout(100);
    }
  }

  await page.waitForTimeout(2000);
  const continueBtn = page.locator('button:has-text("استمر"), button:has-text("Continue")').first();
  if (await continueBtn.count() > 0 && await continueBtn.isVisible()) {
    await continueBtn.click();
  }

  await page.waitForTimeout(2500);
  let bodyText = await page.innerText('body');
  if (bodyText.includes('تقديم جديد') || bodyText.includes('استئناف التقديم')) {
    const btn = page.locator('button:has-text("تقديم جديد"), button:has-text("استئناف التقديم")').first();
    await btn.click();
    await page.waitForTimeout(2000);
    bodyText = await page.innerText('body');
  }

  if (bodyText.includes('الموافقة على الشروط')) {
    const checkbox = page.locator('input[type="checkbox"], [role="checkbox"]').first();
    if (await checkbox.count() > 0) {
      await checkbox.click({ force: true });
    }
    const nextBtn = page.locator('button:has-text("التالي"), button:has-text("Next")').first();
    await nextBtn.click();
    await page.waitForTimeout(3000);
  }

  // Demographics
  console.log('Filling Demographics...');
  const fullName = isFemale ? 'نورة سعد الدوسري' : 'عبدالعزيز خالد المطيري';
  const phone = isFemale ? '559812734' : '508192734';
  const saudiId = isFemale ? '1098472918' : '1084928172';

  // 1. Name
  const nameLocator = page.locator('input[placeholder*="محمد"], input[aria-label*="الاسم" i]').first();
  if (await nameLocator.count() > 0) {
    await nameLocator.fill(fullName);
  } else {
    const textInputs = page.locator('input[type="text"]:not([id*="react-select"])');
    if (await textInputs.count() > 0) {
      await textInputs.first().fill(fullName);
    }
  }

  // 2. Phone
  const phoneLocator = page.locator('input[type="tel"]').first();
  if (await phoneLocator.count() > 0) {
    await phoneLocator.fill(phone);
  }

  // 3. ID
  const idLocator = page.locator('input[placeholder*="10"], input[aria-label*="هوية" i], input[aria-label*="إقامة" i]').first();
  if (await idLocator.count() > 0) {
    await idLocator.fill(saudiId);
  } else {
    const textInputs = page.locator('input[type="text"]:not([id*="react-select"])');
    if (await textInputs.count() > 1) {
      await textInputs.nth(1).fill(saudiId);
    }
  }

  // 4. Gender Selection via typing filter into react-select
  console.log(`Selecting Gender (isFemale=${isFemale})...`);
  const selectControl = page.locator('input[id*="react-select"]').first();
  if (await selectControl.count() > 0) {
    await selectControl.focus();
    await page.keyboard.type(isFemale ? 'Female' : 'Male', { delay: 100 });
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
  }

  await page.waitForTimeout(1000);

  // Submit
  console.log('Submitting Form...');
  const submitBtn = page.locator('button:has-text("ارسال"), button:has-text("المشاركة"), button:has-text("Submit")').first();
  if (await submitBtn.count() > 0) {
    await submitBtn.click();
  }

  await page.waitForTimeout(6000);
  const finalBody = await page.innerText('body');
  const isSuccess = finalBody.includes('شكرا لك') || finalBody.includes('تمت المشاركة') || finalBody.includes('eCopon');
  console.log('RESULT:', isSuccess ? '✅ SUCCESS' : '❌ FAILED');
  console.log('PAGE BODY:\n', finalBody.substring(0, 200));

  await browser.close();
}

async function run() {
  // Test Male first
  await testGenderSelection(false);
  // Test Female
  await testGenderSelection(true);
}

run().catch(console.error);
