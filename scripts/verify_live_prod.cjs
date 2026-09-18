const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  console.log('Testing live https://batabitoo-mail-2026.web.app ...');
  await page.goto('https://batabitoo-mail-2026.web.app');
  await page.click('#pin-keypad button[data-digit="0"]');
  await page.click('#pin-keypad button[data-digit="5"]');
  await page.click('#pin-keypad button[data-digit="3"]');
  await page.click('#pin-keypad button[data-digit="0"]');
  await page.waitForTimeout(3000);

  const officialText = await page.innerText('#official-count');
  const tempText = await page.innerText('#temp-count');
  const totalText = await page.innerText('#stat-total');
  console.log('LIVE Official count:', officialText);
  console.log('LIVE Temp count:', tempText);
  console.log('LIVE Total text:', totalText);

  await page.screenshot({ path: 'scripts/live_production_restored.png' });
  await browser.close();
  console.log('Done!');
})();
