const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('@playwright/test');
const root = path.resolve(__dirname, '../public');
const attachmentId = 'a'.repeat(64);
const messages = [1, 2].map(i => ({ id: `prize-${i}`, subject: `Prize ticket ${i}`, from: 'Awards <prizes@example.org>', to: 'owner@example.org', inboxEmail: 'owner@example.org', text: 'Congratulations, your ticket is attached.', html: '<p>Your prize ticket is attached.</p>', isWinning: true, createdAt: `2026-09-24T0${i}:00:00Z`, attachments: [{ id: attachmentId, filename: 'prize-ticket.pdf', size: 12 }] }));
const pdf = Buffer.from('%PDF-1.4\nfixture-ticket\n%%EOF');
let expiry = false;
let attachmentCalls = 0;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) {
    if (pathname.includes('/attachments/')) {
      attachmentCalls++;
      assert.equal(req.headers.authorization, 'Bearer fixture-session');
      if (expiry) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ code: 'AUTH_REQUIRED', error: 'Expired session' })); }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(pdf);
    }
    res.writeHead(200, { 'Content-Type': pathname === '/api/events' ? 'text/event-stream' : 'application/json' });
    if (pathname === '/api/events') return res.end(': connected\n\n');
    const data = pathname === '/api/auth/check' ? { success: true } : pathname === '/api/inboxes' ? { official: [], temp: [], amazon: [], banned: [] } : pathname === '/api/nivea/logs' ? [] : pathname === '/api/all-messages' ? { messages, official: messages, temp: [], amazon: [] } : pathname.startsWith('/api/messages/') ? messages.find(m => m.id === pathname.split('/')[3]) : {};
    return res.end(JSON.stringify(data));
  }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
  try {
    for (const width of [390, 1440]) {
      expiry = false;
      const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
      await context.route('**/*', route => route.request().url().startsWith(origin) || route.request().url().startsWith('blob:') ? route.continue() : route.abort());
      await context.addInitScript(() => localStorage.setItem('batabitoo_session_token', 'fixture-session'));
      const page = await context.newPage();
      await page.goto(origin);
      await page.waitForFunction(() => appStarted && !state.loading);
      await page.evaluate(items => {
        state.officialMessages = items;
        switchContentView('amazon');
        state.logsFilter = 'winning';
        switchContentView('logs');
        document.querySelector('#content-search').value = 'ticket';
        renderContent();
      }, messages);
      await page.locator('[data-message-id="prize-2"]').click();
      await page.waitForFunction(() => state.currentMessage?.subject === 'Prize ticket 2');
      assert.equal(await page.locator('#reader-counter').textContent(), '1 / 2');
      await page.locator('#reader-next-btn').click();
      await page.waitForFunction(() => state.currentMessage?.id === 'prize-1' && state.currentMessage?.subject);
      const pendingDownload = page.waitForEvent('download');
      await page.locator('[data-reader-attachment]').click();
      const download = await pendingDownload;
      assert.equal(download.suggestedFilename(), 'prize-ticket.pdf');
      assert.deepEqual(fs.readFileSync(await download.path()), pdf);
      await page.locator('#reader-back-btn').click();
      await page.waitForFunction(() => history.state?.screen === 'list');
      assert.equal(await page.evaluate(() => state.view), 'logs');
      assert.equal(await page.locator('#content-search').inputValue(), 'ticket');
      assert.equal(await page.locator('[data-message-id]').count(), 2);
      await page.locator('[data-message-id="prize-2"]').click();
      await page.waitForFunction(() => state.currentMessage?.subject);
      await page.goBack();
      await page.waitForFunction(() => !state.currentMessage);
      assert.equal(await page.evaluate(() => state.view), 'logs');
      await page.goForward();
      await page.waitForFunction(() => state.currentMessage?.subject);
      expiry = true;
      await page.locator('[data-reader-attachment]').click();
      await page.waitForFunction(() => !localStorage.getItem('batabitoo_session_token'));
      assert.equal(await page.locator('#pin-lock-overlay').evaluate(el => el.classList.contains('unlocked')), false);
      console.log(`${width}px: previous list/search, next message, browser Back/Forward, authenticated PDF bytes and expired-session handling passed`);
      await context.close();
    }
    assert.equal(attachmentCalls, 4);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
