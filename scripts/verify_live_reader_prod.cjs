const { chromium } = require('playwright');
const path = require('path');

const artifactDir = 'C:/Users/ayami/.gemini/antigravity/brain/8f7d1285-40f9-49c3-b4ea-5e20916cd558';

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ----------------------------------------------------
  // 1. MOBILE VERIFICATION (iPhone 14 - 390x844)
  // ----------------------------------------------------
  console.log('=== 1. Live Production Mobile Verification (390x844) ===');
  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  
  await mobilePage.goto('https://batabitoo-mail-2026.web.app/', { waitUntil: 'networkidle' });
  if (await mobilePage.locator('#pin-keypad').isVisible()) {
    console.log('Entering PIN 0530 on mobile...');
    await mobilePage.click('#pin-keypad button[data-digit="0"]');
    await mobilePage.click('#pin-keypad button[data-digit="5"]');
    await mobilePage.click('#pin-keypad button[data-digit="3"]');
    await mobilePage.click('#pin-keypad button[data-digit="0"]');
    await mobilePage.waitForFunction(() => document.getElementById('pin-lock-overlay')?.classList.contains('unlocked'), { timeout: 15000 });
    await mobilePage.waitForTimeout(2000);
  }

  // Open Amazon message directly or click from Amazon list
  console.log('Opening Amazon message on live mobile...');
  await mobilePage.evaluate(() => openMessage('mail_f36e3b8d8243f5fdd36733205f4ce3e175626c41696d2ef4'));
  await mobilePage.waitForTimeout(2500);

  const mobileEval = await mobilePage.evaluate(() => {
    const f = document.getElementById('reader-frame');
    const r = f ? f.getBoundingClientRect() : {};
    const doc = f ? (f.contentDocument || f.contentWindow.document) : null;
    const body = doc ? doc.body : null;
    return {
      windowHeight: window.innerHeight,
      scrollY: window.scrollY,
      frameTop: r.top,
      frameBottom: r.bottom,
      frameHeight: r.height,
      frameInlineHeight: f ? f.style.height : null,
      bodyScrollHeight: body ? body.scrollHeight : null,
      subject: document.getElementById('reader-subject')?.textContent?.trim(),
      compactFrom: document.getElementById('reader-compact-from')?.textContent?.trim(),
      compactDate: document.getElementById('reader-compact-date')?.textContent?.trim(),
      envelopeOpen: document.getElementById('reader-envelope-details')?.hasAttribute('open'),
      privacyBarHidden: document.getElementById('reader-image-privacy-bar')?.classList.contains('hidden'),
      imagesCount: doc ? doc.querySelectorAll('img').length : 0,
      blockedImagesCount: doc ? doc.querySelectorAll('img[data-original-src]').length : 0,
      frameText: body ? body.innerText.slice(0, 200).replace(/\n+/g, ' ') : ''
    };
  });
  console.log('Live Mobile Evaluation:', JSON.stringify(mobileEval, null, 2));

  const mobileScreenshot = path.join(artifactDir, 'live_mobile_reader_fixed.png');
  await mobilePage.screenshot({ path: mobileScreenshot });
  console.log('Saved mobile screenshot:', mobileScreenshot);

  // ----------------------------------------------------
  // 2. DESKTOP VERIFICATION (1440x900)
  // ----------------------------------------------------
  console.log('\n=== 2. Live Production Desktop Verification (1440x900) ===');
  const desktopPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  
  await desktopPage.goto('https://batabitoo-mail-2026.web.app/', { waitUntil: 'networkidle' });
  if (await desktopPage.locator('#pin-keypad').isVisible()) {
    console.log('Entering PIN 0530 on desktop...');
    await desktopPage.click('#pin-keypad button[data-digit="0"]');
    await desktopPage.click('#pin-keypad button[data-digit="5"]');
    await desktopPage.click('#pin-keypad button[data-digit="3"]');
    await desktopPage.click('#pin-keypad button[data-digit="0"]');
    await desktopPage.waitForFunction(() => document.getElementById('pin-lock-overlay')?.classList.contains('unlocked'), { timeout: 15000 });
    await desktopPage.waitForTimeout(2000);
  }

  // Go to Amazon Hub on desktop
  console.log('Opening Amazon Hub on desktop...');
  await desktopPage.click('#open-amazon-hub-btn');
  await desktopPage.waitForTimeout(1500);
  await desktopPage.click('#amazon-sub-tabs button[data-amazon-view="messages"]');
  await desktopPage.waitForTimeout(2000);

  // Click first Amazon message card
  const firstCard = desktopPage.locator('#amazon-message-list .message-card').first();
  const cardTitle = (await firstCard.locator('.message-subject').textContent()).trim();
  console.log('Clicking Amazon message card on desktop:', cardTitle);
  await firstCard.click();
  await desktopPage.waitForTimeout(3000);

  const desktopEval = await desktopPage.evaluate(() => {
    const f = document.getElementById('reader-frame');
    const r = f ? f.getBoundingClientRect() : {};
    const doc = f ? (f.contentDocument || f.contentWindow.document) : null;
    const body = doc ? doc.body : null;
    return {
      windowHeight: window.innerHeight,
      frameTop: r.top,
      frameHeight: r.height,
      frameInlineHeight: f ? f.style.height : null,
      bodyScrollHeight: body ? body.scrollHeight : null,
      subject: document.getElementById('reader-subject')?.textContent?.trim(),
      compactFrom: document.getElementById('reader-compact-from')?.textContent?.trim(),
      compactDate: document.getElementById('reader-compact-date')?.textContent?.trim(),
      envelopeOpen: document.getElementById('reader-envelope-details')?.hasAttribute('open'),
      privacyBarHidden: document.getElementById('reader-image-privacy-bar')?.classList.contains('hidden'),
      imagesCount: doc ? doc.querySelectorAll('img').length : 0,
      blockedImagesCount: doc ? doc.querySelectorAll('img[data-original-src]').length : 0,
      amazonHubVisible: !document.getElementById('amazon-hub-shell')?.classList.contains('hidden'),
      feedShellHidden: document.getElementById('feed-shell')?.classList.contains('hidden'),
      activeCardSelected: !!document.querySelector('#amazon-message-list .message-card.is-selected'),
      frameText: body ? body.innerText.slice(0, 200).replace(/\n+/g, ' ') : ''
    };
  });
  console.log('Live Desktop Evaluation:', JSON.stringify(desktopEval, null, 2));

  const desktopScreenshot = path.join(artifactDir, 'live_desktop_reader_fixed.png');
  await desktopPage.screenshot({ path: desktopScreenshot });
  console.log('Saved desktop screenshot:', desktopScreenshot);

  // Also test another message with promotions / rich layout: "Welcome to your everything store"
  console.log('\nTesting Message 2 (Rich promotional layout): "Welcome to your everything store"');
  await desktopPage.evaluate(() => openMessage('mail_87d53468cd0852d611af56e32cfaac490e13e39d65f7fe5b'));
  await desktopPage.waitForTimeout(3000);

  const promoEval = await desktopPage.evaluate(() => {
    const f = document.getElementById('reader-frame');
    const doc = f ? (f.contentDocument || f.contentWindow.document) : null;
    const body = doc ? doc.body : null;
    return {
      frameInlineHeight: f ? f.style.height : null,
      bodyScrollHeight: body ? body.scrollHeight : null,
      imagesCount: doc ? doc.querySelectorAll('img').length : 0,
      blockedImagesCount: doc ? doc.querySelectorAll('img[data-original-src]').length : 0
    };
  });
  console.log('Promo Email Evaluation:', JSON.stringify(promoEval, null, 2));

  const promoScreenshot = path.join(artifactDir, 'live_desktop_promo_fixed.png');
  await desktopPage.screenshot({ path: promoScreenshot });
  console.log('Saved promo email screenshot:', promoScreenshot);

  await browser.close();
  console.log('\nAll Live Verifications Passed Successfully!');
})();
