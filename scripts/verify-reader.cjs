const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('@playwright/test');
process.env.MAIL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-reader-test-'));
const content = require('../MailContent');

(async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6LVsAAAAASUVORK5CYII=';
  const raw = [
    'From: Sender <sender@example.test>', 'To: reader@example.test',
    `Subject: =?UTF-8?B?${Buffer.from('رسالة عربية').toString('base64')}?=`,
    'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="outer"', '',
    '--outer', 'Content-Type: multipart/related; boundary="related"', '',
    '--related', 'Content-Type: multipart/alternative; boundary="alt"', '',
    '--alt', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from('رمز التحقق: 123456').toString('base64'),
    '--alt', 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from('<html><body dir="rtl"><table width="600" style="background:#f3f0ff"><tr><td><h2>مرحبًا بك</h2><img src="cid:logo" width="120"><p>رمز التحقق: 123456</p><a href="https://example.com">زيارة الموقع</a></td></tr></table><script>alert(1)</script><form><input></form></body></html>').toString('base64'),
    '--alt--', '--related', 'Content-Type: image/png', 'Content-ID: <logo>', 'Content-Disposition: inline; filename="logo.png"', 'Content-Transfer-Encoding: base64', '', png,
    '--related--', '--outer', 'Content-Type: application/pdf', 'Content-Disposition: attachment; filename="receipt.pdf"', 'Content-Transfer-Encoding: base64', '', Buffer.from('%PDF-fixture').toString('base64'), '--outer--', ''
  ].join('\r\n');
  let message = await content.normalize({ raw }, 'fixture');
  assert.equal(message.subject, 'رسالة عربية');
  assert.equal(message.otp, '123456');
  assert.equal(message.attachments.length, 2);
  assert.match(message.html, /data:image\/png;base64/);
  assert.doesNotMatch(message.html, /<script|<form|<input|cid:logo/);
  assert.doesNotMatch(message.text, /boundary|Content-Type|--alt/);
  const attachment = message.attachments.find(item => !item.inline);
  assert.equal(content.attachment(message, attachment.id).content.toString(), '%PDF-fixture');
  const enriched = await content.normalize({ text: 'new-body'.repeat(6000), html: '<h2>new-enriched-body</h2>' }, 'enrich');
  await content.normalize({ text: 'old' }, 'enrich');
  const replacement = await content.normalize({ text: 'new-body'.repeat(6000), html: '<h2>new-enriched-body</h2>' }, 'enrich');
  assert.match(replacement.html, /new-enriched-body/);
  assert.equal(content.detail(replacement).text.length, 48000);
  assert.equal(content.summary(enriched).html, '');
  const missing = await content.normalize({ text: 'boundary="----=_Part_123"\nX-AMAZON-MAIL-RELAY-TYPE: notification\nBounces-to: bounce@example.test\nX-AMAZON-METADATA: data\nFeedback-ID: 123\nX-SES-Outgoing: test' }, 'missing');
  assert.equal(missing.bodyStatus, 'unavailable', 'Transport-only content must not be shown as a message');
  console.log('PASS: MIME, Arabic, CID image, binary attachment, sanitization, enrichment, full text, unavailable source');

  message = { ...content.detail(message), subject: 'تأكيد وصول طلبك — رسالة طويلة لاختبار القراءة والتنسيق على مختلف الشاشات', from: 'خدمة العملاء <very-long-sender-address-for-layout@example.test>', to: 'long-recipient-address-for-testing@example.test', createdAt: new Date().toISOString() };
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];
  try {
    for (const width of [320, 390, 768, 1440, 1920]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let delay = 0;
      let fail = false;
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/api/messages/')) {
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          return route.fulfill({ status: fail ? 500 : 200, json: fail ? {error:'fixture failure'} : message });
        }
        const inbox = { id:'fixture-inbox', email:'reader@example.test', isOfficial:true, type:'official' };
        const responses = {
          '/api/status': {status:'online',counts:{totalInboxes:1,official:1,temp:0,messages:1}},
          '/api/inboxes': {activeId:inbox.id,official:[inbox],temp:[],inboxes:[inbox]},
          '/api/all-messages': {messages:[message],official:[message],temp:[]},
          '/api/inbox/current': {inbox,messages:[message]},
          '/api/nivea/logs': {submissions:[],total:0}
        };
        return route.fulfill({json:responses[url.pathname] || {}});
      });
      await page.goto(process.env.DESIGN_URL || 'http://127.0.0.1:3030', {waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => typeof openMessage === 'function');
      await page.evaluate(() => openMessage('fixture'));
      await page.locator('.reader-content-card[aria-busy="false"]').waitFor();
      const img = page.frameLocator('#reader-frame').locator('img');
      await img.waitFor();
      assert(await img.evaluate(el => el.complete && el.naturalWidth > 0), 'Embedded image should load');
      const measure = () => page.evaluate(() => {
        const card = document.querySelector('.reader-content-card').getBoundingClientRect();
        const frame = document.querySelector('#reader-frame');
        return {width:innerWidth,scroll:document.documentElement.scrollWidth,left:card.left,right:card.right,height:frame.clientHeight,bodyHeight:frame.contentDocument.body.getBoundingClientRect().height,attachments:document.querySelectorAll('.reader-attachment').length};
      });
      const first = await measure();
      assert(first.scroll <= width + 1, JSON.stringify(first));
      assert(Math.abs(first.left - (width - first.right)) < 3, `Reader must be centered: ${JSON.stringify(first)}`);
      assert.equal(first.attachments, 1);
      await page.waitForTimeout(700);
      const second = await measure();
      assert(Math.abs(first.height - second.height) < 5, 'Iframe must not grow continuously');
      // Delayed layout changes in the message must resize its enclosing card.
      await page.frameLocator('#reader-frame').locator('body').evaluate(el => { const p = document.createElement('div'); p.style.height='900px'; p.textContent='Long content'; el.append(p); });
      await page.waitForTimeout(100);
      assert((await measure()).height > second.height + 700);
      await page.screenshot({path:path.resolve(`reader-verified-${width}.png`), fullPage:true});
      await page.evaluate(() => closeReader(false));
      delay = 400;
      await page.evaluate(() => { void openMessage('fixture',false); closeReader(false); });
      await page.waitForTimeout(500);
      assert(await page.locator('#reader-shell').isHidden(), 'Late response must not reopen the reader');
      delay = 0; fail = true;
      await page.evaluate(() => openMessage('fixture',false));
      assert.equal(await page.locator('#reader-subject').textContent(), 'تعذر تحميل الرسالة');
      fail = false;
      await page.locator('#reader-retry-btn').click();
      await page.waitForFunction(() => document.querySelector('#reader-subject').textContent.startsWith('تأكيد'));
      assert.deepEqual(errors, []);
      results.push({...first,passed:true});
      await page.close();
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify(results,null,2));
})().catch(error => {console.error(error); process.exitCode=1;});
