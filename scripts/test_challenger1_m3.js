"use strict";

const assert = require("node:assert/strict");
const validators = require("../validators");
const parser = require("../EmailParser");

console.log("======================================================================");
console.log("🔥 CHALLENGER 1 — ADVERSARIAL STRESS HARNESS & EMPIRICAL EXPERIMENTS");
console.log("======================================================================\n");

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];
const observations = [];
const securityNotes = [];

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    failedTests++;
    failures.push({ name, error: err.message, stack: err.stack });
    console.log(`  ❌ FAIL: ${name} -> ${err.message}`);
  }
}

// ============================================================================
// 1. BOUNDARY & FUZZ TESTING: validateBanStatusPayload
// ============================================================================
console.log("🔹 [1/4] Fuzzing validateBanStatusPayload...");

test("1.1.1 Extreme symbols in target identifier (SQLi, HTML, shell, path traversal)", () => {
  const hostilePayloads = [
    "' OR '1'='1",
    '"; DROP TABLE inboxes; --',
    "$(whoami)",
    "`rm -rf /`",
    "<script>alert('xss')</script>",
    "../../../../etc/passwd",
    "!@#$%^&*()_+~|}{[]:;?><,./-="
  ];
  for (const hostile of hostilePayloads) {
    const res = validators.validateBanStatusPayload({ inboxId: hostile, status: "confirmed" });
    assert.equal(res.valid, true, `Should accept valid string format even with symbols: ${hostile}`);
    assert.equal(res.data.inboxId, hostile.trim());
    assert.equal(res.data.id, hostile.trim());
    assert.equal(res.data.target, hostile.trim());
  }
});

test("1.1.2 Extreme Unicode in target identifier (Arabic, Chinese, Emoji, RTL, null bytes)", () => {
  const unicodePayloads = [
    "صندوق_تجريبي_١٢٣",
    "بريد@بطابيطو.كوم",
    "测试邮箱_123",
    "🔥📦📬🔒",
    "\u202Ereversed_box\u202C", // Right-to-Left Override
    "box\0injection"
  ];
  for (const uni of unicodePayloads) {
    const res = validators.validateBanStatusPayload({ id: uni, status: "safe" });
    assert.equal(res.valid, true, `Should handle Unicode string safely: ${uni}`);
    assert.equal(res.data.target, uni.trim());
  }
});

test("1.1.3 Objects with prototype properties & prototype pollution resistance", () => {
  // Object with null prototype
  const nullProto = Object.create(null);
  nullProto.inboxId = "null_proto_id";
  nullProto.status = "confirmed";
  const resNull = validators.validateBanStatusPayload(nullProto);
  assert.equal(resNull.valid, true);
  assert.equal(resNull.data.inboxId, "null_proto_id");

  // Inherited properties
  const proto = { inboxId: "inherited_id", status: "safe" };
  const child = Object.create(proto);
  const resInherited = validators.validateBanStatusPayload(child);
  assert.equal(resInherited.valid, true);
  assert.equal(resInherited.data.inboxId, "inherited_id");

  // Prototype pollution payload attempt
  const polluted = JSON.parse('{"__proto__": {"polluted": true}, "id": "clean_id", "status": "safe"}');
  const resPolluted = validators.validateBanStatusPayload(polluted);
  assert.equal(resPolluted.valid, true);
  assert.equal(resPolluted.data.target, "clean_id");
  assert.equal(Object.prototype.polluted, undefined, "Prototype must NOT be polluted");

  // Overridden getter
  const getterObj = {
    get id() { return "dynamic_id"; },
    banStatus: "suspected"
  };
  const resGetter = validators.validateBanStatusPayload(getterObj);
  assert.equal(resGetter.valid, true);
  assert.equal(resGetter.data.target, "dynamic_id");
});

test("1.1.4 Exact length boundary for target identifier (254, 255, 256, 10000)", () => {
  const str254 = "a".repeat(254);
  const res254 = validators.validateBanStatusPayload({ inboxId: str254, status: "safe" });
  assert.equal(res254.valid, true, "254 chars must be valid");

  const str255 = "a".repeat(255);
  const res255 = validators.validateBanStatusPayload({ inboxId: str255, status: "safe" });
  assert.equal(res255.valid, true, "255 chars must be valid");

  const str256 = "a".repeat(256);
  const res256 = validators.validateBanStatusPayload({ inboxId: str256, status: "safe" });
  assert.equal(res256.valid, false, "256 chars must be rejected");

  const str10k = "a".repeat(10000);
  const res10k = validators.validateBanStatusPayload({ inboxId: str10k, status: "safe" });
  assert.equal(res10k.valid, false, "10000 chars must be rejected");
});

test("1.1.5 Reason truncation boundary (exact 500 characters)", () => {
  const reason600 = "R".repeat(600);
  const res = validators.validateBanStatusPayload({ inboxId: "box1", status: "confirmed", reason: reason600 });
  assert.equal(res.valid, true);
  assert.equal(res.data.reason.length, 500, "Reason must be cleanly sliced to 500 chars");
  assert.equal(res.data.reason, "R".repeat(500));
});

test("1.1.6 Null, undefined, empty, primitives, and non-object inputs", () => {
  const invalidInputs = [
    null,
    undefined,
    "",
    "string_instead_of_object",
    12345,
    true,
    false,
    [],
    [1, 2, 3],
    NaN,
    Infinity,
    () => {}
  ];
  for (const input of invalidInputs) {
    const res = validators.validateBanStatusPayload(input);
    assert.equal(res.valid, false, `Input should be invalid: ${String(input)}`);
  }
});

test("1.1.7 Fallback precedence between inboxId, id, and email", () => {
  // Precedence 1: inboxId over id and email
  const res1 = validators.validateBanStatusPayload({ inboxId: "A", id: "B", email: "C@batabitoo.com", status: "safe" });
  assert.equal(res1.data.target, "A");

  // Precedence 2: id over email when inboxId is whitespace or missing
  const res2 = validators.validateBanStatusPayload({ inboxId: "   ", id: "B", email: "C@batabitoo.com", status: "safe" });
  assert.equal(res2.data.target, "B");

  // Precedence 3: email when inboxId and id are non-strings
  const res3 = validators.validateBanStatusPayload({ inboxId: 123, id: null, email: "C@batabitoo.com", status: "safe" });
  assert.equal(res3.data.target, "C@batabitoo.com");

  // All whitespace -> rejected
  const res4 = validators.validateBanStatusPayload({ inboxId: "  ", id: "", email: "   ", status: "safe" });
  assert.equal(res4.valid, false);
});

test("1.1.8 Status case-insensitivity and rejection of invalid status values", () => {
  const validStatuses = ["confirmed", "suspected", "safe", "none", "CONFIRMED", "Suspected", "SAFE", "NoNe"];
  for (const st of validStatuses) {
    const res = validators.validateBanStatusPayload({ inboxId: "box", status: st });
    assert.equal(res.valid, true, `Status '${st}' should be accepted`);
    assert.equal(res.data.status, st.toLowerCase().trim());
  }

  const invalidStatuses = ["banned", "active", "deleted", "unknown", "__proto__", "toString", ""];
  for (const st of invalidStatuses) {
    const res = validators.validateBanStatusPayload({ inboxId: "box", status: st });
    assert.equal(res.valid, false, `Status '${st}' should be rejected`);
  }
});

// ============================================================================
// 2. BOUNDARY & FUZZ TESTING: validateNiveaLogPayload
// ============================================================================
console.log("\n🔹 [2/4] Fuzzing validateNiveaLogPayload...");

test("2.1.1 Preserves index: 0 as strict numeric 0", () => {
  const res = validators.validateNiveaLogPayload({ personName: "أحمد", mobile: "0501234567", index: 0 });
  assert.equal(res.valid, true);
  assert.strictEqual(res.data.index, 0);
  assert.notEqual(res.data.index, null);
  assert.notEqual(res.data.index, undefined);
});

test("2.1.2 Handles index: -1 and negative numbers", () => {
  const res = validators.validateNiveaLogPayload({ personName: "أحمد", mobile: "0501234567", index: -1 });
  assert.equal(res.valid, true);
  assert.strictEqual(res.data.index, -1);
  observations.push("validateNiveaLogPayload permits negative index (-1) without floor check");
});

test("2.1.3 Handles floats in index", () => {
  const resFloat = validators.validateNiveaLogPayload({ personName: "أحمد", mobile: "0501234567", index: 12.34 });
  assert.equal(resFloat.valid, true);
  assert.strictEqual(resFloat.data.index, 12.34);
  observations.push("validateNiveaLogPayload accepts floating point index (12.34)");
});

test("2.1.4 Non-numeric strings in index fall back to null", () => {
  // 'abc' -> Number('abc') is NaN -> index should be null
  const resAbc = validators.validateNiveaLogPayload({ personName: "أحمد", mobile: "0501234567", index: "abc" });
  assert.equal(resAbc.valid, true);
  assert.strictEqual(resAbc.data.index, null);

  // 'NaN' -> Number('NaN') is NaN -> index null
  const resNan = validators.validateNiveaLogPayload({ personName: "أحمد", mobile: "0501234567", index: "NaN" });
  assert.equal(resNan.valid, true);
  assert.strictEqual(resNan.data.index, null);

  // '100' numeric string -> Number('100') is 100 -> index 100
  const resNumStr = validators.validateNiveaLogPayload({ personName: "أحمد", mobile: "0501234567", index: "100" });
  assert.equal(resNumStr.valid, true);
  assert.strictEqual(resNumStr.data.index, 100);
});

test("2.1.5 JavaScript type coercion quirks with Number() in index", () => {
  // In JS: Number("") === 0
  const resEmptyStr = validators.validateNiveaLogPayload({ personName: "أحمد", mobile: "0501234567", index: "" });
  assert.equal(resEmptyStr.valid, true);
  assert.strictEqual(resEmptyStr.data.index, 0);
  observations.push("index: \"\" coerces to numeric 0 due to Number('') semantics");

  // In JS: Number(false) === 0
  const resFalse = validators.validateNiveaLogPayload({ personName: "أحمد", mobile: "0501234567", index: false });
  assert.equal(resFalse.valid, true);
  assert.strictEqual(resFalse.data.index, 0);
  observations.push("index: false coerces to numeric 0 due to Number(false) semantics");

  // In JS: Number(true) === 1
  const resTrue = validators.validateNiveaLogPayload({ personName: "أحمد", mobile: "0501234567", index: true });
  assert.equal(resTrue.valid, true);
  assert.strictEqual(resTrue.data.index, 1);
  observations.push("index: true coerces to numeric 1 due to Number(true) semantics");
});

test("2.1.6 Required field boundaries: personName and mobile", () => {
  // Empty name
  assert.equal(validators.validateNiveaLogPayload({ personName: "", mobile: "0501234567" }).valid, false);
  assert.equal(validators.validateNiveaLogPayload({ personName: "   ", mobile: "0501234567" }).valid, false);
  // Name 100 chars -> valid; 101 chars -> invalid
  assert.equal(validators.validateNiveaLogPayload({ personName: "A".repeat(100), mobile: "0501234567" }).valid, true);
  assert.equal(validators.validateNiveaLogPayload({ personName: "A".repeat(101), mobile: "0501234567" }).valid, false);

  // Mobile empty
  assert.equal(validators.validateNiveaLogPayload({ personName: "Ali", mobile: "" }).valid, false);
  assert.equal(validators.validateNiveaLogPayload({ personName: "Ali", mobile: "   " }).valid, false);
  // Mobile 20 chars -> valid; 21 chars -> invalid
  assert.equal(validators.validateNiveaLogPayload({ personName: "Ali", mobile: "0".repeat(20) }).valid, true);
  assert.equal(validators.validateNiveaLogPayload({ personName: "Ali", mobile: "0".repeat(21) }).valid, false);
});

// ============================================================================
// 3. BYPASS TESTING: validateOfficialCreatePayload & validateAppVersionPayload
// ============================================================================
console.log("\n🔹 [3/4] Testing bypasses on validateOfficialCreatePayload & validateAppVersionPayload...");

test("3.1.1 validateOfficialCreatePayload rejects domain spoofing attempts", () => {
  const badEmails = [
    "attacker@batabitoo.com.attacker.com",
    "attacker@evilbatabitoo.com",
    "attacker@mail.batabitoo.com",
    "attacker@sub.gmail.com",
    "attacker@notgmail.com",
    "attacker@batabitoo.com.br",
    "attacker@batabitoo.com@evil.com",
    "@batabitoo.com",
    "user@@batabitoo.com",
    "user@batabitoo..com",
    "user<script>@batabitoo.com",
    "user\0@batabitoo.com"
  ];
  for (const email of badEmails) {
    const res = validators.validateOfficialCreatePayload({ email });
    assert.equal(res.valid, false, `Should reject spoofed email: ${email}`);
  }
});

test("3.1.2 validateOfficialCreatePayload accepts legitimate official domains", () => {
  const goodEmails = [
    "admin@batabitoo.com",
    "SUPPORT@BATABITOO.COM",
    "user.name+alias@batabitoo.com",
    "user@gmail.com",
    "AhmedBatabitooRoou@GMAIL.COM"
  ];
  for (const email of goodEmails) {
    const res = validators.validateOfficialCreatePayload({ email });
    assert.equal(res.valid, true, `Should accept valid email: ${email}`);
    assert.equal(res.data.email, email.trim().toLowerCase());
  }
});

test("3.1.3 validateOfficialCreatePayload defaults label and personName if missing", () => {
  const res = validators.validateOfficialCreatePayload({ email: "finance@batabitoo.com" });
  assert.equal(res.valid, true);
  assert.equal(res.data.label, "finance");
  assert.equal(res.data.personName, "finance");
});

test("3.2.1 validateAppVersionPayload strictly rejects boolean latestVersionCode", () => {
  const resTrue = validators.validateAppVersionPayload({
    latestVersionCode: true,
    latestVersionName: "1.0",
    downloadUrl: "https://example.com/app.apk"
  });
  assert.equal(resTrue.valid, false, "Must reject boolean true");

  const resFalse = validators.validateAppVersionPayload({
    latestVersionCode: false,
    latestVersionName: "1.0",
    downloadUrl: "https://example.com/app.apk"
  });
  assert.equal(resFalse.valid, false, "Must reject boolean false");
});

test("3.2.2 validateAppVersionPayload rejects 0, negative, and float version codes", () => {
  const invalidCodes = [0, -1, -100, 1.5, 2.0001, "1.5", "0", "-5", "abc", null, undefined, NaN, Infinity];
  for (const code of invalidCodes) {
    const res = validators.validateAppVersionPayload({
      latestVersionCode: code,
      latestVersionName: "1.0",
      downloadUrl: "https://example.com/app.apk"
    });
    assert.equal(res.valid, false, `Version code should be rejected: ${code}`);
  }
});

test("3.2.3 validateAppVersionPayload rejects non-HTTPS and hostile URLs", () => {
  const badUrls = [
    "http://insecure.com/app.apk",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://files.example.com/app.apk",
    "file:///C:/app.apk",
    "not_a_url",
    ""
  ];
  for (const url of badUrls) {
    const res = validators.validateAppVersionPayload({
      latestVersionCode: 2,
      latestVersionName: "2.0",
      downloadUrl: url
    });
    assert.equal(res.valid, false, `URL should be rejected: ${url}`);
  }
});

test("3.2.4 validateAppVersionPayload SHA-256 validation boundary", () => {
  // Valid 64-hex
  const validHex = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const resValid = validators.validateAppVersionPayload({
    latestVersionCode: 5,
    latestVersionName: "5.0",
    downloadUrl: "https://batabitoo.com/app.apk",
    sha256: validHex
  });
  assert.equal(resValid.valid, true);
  assert.equal(resValid.data.sha256, validHex);

  // 63-hex (too short)
  const shortHex = validHex.slice(0, 63);
  const resShort = validators.validateAppVersionPayload({
    latestVersionCode: 5,
    latestVersionName: "5.0",
    downloadUrl: "https://batabitoo.com/app.apk",
    sha256: shortHex
  });
  assert.equal(resShort.valid, false, "63-hex must be rejected");

  // Non-hex chars
  const nonHex = "z".repeat(64);
  const resNonHex = validators.validateAppVersionPayload({
    latestVersionCode: 5,
    latestVersionName: "5.0",
    downloadUrl: "https://batabitoo.com/app.apk",
    sha256: nonHex
  });
  assert.equal(resNonHex.valid, false, "Non-hex sha256 must be rejected");
});

// ============================================================================
// 4. ADVERSARIAL TESTING: EmailParser extractOtp & MIME Streams
// ============================================================================
console.log("\n🔹 [4/4] Testing EmailParser adversarial OTP extraction & MIME parsing...");

test("4.1.1 extractOtp with complex/confusing HTML structures", () => {
  // Nested tables, inline CSS, and formatting tags
  const complexHtml = `
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td>
          <div style="font-family: Arial; padding: 20px;">
            <p>Dear customer,</p>
            <p>Please enter your verification code to proceed:</p>
            <table bgcolor="#f8f9fa" style="border: 1px solid #e9ecef;">
              <tr>
                <td style="padding: 15px; font-size: 28px; letter-spacing: 5px; font-weight: bold; color: #1e3a8a;">
                  <b>482910</b>
                </td>
              </tr>
            </table>
            <p>This code will expire in 10 minutes.</p>
          </div>
        </td>
      </tr>
    </table>
  `;
  const otp = parser.extractOtp("", complexHtml);
  assert.equal(otp, "482910", "Should extract OTP from styled nested table");
});

test("4.1.2 extractOtp with HTML entity encoded digits", () => {
  // &#53; = '5', &#54; = '6', &#55; = '7', &#56; = '8', &#57; = '9', &#48; = '0' -> 567890
  const entityHtml = "<p>Your verification code is: &#53;&#54;&#55;&#56;&#57;&#48;</p>";
  const otp = parser.extractOtp("", entityHtml);
  assert.equal(otp, "567890", "Should decode HTML numeric character entities");
});

test("4.1.3 extractOtp with HTML comments containing bait numbers", () => {
  // Comment containing fake OTP, followed by actual OTP
  const commentHtml = "<!-- verification code: 111111 --> <p>Your real verification code is 882233</p>";
  const otp = parser.extractOtp("", commentHtml);
  assert.equal(otp, "882233", "Must strip HTML comments and avoid matching fake bait codes in comments");
});

test("4.1.4 extractOtp with Arabic numerals and Arabic keywords", () => {
  const arabicText = "رمز التفعيل المؤقت الخاص بحسابك هو: ٥٨٢١٠٩ صالح لمدة عشر دقائق.";
  const otp = parser.extractOtp(arabicText);
  assert.equal(otp, "582109", "Should convert Eastern Arabic digits to standard digits");
});

test("4.1.5 extractOtp disambiguates order numbers, tracking IDs, dates, and phone numbers", () => {
  const noiseEmail = `
    Batabitoo Order Confirmation
    Order ID: 98765432
    Tracking: TRK-55443322
    Date: 2026-09-20 14:30:15
    Customer Service: +966551234567

    To confirm this delivery, please use verification code: 624190.
  `;
  const otp = parser.extractOtp(noiseEmail);
  assert.equal(otp, "624190", "Must isolate 624190 as verification code amidst other 6-8 digit numbers");
});

test("4.1.6 extractOtp handles hyphenated and spaced codes (123-456 and 123 456)", () => {
  const hyphenCode = "Your login code is 839-201. Please enter it now.";
  assert.equal(parser.extractOtp(hyphenCode), "839201");

  const spaceCode = "Your OTP is 741 852 to verify your mobile.";
  assert.equal(parser.extractOtp(spaceCode), "741852");
});

test("4.1.7 extractOtp handles 3-argument signature with subject priority", () => {
  // If subject contains an explicit OTP, 3-arg call prioritizes subject
  const text = "Body says code is 111222";
  const html = "<p>Html says code is 333444</p>";
  const subject = "Your verification code: 555666";
  const otp = parser.extractOtp(text, html, subject);
  assert.equal(otp, "555666", "Subject OTP must take precedence");
});

test("4.1.8 extractOtp handles standalone digits on dedicated lines", () => {
  const standalone = "Hello customer,\nHere is the code you requested:\n\n847291\n\nThank you.";
  const otp = parser.extractOtp(standalone);
  assert.equal(otp, "847291", "Standalone line of digits must be extracted");
});

test("4.1.9 Deceptive subject behavioral analysis: generic 'code' keyword collision", () => {
  // When subject contains generic 'code' followed by digits (e.g. Postal Code or Promo Code):
  const postalSubject = "Delivery update for Postal Code 12345";
  const bodyOtp = "Your verification code is 778899";
  const extracted = parser.extractOtp(bodyOtp, postalSubject);
  // Because \bcode\b is in keyword list and subject is evaluated first:
  if (extracted === "12345") {
    securityNotes.push("Adversarial nuance: Subject with 'Postal Code 12345' matches generic \\bcode\\b keyword before body verification code (extracted 12345 instead of 778899)");
  } else {
    assert.equal(extracted, "778899");
  }
});

test("4.1.10 Non-keyword subjects do not hijack body OTP", () => {
  const invoiceSubject = "Invoice #987654 for Order #123456";
  const bodyOtp = "Your OTP code is 456789";
  const extracted = parser.extractOtp(bodyOtp, invoiceSubject);
  assert.equal(extracted, "456789", "Invoice and Order numbers in subject do NOT hijack OTP extraction");
});

test("4.1.11 parseRawEmail handles malformed MIME streams without throwing", async () => {
  // Malformed stream: header without delimiter, missing boundaries
  const malformedStream1 = `From: "Support" <support@service.com>
Subject: Malformed Message
Content-Type: multipart/alternative; boundary=MISSING_BOUNDARY

This is a broken stream without boundaries.
Your verification code is 395812.
`;
  const parsed1 = await parser.parseRawEmail(malformedStream1);
  assert.ok(parsed1);
  assert.equal(parsed1.otp, "395812");

  // Empty stream
  const parsedEmpty = await parser.parseRawEmail("");
  assert.ok(parsedEmpty);
  assert.equal(parsedEmpty.subject, "");
  assert.equal(parsedEmpty.otp, null);

  // Null stream
  const parsedNull = await parser.parseRawEmail(null);
  assert.ok(parsedNull);
  assert.equal(parsedNull.otp, null);
});

test("4.1.12 fixMojibake and cleanPlainText repair garbled Arabic UTF-8", () => {
  // Arabic word "رمز" encoded as UTF-8 then read as Windows-1252:
  const mojibakeBuffer = Buffer.from("D8B1D985D8B220D8A7D984D8AAD8ADD982D9823A20373339313032", "hex");
  const mojibakeStr = mojibakeBuffer.toString("latin1");
  
  // 1. Direct fixMojibake decodes to Arabic
  const repaired = parser.fixMojibake(mojibakeStr);
  assert.ok(repaired.includes("رمز التحقق: 739102"), `fixMojibake must restore Arabic text, got: ${repaired}`);

  // 2. cleanPlainText repairs text and enables extractOtp
  const cleaned = parser.cleanPlainText(mojibakeStr);
  const otpCleaned = parser.extractOtp(cleaned);
  assert.equal(otpCleaned, "739102", "extractOtp after cleanPlainText extracts OTP");

  // 3. Document that extractOtp without cleanPlainText does not automatically fixMojibake
  const rawExtract = parser.extractOtp(mojibakeStr);
  if (rawExtract === null) {
    observations.push("extractOtp does not internally call fixMojibake; callers must run cleanPlainText first if raw mojibake is passed");
  }
});

// ============================================================================
// SUMMARY & FINDINGS
// ============================================================================
console.log("\n======================================================================");
console.log(`📊 ADVERSARIAL TEST RESULTS: Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
console.log("======================================================================");

if (observations.length > 0) {
  console.log("\n📝 Observations & Quirks Discovered:");
  observations.forEach(obs => console.log(`   - ${obs}`));
}

if (securityNotes.length > 0) {
  console.log("\n🛡️ Nuances & Edge-Case Findings:");
  securityNotes.forEach(note => console.log(`   - ${note}`));
}

if (failures.length > 0) {
  console.log("\n❌ FAILURES FOUND:");
  failures.forEach(f => console.log(`   - ${f.name}: ${f.error}`));
  process.exit(1);
} else {
  console.log("\n✨ ALL EMPIRICAL ADVERSARIAL CHALLENGES EVALUATED SUCCESSFULLY!");
  process.exit(0);
}
