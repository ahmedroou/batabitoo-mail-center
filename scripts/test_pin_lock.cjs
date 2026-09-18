const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // Mobile iPhone 14/15 size
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();

  console.log('1. Loading localhost:3030 ...');
  await page.goto('http://localhost:3030', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // Take screenshot of locked screen
  await page.screenshot({ path: path.join(__dirname, 'pin_locked_screen.png') });
  console.log('📸 Saved pin_locked_screen.png');

  // Verify PIN overlay is visible
  const isOverlayVisible = await page.isVisible('#pin-lock-overlay');
  console.log('Is lock overlay visible?:', isOverlayVisible);

  // Test typing wrong PIN 1234
  console.log('2. Entering wrong PIN 1234 ...');
  await page.click('#pin-keypad button[data-digit="1"]');
  await page.click('#pin-keypad button[data-digit="2"]');
  await page.click('#pin-keypad button[data-digit="3"]');
  await page.click('#pin-keypad button[data-digit="4"]');
  await page.waitForTimeout(500);

  const errorVisible = await page.isVisible('#pin-error-msg:not(.hidden)');
  console.log('Is error message visible on wrong PIN?:', errorVisible);

  // Take screenshot of error state
  await page.screenshot({ path: path.join(__dirname, 'pin_error_state.png') });
  console.log('📸 Saved pin_error_state.png');

  // Test typing correct PIN 0530
  console.log('3. Entering correct PIN 0530 ...');
  await page.click('#pin-keypad button[data-digit="0"]');
  await page.click('#pin-keypad button[data-digit="5"]');
  await page.click('#pin-keypad button[data-digit="3"]');
  await page.click('#pin-keypad button[data-digit="0"]');
  await page.waitForTimeout(1000);

  // Check if unlocked
  const isUnlocked = await page.evaluate(() => {
    return document.getElementById('pin-lock-overlay').classList.contains('unlocked');
  });
  console.log('Is app unlocked?:', isUnlocked);

  // Take screenshot of unlocked app
  await page.screenshot({ path: path.join(__dirname, 'pin_unlocked_app.png') });
  console.log('📸 Saved pin_unlocked_app.png');

  await browser.close();
  console.log('✅ PIN Lock verification complete!');
})();
