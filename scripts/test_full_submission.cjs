const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const RealInboxService = require('../RealInboxService');

const realService = new RealInboxService();

const MALE_FIRST_NAMES = [
  'محمد', 'عبدالله', 'أحمد', 'خالد', 'سعد', 'فهد', 'سلمان', 'عبدالعزيز', 'سلطان', 'فيصل',
  'عمر', 'علي', 'إبراهيم', 'تركي', 'بندر', 'مشاري', 'سعود', 'منصور', 'صالح', 'حمد',
  'ياسر', 'نايف', 'وليد', 'بدر', 'ناصر', 'ماجد', 'فارس', 'زياد', 'ريان', 'طلال'
];

const FEMALE_FIRST_NAMES = [
  'سارة', 'نورة', 'ريم', 'منى', 'هند', 'مها', 'عبير', 'غادة', 'خلود', 'أسماء',
  'أمل', 'شهد', 'فاطمة', 'لطيفة', 'لمى', 'دانة', 'جواهر', 'رهف', 'العنود', 'هيا',
  'مريم', 'وفاء', 'منيرة', 'أريج', 'بيان', 'أفنان', 'هالة', 'رنا', 'نجلاء', 'حنان'
];

const FATHER_NAMES = [
  'محمد', 'عبدالله', 'أحمد', 'علي', 'خالد', 'سعد', 'فهد', 'صالح', 'إبراهيم', 'حسن',
  'سلمان', 'ناصر', 'عبدالعزيز', 'منصور', 'سلطان', 'حمد', 'عمر', 'عبدالرحمن', 'يوسف', 'سالم'
];

const FAMILY_NAMES = [
  'القحطاني', 'العتيبي', 'الدوسري', 'الشهري', 'الحربي', 'الشمري', 'الغامدي', 'الزهراني',
  'المطيري', 'العنزي', 'السبيعي', 'الخالدي', 'المالكي', 'العسيري', 'التميمي', 'الرشيدي',
  'الجهني', 'العمري', 'القرني', 'السالمي', 'الغامدي', 'الشهراني', 'الظفيري', 'السهلي'
];

function generateSaudiPerson(email) {
  const isFemale = /sara|noura|reem|maha|hind|fatima|amal|shatha|shaza|ghyda|mona|rawan|bayan|afnan|latifa|hajar|abeer|khulood|asmaa|monira|arwa|dana|jawaher|rahaf|anoud|haya|maryam|wafaa/i.test(email);
  const firstList = isFemale ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES;
  
  const firstName = firstList[Math.floor(Math.random() * firstList.length)];
  const fatherName = FATHER_NAMES[Math.floor(Math.random() * FATHER_NAMES.length)];
  const familyName = FAMILY_NAMES[Math.floor(Math.random() * FAMILY_NAMES.length)];
  const fullName = `${firstName} ${fatherName} ${familyName}`;

  // Phone: 9 digits starting with 5 (e.g. 50XXXXXXX, 55XXXXXXX, 54XXXXXXX, 56XXXXXXX)
  const prefixes = ['50', '53', '54', '55', '56', '58', '59'];
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

async function dismissBanners(page) {
  try {
    await page.evaluate(() => {
      const banners = document.querySelectorAll('.fixed.bottom-0, [class*="bottom-0"], div[style*="z-index"]');
      banners.forEach(b => {
        if (b.innerText && (b.innerText.includes('أقبل') || b.innerText.includes('تعريف الارتباط') || b.innerText.includes('cookie'))) {
          b.remove();
        }
      });
    });
  } catch(e) {}
}

async function testFullSubmission() {
  const inbox = JSON.parse(fs.readFileSync(path.join(__dirname, 'fresh_test_inbox.json')));
  console.log('Target Fresh Inbox:', inbox.email);

  const person = generateSaudiPerson(inbox.email);
  console.log('Generated Profile:', person);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
  });
  const page = await context.newPage();

  page.on('response', async res => {
    if (res.url().includes('fillout.com/v1')) {
      console.log('API:', res.status(), res.url());
      try {
        const text = await res.text();
        console.log('API Response body:', text.substring(0, 300));
      } catch(e) {}
    }
  });

  const url = 'https://forms.e-copon.com/t/cLdL5XA3tyus?token=B3817815493F03D4C50D8A4275176520DFD98EB6E6DEE15ED099D9267BBC6ED6';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  await dismissBanners(page);

  // 1. Check if email login input is present
  const emailInput = await page.$('input[type="email"], input[type="text"]');
  if (emailInput) {
    console.log('Step 1: Entering email...');
    await emailInput.fill(inbox.email);
    await page.waitForTimeout(500);

    const buttons = await page.$$('button');
    for (const b of buttons) {
      const txt = (await b.innerText()).trim();
      if (txt.includes('تحقق') || txt.includes('Verify') || txt.includes('Log in') || txt.includes('دخول')) {
        await b.click();
        break;
      }
    }

    console.log('Waiting for OTP...');
    let otp = null;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(3000);
      process.stdout.write(`Polling OTP [${i+1}/15]... `);
      const msgs = await realService.getMessages(inbox);
      console.log(`Found ${msgs.length} messages`);
      if (msgs.length > 0) {
        for (const m of msgs) {
          const full = await realService.getMessage(inbox, m.id);
          const text = (full.text || full.intro || '') + ' ' + (full.subject || '');
          const match = text.match(/\b\d{6}\b/) || (full.subject && full.subject.match(/\b\d{6}\b/));
          if (match) {
            otp = match[0];
            console.log('🎉 Extracted OTP Code:', otp);
            break;
          }
        }
        if (otp) break;
      }
    }

    if (!otp) throw new Error('OTP was not received');

    // Type OTP
    const pinInputs = await page.$$('input[aria-label*="pin" i], input[placeholder="o"]');
    if (pinInputs.length >= 6) {
      for (let i = 0; i < 6; i++) {
        await pinInputs[i].fill(otp[i]);
        await page.waitForTimeout(100);
      }
    }

    await page.waitForTimeout(1000);
    const contButtons = await page.$$('button');
    for (const b of contButtons) {
      const txt = (await b.innerText()).trim();
      if (txt.includes('استمر') || txt.includes('Continue') || txt.includes('التالي')) {
        await b.click();
        break;
      }
    }
    await page.waitForTimeout(3000);
  }

  // 2. Step 2 (Terms & Conditions)
  console.log('--- STEP 2: TERMS AND CONDITIONS ---');
  await page.locator('text=الموافقة على الشروط').waitFor({ timeout: 15000 });
  await dismissBanners(page);

  console.log('Checking Terms & Conditions checkbox...');
  await page.evaluate(() => {
    const cb = document.querySelector('input[type="checkbox"], [role="checkbox"]');
    if (cb) {
      cb.click();
      cb.checked = true;
      cb.dispatchEvent(new Event('input', { bubbles: true }));
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const labels = Array.from(document.querySelectorAll('label, div')).filter(d => (d.innerText || '').includes('الموافقة على الشروط'));
    if (labels.length > 0) labels[0].click();
  });
  await page.waitForTimeout(1000);
  await dismissBanners(page);

  console.log('Clicking Next (التالي)...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button')).filter(b => {
      const t = b.innerText || '';
      return t.includes('التالي') || t.includes('Next');
    });
    if (btns.length > 0) btns[0].click();
  });

  // 3. Step 3 (Demographics Info)
  console.log('--- STEP 3: DEMOGRAPHICS INFO ---');
  await page.locator('input[type="tel"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  await dismissBanners(page);

  console.log('Filling Demographics...');
  await page.evaluate((person) => {
    const allInputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([aria-label*="pin" i])'));
    
    // 1. Name input (first text input or container with الاسم)
    const nameInput = allInputs.find(i => {
      const parent = i.closest('div[class*="field"], div[class*="form"], div[class*="container"]');
      const label = parent ? parent.innerText : '';
      return label.includes('الاسم') || (i.placeholder && i.placeholder.includes('محمد'));
    }) || document.querySelector('input[type="text"]:not([id*="react-select"])');
    
    if (nameInput) {
      nameInput.focus();
      nameInput.value = person.fullName;
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
      nameInput.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    // 2. Phone input (tel input)
    const phoneInput = document.querySelector('input[type="tel"]') || allInputs.find(i => i.type === 'tel' || (i.placeholder && i.placeholder.includes('512345678')));
    if (phoneInput) {
      phoneInput.focus();
      phoneInput.value = person.phone;
      phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
      phoneInput.dispatchEvent(new Event('change', { bubbles: true }));
      phoneInput.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    // 3. Saudi ID input (container with الهوية)
    const idInput = allInputs.find(i => {
      const parent = i.closest('div[class*="field"], div[class*="form"], div[class*="container"]');
      const label = parent ? parent.innerText : '';
      return (label.includes('الهوية') || label.includes('الإقامة') || label.includes('National ID')) && i !== nameInput;
    });
    if (idInput) {
      idInput.focus();
      idInput.value = person.saudiId;
      idInput.dispatchEvent(new Event('input', { bubbles: true }));
      idInput.dispatchEvent(new Event('change', { bubbles: true }));
      idInput.dispatchEvent(new Event('blur', { bubbles: true }));
    }
  }, person);

  await page.waitForTimeout(1000);

  // 4. Gender Dropdown
  console.log('Selecting Gender:', person.genderText);
  try {
    const dropdown = page.locator('div[class*="control" i], [class*="select__control"], input[id*="react-select"]').first();
    if (await dropdown.count() > 0) {
      await dropdown.click({ force: true });
      await page.waitForTimeout(500);
      const optionLocator = page.locator(`text=${person.genderText}`);
      if (await optionLocator.count() > 0) {
        await optionLocator.first().click({ force: true });
      } else {
        await page.locator(`text=${person.isFemale ? 'أنثى' : 'ذكر'}`).first().click({ force: true });
      }
    }
  } catch (err) {
    console.warn('Dropdown selection note:', err.message);
  }

  await page.waitForTimeout(1000);
  await dismissBanners(page);

  // 5. Submit Form
  console.log('Submitting Form...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button')).filter(b => {
      const t = b.innerText || '';
      return t.includes('ارسال') || t.includes('Submit') || t.includes('المشاركة');
    });
    if (btns.length > 0) {
      console.log('Found submit button, clicking...');
      btns[0].click();
    }
  });

  await page.waitForTimeout(6000);
  console.log('--- POST-SUBMISSION STATUS ---');
  const endingText = await page.innerText('body');
  console.log('Page text after submission:\n', endingText);

  await page.screenshot({ path: path.join(__dirname, 'ecopon_submitted_success.png') });

  const isSuccess = endingText.includes('شكرا لك') || endingText.includes('تمت المشاركة') || endingText.includes('Thank you') || endingText.includes('بنجاح');
  console.log('🎉 Is Submission Successful?', isSuccess);

  await browser.close();
}

testFullSubmission().catch(console.error);
