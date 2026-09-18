const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(msg.text()));
  page.on('pageerror', err => consoleLogs.push('PAGEERROR: ' + err.message));

  console.log('Navigating to live production...');
  await page.goto('https://batabitoo-mail-2026.web.app', { waitUntil: 'networkidle' });

  // Enter PIN 0530
  console.log('Entering PIN 0530...');
  for (const digit of ['0', '5', '3', '0']) {
    await page.click(`button.pin-key[data-digit="${digit}"]`);
    await page.waitForTimeout(120);
  }

  await page.waitForTimeout(1000);
  const isUnlocked = await page.evaluate(() => document.getElementById('pin-lock-overlay').classList.contains('unlocked'));
  console.log('Is Unlocked?', isUnlocked);

  // Click new inbox button
  console.log('Opening create inbox modal...');
  await page.click('#new-inbox-top');
  await page.waitForTimeout(500);

  // Click Gmail pill
  console.log('Switching to Gmail tab...');
  await page.click('[data-create-type="gmail"]');
  await page.waitForTimeout(500);

  const oauthBtnVisible = await page.isVisible('#start-google-oauth-btn');
  console.log('Google OAuth button visible?', oauthBtnVisible);

  await page.screenshot({ path: 'scripts/live_gmail_verified.png' });
  console.log('Screenshot saved to scripts/live_gmail_verified.png');

  console.log('Errors logged:');
  const errors = consoleLogs.filter(l => l.includes('PAGEERROR') || l.toLowerCase().includes('uncaught'));
  console.log(errors.length ? errors : 'None! Completely error free.');

  await browser.close();
})();
