const test = require("node:test");
const assert = require("node:assert/strict");
const gmailSync = require("../GmailSyncService");
const { safeOAuthReturnTo, oauthReturnUrl } = require("../inbox_server");

test("Gmail canonical aliases resolve without touching the live Firestore account store", () => {
  const canonicalGmail = gmailSync.canonicalGmail;
  assert.equal(canonicalGmail("shatharoou55@gmail.com"), "shatharoou55@gmail.com");
  assert.equal(canonicalGmail("s.hatharoou.55@gmail.com"), "shatharoou55@gmail.com");
  assert.equal(canonicalGmail("s.h.a.t.h.a.r.o.o.u.5.5@gmail.com"), "shatharoou55@gmail.com");
});

test("Gmail sync module exposes a safe public account summary", () => {
  const accounts = gmailSync.getAccounts();
  assert.ok(Array.isArray(accounts));
  for (const account of accounts) {
    assert.equal(Object.hasOwn(account, "accessToken"), false);
    assert.equal(Object.hasOwn(account, "refreshToken"), false);
  }
});

test("OAuth return target is restricted to the app origin", () => {
  assert.equal(safeOAuthReturnTo("https://batabitoo-mail-2026.web.app/inbox?next=evil"), "https://batabitoo-mail-2026.web.app");
  assert.equal(safeOAuthReturnTo("https://batabitoo-mail-2026.web.app.evil.example"), "https://batabitoo-mail-2026.web.app");
  assert.equal(safeOAuthReturnTo("https://example.com"), "https://batabitoo-mail-2026.web.app");
  assert.equal(safeOAuthReturnTo("http://localhost:3030/anything"), "http://localhost:3030");
  assert.equal(oauthReturnUrl("https://batabitoo-mail-2026.web.app/path", "gmail_connected", "1"), "https://batabitoo-mail-2026.web.app/?gmail_connected=1");
});
