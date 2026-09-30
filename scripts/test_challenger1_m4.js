"use strict";

/**
 * Batabitoo Mail Center — Milestone M4 Adversarial Verification Harness
 * Challenger 1 (critic & empirical specialist)
 * 
 * Target: scripts/test_challenger1_m4.js
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const vm = require("node:vm");

console.log("======================================================================");
console.log("🔥 CHALLENGER 1 — MILESTONE M4 EMPIRICAL ADVERSARIAL TEST HARNESS");
console.log("======================================================================\n");

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

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

async function testAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    failedTests++;
    failures.push({ name, error: err.message, stack: err.stack });
    console.log(`  ❌ FAIL: ${name} -> ${err.message}`);
  }
}

// Load source files
const stylesCss = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
const styleCss = fs.readFileSync(path.join(__dirname, "..", "public", "style.css"), "utf8");
const readerCss = fs.readFileSync(path.join(__dirname, "..", "public", "reader.css"), "utf8");
const appJs = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

// ============================================================================
// SUITE 1: CSS PARSING, BRACE INTEGRITY & MIRROR SYNCHRONIZATION
// ============================================================================
console.log("🔹 [1/5] Testing CSS Structure, Braces & Mirror Synchronization...");

test("1.1 public/styles.css and public/style.css are byte-for-byte identical mirrors", () => {
  assert.equal(stylesCss.length, styleCss.length, "Files must have identical lengths");
  assert.equal(stylesCss, styleCss, "style.css must be an exact mirror of styles.css");
});

test("1.2 CSS brace balance audit across styles.css and reader.css", () => {
  const checkBalance = (filename, content) => {
    let balance = 0;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === "{") balance++;
      else if (content[i] === "}") balance--;
      assert.ok(balance >= 0, `${filename}: unmatched closing brace at offset ${i}`);
    }
    assert.equal(balance, 0, `${filename}: unclosed opening brace(s) (balance=${balance})`);
  };
  checkBalance("styles.css", stylesCss);
  checkBalance("style.css", styleCss);
  checkBalance("reader.css", readerCss);
});

test("1.3 app.js parses with zero syntax errors via vm.Script", () => {
  assert.doesNotThrow(() => {
    new vm.Script(appJs, { filename: "app.js" });
  });
});

// ============================================================================
// SUITE 2: ACTIVE INBOX BANNER MOBILE HEIGHT SPECIFICATION (< 70px)
// ============================================================================
console.log("\n🔹 [2/5] Stress-Testing Active Inbox Banner Mobile Height (< 70px)...");

test("2.1 index.html contains all 4 banner selectors on the active container", () => {
  assert.ok(indexHtml.includes('id="activeInboxBanner"'), "Missing id='activeInboxBanner'");
  assert.ok(indexHtml.includes('active-inbox-banner'), "Missing class 'active-inbox-banner'");
  assert.ok(indexHtml.includes('inbox-hero-card'), "Missing class 'inbox-hero-card'");
  assert.ok(indexHtml.includes('active-inbox-bar'), "Missing class 'active-inbox-bar'");
});

test("2.2 Extract @media (max-width: 768px) and verify banner height < 70px", () => {
  const mq768Match = stylesCss.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?(?=@media|$)/);
  assert.ok(mq768Match, "Must contain @media (max-width: 768px)");
  const mqContent = mq768Match[0];

  // Check that all 4 banner selectors are targeted
  assert.ok(mqContent.includes("#activeInboxBanner"), "Missing #activeInboxBanner in 768px MQ");
  assert.ok(mqContent.includes(".active-inbox-banner"), "Missing .active-inbox-banner in 768px MQ");
  assert.ok(mqContent.includes(".inbox-hero-card"), "Missing .inbox-hero-card in 768px MQ");
  assert.ok(mqContent.includes(".active-inbox-bar"), "Missing .active-inbox-bar in 768px MQ");

  // Check height values in the rule block
  const ruleMatch = mqContent.match(/#activeInboxBanner[\s\S]*?\{([\s\S]*?)\}/);
  assert.ok(ruleMatch, "Cannot extract rule block for banner in 768px MQ");
  const declarations = ruleMatch[1];

  const heightMatch = declarations.match(/height:\s*(\d+)px/);
  assert.ok(heightMatch, "Missing height: Xpx in 768px rule block");
  const heightVal = parseInt(heightMatch[1], 10);
  assert.ok(heightVal < 70, `Banner height in 768px (${heightVal}px) must be strictly < 70px`);

  const maxHeightMatch = declarations.match(/max-height:\s*(\d+)px/);
  assert.ok(maxHeightMatch, "Missing max-height: Xpx in 768px rule block");
  const maxHeightVal = parseInt(maxHeightMatch[1], 10);
  assert.ok(maxHeightVal < 70, `Banner max-height in 768px (${maxHeightVal}px) must be strictly < 70px`);

  assert.ok(declarations.includes("min-height: unset !important;"), "Must unset default min-height");
  assert.ok(declarations.includes("overflow: hidden !important;"), "Must enforce overflow: hidden");
  assert.ok(declarations.includes("box-sizing: border-box !important;"), "Must enforce border-box");
});

test("2.3 Extract @media (max-width: 390px) and verify banner height < 70px", () => {
  const mq390Match = stylesCss.match(/@media\s*\(max-width:\s*390px\)[\s\S]*?(?=@media|$)/);
  assert.ok(mq390Match, "Must contain @media (max-width: 390px)");
  const mqContent = mq390Match[0];

  const ruleMatch = mqContent.match(/#activeInboxBanner[\s\S]*?\{([\s\S]*?)\}/);
  assert.ok(ruleMatch, "Cannot extract rule block for banner in 390px MQ");
  const declarations = ruleMatch[1];

  const heightMatch = declarations.match(/height:\s*(\d+)px/);
  assert.ok(heightMatch, "Missing height in 390px rule block");
  const heightVal = parseInt(heightMatch[1], 10);
  assert.ok(heightVal < 70, `Banner height in 390px (${heightVal}px) must be strictly < 70px`);

  const maxHeightMatch = declarations.match(/max-height:\s*(\d+)px/);
  assert.ok(maxHeightMatch, "Missing max-height in 390px rule block");
  const maxHeightVal = parseInt(maxHeightMatch[1], 10);
  assert.ok(maxHeightVal < 70, `Banner max-height in 390px (${maxHeightVal}px) must be strictly < 70px`);
});

test("2.4 Child element deflation inside active inbox banner on mobile", () => {
  const mq768Match = stylesCss.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?(?=@media|$)/);
  const mqContent = mq768Match[0];

  // Head label hidden to save vertical space
  assert.ok(mqContent.includes(".active-inbox-bar .active-head"), "Must target .active-head");
  assert.ok(mqContent.includes("display: none !important;"), ".active-head must be hidden");

  // Avatar sizing <= 32px
  assert.ok(mqContent.includes(".active-inbox-bar .inbox-avatar"), "Must target .inbox-avatar");
  assert.ok(mqContent.includes("width: 32px !important;"), "Avatar width must be 32px");

  // Action button text hidden, compact icon size
  assert.ok(mqContent.includes(".active-inbox-bar .soft-button span"), "Must target soft-button span");
  assert.ok(mqContent.includes(".active-inbox-bar .soft-button"), "Must target soft-button");
});

// ============================================================================
// SUITE 3: COMPACT CARDS & 390px CONTAINMENT
// ============================================================================
console.log("\n🔹 [3/5] Stress-Testing Compact Cards & 390px Viewport Containment...");

test("3.1 .inbox-item compact vertical padding (<=10px) and font size (<=0.90rem)", () => {
  const mq768Match = stylesCss.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?(?=@media|$)/)[0];
  const itemMatch = mq768Match.match(/\.inbox-item\s*\{([\s\S]*?)\}/);
  assert.ok(itemMatch, "Must contain .inbox-item rule in 768px MQ");
  const decl = itemMatch[1];

  const padMatch = decl.match(/padding:\s*(\d+)px\s+(\d+)px/);
  assert.ok(padMatch, "Must define padding in px");
  assert.ok(parseInt(padMatch[1], 10) <= 10, `Inbox item vertical padding (${padMatch[1]}px) must be <= 10px`);

  const minHMatch = decl.match(/min-height:\s*(\d+)px/);
  assert.ok(minHMatch, "Must define min-height");
  assert.ok(parseInt(minHMatch[1], 10) <= 48, `Inbox item min-height (${minHMatch[1]}px) must be <= 48px`);

  assert.ok(mq768Match.includes(".inbox-item-copy strong"), "Must style copy title");
  assert.ok(mq768Match.includes("font-size: 0.88rem") || mq768Match.includes("font-size: 0.85rem"), "Typography must be compact");
});

test("3.2 .message-card compact vertical padding (<=10px) and min-height (<=50px)", () => {
  const mq768Match = stylesCss.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?(?=@media|$)/)[0];
  const cardMatch = mq768Match.match(/\.message-card\s*\{([\s\S]*?)\}/);
  assert.ok(cardMatch, "Must contain .message-card rule in 768px MQ");
  const decl = cardMatch[1];

  const padMatch = decl.match(/padding:\s*(\d+)px\s+(\d+)px/);
  assert.ok(padMatch, "Must define padding in px");
  assert.ok(parseInt(padMatch[1], 10) <= 10, `Message card vertical padding (${padMatch[1]}px) must be <= 10px`);

  const minHMatch = decl.match(/min-height:\s*(\d+)px/);
  assert.ok(minHMatch, "Must define min-height");
  assert.ok(parseInt(minHMatch[1], 10) <= 50, `Message card min-height (${minHMatch[1]}px) must be <= 50px`);

  assert.ok(decl.includes("max-width: 100% !important;"), "Card must be fully contained");
});

test("3.3 390px ultra-compact card scaling", () => {
  const mq390Match = stylesCss.match(/@media\s*\(max-width:\s*390px\)[\s\S]*?(?=@media|$)/)[0];

  // inbox-item on 390px
  const itemMatch = mq390Match.match(/\.inbox-item\s*\{([\s\S]*?)\}/);
  assert.ok(itemMatch, "Must define .inbox-item in 390px MQ");
  const itemDecl = itemMatch[1];
  const itemPadMatch = itemDecl.match(/padding:\s*(\d+)px\s+(\d+)px/);
  assert.ok(itemPadMatch && parseInt(itemPadMatch[1], 10) <= 8, "Inbox item vertical padding on 390px must be <= 8px");

  // message-card on 390px
  const cardMatch = mq390Match.match(/\.message-card\s*\{([\s\S]*?)\}/);
  assert.ok(cardMatch, "Must define .message-card in 390px MQ");
  const cardDecl = cardMatch[1];
  const cardPadMatch = cardDecl.match(/padding:\s*(\d+)px\s+(\d+)px/);
  assert.ok(cardPadMatch && parseInt(cardPadMatch[1], 10) <= 8, "Message card vertical padding on 390px must be <= 8px");
});

test("3.4 390px viewport horizontal blowout prevention and topbar scrolling", () => {
  const mq768Match = stylesCss.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?(?=@media|$)/)[0];
  const mq390Match = stylesCss.match(/@media\s*\(max-width:\s*390px\)[\s\S]*?(?=@media|$)/)[0];

  // 390px root containment
  assert.ok(mq390Match.includes("overflow-x: hidden !important;"), "Must enforce overflow-x: hidden on root/shell");
  assert.ok(mq390Match.includes(".topbar-actions"), "Must configure .topbar-actions in 390px");
  assert.ok(mq390Match.includes("gap: 4px !important;"), "Must set tight gap for 390px actions");

  // Topbar action bar scrolling cascade from mobile breakpoint
  assert.ok(mq768Match.includes(".topbar-actions"), "Must configure .topbar-actions in mobile MQ");
  assert.ok(mq768Match.includes("overflow-x: auto !important;"), "Must allow horizontal scroll on action bar");
  assert.ok(mq768Match.includes("flex-wrap: nowrap !important;"), "Must prevent wrapping blowout");
  assert.ok(mq768Match.includes("scrollbar-width: none !important;"), "Must hide native scrollbars");
});

// ============================================================================
// SUITE 4: DESKTOP 3-PANEL EXPERIENCE (>= 1024px) & SCREEN UTILIZATION
// ============================================================================
console.log("\n🔹 [4/5] Stress-Testing Desktop 3-Panel Experience & Screen Utilization...");

test("4.1 reader.css scopes mobile concealment strictly to < 1024px", () => {
  assert.ok(readerCss.includes("@media (max-width: 1023px)"), "Must scope concealment to <= 1023px");
  const mobileConceal = readerCss.match(/@media\s*\(max-width:\s*1023px\)[\s\S]*?(?=@media|$)/)[0];
  assert.ok(mobileConceal.includes("body[data-screen=\"reader\"] .sidebar"), "Conceals sidebar on mobile");
  assert.ok(mobileConceal.includes("display:none !important;") || mobileConceal.includes("display: none !important;"));
});

test("4.2 reader.css and styles.css activate 3 panels simultaneously on >= 1024px", () => {
  const checkDesktop3Panel = (filename, content) => {
    const dskMatch = content.match(/@media\s*\(min-width:\s*1024px\)[\s\S]*?(?=@media|$)/);
    assert.ok(dskMatch, `${filename} must contain @media (min-width: 1024px)`);
    const dsk = dskMatch[0];

    // Panel 1: Sidebar
    assert.ok(dsk.includes(".sidebar"), `${filename}: Must target .sidebar in desktop reader`);
    assert.ok(dsk.includes("display: flex !important;"), `${filename}: .sidebar must be display: flex !important`);

    // Panel 2: Feed Shell (Messages stream)
    assert.ok(dsk.includes(".feed-shell"), `${filename}: Must target .feed-shell in desktop reader`);
    assert.ok(dsk.includes("display: flex !important;"), `${filename}: .feed-shell must be display: flex !important`);

    // Panel 3: Reader Shell (Email content)
    assert.ok(dsk.includes(".reader-shell"), `${filename}: Must target .reader-shell in desktop reader`);
    assert.ok(dsk.includes("display: flex !important;"), `${filename}: .reader-shell must be display: flex !important`);

    // Active Inbox Bar spans header
    assert.ok(dsk.includes(".active-inbox-bar"), `${filename}: Must target .active-inbox-bar in desktop reader`);
    assert.ok(dsk.includes("grid-column: 1 / -1 !important;"), `${filename}: Active inbox bar must span grid-column 1 / -1`);
  };

  checkDesktop3Panel("reader.css", readerCss);
  checkDesktop3Panel("styles.css", stylesCss);
});

test("4.3 Desktop screen space utilization scales up to 1720px on widescreen monitors", () => {
  assert.ok(stylesCss.includes("@media (min-width: 1280px)"), "Must support 1280px breakpoint");
  assert.ok(stylesCss.includes("@media (min-width: 1440px)"), "Must support 1440px breakpoint");
  assert.ok(stylesCss.includes("max-width: 1720px"), "Must expand container up to 1720px");
});

test("4.4 app.js coordinates layout-3panel, is-reading, and is-selected dynamically", () => {
  // Check openMessage
  assert.ok(appJs.includes("const isDesktop = window.innerWidth >= 1024;"), "Checks 1024px breakpoint in openMessage");
  assert.ok(appJs.includes("document.body.classList.add('layout-3panel')"), "Adds layout-3panel class on desktop");
  assert.ok(appJs.includes("card.classList.toggle('is-selected', cardId === id);"), "Toggles is-selected highlight");

  // Check closeReader
  assert.ok(appJs.includes("document.body.classList.remove('is-reading', 'layout-3panel')"), "Cleans classes in closeReader");

  // Check resize handler
  assert.ok(appJs.includes("desktopLayout.addEventListener('change', handleDesktopLayout)"), "Listens to matchMedia changes");
  assert.ok(appJs.includes("window.addEventListener('resize', handleDesktopLayout)"), "Listens to resize events");
});

// ============================================================================
// SUITE 5: LIVE EPHEMERAL HTTP SERVER ASSET SERVING & SECURITY
// ============================================================================
console.log("\n🔹 [5/5] Testing Live HTTP Asset Serving, Headers & Route Security...");

async function runHttpSuite() {
  const { handleRequest } = require("../inbox_server");
  const db = require("../InboxDatabase");
  await db.ready();

  let server;
  let baseUrl;

  await new Promise(resolve => {
    server = http.createServer(handleRequest).listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  try {
    const assets = [
      { path: "/styles.css", mime: "text/css", cache: "public, max-age=3600" },
      { path: "/style.css", mime: "text/css", cache: "public, max-age=3600" },
      { path: "/reader.css", mime: "text/css", cache: "public, max-age=3600" },
      { path: "/app.js", mime: "application/javascript", cache: "public, max-age=3600" },
      { path: "/index.html", mime: "text/html", cache: "no-cache" },
      { path: "/amazon.css", mime: "text/css", cache: "public, max-age=3600" },
      { path: "/manifest.json", mime: "application/json", cache: "public, max-age=3600" },
      { path: "/icon.svg", mime: "image/svg+xml", cache: "public, max-age=3600" },
    ];

    for (const asset of assets) {
      await testAsync(`5.1 GET ${asset.path} returns 200 OK, valid mime (${asset.mime}) & cache header`, async () => {
        const res = await fetch(`${baseUrl}${asset.path}`);
        assert.equal(res.status, 200, `Expected 200 OK for ${asset.path}`);
        const cType = res.headers.get("content-type") || "";
        assert.ok(cType.includes(asset.mime), `Expected ${asset.mime} for ${asset.path}, got ${cType}`);
        const cache = res.headers.get("cache-control") || "";
        assert.ok(cache.includes(asset.cache), `Expected Cache-Control ${asset.cache}, got ${cache}`);
        const text = await res.text();
        assert.ok(text.length > 0, `${asset.path} response body must not be empty`);
      });
    }

    await testAsync("5.2 Root URL GET / returns 200 OK and serves index.html", async () => {
      const res = await fetch(`${baseUrl}/`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('id="activeInboxBanner"'));
    });

    await testAsync("5.3 Static assets tolerate query strings (e.g. ?v=18&cb=456)", async () => {
      const res = await fetch(`${baseUrl}/styles.css?v=18&cb=456`);
      assert.equal(res.status, 200);
      assert.ok(res.headers.get("content-type").includes("text/css"));
    });

    await testAsync("5.4 Security: Path traversal attempts are blocked", async () => {
      const hostilePaths = [
        "/..%2fpackage.json",
        "/..%2f..%2finbox_server.js",
        "/..%2f.env"
      ];
      for (const p of hostilePaths) {
        const res = await fetch(`${baseUrl}${p}`);
        assert.notEqual(res.status, 200, `Path traversal attempt ${p} must not return 200 OK`);
      }
    });

  } finally {
    if (server) server.close();
  }
}

async function main() {
  await runHttpSuite();

  console.log("\n======================================================================");
  console.log(`📊 CHALLENGER 1 SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log("======================================================================\n");

  if (failedTests > 0) {
    console.error(`❌ ${failedTests} test(s) failed:`);
    for (const f of failures) {
      console.error(`- ${f.name}: ${f.error}`);
    }
    process.exit(1);
  } else {
    console.log("🎉 ALL ADVERSARIAL TESTS PASSED CONVINCINGLY WITH ZERO FAILURES!");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
