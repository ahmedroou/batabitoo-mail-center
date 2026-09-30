const { chromium } = require('playwright');
const path = require('path');

const artifactDir = 'C:/Users/ayami/.gemini/antigravity/brain/8f7d1285-40f9-49c3-b4ea-5e20916cd558';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();

  page.on('console', msg => console.log('MOBILE LOG:', msg.text()));
  page.on('pageerror', err => console.log('MOBILE PAGE ERROR:', err.message));

  console.log('Navigating to mobile production...');
  await page.goto('https://batabitoo-mail-2026.web.app/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  if (await page.locator('#pin-keypad').isVisible()) {
    await page.click('#pin-keypad button[data-digit="0"]');
    await page.click('#pin-keypad button[data-digit="5"]');
    await page.click('#pin-keypad button[data-digit="3"]');
    await page.click('#pin-keypad button[data-digit="0"]');
    await page.waitForTimeout(4000);
  }

  // Go to messages tab
  console.log('Switching to messages tab on mobile...');
  await page.click('#mobile-nav button[data-mobile-view="messages"]');
  await page.waitForTimeout(2000);

  const card = page.locator('#message-list .message-card').first();
  const cardCount = await page.locator('#message-list .message-card').count();
  console.log('Mobile message cards count:', cardCount);

  if (cardCount > 0) {
    const subject = (await card.locator('.message-subject').textContent()).trim();
    console.log(`Opening mobile message: "${subject}"...`);
    await card.click();
    await page.waitForTimeout(3000);

    // Capture initial view upon opening
    await page.screenshot({ path: path.join(artifactDir, 'mobile_reader_initial.png') });
    console.log('Saved mobile_reader_initial.png');

    // Inspect iframe & geometry
    const info = await page.evaluate(() => {
      const f = document.getElementById('reader-frame');
      const card = document.querySelector('.reader-content-card');
      const shell = document.getElementById('reader-shell');
      const ws = document.querySelector('.workspace');
      let docH = 0, bodyH = 0;
      try {
        const doc = f.contentDocument || f.contentWindow.document;
        docH = doc ? doc.documentElement.scrollHeight : 0;
        bodyH = doc ? doc.body.getBoundingClientRect().height : 0;
      } catch (e) { docH = e.message; }
      return {
        frame: {
          inlineHeight: f ? f.style.height : null,
          computedHeight: f ? window.getComputedStyle(f).height : null,
          rect: f ? f.getBoundingClientRect() : null,
          docH,
          bodyH
        },
        card: card ? { rect: card.getBoundingClientRect(), overflow: window.getComputedStyle(card).overflow } : null,
        shell: shell ? { rect: shell.getBoundingClientRect(), overflow: window.getComputedStyle(shell).overflow } : null,
        workspace: ws ? { hasShowContent: ws.classList.contains('show-content'), rect: ws.getBoundingClientRect() } : null
      };
    });
    console.log('Mobile Geometry:', JSON.stringify(info, null, 2));

    // Scroll down 400px
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(artifactDir, 'mobile_reader_scrolled_400.png') });
    console.log('Saved mobile_reader_scrolled_400.png');

    // Scroll down 800px
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(artifactDir, 'mobile_reader_scrolled_800.png') });
    console.log('Saved mobile_reader_scrolled_800.png');
  }

  await browser.close();
  process.exit(0);
})().catch(err => {
  console.error('Mobile test failed:', err);
  process.exit(1);
});
