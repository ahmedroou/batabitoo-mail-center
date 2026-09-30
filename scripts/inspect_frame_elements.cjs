const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('https://batabitoo-mail-2026.web.app/');
  await page.waitForTimeout(1000);
  if (await page.locator('#pin-keypad').isVisible()) {
    await page.click('#pin-keypad button[data-digit="0"]');
    await page.click('#pin-keypad button[data-digit="5"]');
    await page.click('#pin-keypad button[data-digit="3"]');
    await page.click('#pin-keypad button[data-digit="0"]');
    await page.waitForTimeout(4000);
  }

  // Open message directly via evaluate
  await page.evaluate(async () => {
    await openMessage('mail_f36e3b8d8243f5fdd36733205f4ce3e175626c41696d2ef4');
  });
  await page.waitForTimeout(3000);

  // Check middle panel (.message-card) to see why it was blank in screenshot
  const cardsInfo = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#message-list .message-card'));
    return cards.map(c => ({
      html: c.innerHTML.slice(0, 200),
      text: c.innerText.slice(0, 100),
      style: {
        color: window.getComputedStyle(c).color,
        display: window.getComputedStyle(c).display,
        visibility: window.getComputedStyle(c).visibility
      }
    }));
  });
  console.log('Middle panel cards info:', JSON.stringify(cardsInfo, null, 2));

  // Check iframe
  const frame = page.frameLocator('#reader-frame');
  const frameElements = await frame.locator('*').evaluateAll(els => {
    return els.filter(el => el.innerText && el.innerText.trim().length > 0).slice(0, 20).map(el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        tag: el.tagName,
        id: el.id,
        className: el.className,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height), top: Math.round(rect.top) },
        color: style.color,
        bg: style.backgroundColor,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        fontSize: style.fontSize,
        text: el.innerText.slice(0, 60).replace(/\s+/g, ' ').trim()
      };
    });
  });
  console.log('Frame text elements:', JSON.stringify(frameElements, null, 2));

  // Let's also check if the iframe content is scrolled or hidden
  const iframeBounding = await page.evaluate(() => {
    const f = document.getElementById('reader-frame');
    const r = f.getBoundingClientRect();
    return {
      frameRect: { top: r.top, bottom: r.bottom, height: r.height },
      windowScrollY: window.scrollY,
      windowInnerHeight: window.innerHeight,
      shellScrollTop: document.getElementById('reader-shell')?.scrollTop,
      shellScrollHeight: document.getElementById('reader-shell')?.scrollHeight,
      shellHeight: document.getElementById('reader-shell')?.getBoundingClientRect().height
    };
  });
  console.log('Iframe positioning on screen:', JSON.stringify(iframeBounding, null, 2));

  await browser.close();
  process.exit(0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
