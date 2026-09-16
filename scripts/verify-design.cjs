const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const base = process.env.DESIGN_URL || 'http://127.0.0.1:3030';
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];
  try {
    for (const width of [390, 320, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: width > 720 ? 1050 : 844 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'warning' && message.text().includes('Mail')) console.log(width, message.text()); });
      // This review must never change the user's inbox data.
      await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.locator('.inbox-item').first().waitFor({ timeout: 30000 });
      await page.waitForFunction(() => document.querySelector('#mail-scene').classList.contains('ready'), null, { timeout: 15000 }).catch(async error => {
        console.log('Scene failure', width, await page.locator('#mail-scene').evaluate(el => ({ class: el.className, data: {...el.dataset}, hidden: document.hidden, rect: el.getBoundingClientRect().toJSON() })), errors);
        throw error;
      });
      await page.screenshot({ path: path.resolve(`web-preview-final-${width}.png`) });
      const layout = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth, scene: document.querySelector('#mail-scene').dataset.animating }));
      assert(layout.scroll <= layout.viewport + 1, `Horizontal overflow at ${width}: ${JSON.stringify(layout)}`);
      assert.equal(layout.scene, 'true', 'The real WebGL scene must be running');
      await page.locator('[data-inbox-type="temp"]').click();
      assert((await page.locator('.inbox-item').count()) <= 40, 'Inbox render must be paginated');
      const more = page.locator('[data-load-more]');
      if (await more.count()) {
        await more.click();
        assert((await page.locator('.inbox-item').count()) <= 80);
      }
      await page.locator('#inbox-search').fill('no-such-inbox-98765');
      assert.equal(await page.locator('.inbox-item').count(), 0);
      await page.locator('#inbox-search').fill('');
      await page.locator('.inbox-more').first().click();
      assert(await page.locator('#confirm-delete').isVisible());
      await page.locator('#cancel-delete').click();
      await page.locator(width <= 720 ? '[data-mobile-view="create"]' : '#new-inbox-top').click();
      assert(await page.locator('#create-modal').isVisible());
      await page.locator('[data-close-modal="create"]').click();
      if (width <= 720) {
        await page.locator('[data-mobile-view="logs"]').click();
        await page.waitForFunction(() => document.querySelector('#mail-scene').dataset.animating === 'false');
        await page.locator('[data-mobile-view="messages"]').click();
        await page.locator('[data-view="official"]').click();
        await page.locator('.message-card').first().waitFor({ timeout: 30000 });
        await page.screenshot({ path: path.resolve(`web-preview-messages-${width}.png`) });
        await page.locator('.message-card').first().click();
        assert(await page.locator('#message-modal').isVisible());
        await page.locator('[data-close-modal="message"]').click();
      }
      assert.deepEqual(errors, [], `Browser JavaScript errors at ${width}`);
      results.push({ width, ...layout, errors, passed: true });
      await page.close();
    }
    const reduced = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await reduced.goto(base);
    assert.equal(await reduced.locator('#mail-scene.ready').count(), 0, 'Reduced motion should use the static illustration');
    results.push({ reducedMotion: true, passed: true });
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
