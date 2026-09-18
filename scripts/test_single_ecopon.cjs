const { chromium } = require('playwright');
const path = require('path');
const db = require('../InboxDatabase');
const defaultTempSync = require('../TempSyncService');
const RealInboxService = require('../RealInboxService');

const realService = new RealInboxService();

async function main() {
  console.log('--- TESTING SINGLE ECOPON SUBMISSION ---');
  
  const fs = require('fs');
  const b = JSON.parse(fs.readFileSync(path.join(__dirname, '../inboxes_db.backup.json')));
  const inbox = b.inboxes.find(i => i.host === 'api.mail.tm' && i.email.endsWith('@emalupe.com'));
  console.log('Testing with Mail.tm Inbox:', inbox.email);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
  });
  const page = await context.newPage();

  const url = 'https://forms.e-copon.com/t/cLdL5XA3tyus?token=B3817815493F03D4C50D8A4275176520DFD98EB6E6DEE15ED099D9267BBC6ED6';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('input', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Enter email
  const emailInput = await page.$('input[type="email"], input[type="text"]');
  await emailInput.fill(inbox.email);
  await page.waitForTimeout(500);

  // Click verify
  const buttons = await page.$$('button');
  for (const b of buttons) {
    const txt = (await b.innerText()).trim();
    if (txt.includes('تحقق') || txt.includes('Verify') || txt.includes('Log in') || txt.includes('دخول')) {
      await b.click();
      break;
    }
  }

  console.log('Submitted email, waiting for OTP to arrive in inbox...');
  let otp = null;
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(3000);
    process.stdout.write(`Polling [${i+1}/15]... `);
    const msgs = await realService.getMessages(inbox);
    console.log(`Found ${msgs.length} messages`);
    if (msgs.length > 0) {
      // Find security code message
      for (const m of msgs) {
        console.log('Subject:', m.subject, 'From:', JSON.stringify(m.from));
        const full = await realService.getMessage(inbox, m.id);
        const text = (full.text || full.intro || '') + ' ' + (full.subject || '');
        console.log('Message text snippet:', text.substring(0, 150));
        const match = text.match(/\b\d{6}\b/) || (full.subject && full.subject.match(/\b\d{6}\b/));
        if (match) {
          otp = match[0];
          console.log('🎉 FOUND OTP CODE:', otp);
          break;
        }
      }
      if (otp) break;
    }
  }

  if (otp) {
    console.log('Typing OTP code into page...');
    // Look for 6 pin inputs
    const pinInputs = await page.$$('input[aria-label*="pin" i], input[placeholder="o"], input[type="text"]');
    console.log(`Found ${pinInputs.length} potential pin inputs`);
    if (pinInputs.length >= 6) {
      for (let i = 0; i < 6; i++) {
        await pinInputs[i].fill(otp[i]);
        await page.waitForTimeout(100);
      }
    } else if (pinInputs.length > 0) {
      await pinInputs[0].fill(otp);
    }

    await page.waitForTimeout(1000);
    // Look for continue button
    const contButtons = await page.$$('button');
    for (const b of contButtons) {
      const txt = (await b.innerText()).trim();
      if (txt.includes('استمر') || txt.includes('Continue') || txt.includes('التالي')) {
        console.log('Clicking continue button:', txt);
        await b.click();
        break;
      }
    }

    await page.waitForTimeout(3000);
    console.log('--- STEP 2: TERMS AND CONDITIONS ---');
    // Find checkbox
    const checkbox = await page.$('input[type="checkbox"], [role="checkbox"]');
    if (checkbox) {
      console.log('Checking terms checkbox...');
      await checkbox.click();
      await page.waitForTimeout(500);
    }

    // Click Next
    const nextBtn = await page.$('button[type="button"], button[type="submit"]');
    const allButtons = await page.$$('button');
    for (const b of allButtons) {
      const txt = (await b.innerText()).trim();
      if (txt.includes('التالي') || txt.includes('Next')) {
        console.log('Clicking Next button:', txt);
        await b.click();
        break;
      }
    }

    await page.waitForTimeout(3000);
    console.log('--- CHECKING IF IN-PROGRESS MODAL OR QUESTIONS ---');
    const bodyText = await page.innerText('body');
    if (bodyText.includes('استئناف التقديم') || bodyText.includes('تقديم جديد')) {
      console.log('Found resume/new prompt, clicking استئناف التقديم or تقديم جديد...');
      const btns = await page.$$('button');
      for (const b of btns) {
        const txt = (await b.innerText()).trim();
        if (txt.includes('استئناف التقديم') || txt.includes('تقديم جديد') || txt.includes('Resume') || txt.includes('Start new')) {
          console.log('Clicking button:', txt);
          await b.click();
          break;
        }
      }
      await page.waitForTimeout(3000);
    }

    console.log('--- FORM STEP 3 (INFO FIELDS) ---');
    console.log('Page Text:\n', await page.innerText('body'));

    const allInputs = await page.$$eval('input, select, textarea, button', els => els.map(e => ({
      tag: e.tagName,
      type: e.type,
      id: e.id,
      name: e.name,
      placeholder: e.placeholder,
      ariaLabel: e.getAttribute('aria-label'),
      text: e.innerText ? e.innerText.trim() : ''
    })));
    console.log('All interactive elements:', JSON.stringify(allInputs, null, 2));

    await page.screenshot({ path: path.join(__dirname, 'test_ecopon_step3_full.png') });
  } else {
    console.log('❌ No OTP received within 45 seconds');
  }

  await browser.close();
}

main().catch(console.error);
