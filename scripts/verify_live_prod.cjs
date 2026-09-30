const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('response', res => {
    if (res.url().includes('/api/')) console.log('API RESPONSE:', res.url(), res.status());
  });
  console.log('Testing live https://batabitoo-mail-2026.web.app ...');
  await page.goto('https://batabitoo-mail-2026.web.app');
  await page.click('#pin-keypad button[data-digit="0"]');
  await page.click('#pin-keypad button[data-digit="5"]');
  await page.click('#pin-keypad button[data-digit="3"]');
  await page.click('#pin-keypad button[data-digit="0"]');
  await page.waitForTimeout(6000);

  const officialText = await page.$eval('#official-count', el => el.innerText).catch(() => null);
  const tempExists = await page.$('#temp-count');
  const totalText = await page.$eval('#stat-total', el => el.innerText).catch(() => null);
  const contentTabs = await page.$$eval('#content-tabs button', btns => btns.map(b => b.textContent.trim())).catch(() => []);
  const amazonTabs = await page.$$eval('#amazon-sub-tabs button', btns => btns.map(b => b.textContent.trim())).catch(() => []);
  console.log('LIVE Official count:', officialText);
  console.log('LIVE Temp count exists:', Boolean(tempExists));
  console.log('LIVE Total text:', totalText);
  console.log('LIVE Content Tabs:', contentTabs);
  console.log('LIVE Amazon Tabs:', amazonTabs);

  await page.screenshot({ path: 'scripts/live_production_restored.png' });
  await browser.close();
  console.log('Done!');
})();
