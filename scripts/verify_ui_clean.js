const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  
  console.log('Navigating to live web app...');
  await page.goto('https://batabitoo-mail-2026.web.app/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Keypad PIN entry
  const keypad = page.locator('#pin-keypad');
  if (await keypad.isVisible()) {
    console.log('Entering PIN via keypad: 0 5 3 0...');
    await page.click('#pin-keypad button[data-digit="0"]');
    await page.click('#pin-keypad button[data-digit="5"]');
    await page.click('#pin-keypad button[data-digit="3"]');
    await page.click('#pin-keypad button[data-digit="0"]');
    await page.waitForTimeout(3000);
  }

  // Official tab
  const officialTab = page.locator('button[data-inbox-type="official"]');
  if (await officialTab.isVisible()) {
    await officialTab.click();
    await page.waitForTimeout(1500);
  }

  const officialCount = await page.innerText('#official-count');
  console.log('Live Official count in UI:', officialCount);

  const inboxes = await page.$$eval('#inbox-list .inbox-item, #inbox-list .inbox-card', els => {
    return els.map(el => {
      const email = el.querySelector('.inbox-email, .email, h4')?.textContent?.trim();
      return email || el.textContent.replace(/\s+/g, ' ').trim();
    });
  });

  console.log('Visible inboxes count:', inboxes.length);
  console.log('Official inboxes:', inboxes);

  // Save screenshot to artifact directory
  const artifactDir = 'C:/Users/ayami/.gemini/antigravity/brain/8f7d1285-40f9-49c3-b4ea-5e20916cd558';
  const screenshotPath = path.join(artifactDir, 'live_cleaned_verified.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log('Screenshot saved to:', screenshotPath);

  await browser.close();
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
