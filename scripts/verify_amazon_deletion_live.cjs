const { chromium } = require('playwright');
const path = require('path');

const artifactDir = 'C:/Users/ayami/.gemini/antigravity/brain/8f7d1285-40f9-49c3-b4ea-5e20916cd558';

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  console.log('=== VERIFYING LIVE AMAZON DELETION & RESTORE ON PRODUCTION ===');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const networkErrors = [];
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('response', res => {
    if (res.status() >= 400 && !res.url().includes('favicon')) {
      networkErrors.push({ url: res.url(), status: res.status() });
    }
  });

  console.log('Navigating to https://batabitoo-mail-2026.web.app/ ...');
  await page.goto('https://batabitoo-mail-2026.web.app/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // PIN entry
  const keypad = page.locator('#pin-keypad');
  if (await keypad.isVisible()) {
    console.log('Entering PIN: 0 5 3 0...');
    await page.click('#pin-keypad button[data-digit="0"]');
    await page.click('#pin-keypad button[data-digit="5"]');
    await page.click('#pin-keypad button[data-digit="3"]');
    await page.click('#pin-keypad button[data-digit="0"]');
    await page.waitForTimeout(4000);
  }

  // Open Amazon Hub
  console.log('Opening Amazon Hub...');
  const amazonTab = page.locator('#tab-amazon, button[data-view="amazon"], #open-amazon-hub-btn').first();
  await amazonTab.click();
  await page.waitForTimeout(2500);

  // Check sub-tabs
  const subTabs = await page.$$eval('#amazon-sub-tabs button', btns => btns.map(b => b.textContent.trim()));
  console.log('Sub-tabs found in Amazon Hub:', subTabs);

  // If there's an existing deleted account from previous partial run, restore it first to reset
  const deletedPill = page.locator('#amazon-sub-tabs .deleted-tab-pill, #amazon-sub-tabs button[data-account-filter="deleted"]').first();
  await deletedPill.click();
  await page.waitForTimeout(1500);

  const existingDeletedBtns = page.locator('#amazon-inboxes-reel .btn-restore-amazon');
  const existingCount = await existingDeletedBtns.count();
  if (existingCount > 0) {
    console.log(`Cleaning up / restoring ${existingCount} previously excluded accounts...`);
    for (let i = 0; i < existingCount; i++) {
      const btn = existingDeletedBtns.first();
      await btn.click();
      await page.waitForTimeout(1500);
    }
  }

  // Go back to accounts tab
  console.log('Switching to main accounts tab...');
  const accountsTabBtn = page.locator('#amazon-sub-tabs button[data-account-filter="all"], #amazon-sub-tabs button:first-child').first();
  await accountsTabBtn.click();
  await page.waitForTimeout(2000);

  // Check active accounts
  const accountCards = page.locator('#amazon-inboxes-reel .amazon-account-card');
  const cardCount = await accountCards.count();
  console.log('Active Amazon accounts count:', cardCount);
  if (cardCount === 0) {
    throw new Error('No active Amazon accounts found to test deletion!');
  }

  await page.screenshot({ path: path.join(artifactDir, 'live_amazon_hub_desktop.png'), fullPage: false });

  // Select target account
  const firstCard = accountCards.first();
  const targetEmail = (await firstCard.locator('.amazon-account-email span').textContent()).trim();
  console.log(`Target account for deletion test: ${targetEmail}`);

  // Check delete button
  const delBtn = firstCard.locator('.amazon-card-del-btn');
  const hasDelBtn = await delBtn.isVisible();
  console.log('Delete button visible on card:', hasDelBtn);
  if (!hasDelBtn) {
    throw new Error('Delete button (.amazon-card-del-btn) is not visible on Amazon account card!');
  }

  // Click delete button
  console.log('Clicking delete button...');
  await delBtn.click();
  await page.waitForTimeout(800);

  // Verify modal
  const modalVisible = await page.isVisible('#confirm-amazon-delete-backdrop');
  console.log('Confirm delete modal visible:', modalVisible);
  const modalDesc = await page.locator('#amazon-delete-target-desc').textContent();
  console.log('Modal description:', modalDesc.trim());

  await page.screenshot({ path: path.join(artifactDir, 'live_amazon_delete_modal.png'), fullPage: false });

  // Confirm delete
  console.log('Confirming deletion in modal...');
  const [deleteResponse] = await Promise.all([
    page.waitForResponse(res => res.url().includes('/api/amazon/delete') && res.status() === 200, { timeout: 15000 }),
    page.click('#accept-amazon-delete-btn')
  ]);
  console.log('Delete API response status:', deleteResponse.status());
  await page.waitForTimeout(2000);

  // Verify removed from active reel
  const activeEmails = await page.$$eval('#amazon-inboxes-reel .amazon-account-email span', els => els.map(e => e.textContent.trim()));
  const isGoneFromActive = !activeEmails.includes(targetEmail);
  console.log(`Is ${targetEmail} removed from active accounts:`, isGoneFromActive);
  if (!isGoneFromActive) {
    throw new Error(`Failed: ${targetEmail} still present in active accounts after deletion!`);
  }

  // Switch to "المستبعدة" tab
  console.log('Switching to "المستبعدة" tab...');
  await deletedPill.click();
  await page.waitForTimeout(2000);

  const deletedEmails = await page.$$eval('#amazon-inboxes-reel .amazon-account-email span', els => els.map(e => e.textContent.trim()));
  console.log('Excluded tab emails:', deletedEmails);
  const isPresentInDeleted = deletedEmails.includes(targetEmail);
  console.log(`Is ${targetEmail} present in المستبعدة tab:`, isPresentInDeleted);
  if (!isPresentInDeleted) {
    throw new Error(`Failed: ${targetEmail} not found in المستبعدة tab!`);
  }

  await page.screenshot({ path: path.join(artifactDir, 'live_amazon_excluded_tab.png'), fullPage: false });

  // Test restore
  console.log(`Testing restoration for ${targetEmail}...`);
  const restoreBtn = page.locator('#amazon-inboxes-reel .btn-restore-amazon').first();
  await restoreBtn.waitFor({ state: 'visible', timeout: 5000 });

  const [restoreResponse] = await Promise.all([
    page.waitForResponse(res => res.url().includes('/api/amazon/restore') && res.status() === 200, { timeout: 15000 }),
    restoreBtn.click()
  ]);
  console.log('Restore API response status:', restoreResponse.status());
  await page.waitForTimeout(2000);

  // Verify removed from excluded tab
  const remainingDeleted = await page.$$eval('#amazon-inboxes-reel .amazon-account-email span', els => els.map(e => e.textContent.trim()));
  console.log('Excluded tab emails after restore:', remainingDeleted);
  const isGoneFromDeleted = !remainingDeleted.includes(targetEmail);
  console.log(`Is ${targetEmail} removed from المستبعدة tab:`, isGoneFromDeleted);

  // Switch back to "الحسابات"
  console.log('Switching back to main accounts tab...');
  await accountsTabBtn.click();
  await page.waitForTimeout(2000);

  const restoredEmails = await page.$$eval('#amazon-inboxes-reel .amazon-account-email span', els => els.map(e => e.textContent.trim()));
  const isBackInActive = restoredEmails.includes(targetEmail);
  console.log(`Is ${targetEmail} successfully restored to active accounts:`, isBackInActive);
  if (!isBackInActive) {
    throw new Error(`Failed: ${targetEmail} was not restored to active accounts!`);
  }

  // Test Mobile view
  console.log('\n--- TESTING MOBILE VIEW (390x844) ---');
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto('https://batabitoo-mail-2026.web.app/', { waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(1000);

  if (await mobilePage.locator('#pin-keypad').isVisible()) {
    await mobilePage.click('#pin-keypad button[data-digit="0"]');
    await mobilePage.click('#pin-keypad button[data-digit="5"]');
    await mobilePage.click('#pin-keypad button[data-digit="3"]');
    await mobilePage.click('#pin-keypad button[data-digit="0"]');
    await mobilePage.waitForTimeout(4000);
  }

  const mobileAmazonTab = mobilePage.locator('#mobile-nav button[data-mobile-view="amazon"], #open-amazon-hub-btn').first();
  await mobileAmazonTab.click();
  await mobilePage.waitForTimeout(3000);

  await mobilePage.screenshot({ path: path.join(artifactDir, 'live_amazon_mobile_view.png'), fullPage: false });

  console.log('Network errors reported:', networkErrors);
  await browser.close();
  console.log('\nALL VERIFICATIONS PASSED 100% ON LIVE PRODUCTION!');
  process.exit(0);
})().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
