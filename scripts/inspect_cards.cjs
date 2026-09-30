const { chromium } = require('playwright');
const path = require('path');

const artifactDir = 'C:/Users/ayami/.gemini/antigravity/brain/8f7d1285-40f9-49c3-b4ea-5e20916cd558';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('https://batabitoo-mail-2026.web.app/', { waitUntil: 'networkidle' });
  if (await page.locator('#pin-keypad').isVisible()) {
    await page.click('#pin-keypad button[data-digit="0"]');
    await page.click('#pin-keypad button[data-digit="5"]');
    await page.click('#pin-keypad button[data-digit="3"]');
    await page.click('#pin-keypad button[data-digit="0"]');
    await page.waitForTimeout(3000);
  }

  await page.click('#open-amazon-hub-btn');
  await page.waitForTimeout(1500);
  await page.click('#amazon-sub-tabs button[data-amazon-view="messages"]');
  await page.waitForTimeout(2000);
  
  const card = page.locator('#amazon-message-list .message-card').first();
  await card.click();
  await page.waitForTimeout(2000);

  const cardText = await page.evaluate(() => {
    const cards = document.querySelectorAll('#message-list .message-card');
    return Array.from(cards).map(c => ({
      text: c.innerText,
      color: window.getComputedStyle(c).color,
      bgColor: window.getComputedStyle(c).backgroundColor,
      mainColor: c.querySelector('.message-main') ? window.getComputedStyle(c.querySelector('.message-main')).color : null,
      titleColor: c.querySelector('strong') ? window.getComputedStyle(c.querySelector('strong')).color : null,
      snippetColor: c.querySelector('.message-snippet') ? window.getComputedStyle(c.querySelector('.message-snippet')).color : null,
      rect: c.getBoundingClientRect()
    }));
  });
  console.log('Card colors:', cardText);

  await page.screenshot({ path: path.join(artifactDir, 'test_cards_screenshot.png') });
  await browser.close();
})();
