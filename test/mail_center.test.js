const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const auth = require('../auth');
const { defaultMailDatabase: db } = require('../database');
const validators = require('../validators');

test('1. Auth Module & PIN Verification', async (t) => {
  await t.test('verifies correct default PIN 0530', () => {
    assert.equal(auth.verifyPin('0530'), true);
  });

  await t.test('rejects incorrect PIN timing-safely', () => {
    assert.equal(auth.verifyPin('1234'), false);
    assert.equal(auth.verifyPin('053'), false);
    assert.equal(auth.verifyPin('05300'), false);
    assert.equal(auth.verifyPin(''), false);
    assert.equal(auth.verifyPin(null), false);
  });

  await t.test('creates, validates, and revokes sessions in SQLite', () => {
    const session = auth.createSession('test-agent');
    assert.ok(session.token, 'Token should exist');
    assert.equal(typeof session.token, 'string');
    assert.equal(session.token.length, 64);

    const valid = auth.validateSession(session.token);
    assert.equal(valid, true, 'Session should be valid');

    const revoked = auth.revokeSession(session.token);
    assert.equal(revoked, true);

    const afterRevoke = auth.validateSession(session.token);
    assert.equal(afterRevoke, false);
  });
});

test('2. SQLite Native Database Operations', async (t) => {
  await t.test('verifies WAL journal mode is active', () => {
    const journalMode = db.db.prepare('PRAGMA journal_mode;').get();
    assert.equal(journalMode.journal_mode.toLowerCase(), 'wal');
  });

  await t.test('can save, retrieve, select, and delete inboxes', () => {
    const testId = 'test_inbox_' + Date.now();
    const testEmail = 'test_' + Date.now() + '@batabitoo.com';

    db.saveInbox({
      id: testId,
      email: testEmail,
      domain: 'batabitoo.com',
      isOfficial: true,
      label: 'صندوق اختبار',
      createdAt: new Date().toISOString()
    });

    const fetched = db.findInboxById(testId);
    assert.ok(fetched, 'Inbox should be retrievable by ID');
    assert.equal(fetched.email, testEmail);

    const fetchedByEmail = db.findInboxByEmail(testEmail);
    assert.ok(fetchedByEmail, 'Inbox should be retrievable by email');
    assert.equal(fetchedByEmail.id, testId);

    db.setActiveInboxId(testId);
    assert.equal(db.getActiveInboxId(), testId);

    db.updateInboxBanStatus(testId, 'confirmed', 'حساب مقيد للاختبار');
    const bannedInbox = db.findInboxById(testId);
    assert.equal(bannedInbox.banStatus, 'confirmed');
    assert.equal(bannedInbox.isBanned, true);

    const deleted = db.deleteInbox(testId);
    assert.equal(deleted, true);
    assert.equal(db.findInboxById(testId), null);
  });

  await t.test('can save, retrieve, and query messages for inbox', () => {
    const msgId = 'test_msg_' + Date.now();
    const testEmail = 'target_' + Date.now() + '@batabitoo.com';

    db.saveMessage({
      id: msgId,
      inboxEmail: testEmail,
      from: 'Amazon.sa <order-update@amazon.sa>',
      to: testEmail,
      subject: 'تم شحن طلبك 123',
      text: 'تفاصيل الشحن...',
      html: '<p>تفاصيل الشحن...</p>',
      createdAt: new Date().toISOString(),
      isAmazon: true
    });

    const msg = db.findMessageById(msgId);
    assert.ok(msg);
    assert.equal(msg.subject, 'تم شحن طلبك 123');
    assert.equal(msg.isAmazon, true);

    const inboxMsgs = db.getMessagesByInboxEmail(testEmail);
    assert.equal(inboxMsgs.length, 1);
    assert.equal(inboxMsgs[0].id, msgId);

    const deleted = db.deleteMessage(msgId);
    assert.equal(deleted, true);
    assert.equal(db.findMessageById(msgId), null);
  });
});

test('3. Schema Validators', async (t) => {
  await t.test('validates login payloads', () => {
    assert.equal(validators.validateLoginPayload({ pin: '0530' }).valid, true);
    assert.equal(validators.validateLoginPayload({ pin: '' }).valid, false);
    assert.equal(validators.validateLoginPayload({}).valid, false);
  });

  await t.test('validates official inbox creation payloads', () => {
    assert.equal(validators.validateOfficialCreatePayload({ email: 'ahmed@batabitoo.com' }).valid, true);
    assert.equal(validators.validateOfficialCreatePayload({ email: 'ahmed@gmail.com' }).valid, true);
    assert.equal(validators.validateOfficialCreatePayload({ email: 'invalid-email' }).valid, false);
    assert.equal(validators.validateOfficialCreatePayload({}).valid, false);
  });

  await t.test('validates ban status payloads', () => {
    assert.equal(validators.validateBanStatusPayload({ id: 'inbox_1', banStatus: 'confirmed' }).valid, true);
    assert.equal(validators.validateBanStatusPayload({ email: 'test@batabitoo.com', banStatus: 'safe' }).valid, true);
    assert.equal(validators.validateBanStatusPayload({ id: 'inbox_1', banStatus: 'invalid_status' }).valid, false);
    assert.equal(validators.validateBanStatusPayload({ banStatus: 'confirmed' }).valid, false);
  });

  await t.test('validates app version payloads', () => {
    assert.equal(validators.validateAppVersionPayload({
      latestVersionCode: 10,
      latestVersionName: '1.4.0',
      downloadUrl: 'https://github.com/ahmedroou/batabitoo-mail-center/releases/download/v1.4.0/Batabitoo-Mail-Center-1.4.0.apk'
    }).valid, true);

    assert.equal(validators.validateAppVersionPayload({
      latestVersionCode: 0,
      latestVersionName: '1.4.0'
    }).valid, false);
  });
});

test('4. Version Configuration & Hygiene', async (t) => {
  await t.test('public/version.json is synchronized with Android versionCode 10 (1.4.0)', () => {
    const vPath = path.join(__dirname, '..', 'public', 'version.json');
    const versionData = JSON.parse(fs.readFileSync(vPath, 'utf8'));
    assert.equal(versionData.latestVersionCode, 10);
    assert.equal(versionData.latestVersionName, '1.4.0');
    assert.ok(versionData.hasOwnProperty('sha256'), 'version.json must include sha256 property');
  });
});
