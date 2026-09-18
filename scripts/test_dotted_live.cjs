const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 }
  });
  const page = await context.newPage();

  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(msg.text()));
  page.on('pageerror', err => consoleLogs.push('PAGEERROR: ' + (err.stack || err.message)));

  console.log('Navigating to live production...');
  await page.goto('https://batabitoo-mail-2026.web.app', { waitUntil: 'networkidle' });

  // 1. Enter PIN 0530
  console.log('Entering PIN 0530...');
  for (const digit of ['0', '5', '3', '0']) {
    await page.click(`button.pin-key[data-digit="${digit}"]`);
    await page.waitForTimeout(100);
  }

  await page.waitForTimeout(1200);
  const isUnlocked = await page.evaluate(() => document.getElementById('pin-lock-overlay').classList.contains('unlocked'));
  console.log('Is Unlocked?', isUnlocked);

  // 2. Navigate to Amazon Hub
  console.log('Navigating to Amazon Hub...');
  await page.click('[data-mobile-view="amazon"]');
  await page.waitForTimeout(1200);

  // 3. Verify Dotted Button
  const dottedBtn = await page.isVisible('#amazon-add-dotted-btn');
  console.log('Is "+ تفريع نقطي لـ Gmail" button visible?', dottedBtn);

  // 4. Open Dotted Modal
  console.log('Clicking "+ تفريع نقطي لـ Gmail"...');
  await page.click('#amazon-add-dotted-btn');
  await page.waitForTimeout(800);

  // Screenshot 1: Modal open with chips
  await page.screenshot({ path: 'C:/Users/ayami/.gemini/antigravity/brain/8f7d1285-40f9-49c3-b4ea-5e20916cd558/live_dotted_modal_open.png' });
  console.log('Screenshot saved: live_dotted_modal_open.png');

  // Select second suggestion chip (ah.medroou1122@gmail.com)
  const chipsCount = await page.locator('.dotted-chip').count();
  console.log('Generated suggestion chips count:', chipsCount);

  if (chipsCount > 1) {
    await page.locator('.dotted-chip').nth(1).click();
    await page.waitForTimeout(300);
    const inputVal = await page.inputValue('#dotted-email-input');
    console.log('Selected dotted email in input:', inputVal);

    console.log('Submitting dotted account form...');
    await page.click('#submit-amazon-dotted-btn');
    await page.waitForTimeout(2500);
  }

  // Scroll to account reel cards
  await page.evaluate(() => {
    const el = document.getElementById('amazon-inboxes-reel');
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  await page.waitForTimeout(1000);

  // Screenshot 2: Amazon Hub showing dotted account badge
  await page.screenshot({ path: 'C:/Users/ayami/.gemini/antigravity/brain/8f7d1285-40f9-49c3-b4ea-5e20916cd558/live_amazon_dotted_hub.png' });
  console.log('Screenshot saved: live_amazon_dotted_hub.png');

  console.log('Console errors during session:');
  const errors = consoleLogs.filter(l => l.includes('PAGEERROR') || l.toLowerCase().includes('uncaught'));
  console.log(errors.length ? errors : 'None! Completely error free.');

  await browser.close();
})();
