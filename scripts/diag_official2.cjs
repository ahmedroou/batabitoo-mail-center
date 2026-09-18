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
  await page.waitForTimeout(2500);

  const officialText = await page.innerText('#official-count');
  const tempText = await page.innerText('#temp-count');
  const totalText = await page.innerText('#stat-total');
  console.log('UI Official count text:', officialText);
  console.log('UI Temp count text:', tempText);
  console.log('UI Total text:', totalText);
  await browser.close();
})();
