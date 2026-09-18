const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  await page.goto('http://localhost:3030');
  await page.click('#pin-keypad button[data-digit="0"]');
  await page.click('#pin-keypad button[data-digit="5"]');
  await page.click('#pin-keypad button[data-digit="3"]');
  await page.click('#pin-keypad button[data-digit="0"]');
  await page.waitForTimeout(2000);

  const stateOfficialLength = await page.evaluate(() => state.official ? state.official.length : -1);
  const stateTempLength = await page.evaluate(() => state.temp ? state.temp.length : -1);
  console.log('state.official length:', stateOfficialLength);
  console.log('state.temp length:', stateTempLength);
  await browser.close();
})();
