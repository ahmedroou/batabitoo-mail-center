"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const validators = require("../validators");

/* ========================================================================== */
/* 1. HELPER FUNCTIONS                                                       */
/* ========================================================================== */

test("isNonEmptyString enforces types, whitespace trimming, and maxLength", () => {
  assert.equal(validators.isNonEmptyString("valid string"), true);
  assert.equal(validators.isNonEmptyString("   trimmed   "), true);
  assert.equal(validators.isNonEmptyString(""), false);
  assert.equal(validators.isNonEmptyString("    "), false);
  assert.equal(validators.isNonEmptyString(null), false);
  assert.equal(validators.isNonEmptyString(undefined), false);
  assert.equal(validators.isNonEmptyString(12345), false);
  assert.equal(validators.isNonEmptyString({}), false);
  assert.equal(validators.isNonEmptyString([]), false);
  assert.equal(validators.isNonEmptyString("a".repeat(10), 5), false);
  assert.equal(validators.isNonEmptyString("a".repeat(5), 5), true);
  assert.equal(validators.isNonEmptyString("a".repeat(1001)), false, "Exceeds default 1000 max length");
  assert.equal(validators.isNonEmptyString("a".repeat(1000)), true, "Meets default 1000 max length");
});

test("isValidEmail validates RFC format, casing, and length limits", () => {
  assert.equal(validators.isValidEmail("user@batabitoo.com"), true);
  assert.equal(validators.isValidEmail("USER@BATABITOO.COM"), true);
  assert.equal(validators.isValidEmail("user.name+tag@sub.domain.org"), true);
  assert.equal(validators.isValidEmail("invalid-email"), false);
  assert.equal(validators.isValidEmail("@missing-user.com"), false);
  assert.equal(validators.isValidEmail("user@missing-tld"), false);
  assert.equal(validators.isValidEmail(""), false);
  assert.equal(validators.isValidEmail(null), false);
  assert.equal(validators.isValidEmail(123), false);
  assert.equal(validators.isValidEmail(`${"a".repeat(250)}@batabitoo.com`), false, "Length > 255 rejected");
});

test("isValidHttpsUrl accepts only valid HTTPS protocols", () => {
  assert.equal(validators.isValidHttpsUrl("https://example.com/app.apk"), true);
  assert.equal(validators.isValidHttpsUrl("https://batabitoo-mail-2026.web.app"), true);
  assert.equal(validators.isValidHttpsUrl("http://insecure.com/app.apk"), false);
  assert.equal(validators.isValidHttpsUrl("ftp://files.example.com"), false);
  assert.equal(validators.isValidHttpsUrl("javascript:alert(1)"), false);
  assert.equal(validators.isValidHttpsUrl("data:text/plain;base64,abc"), false);
  assert.equal(validators.isValidHttpsUrl("not-a-url"), false);
  assert.equal(validators.isValidHttpsUrl(""), false);
  assert.equal(validators.isValidHttpsUrl(null), false);
  assert.equal(validators.isValidHttpsUrl("https://" + "a".repeat(2048)), false, "Exceeds 2048 chars");
});

test("isValidSha256 validates 64-hex strings and allows empty/optional values", () => {
  assert.equal(validators.isValidSha256(""), true, "Empty is optional");
  assert.equal(validators.isValidSha256(null), true, "Null is optional");
  assert.equal(validators.isValidSha256(undefined), true, "Undefined is optional");
  assert.equal(validators.isValidSha256("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"), true);
  assert.equal(validators.isValidSha256("E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855"), true);
  assert.equal(validators.isValidSha256("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85"), false, "63 chars");
  assert.equal(validators.isValidSha256("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b8555"), false, "65 chars");
  assert.equal(validators.isValidSha256("g3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"), false, "Non-hex char 'g'");
});

/* ========================================================================== */
/* 2. validateLoginPayload                                                    */
/* ========================================================================== */

test("validateLoginPayload validates pin/password and rejects malformed inputs", () => {
  assert.equal(validators.validateLoginPayload({ pin: "0530" }).valid, true);
  assert.equal(validators.validateLoginPayload({ pin: "  0530  " }).data.pin, "0530");
  assert.equal(validators.validateLoginPayload({ password: "my-secret-password" }).data.pin, "my-secret-password");
  assert.equal(validators.validateLoginPayload({ pin: "" }).valid, false);
  assert.equal(validators.validateLoginPayload({ pin: "   " }).valid, false);
  assert.equal(validators.validateLoginPayload({ pin: "a".repeat(129) }).valid, false);
  assert.equal(validators.validateLoginPayload(null).valid, false);
  assert.equal(validators.validateLoginPayload([]).valid, false, "Array rejected");
  assert.equal(validators.validateLoginPayload("raw_string").valid, false);
  assert.equal(validators.validateLoginPayload(1234).valid, false);
});

/* ========================================================================== */
/* 3. validateAppVersionPayload                                               */
/* ========================================================================== */

test("validateAppVersionPayload validates integer version code, HTTPS url, and rejects booleans", () => {
  const valid = validators.validateAppVersionPayload({
    latestVersionCode: 11,
    latestVersionName: "1.4.1",
    downloadUrl: "https://batabitoo.com/app.apk",
    sha256: "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
    mandatory: 1,
    releaseNotes: "Critical fixes",
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.data.latestVersionCode, 11);
  assert.equal(valid.data.latestVersionName, "1.4.1");
  assert.equal(valid.data.sha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(valid.data.mandatory, true);

  // Reject boolean latestVersionCode
  assert.equal(validators.validateAppVersionPayload({ latestVersionCode: true, latestVersionName: "1.0", downloadUrl: "https://x.com/a.apk" }).valid, false);
  assert.equal(validators.validateAppVersionPayload({ latestVersionCode: false, latestVersionName: "1.0", downloadUrl: "https://x.com/a.apk" }).valid, false);

  // Reject negative, zero, float
  assert.equal(validators.validateAppVersionPayload({ latestVersionCode: 0, latestVersionName: "1.0", downloadUrl: "https://x.com/a.apk" }).valid, false);
  assert.equal(validators.validateAppVersionPayload({ latestVersionCode: -5, latestVersionName: "1.0", downloadUrl: "https://x.com/a.apk" }).valid, false);
  assert.equal(validators.validateAppVersionPayload({ latestVersionCode: 1.5, latestVersionName: "1.0", downloadUrl: "https://x.com/a.apk" }).valid, false);

  // Reject invalid URLs
  assert.equal(validators.validateAppVersionPayload({ latestVersionCode: 1, latestVersionName: "1.0", downloadUrl: "http://insecure.com/a.apk" }).valid, false);

  // Reject invalid sha256
  assert.equal(validators.validateAppVersionPayload({ latestVersionCode: 1, latestVersionName: "1.0", downloadUrl: "https://x.com/a.apk", sha256: "short" }).valid, false);

  // Reject non-objects and arrays
  assert.equal(validators.validateAppVersionPayload([]).valid, false);
  assert.equal(validators.validateAppVersionPayload(null).valid, false);
});

/* ========================================================================== */
/* 4. validateOfficialCreatePayload                                           */
/* ========================================================================== */

test("validateOfficialCreatePayload allows @batabitoo.com and @gmail.com, rejects other domains", () => {
  const v1 = validators.validateOfficialCreatePayload({ email: "Support@Batabitoo.com" });
  assert.equal(v1.valid, true);
  assert.equal(v1.data.email, "support@batabitoo.com");
  assert.equal(v1.data.label, "support");
  assert.equal(v1.data.personName, "support");

  const v2 = validators.validateOfficialCreatePayload({ email: "admin@gmail.com", label: "My Admin", personName: "Admin Person" });
  assert.equal(v2.valid, true);
  assert.equal(v2.data.label, "My Admin");
  assert.equal(v2.data.personName, "Admin Person");

  // Unauthorized domains
  assert.equal(validators.validateOfficialCreatePayload({ email: "user@yahoo.com" }).valid, false);
  assert.equal(validators.validateOfficialCreatePayload({ email: "user@outlook.com" }).valid, false);
  assert.equal(validators.validateOfficialCreatePayload({ email: "attacker@malicious.org" }).valid, false);
  assert.equal(validators.validateOfficialCreatePayload({ email: "not-an-email" }).valid, false);
  assert.equal(validators.validateOfficialCreatePayload([]).valid, false);
  assert.equal(validators.validateOfficialCreatePayload(null).valid, false);
});

/* ========================================================================== */
/* 5. validateBanStatusPayload (Bug Fix Verification)                         */
/* ========================================================================== */

test("validateBanStatusPayload resolves target identifier correctly from inboxId, id, or email", () => {
  // 1. By inboxId
  const r1 = validators.validateBanStatusPayload({ inboxId: "inbox_123", banStatus: "confirmed" });
  assert.equal(r1.valid, true);
  assert.equal(r1.data.inboxId, "inbox_123");
  assert.equal(r1.data.id, "inbox_123");

  // 2. By id (Fix verification)
  const r2 = validators.validateBanStatusPayload({ id: "inbox_456", banStatus: "suspected" });
  assert.equal(r2.valid, true);
  assert.equal(r2.data.inboxId, "inbox_456");
  assert.equal(r2.data.id, "inbox_456");

  // 3. By email
  const r3 = validators.validateBanStatusPayload({ email: "user@batabitoo.com", banStatus: "safe" });
  assert.equal(r3.valid, true);
  assert.equal(r3.data.inboxId, "user@batabitoo.com");

  // 4. Precedence: inboxId > id > email
  const r4 = validators.validateBanStatusPayload({ inboxId: "box_top", id: "box_sub", email: "sub@example.com", status: "none" });
  assert.equal(r4.valid, true);
  assert.equal(r4.data.inboxId, "box_top");

  // 5. Trimming
  const r5 = validators.validateBanStatusPayload({ id: "   box_trimmed   ", status: "safe" });
  assert.equal(r5.valid, true);
  assert.equal(r5.data.inboxId, "box_trimmed");

  // 6. Enum statuses
  for (const st of ["confirmed", "suspected", "safe", "none", "CONFIRMED", "Safe"]) {
    assert.equal(validators.validateBanStatusPayload({ id: "box", status: st }).valid, true);
  }

  // 7. Rejections
  assert.equal(validators.validateBanStatusPayload({ id: "box", status: "banned" }).valid, false);
  assert.equal(validators.validateBanStatusPayload({ id: "box", status: "unknown" }).valid, false);
  assert.equal(validators.validateBanStatusPayload({}).valid, false);
  assert.equal(validators.validateBanStatusPayload({ banStatus: "confirmed" }).valid, false);
  assert.equal(validators.validateBanStatusPayload({ id: "   " }).valid, false);
  assert.equal(validators.validateBanStatusPayload({ id: 12345, status: "safe" }).valid, false);
  assert.equal(validators.validateBanStatusPayload({ id: "a".repeat(256), status: "safe" }).valid, false);
  assert.equal(validators.validateBanStatusPayload([]).valid, false);
  assert.equal(validators.validateBanStatusPayload(null).valid, false);

  // 8. Reason slicing
  const longReason = "r".repeat(600);
  const rLong = validators.validateBanStatusPayload({ id: "box1", status: "safe", reason: longReason });
  assert.equal(rLong.data.reason.length, 500);
});

/* ========================================================================== */
/* 6. validateNiveaLogPayload                                                 */
/* ========================================================================== */

test("validateNiveaLogPayload validates registrations and preserves zero index", () => {
  const valid = {
    personName: "سارة محمد",
    mobile: "0551234567",
    realEmail: "sara@example.com",
    city: "جدة",
    receiptNumber: "INV-1002",
    index: 0
  };
  const res = validators.validateNiveaLogPayload(valid);
  assert.equal(res.valid, true);
  assert.equal(res.data.personName, "سارة محمد");
  assert.equal(res.data.mobile, "0551234567");
  assert.equal(res.data.city, "جدة");
  assert.equal(res.data.index, 0, "Index 0 must be preserved as number 0, not null");

  // Non-zero index
  const res42 = validators.validateNiveaLogPayload({ personName: "علي", mobile: "0501112233", index: 42 });
  assert.equal(res42.data.index, 42);

  // Missing index
  const resNoIdx = validators.validateNiveaLogPayload({ personName: "علي", mobile: "0501112233" });
  assert.equal(resNoIdx.data.index, null);

  // Non-numeric index
  const resBadIdx = validators.validateNiveaLogPayload({ personName: "علي", mobile: "0501112233", index: "not_a_number" });
  assert.equal(resBadIdx.data.index, null);

  // Rejections
  assert.equal(validators.validateNiveaLogPayload({ mobile: "0551234567" }).valid, false);
  assert.equal(validators.validateNiveaLogPayload({ personName: "   ", mobile: "0551234567" }).valid, false);
  assert.equal(validators.validateNiveaLogPayload({ personName: "سارة" }).valid, false);
  assert.equal(validators.validateNiveaLogPayload({ personName: "سارة", mobile: "   " }).valid, false);
  assert.equal(validators.validateNiveaLogPayload({ personName: "a".repeat(101), mobile: "0551234567" }).valid, false);
  assert.equal(validators.validateNiveaLogPayload([]).valid, false);
  assert.equal(validators.validateNiveaLogPayload(null).valid, false);
});
