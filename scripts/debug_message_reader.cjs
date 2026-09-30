const { chromium } = require('playwright');
const path = require('path');

const artifactDir = 'C:/Users/ayami/.gemini/antigravity/brain/8f7d1285-40f9-49c3-b4ea-5e20916cd558';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  
  const consoleLogs = [];
  const networkEvents = [];
  page.on('console', msg => {
    consoleLogs.push(msg.text());
    console.log('BROWSER:', msg.text());
  });
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('response', res => {
    if (res.url().includes('/api/')) {
      console.log(`API [${res.status()}] ${res.url()}`);
    }
  });

  console.log('Opening https://batabitoo-mail-2026.web.app/ ...');
  await page.goto('https://batabitoo-mail-2026.web.app/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  
  if (await page.locator('#pin-keypad').isVisible()) {
    console.log('Entering PIN 0530...');
    await page.click('#pin-keypad button[data-digit="0"]');
    await page.click('#pin-keypad button[data-digit="5"]');
    await page.click('#pin-keypad button[data-digit="3"]');
    await page.click('#pin-keypad button[data-digit="0"]');
    await page.waitForTimeout(4000);
  }

  // Check messages on the active inbox / main list
  let msgCards = page.locator('#message-list .message-card');
  let count = await msgCards.count();
  console.log('Main message-list card count:', count);
  
  // Also check Amazon Hub messages
  console.log('Checking Amazon Hub messages...');
  await page.click('#open-amazon-hub-btn');
  await page.waitForTimeout(2000);
  
  const amzMsgTab = page.locator('#amazon-sub-tabs button[data-amazon-view="messages"]').first();
  await amzMsgTab.click();
  await page.waitForTimeout(2500);

  const amzCards = page.locator('#amazon-message-list .message-card');
  const amzCount = await amzCards.count();
  console.log('Amazon message-list count:', amzCount);

  // Test opening several messages to see what happens
  const messagesToTest = [];
  if (amzCount > 0) {
    for (let i = 0; i < Math.min(3, amzCount); i++) {
      const card = amzCards.nth(i);
      const subject = (await card.locator('.message-subject').textContent()).trim();
      const id = await card.getAttribute('data-message-id');
      messagesToTest.push({ index: i, subject, id: decodeURIComponent(id || '') });
    }
  }

  console.log('Messages to test:', messagesToTest);

  for (const testMsg of messagesToTest) {
    console.log(`\n--- Testing Message ${testMsg.index}: "${testMsg.subject}" (${testMsg.id}) ---`);
    const card = amzCards.nth(testMsg.index);
    await card.click();
    await page.waitForTimeout(3000);

    const isReaderVisible = await page.isVisible('#reader-shell');
    const readerSubject = await page.locator('#reader-subject').textContent();
    const readerFrom = await page.locator('#reader-from').textContent();
    const readerTo = await page.locator('#reader-to').textContent();
    const readerStatus = await page.locator('#reader-content-status').textContent();
    const noticeVisible = await page.isVisible('#reader-notice');
    const noticeText = noticeVisible ? await page.locator('#reader-notice').textContent() : '';

    console.log('Reader Shell Visible:', isReaderVisible);
    console.log('Reader Subject:', readerSubject.trim());
    console.log('Reader From:', readerFrom.trim());
    console.log('Reader To:', readerTo.trim());
    console.log('Reader Status:', readerStatus.trim());
    console.log('Notice visible:', noticeVisible, noticeText.trim());

    // Inspect the iframe inside reader
    const frameElement = await page.$('#reader-frame');
    const frame = page.frameLocator('#reader-frame');
    const frameHtml = await frame.locator('html').innerHTML().catch(e => 'ERROR: ' + e.message);
    console.log('Frame HTML length:', frameHtml.length);
    console.log('Frame HTML preview (first 400 chars):');
    console.log(frameHtml.slice(0, 400));
    console.log('Frame body innerText:');
    const frameText = await frame.locator('body').innerText().catch(e => 'ERROR: ' + e.message);
    console.log(frameText.slice(0, 300));

    const geometry = await page.evaluate(() => {
      const f = document.getElementById('reader-frame');
      const c = document.querySelector('.reader-content-card');
      const s = document.getElementById('reader-shell');
      let docH = 0, bodyH = 0, bodyScrollH = 0;
      try {
        const doc = f.contentDocument || f.contentWindow.document;
        if (doc) {
          docH = doc.documentElement.scrollHeight;
          bodyH = doc.body ? Math.ceil(doc.body.getBoundingClientRect().height) : 0;
          bodyScrollH = doc.body ? doc.body.scrollHeight : 0;
        }
      } catch(e) { docH = e.message; }
      return {
        frame: {
          inlineHeight: f ? f.style.height : null,
          rect: f ? f.getBoundingClientRect() : null,
          docH,
          bodyH,
          bodyScrollH
        },
        card: c ? { rect: c.getBoundingClientRect(), overflow: window.getComputedStyle(c).overflow } : null,
        shell: s ? { rect: s.getBoundingClientRect(), display: window.getComputedStyle(s).display } : null
      };
    });
    console.log('Geometry:', JSON.stringify(geometry, null, 2));

    const screenshotPath = path.join(artifactDir, `debug_reader_msg_${testMsg.index}.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`Saved screenshot to ${screenshotPath}`);

    // Click back to messages or close reader
    const backBtn = page.locator('#reader-back-btn, #reader-close-btn').first();
    if (await backBtn.isVisible()) {
      await backBtn.click();
      await page.waitForTimeout(1500);
    }
  }

  await browser.close();
  console.log('\nDebug script finished.');
  process.exit(0);
})().catch(e => {
  console.error('Debug script error:', e);
  process.exit(1);
});
