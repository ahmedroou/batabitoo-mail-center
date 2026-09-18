const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true
  });
  const page = await context.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  console.log('Navigating to live https://batabitoo-mail-2026.web.app...');
  await page.goto('https://batabitoo-mail-2026.web.app', { waitUntil: 'networkidle' });

  console.log('Opening create modal on live site...');
  await page.click('#new-inbox-top');
  await page.waitForTimeout(600);

  console.log('Clicking gmail button...');
  await page.click('[data-create-type="gmail"]');
  await page.waitForTimeout(600);

  const isGmailSectionVisible = await page.isVisible('#gmail-connect-section');
  const isCreateFormVisible = await page.isVisible('#create-form');
  console.log('Is #gmail-connect-section visible?', isGmailSectionVisible);
  console.log('Is #create-form visible?', isCreateFormVisible);

  const htmlContent = await page.innerHTML('#create-modal');
  console.log('Modal inner HTML sample:', htmlContent.substring(0, 300));

  const ss = path.resolve('live_test_gmail_click.png');
  await page.screenshot({ path: ss });
  console.log('Saved live screenshot to', ss);

  await browser.close();
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
