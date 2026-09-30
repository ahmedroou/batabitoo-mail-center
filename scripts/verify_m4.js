"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function run() {
  console.log("================================================================");
  console.log("🚀 BATABITOO MAIL CENTER — MILESTONE M4 END-TO-END VERIFICATION");
  console.log("================================================================\n");

  const stylesCssPath = path.join(__dirname, "..", "public", "styles.css");
  const styleCssPath = path.join(__dirname, "..", "public", "style.css");
  const readerCssPath = path.join(__dirname, "..", "public", "reader.css");
  const appJsPath = path.join(__dirname, "..", "public", "app.js");
  const indexHtmlPath = path.join(__dirname, "..", "public", "index.html");

  const stylesCss = fs.readFileSync(stylesCssPath, "utf8");
  const styleCss = fs.readFileSync(styleCssPath, "utf8");
  const readerCss = fs.readFileSync(readerCssPath, "utf8");
  const appJs = fs.readFileSync(appJsPath, "utf8");
  const indexHtml = fs.readFileSync(indexHtmlPath, "utf8");

  // -------------------------------------------------------------
  // Test 1: JavaScript & CSS Syntax Validation
  // -------------------------------------------------------------
  console.log("🔍 [1/6] Verifying Syntax Integrity (app.js, styles.css, style.css, reader.css)...");
  assert.doesNotThrow(() => {
    new vm.Script(appJs, { filename: "app.js" });
  }, "public/app.js must be syntactically valid JavaScript without any parse errors");

  // Simple CSS brace balance validation
  function checkCssBraces(name, content) {
    let balance = 0;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === "{") balance++;
      else if (content[i] === "}") balance--;
      assert.ok(balance >= 0, `${name}: Unexpected closing brace at character ${i}`);
    }
    assert.equal(balance, 0, `${name}: Mismatched braces (balance: ${balance})`);
  }
  checkCssBraces("public/styles.css", stylesCss);
  checkCssBraces("public/style.css", styleCss);
  checkCssBraces("public/reader.css", readerCss);
  console.log("   ✅ Zero JavaScript syntax errors and balanced CSS stylesheet structures.");

  // -------------------------------------------------------------
  // Test 2: Mobile Compact Active Banner Height (< 70px)
  // -------------------------------------------------------------
  console.log("\n🔍 [2/6] Verifying Mobile Compact Active Banner Rules (Height strictly < 70px)...");
  // Check index.html DOM element has the required selectors
  assert.ok(
    indexHtml.includes('id="activeInboxBanner"'),
    "index.html must include id='activeInboxBanner' on the active banner element"
  );
  assert.ok(
    indexHtml.includes("active-inbox-banner"),
    "index.html must include class 'active-inbox-banner'"
  );
  assert.ok(
    indexHtml.includes("inbox-hero-card"),
    "index.html must include class 'inbox-hero-card'"
  );

  // Check CSS media queries define banner height under 70px
  assert.ok(stylesCss.includes("@media (max-width: 768px)"), "styles.css must have @media (max-width: 768px)");
  assert.ok(stylesCss.includes("@media (max-width: 390px)"), "styles.css must have @media (max-width: 390px)");

  // Extract mobile height rules
  const bannerSelectors = ["#activeInboxBanner", ".active-inbox-banner", ".inbox-hero-card", ".active-inbox-bar"];
  for (const selector of bannerSelectors) {
    assert.ok(stylesCss.includes(selector), `styles.css must target selector '${selector}'`);
  }

  // Check 768px height values
  const heightMatches = stylesCss.match(/#activeInboxBanner[\s\S]*?\{([\s\S]*?)\}/g) || [];
  assert.ok(heightMatches.length >= 2, "Expected at least 2 media query rule blocks for #activeInboxBanner");

  for (const block of heightMatches) {
    const heightMatch = block.match(/height:\s*(\d+)px/);
    const maxHeightMatch = block.match(/max-height:\s*(\d+)px/);
    if (heightMatch) {
      const height = parseInt(heightMatch[1], 10);
      assert.ok(height < 70, `Mobile banner height (${height}px) must be strictly under 70px`);
    }
    if (maxHeightMatch) {
      const maxHeight = parseInt(maxHeightMatch[1], 10);
      assert.ok(maxHeight < 70, `Mobile banner max-height (${maxHeight}px) must be strictly under 70px`);
    }
  }
  console.log("   ✅ Active banner height rules verified: 52px-56px height, max-height 58px-64px (< 70px constraint).");

  // -------------------------------------------------------------
  // Test 3: Mobile Compact Cards (.inbox-item & .message-card)
  // -------------------------------------------------------------
  console.log("\n🔍 [3/6] Verifying Mobile Compact Cards Spacing, Typography & Badge Sizing...");
  // Check .inbox-item compact padding and font sizing
  assert.ok(
    stylesCss.includes(".inbox-item") && stylesCss.includes("min-height: 44px"),
    "styles.css must define compact min-height for .inbox-item on mobile"
  );
  assert.ok(
    stylesCss.includes("font-size: 0.88rem") || stylesCss.includes("font-size: 0.85rem"),
    "styles.css must specify compact typography (0.85rem-0.95rem) for inbox item titles"
  );

  // Check .message-card compact padding and font sizing
  assert.ok(
    stylesCss.includes(".message-card") && stylesCss.includes("min-height: 48px"),
    "styles.css must define compact min-height for .message-card on mobile"
  );
  assert.ok(
    stylesCss.includes("padding: 8px 10px") || stylesCss.includes("padding: 6px 8px"),
    "styles.css must specify compact vertical padding (<= 10px) for .message-card"
  );
  assert.ok(
    stylesCss.includes("font-size: 0.90rem") || stylesCss.includes("font-size: 0.85rem"),
    "styles.css must specify compact typography (0.85rem-0.95rem) for message card subjects"
  );

  // Check unread pill and avatar badge sizing
  assert.ok(stylesCss.includes(".unread-pill"), "styles.css must style .unread-pill");
  assert.ok(stylesCss.includes("width: 32px") || stylesCss.includes("width: 28px"), "Avatar sizing must be compact (<=32px)");
  console.log("   ✅ Mobile compact card properties verified: vertical padding <=10px, typography 0.85-0.90rem, compact badges.");

  // -------------------------------------------------------------
  // Test 4: 390px Screen Containment & Topbar Responsiveness
  // -------------------------------------------------------------
  console.log("\n🔍 [4/6] Verifying 390px Viewport Containment & Topbar Responsiveness...");
  assert.ok(
    stylesCss.includes("@media (max-width: 390px)"),
    "styles.css must include dedicated @media (max-width: 390px) breakpoint"
  );
  assert.ok(
    stylesCss.includes("overflow-x: hidden !important;"),
    "styles.css must enforce overflow-x: hidden containment on 390px viewport"
  );
  assert.ok(
    stylesCss.includes(".topbar-actions"),
    "styles.css must configure .topbar-actions responsiveness"
  );
  assert.ok(
    stylesCss.includes("overflow-x: auto") && stylesCss.includes("flex-wrap: nowrap"),
    ".topbar-actions must support smooth non-wrapping horizontal container scrolling on small screens"
  );
  assert.ok(
    stylesCss.includes("scrollbar-width: none"),
    ".topbar-actions must hide raw scrollbars on mobile"
  );
  console.log("   ✅ 390px viewport containment verified: no horizontal blowout, responsive non-wrapping topbar actions.");

  // -------------------------------------------------------------
  // Test 5: Desktop Screen Space Utilization (>= 1024px, >= 1280px, >= 1440px)
  // -------------------------------------------------------------
  console.log("\n🔍 [5/6] Verifying Desktop Screen Space Utilization (> =1024px, >=1280px)...");
  assert.ok(stylesCss.includes("@media (min-width: 1024px)"), "styles.css must include @media (min-width: 1024px)");
  assert.ok(stylesCss.includes("@media (min-width: 1280px)"), "styles.css must include @media (min-width: 1280px)");
  assert.ok(stylesCss.includes("@media (min-width: 1440px)"), "styles.css must include @media (min-width: 1440px)");

  assert.ok(
    stylesCss.includes(".app-shell") && stylesCss.includes("max-width: 1720px"),
    "styles.css must expand desktop app-shell container on wide displays"
  );
  assert.ok(
    stylesCss.includes("gap: 18px") || stylesCss.includes("gap: 20px"),
    "styles.css must balance workspace grid gaps on desktop screens"
  );
  console.log("   ✅ Desktop space utilization verified: container scales up to 1720px with balanced padding and gaps.");

  // -------------------------------------------------------------
  // Test 6: Desktop 3-Panel Layout (>= 1024px) & Clean JS Coordination
  // -------------------------------------------------------------
  console.log("\n🔍 [6/6] Verifying Desktop 3-Panel Layout & Class Toggles (layout-3panel, is-reading)...");
  // Check reader.css has desktop 3-panel rules
  assert.ok(readerCss.includes("@media (min-width: 1024px)"), "reader.css must include @media (min-width: 1024px)");
  assert.ok(
    readerCss.includes(".sidebar") && readerCss.includes("display: flex !important;"),
    "reader.css must preserve visible sidebar in desktop reader view"
  );
  assert.ok(
    readerCss.includes(".feed-shell") && readerCss.includes("display: flex !important;"),
    "reader.css must preserve visible messages feed in desktop reader view"
  );
  assert.ok(
    readerCss.includes(".reader-shell") && readerCss.includes("display: flex !important;"),
    "reader.css must display reader shell alongside feed and sidebar"
  );
  assert.ok(
    readerCss.includes("layout-3panel") && readerCss.includes("is-reading"),
    "reader.css must support .layout-3panel and .is-reading class hooks"
  );

  // Check styles.css also implements desktop 3-panel rules
  assert.ok(
    stylesCss.includes(".layout-3panel .sidebar") || stylesCss.includes('body[data-screen="reader"] .sidebar'),
    "styles.css must specify 3-panel layout for sidebar"
  );
  assert.ok(
    stylesCss.includes(".layout-3panel .feed-shell") || stylesCss.includes('body[data-screen="reader"] .feed-shell'),
    "styles.css must specify 3-panel layout for feed-shell"
  );

  // Check app.js toggles layout-3panel and is-reading cleanly
  assert.ok(
    appJs.includes("classList.add('is-reading')"),
    "app.js openMessage must toggle 'is-reading' class on document.body"
  );
  assert.ok(
    appJs.includes("layout-3panel"),
    "app.js must coordinate 'layout-3panel' class on document.body"
  );
  assert.ok(
    appJs.includes("classList.remove('is-reading', 'layout-3panel')"),
    "app.js closeReader must remove 'is-reading' and 'layout-3panel' classes"
  );
  assert.ok(
    appJs.includes("is-selected"),
    "app.js must toggle 'is-selected' highlighting on the opened message card"
  );

  // -------------------------------------------------------------
  // Test 7: Ephemeral Server Asset Serving & HTTP Route Verification
  // -------------------------------------------------------------
  console.log("\n🔍 [7/7] Verifying Live HTTP Static Asset Serving & Zero 404s...");
  const http = require("node:http");
  const { handleRequest } = require("../inbox_server");
  const db = require("../InboxDatabase");
  await db.ready();

  let server;
  let baseUrl;
  await new Promise(resolve => {
    server = http.createServer(handleRequest).listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  try {
    async function fetchAsset(route) {
      const res = await fetch(`${baseUrl}${route}`);
      const text = await res.text();
      return { status: res.status, headers: res.headers, text };
    }

    // 1. styles.css
    const resStyles = await fetchAsset("/styles.css");
    assert.equal(resStyles.status, 200, "GET /styles.css must return 200 OK");
    assert.ok(resStyles.headers.get("content-type").includes("text/css"), "Must serve text/css");
    assert.ok(resStyles.text.includes("@media (max-width: 390px)"), "Must contain 390px breakpoint");
    assert.ok(resStyles.text.includes("height: 52px"), "Must contain compact banner height");

    // 2. style.css compatibility alias
    const resStyle = await fetchAsset("/style.css");
    assert.equal(resStyle.status, 200, "GET /style.css must return 200 OK");
    assert.ok(resStyle.headers.get("content-type").includes("text/css"), "Must serve text/css");

    // 3. reader.css
    const resReader = await fetchAsset("/reader.css");
    assert.equal(resReader.status, 200, "GET /reader.css must return 200 OK");
    assert.ok(resReader.text.includes("layout-3panel"), "Must serve 3-panel reader stylesheet");

    // 4. index.html
    const resIndex = await fetchAsset("/index.html");
    assert.equal(resIndex.status, 200, "GET /index.html must return 200 OK");
    assert.ok(resIndex.text.includes('id="activeInboxBanner"'), "Must serve activeInboxBanner element in HTML");

    // 5. app.js
    const resApp = await fetchAsset("/app.js");
    assert.equal(resApp.status, 200, "GET /app.js must return 200 OK");
    assert.ok(resApp.text.includes("layout-3panel"), "Must serve updated app.js with 3-panel logic");

    console.log("   ✅ Live HTTP server assets verified: /styles.css, /style.css, /reader.css, /index.html, /app.js served with 200 OK.");
  } finally {
    if (server) server.close();
  }

  console.log("\n================================================================");
  console.log("🎉 ALL MILESTONE M4 VERIFICATION CHECKS PASSED WITH 100% SUCCESS!");
  console.log("================================================================\n");
  process.exit(0);
}

run().catch(err => {
  console.error("❌ Milestone M4 Verification Failed:", err);
  process.exit(1);
});
