const { chromium } = require('playwright');
const path = require('path');

const artifactDir = 'C:/Users/ayami/.gemini/antigravity/brain/8f7d1285-40f9-49c3-b4ea-5e20916cd558';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  
  await page.goto('https://batabitoo-mail-2026.web.app/', { waitUntil: 'networkidle' });
  if (await page.locator('#pin-keypad').isVisible()) {
    await page.click('#pin-keypad button[data-digit="0"]');
    await page.click('#pin-keypad button[data-digit="5"]');
    await page.click('#pin-keypad button[data-digit="3"]');
    await page.click('#pin-keypad button[data-digit="0"]');
    await page.waitForTimeout(3000);
  }

  await page.evaluate(() => openMessage('mail_f36e3b8d8243f5fdd36733205f4ce3e175626c41696d2ef4'));
  await page.waitForTimeout(2000);

  console.log('Clicking load images btn...');
  await page.click('#reader-load-images-btn');
  await page.waitForTimeout(3000);

  const box = await page.evaluate(() => {
    const f = document.getElementById('reader-frame');
    const r = f ? f.getBoundingClientRect() : {};
    const doc = f ? (f.contentDocument || f.contentWindow.document) : null;
    const body = doc ? doc.body : null;
    return {
      windowHeight: window.innerHeight,
      scrollY: window.scrollY,
      frameHeight: r.height,
      frameInlineHeight: f ? f.style.height : null,
      bodyScrollHeight: body ? body.scrollHeight : null,
      imagesCount: doc ? doc.querySelectorAll('img').length : 0,
      blockedImagesCount: doc ? doc.querySelectorAll('img[data-original-src]').length : 0
    };
  });
  console.log('After loading images:', box);

  const screenshotPath = path.join(artifactDir, 'test_mobile_images_loaded.png');
  await page.screenshot({ path: screenshotPath });
  console.log('Screenshot saved to:', screenshotPath);

  await browser.close();
})();
