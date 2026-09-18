const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');

const parentEmail = 'parent.account@gmail.com';
const aliasEmail = 'parentaccount@gmail.com';
const parentInbox = {
  id: 'gmail_parent_account_gmail_com', email: parentEmail, parentEmail,
  domain: 'gmail.com', type: 'official', isOfficial: true, isRealGmail: true
};
const aliasInbox = {
  id: 'gmail_amz_parentaccount_gmail_com', email: aliasEmail, parentEmail,
  domain: 'gmail.com', type: 'official', isOfficial: true, isRealGmail: true,
  isDottedGmailAlias: true, isAmazon: true
};

function fsDoc(collection, item) {
  const fields = {};
  for (const [key, value] of Object.entries(item)) {
    if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else if (typeof value === 'number') fields[key] = { integerValue: String(value) };
    else if (value != null) fields[key] = { stringValue: String(value) };
  }
  return { name: `projects/test/databases/(default)/documents/${collection}/${item.id}`, fields };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const pageErrors = [];
  let savedMessage = null;
  let gmailListCalls = 0;
  let gmailParentAuthorized = false;
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(({ parentEmail }) => {
    localStorage.setItem('batabitoo_master_pin_v1', '0530');
    localStorage.setItem(`gmail_token_${parentEmail}`, 'parent-access-token');
  }, { parentEmail });

  await page.route('https://gmail.googleapis.com/**', async route => {
    const request = route.request();
    gmailParentAuthorized ||= request.headers().authorization === 'Bearer parent-access-token';
    if (request.url().includes('/messages?')) {
      gmailListCalls++;
      return route.fulfill({ json: { messages: [{ id: 'gmail-message-1' }] } });
    }
    return route.fulfill({ json: {
      id: 'gmail-message-1', snippet: 'رمز التحقق 654321',
      payload: {
        headers: [
          { name: 'From', value: 'Amazon <account-update@amazon.sa>' },
          { name: 'To', value: aliasEmail },
          { name: 'Delivered-To', value: aliasEmail },
          { name: 'Subject', value: 'رمز التحقق' },
          { name: 'Date', value: new Date().toUTCString() }
        ],
        mimeType: 'text/plain',
        body: { data: Buffer.from('رمز التحقق 654321').toString('base64url') }
      }
    } });
  });

  await page.route('https://firestore.googleapis.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'PATCH' && url.pathname.includes('/messages/')) {
      const body = request.postDataJSON();
      savedMessage = Object.fromEntries(Object.entries(body.fields).map(([key, field]) => [key,
        field.stringValue ?? field.booleanValue ?? Number(field.integerValue)]));
      return route.fulfill({ json: fsDoc('messages', savedMessage) });
    }
    if (url.pathname.endsWith('/documents/inboxes')) {
      return route.fulfill({ json: { documents: [fsDoc('inboxes', parentInbox), fsDoc('inboxes', aliasInbox)] } });
    }
    if (url.pathname.endsWith('/documents/messages')) {
      // Force the reader through page two to verify pagination is honored.
      if (!url.searchParams.get('pageToken')) {
        return route.fulfill({ json: { documents: [], nextPageToken: 'page-2' } });
      }
      return route.fulfill({ json: { documents: savedMessage ? [fsDoc('messages', savedMessage)] : [] } });
    }
    if (url.pathname.includes('/documents/messages/')) return route.fulfill({ status: 404, json: {} });
    return route.fulfill({ json: {} });
  });

  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/inboxes/select') return route.fulfill({ status: 404, json: { error: 'edge route unavailable' } });
    const body = path === '/api/status'
      ? { status: 'online', cloudConnected: true, counts: {} }
      : path === '/api/inboxes'
        ? { activeId: parentInbox.id, official: [parentInbox, aliasInbox], temp: [], amazon: [aliasInbox], banned: [], suspected: [] }
      : path === '/api/inbox/current'
          ? { inbox: parentInbox, messages: [] }
          : path === '/api/nivea/logs'
            ? { submissions: [] }
            : { counts: {}, messages: [], official: [], temp: [], amazon: [], banned: [] };
    return route.fulfill({ json: body });
  });

  try {
    await page.goto('http://127.0.0.1:3030', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appStarted === true || document.querySelector('#pin-lock-overlay')?.classList.contains('unlocked'));
    await page.waitForFunction(() => typeof state !== 'undefined' && state.messages.some(item => item.id === 'gmail_oauth_gmail-message-1'), null, { timeout: 15000 });
    await page.evaluate(() => {
      setAmazonView('accounts', 'all');
      switchContentView('amazon');
    });
    await page.waitForFunction(id => Boolean(document.querySelector(`.amazon-account-card[data-account-id="${id}"]`)), aliasInbox.id);
    await page.evaluate(id => document.querySelector(`.amazon-account-card[data-account-id="${id}"]`).click(), aliasInbox.id);
    await page.waitForFunction(email => state.activeInbox?.email === email && state.view === 'current' && state.messages.length > 0, aliasEmail);
    const result = await page.evaluate(() => ({
      activeEmail: state.activeInbox?.email,
      messageIds: state.messages.map(item => item.id),
      otp: state.messages[0]?.otp,
      officialCount: state.officialMessages.length,
      visibleEmail: document.querySelector('#active-email')?.textContent,
      contentVisible: document.querySelector('.workspace')?.classList.contains('show-content')
    }));
    assert.equal(result.activeEmail, aliasEmail);
    assert.equal(result.visibleEmail, aliasEmail);
    assert.equal(result.contentVisible, true);
    assert.deepEqual(result.messageIds, ['gmail_oauth_gmail-message-1']);
    assert.equal(result.otp, '654321');
    assert(result.officialCount >= 1, 'new Gmail message must update merged official counts');
    assert(gmailListCalls >= 1, 'silent refresh must call Gmail API');
    assert(gmailParentAuthorized, 'dotted alias must use its parent Gmail token');
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ ok: true, gmailListCalls, ...result }));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
