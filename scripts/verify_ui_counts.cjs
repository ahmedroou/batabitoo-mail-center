const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('http://localhost:3030');
  await page.click('#pin-keypad button[data-digit="0"]');
  await page.click('#pin-keypad button[data-digit="5"]');
  await page.click('#pin-keypad button[data-digit="3"]');
  await page.click('#pin-keypad button[data-digit="0"]');
  await page.waitForTimeout(2000);

  const officialCount = await page.innerText('#official-count');
  const tempCount = await page.innerText('#temp-count');
  const statTotal = await page.innerText('#stat-total');
  const statTemp = await page.innerText('#stat-temp');
  console.log('--- UI COUNTS DISPLAYED ---');
  console.log('Tab official-count:', officialCount);
  console.log('Tab temp-count:', tempCount);
  console.log('Card stat-total:', statTotal);
  console.log('Card stat-temp:', statTemp);

  await page.screenshot({ path: 'scripts/live_restored_inboxes.png' });
  await browser.close();
})();
