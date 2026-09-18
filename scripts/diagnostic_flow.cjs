const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const RealInboxService = require('../RealInboxService');

async function main() {
  const inbox = JSON.parse(fs.readFileSync(path.join(__dirname, 'fresh_test_inbox.json')));
  const svc = new RealInboxService();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  page.on('response', async res => {
    if (res.url().includes('fillout.com/v1')) {
      console.log('HTTP:', res.status(), res.url());
    }
  });

  const url = 'https://forms.e-copon.com/t/cLdL5XA3tyus?token=B3817815493F03D4C50D8A4275176520DFD98EB6E6DEE15ED099D9267BBC6ED6';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const emailInput = await page.$('input[type="email"], input[type="text"]');
  if (emailInput) {
    console.log('Entering email:', inbox.email);
    await emailInput.fill(inbox.email);
    await page.waitForTimeout(500);
    const btns = await page.$$('button');
    for (const b of btns) {
      if ((await b.innerText()).includes('تحقق')) {
        await b.click();
        break;
      }
    }
  }

  let otp = null;
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000);
    const msgs = await svc.getMessages(inbox);
    for (const m of msgs) {
      const full = await svc.getMessage(inbox, m.id);
      const match = (full.text || full.intro || '').match(/\b\d{6}\b/);
      if (match) { otp = match[0]; break; }
    }
    if (otp) break;
  }
  console.log('Extracted OTP:', otp);

  const pinInputs = await page.$$('input[aria-label*="pin" i], input[placeholder="o"]');
  if (pinInputs.length >= 6) {
    for (let i = 0; i < 6; i++) await pinInputs[i].fill(otp[i]);
  }
  await page.waitForTimeout(1000);
  const contBtns = await page.$$('button');
  for (const b of contBtns) {
    if ((await b.innerText()).includes('استمر')) {
      await b.click();
      break;
    }
  }

  await page.waitForTimeout(5000);

  console.log('=== PAGE TEXT AFTER LOGIN ===');
  console.log(await page.innerText('body'));

  const buttons = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()));
  console.log('Buttons on page:', buttons);

  const inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input, select, textarea')).map(e => ({
    tag: e.tagName,
    type: e.type,
    id: e.id,
    placeholder: e.placeholder,
    ariaLabel: e.getAttribute('aria-label')
  })));
  console.log('Inputs on page:', inputs);

  await page.screenshot({ path: path.join(__dirname, 'diagnostic_after_login.png') });
  await browser.close();
}

main().catch(console.error);
