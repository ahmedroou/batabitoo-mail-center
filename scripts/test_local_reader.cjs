const http = require('http');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PORT = 8089;
const artifactDir = 'C:/Users/ayami/.gemini/antigravity/brain/8f7d1285-40f9-49c3-b4ea-5e20916cd558';

// Create a simple static file server for public/
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png'
};

const server = http.createServer((req, res) => {
  let reqUrl = req.url.split('?')[0];
  if (reqUrl === '/') reqUrl = '/index.html';
  const filePath = path.join(__dirname, '..', 'public', reqUrl);
  
  if (req.url.startsWith('/api/messages/')) {
    // Return mock message detail
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'mock_msg_1',
      from: 'Amazon.sa <order-update@amazon.sa>',
      to: 'ahmedbatabitoo1@batabitoo.com',
      subject: 'تحديث بشأن عملية استرداد الأموال لطلبك',
      createdAt: '2026-09-22T03:39:00.000Z',
      html: `<!doctype html><html dir="auto"><head><meta charset="utf-8"></head><body><div id="mail-root"><img src="https://images-na.ssl-images-amazon.com/images/G/01/x-locale/cs/contact-us/amazon-logo._CB485934440_.png" alt="Amazon" style="width:120px;height:auto;"><p>مرحباً ahmed shalabi،</p><p>يسرنا أن نبلغك بأنه قد تم معالجة طلب استرداد المبلغ بنجاح وقدره 69.96 ريال سعودي والخاص بطلبك.</p><table style="width:100%;border:1px solid #e2e8f0;padding:8px;"><tr><td>رقم الطلب</td><td><strong>406-2363916-0213153</strong></td></tr></table></div></body></html>`,
      text: 'مرحباً ahmed shalabi، يسرنا أن نبلغك بأنه قد تم معالجة طلب استرداد المبلغ بنجاح.',
      attachments: [],
      bodyStatus: 'available'
    }));
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    // SPA fallback
    const indexPath = path.join(__dirname, '..', 'public', 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(indexPath).pipe(res);
  }
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  console.log(`Local test server running at http://127.0.0.1:${PORT}`);

  const browser = await chromium.launch({ headless: true });

  // 1. Test Mobile (390x844)
  console.log('\n--- Testing Mobile View (390x844) ---');
  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobilePage.goto(`http://127.0.0.1:${PORT}/`);
  await mobilePage.waitForTimeout(500);

  await mobilePage.evaluate(() => {
    document.getElementById('pin-lock-overlay')?.remove();
    document.body.classList.remove('locked');
  });

  // Directly call openMessage
  await mobilePage.evaluate(() => openMessage('mock_msg_1'));
  await mobilePage.waitForTimeout(1500);

  const mobileEval = await mobilePage.evaluate(() => {
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
      envelopeOpen: document.getElementById('reader-envelope-details')?.hasAttribute('open'),
      compactFrom: document.getElementById('reader-compact-from')?.textContent,
      compactDate: document.getElementById('reader-compact-date')?.textContent,
      privacyBarHidden: document.getElementById('reader-image-privacy-bar')?.classList.contains('hidden'),
      imagesCount: doc ? doc.querySelectorAll('img').length : 0,
      blockedImagesCount: doc ? doc.querySelectorAll('img[data-original-src]').length : 0,
      frameText: body ? body.innerText.slice(0, 100) : ''
    };
  });
  console.log('Mobile evaluation:', mobileEval);
  await mobilePage.screenshot({ path: path.join(artifactDir, 'local_test_mobile_reader.png') });
  console.log('Mobile screenshot saved to local_test_mobile_reader.png');

  // 2. Test Desktop (1440x900)
  console.log('\n--- Testing Desktop View (1440x900) ---');
  const desktopPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktopPage.goto(`http://127.0.0.1:${PORT}/`);
  await desktopPage.waitForTimeout(500);

  await desktopPage.evaluate(() => {
    document.getElementById('pin-lock-overlay')?.remove();
    document.body.classList.remove('locked');
  });

  await desktopPage.evaluate(() => openMessage('mock_msg_1'));
  await desktopPage.waitForTimeout(1500);

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
      envelopeOpen: document.getElementById('reader-envelope-details')?.hasAttribute('open'),
      compactFrom: document.getElementById('reader-compact-from')?.textContent,
      privacyBarHidden: document.getElementById('reader-image-privacy-bar')?.classList.contains('hidden'),
      imagesCount: doc ? doc.querySelectorAll('img').length : 0,
      blockedImagesCount: doc ? doc.querySelectorAll('img[data-original-src]').length : 0
    };
  });
  console.log('Desktop evaluation:', desktopEval);
  await desktopPage.screenshot({ path: path.join(artifactDir, 'local_test_desktop_reader.png') });
  console.log('Desktop screenshot saved to local_test_desktop_reader.png');

  await browser.close();
  server.close();
  console.log('Local test finished.');
  process.exit(0);
})();
