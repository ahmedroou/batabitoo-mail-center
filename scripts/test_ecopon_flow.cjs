const { chromium } = require('playwright');
const path = require('path');
const db = require('../InboxDatabase');

async function main() {
  await new Promise(r => setTimeout(r, 1500));

  const inboxes = db.getAllInboxes();
  console.log('Loaded inboxes:', inboxes.length);

  const testInbox = inboxes.find(i => i.email.endsWith('@batabitoo.com')) || inboxes[0];
  console.log('Testing with email:', testInbox.email);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
  });
  const page = await context.newPage();

  page.on('response', async res => {
    if (res.url().includes('login') || res.url().includes('v1')) {
      console.log('API Response:', res.status(), res.url());
      try {
        const json = await res.json();
        console.log('Response body:', JSON.stringify(json).substring(0, 200));
      } catch (e) {}
    }
  });

  const url = 'https://forms.e-copon.com/t/cLdL5XA3tyus?token=B3817815493F03D4C50D8A4275176520DFD98EB6E6DEE15ED099D9267BBC6ED6';
  console.log('Navigating to', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('Page loaded, waiting for email input...');

  await page.waitForSelector('input', { timeout: 15000 });
  await page.waitForTimeout(1500);

  const inputs = await page.$$('input');
  console.log(`Found ${inputs.length} inputs`);

  // Type email into the first text/email input
  for (const inp of inputs) {
    const type = await inp.getAttribute('type');
    const placeholder = await inp.getAttribute('placeholder');
    console.log(`Input: type=${type}, placeholder=${placeholder}`);
    if (type === 'email' || type === 'text') {
      console.log('Typing email into input...');
      await inp.fill(testInbox.email);
      break;
    }
  }

  await page.waitForTimeout(1000);

  // Find buttons
  const buttons = await page.$$('button');
  console.log(`Found ${buttons.length} buttons`);
  for (const b of buttons) {
    const txt = (await b.innerText()).trim();
    console.log('Button text:', txt);
    if (txt.includes('تحقق') || txt.includes('Verify') || txt.includes('Log in') || txt.includes('دخول') || txt.includes('استمر') || txt.includes('Continue')) {
      console.log('Clicking button:', txt);
      await b.click();
      break;
    }
  }

  console.log('Waiting 5s to see what happens...');
  await page.waitForTimeout(5000);
  const textAfter = await page.innerText('body');
  console.log('Page text after clicking verify:\n', textAfter);
  await page.screenshot({ path: path.join(__dirname, 'test_ecopon_step1.png') });

  await browser.close();
}

main().catch(console.error);
