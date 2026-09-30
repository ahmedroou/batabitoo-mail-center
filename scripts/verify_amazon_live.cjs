const { chromium } = require('playwright');
const path = require('path');

const artifactDir = 'C:/Users/ayami/.gemini/antigravity/brain/8f7d1285-40f9-49c3-b4ea-5e20916cd558';

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  // 1. Desktop Test (1440x900)
  console.log('--- TESTING DESKTOP (1440x900) ---');
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desktopPage = await desktopContext.newPage();
  
  const consoleLogs = [];
  const networkErrors = [];
  desktopPage.on('console', msg => consoleLogs.push(msg.text()));
  desktopPage.on('response', res => {
    if (res.status() >= 400) {
      networkErrors.push({ url: res.url(), status: res.status() });
    }
  });

  await desktopPage.goto('https://batabitoo-mail-2026.web.app/', { waitUntil: 'networkidle' });
  await desktopPage.waitForTimeout(1000);

  // Keypad PIN entry
  const keypad = desktopPage.locator('#pin-keypad');
  if (await keypad.isVisible()) {
    console.log('Entering PIN: 0 5 3 0...');
    await desktopPage.click('#pin-keypad button[data-digit="0"]');
    await desktopPage.click('#pin-keypad button[data-digit="5"]');
    await desktopPage.click('#pin-keypad button[data-digit="3"]');
    await desktopPage.click('#pin-keypad button[data-digit="0"]');
    await desktopPage.waitForTimeout(4000);
  }

  // Check for cart emoji in page text
  const fullText = await desktopPage.innerText('body');
  const cartEmojiCount = (fullText.match(/🛒/g) || []).length;
  console.log(`Cart emoji (🛒) occurrences in visible text: ${cartEmojiCount}`);

  // Open Amazon Hub
  console.log('Opening Amazon Hub...');
  const amazonTab = desktopPage.locator('#tab-amazon, button[data-view="amazon"], #open-amazon-hub-btn').first();
  await amazonTab.click();
  await desktopPage.waitForTimeout(2000);

  // Check Amazon accounts
  const amazonAccounts = await desktopPage.$$eval('#amazon-inboxes-reel .amazon-account-card', cards => {
    return cards.map(c => ({
      email: c.querySelector('.amazon-account-email')?.textContent?.trim() || '',
      title: c.querySelector('.amazon-account-name')?.textContent?.trim() || ''
    }));
  });
  console.log('Amazon Accounts detected:', amazonAccounts.length, amazonAccounts);

  await desktopPage.screenshot({ path: path.join(artifactDir, 'live_amazon_accounts_desktop.png'), fullPage: false });

  // Click on the first Amazon account to open its message box
  if (amazonAccounts.length > 0) {
    console.log(`Clicking on first Amazon account (${amazonAccounts[0].email})...`);
    const firstAccountCard = desktopPage.locator('#amazon-inboxes-reel .amazon-account-card').first();
    const messagesBtn = firstAccountCard.locator('[data-amazon-messages]').first();
    
    if (await messagesBtn.isVisible()) {
      await messagesBtn.click();
    } else {
      await firstAccountCard.click();
    }
    
    await desktopPage.waitForTimeout(2500);

    // Verify messages stream is visible and active
    const isMessagesViewVisible = await desktopPage.isVisible('#amazon-message-list');
    const messagesHeaderText = await desktopPage.locator('#amazon-results-title').textContent().catch(() => '');
    const messageCardsCount = await desktopPage.locator('#amazon-message-list .message-card').count();
    const emptyStateVisible = await desktopPage.isVisible('#amazon-message-list .empty-state');

    console.log('Messages view (#amazon-message-list) visible:', isMessagesViewVisible);
    console.log('Messages header text:', messagesHeaderText.trim());
    console.log('Messages rendered count:', messageCardsCount);
    console.log('Empty state visible:', emptyStateVisible);

    await desktopPage.screenshot({ path: path.join(artifactDir, 'live_amazon_messages_desktop.png'), fullPage: false });
  }

  // 2. Mobile Test (390x844)
  console.log('\n--- TESTING MOBILE (390x844) ---');
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

  const mobileAmazonTab = mobilePage.locator('#tab-amazon, button[data-view="amazon"], #open-amazon-hub-btn').first();
  await mobileAmazonTab.click();
  await mobilePage.waitForTimeout(2000);

  await mobilePage.screenshot({ path: path.join(artifactDir, 'live_amazon_accounts_mobile.png'), fullPage: false });

  const firstMobileCard = mobilePage.locator('#amazon-inboxes-reel .amazon-account-card').first();
  if (await firstMobileCard.isVisible()) {
    const mobileMsgBtn = firstMobileCard.locator('[data-amazon-messages]').first();
    if (await mobileMsgBtn.isVisible()) {
      await mobileMsgBtn.click();
    } else {
      await firstMobileCard.click();
    }
    await mobilePage.waitForTimeout(2500);
    await mobilePage.screenshot({ path: path.join(artifactDir, 'live_amazon_messages_mobile.png'), fullPage: false });
  }

  console.log('\n--- NETWORK ERRORS REPORT ---');
  console.log('Network errors (>400):', networkErrors.filter(e => !e.url.includes('favicon')));

  await browser.close();
  console.log('Verification finished successfully!');
  process.exit(0);
})().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
