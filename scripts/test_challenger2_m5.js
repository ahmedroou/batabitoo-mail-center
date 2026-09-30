"use strict";

/**
 * Batabitoo Mail Center — Milestone M5 Tier 5 White-Box Adversarial Verification Harness
 * Challenger 2 (Empirical Challenger: Critic & Specialist)
 *
 * Scope & Adversarial Testing Objectives:
 * 1. Mobile active banner height rule: strictly < 70px across all mobile breakpoints
 *    (320px, 360px, 375px, 390px, 412px, 768px), plus text blowout deflation.
 * 2. Mobile compact cards: vertical padding <= 10px, typography 0.85-0.90rem,
 *    compact badges, avatar <= 32px.
 * 3. Horizontal containment: zero horizontal blowout/scrolling on mobile viewports
 *    (320px, 360px, 375px, 390px).
 * 4. Topbar responsiveness: action buttons must not wrap or break layout on narrow screens.
 * 5. Desktop 3-panel split view (>= 1024px): simultaneous visibility of sidebar, feed-shell,
 *    and reader-shell; smooth class toggling; widescreen expansion up to 1720px.
 * 6. Zero console/network errors: AST syntax validation, protected fetch calls,
 *    zero 404 assets, SSE error handling.
 * 7. Live Ephemeral HTTP Server end-to-end integration and asset verification.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const vm = require("node:vm");
const { execSync } = require("node:child_process");

// Stub firebase-admin storage if not configured
const storage = require("firebase-admin/storage");
try {
  storage.getStorage = () => ({
    bucket: () => ({
      file: () => ({
        save: async () => {},
        download: async () => [Buffer.from("")],
      }),
    }),
  });
} catch (_) {}

console.log("========================================================================");
console.log("🔥 CHALLENGER 2 — MILESTONE M5 EMPIRICAL ADVERSARIAL TEST HARNESS (TIER 5)");
console.log("========================================================================\n");

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

// Read Frontend Source Files
const publicDir = path.join(__dirname, "..", "public");
const stylesCss = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
const styleCss = fs.readFileSync(path.join(publicDir, "style.css"), "utf8");
const readerCss = fs.readFileSync(path.join(publicDir, "reader.css"), "utf8");
const amazonCss = fs.readFileSync(path.join(publicDir, "amazon.css"), "utf8");
const appJs = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
const mailSceneJs = fs.readFileSync(path.join(publicDir, "mail-scene.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");

// ============================================================================
// SUITE 1: ACTIVE INBOX BANNER MOBILE HEIGHT STRICTLY < 70px ACROSS BREAKPOINTS
// ============================================================================
console.log("🔹 [1/7] Adversarial Stress: Active Banner Height (< 70px) Across Breakpoints...");

const MOBILE_BREAKPOINTS = [320, 360, 375, 390, 412, 768];

test("1.1 DOM element contains all requisite active banner selectors", () => {
  assert.ok(indexHtml.includes('id="activeInboxBanner"'), "index.html must include id='activeInboxBanner'");
  assert.ok(indexHtml.includes("active-inbox-banner"), "index.html must include class 'active-inbox-banner'");
  assert.ok(indexHtml.includes("inbox-hero-card"), "index.html must include class 'inbox-hero-card'");
  assert.ok(indexHtml.includes("active-inbox-bar"), "index.html must include class 'active-inbox-bar'");
});

test("1.2 CSS media query structure defines strictly < 70px for all mobile breakpoints", () => {
  assert.ok(stylesCss.includes("@media (max-width: 768px)"), "styles.css must include @media (max-width: 768px)");
  assert.ok(stylesCss.includes("@media (max-width: 390px)"), "styles.css must include @media (max-width: 390px)");

  // Extract rule blocks for 768px
  const mq768 = stylesCss.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?(?=@media|$)/)[0];
  const rule768 = mq768.match(/#activeInboxBanner[\s\S]*?\{([\s\S]*?)\}/)[1];
  const h768 = parseInt(rule768.match(/height:\s*(\d+)px/)[1], 10);
  const maxH768 = parseInt(rule768.match(/max-height:\s*(\d+)px/)[1], 10);

  // Extract rule blocks for 390px
  const mq390 = stylesCss.match(/@media\s*\(max-width:\s*390px\)[\s\S]*?(?=@media|$)/)[0];
  const rule390 = mq390.match(/#activeInboxBanner[\s\S]*?\{([\s\S]*?)\}/)[1];
  const h390 = parseInt(rule390.match(/height:\s*(\d+)px/)[1], 10);
  const maxH390 = parseInt(rule390.match(/max-height:\s*(\d+)px/)[1], 10);

  assert.ok(h768 < 70, `768px height (${h768}px) must be < 70px`);
  assert.ok(maxH768 < 70, `768px max-height (${maxH768}px) must be < 70px`);
  assert.ok(h390 < 70, `390px height (${h390}px) must be < 70px`);
  assert.ok(maxH390 < 70, `390px max-height (${maxH390}px) must be < 70px`);

  // Verify breakpoint mapping across all target widths
  for (const bp of MOBILE_BREAKPOINTS) {
    const applicableHeight = bp <= 390 ? h390 : h768;
    const applicableMaxHeight = bp <= 390 ? maxH390 : maxH768;
    assert.ok(
      applicableHeight < 70 && applicableMaxHeight < 70,
      `Breakpoint ${bp}px must resolve height < 70px (height=${applicableHeight}px, max-height=${applicableMaxHeight}px)`
    );
  }
});

test("1.3 Adversarial text-overflow defense: Banner children cannot expand vertical height", () => {
  const mq768 = stylesCss.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?(?=@media|$)/)[0];

  // Head label hidden to prevent multiline vertical stacking
  assert.ok(mq768.includes(".active-inbox-bar .active-head"), "Must style .active-head");
  assert.ok(mq768.includes("display: none !important;"), ".active-head must be hidden in mobile MQ");

  // Email title enforced single-line with ellipsis
  assert.ok(mq768.includes(".active-inbox-bar .active-copy h2"), "Must target .active-copy h2");
  assert.ok(mq768.includes("white-space: nowrap !important;"), "Must enforce white-space: nowrap");
  assert.ok(mq768.includes("overflow: hidden !important;"), "Must enforce overflow: hidden");
  assert.ok(mq768.includes("text-overflow: ellipsis !important;"), "Must enforce text-overflow: ellipsis");

  // Button text spans hidden so action buttons stay compact icon pills
  assert.ok(mq768.includes(".active-inbox-bar .soft-button span"), "Must target soft-button span");
  assert.ok(mq768.includes(".active-inbox-bar .soft-button span {\n    display: none !important;"), "Button text hidden");

  // Visual effects (canvas, orbs, fallback) taken out of flow
  assert.ok(mq768.includes(".active-inbox-bar #mail-scene"), "Must position canvas");
  assert.ok(mq768.includes("position: absolute !important;"), "Visual background elements must be absolute");
  assert.ok(mq768.includes("inset: 0 !important;"), "Visual background elements must span inset 0");
});

test("1.4 Banner avatar and button sizing strictly deflated on mobile viewports", () => {
  const mq768 = stylesCss.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?(?=@media|$)/)[0];
  const mq390 = stylesCss.match(/@media\s*\(max-width:\s*390px\)[\s\S]*?(?=@media|$)/)[0];

  // Avatar in 768px: 32px
  assert.ok(mq768.includes(".active-inbox-bar .inbox-avatar"));
  assert.ok(mq768.includes("width: 32px !important;") && mq768.includes("height: 32px !important;"));

  // Avatar in 390px: 28px
  assert.ok(mq390.includes(".active-inbox-bar .inbox-avatar"));
  assert.ok(mq390.includes("width: 28px !important;") && mq390.includes("height: 28px !important;"));

  // Soft buttons in 768px: height 30px
  assert.ok(mq768.includes(".active-inbox-bar .soft-button"));
  assert.ok(mq768.includes("height: 30px !important;"));

  // Soft buttons in 390px: height 28px
  assert.ok(mq390.includes(".active-inbox-bar .soft-button"));
  assert.ok(mq390.includes("height: 28px !important;"));
});

// ============================================================================
// SUITE 2: MOBILE COMPACT CARDS (PADDING, TYPOGRAPHY, BADGES, AVATARS)
// ============================================================================
console.log("\n🔹 [2/7] Adversarial Stress: Mobile Compact Cards (<10px padding, 0.85-0.90rem)...");

test("2.1 .inbox-item vertical padding <= 10px and min-height <= 44px on mobile", () => {
  const mq768 = stylesCss.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?(?=@media|$)/)[0];
  const mq390 = stylesCss.match(/@media\s*\(max-width:\s*390px\)[\s\S]*?(?=@media|$)/)[0];

  const item768Match = mq768.match(/\.inbox-item\s*\{([\s\S]*?)\}/)[1];
  const pad768 = parseInt(item768Match.match(/padding:\s*(\d+)px/)[1], 10);
  const minH768 = parseInt(item768Match.match(/min-height:\s*(\d+)px/)[1], 10);
  assert.ok(pad768 <= 10, `.inbox-item vertical padding at 768px (${pad768}px) must be <= 10px`);
  assert.ok(minH768 <= 44, `.inbox-item min-height at 768px (${minH768}px) must be <= 44px`);

  const item390Match = mq390.match(/\.inbox-item\s*\{([\s\S]*?)\}/)[1];
  const pad390 = parseInt(item390Match.match(/padding:\s*(\d+)px/)[1], 10);
  const minH390 = parseInt(item390Match.match(/min-height:\s*(\d+)px/)[1], 10);
  assert.ok(pad390 <= 10, `.inbox-item vertical padding at 390px (${pad390}px) must be <= 10px`);
  assert.ok(minH390 <= 40, `.inbox-item min-height at 390px (${minH390}px) must be <= 40px`);
});

test("2.2 .message-card vertical padding <= 10px and min-height <= 48px on mobile", () => {
  const mq768 = stylesCss.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?(?=@media|$)/)[0];
  const mq390 = stylesCss.match(/@media\s*\(max-width:\s*390px\)[\s\S]*?(?=@media|$)/)[0];

  const card768Match = mq768.match(/\.message-card\s*\{([\s\S]*?)\}/)[1];
  const pad768 = parseInt(card768Match.match(/padding:\s*(\d+)px/)[1], 10);
  const minH768 = parseInt(card768Match.match(/min-height:\s*(\d+)px/)[1], 10);
  assert.ok(pad768 <= 10, `.message-card vertical padding at 768px (${pad768}px) must be <= 10px`);
  assert.ok(minH768 <= 48, `.message-card min-height at 768px (${minH768}px) must be <= 48px`);

  const card390Match = mq390.match(/\.message-card\s*\{([\s\S]*?)\}/)[1];
  const pad390 = parseInt(card390Match.match(/padding:\s*(\d+)px/)[1], 10);
  const minH390 = parseInt(card390Match.match(/min-height:\s*(\d+)px/)[1], 10);
  assert.ok(pad390 <= 10, `.message-card vertical padding at 390px (${pad390}px) must be <= 10px`);
  assert.ok(minH390 <= 44, `.message-card min-height at 390px (${minH390}px) must be <= 44px`);
});

test("2.3 Mobile card typography falls strictly in 0.85-0.90rem range", () => {
  const mq768 = stylesCss.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?(?=@media|$)/)[0];
  const mq390 = stylesCss.match(/@media\s*\(max-width:\s*390px\)[\s\S]*?(?=@media|$)/)[0];

  // Inbox item title font size: 0.88rem (768px), 0.85rem (390px)
  const itemFont768 = parseFloat(mq768.match(/\.inbox-item-copy strong\s*\{[^}]*font-size:\s*([\d.]+)rem/)[1]);
  const itemFont390 = parseFloat(mq390.match(/\.inbox-item-copy strong\s*\{[^}]*font-size:\s*([\d.]+)rem/)[1]);
  assert.ok(itemFont768 >= 0.85 && itemFont768 <= 0.90, `Inbox item font at 768px (${itemFont768}rem) must be 0.85-0.90rem`);
  assert.ok(itemFont390 >= 0.85 && itemFont390 <= 0.90, `Inbox item font at 390px (${itemFont390}rem) must be 0.85-0.90rem`);

  // Message card title font size: 0.90rem (768px), 0.85rem (390px)
  const msgFont768 = parseFloat(mq768.match(/\.message-top strong\s*\{[^}]*font-size:\s*([\d.]+)rem/)[1]);
  const msgFont390 = parseFloat(mq390.match(/\.message-top strong\s*\{[^}]*font-size:\s*([\d.]+)rem/)[1]);
  assert.ok(msgFont768 >= 0.85 && msgFont768 <= 0.90, `Message card font at 768px (${msgFont768}rem) must be 0.85-0.90rem`);
  assert.ok(msgFont390 >= 0.85 && msgFont390 <= 0.90, `Message card font at 390px (${msgFont390}rem) must be 0.85-0.90rem`);
});

test("2.4 Compact badges and avatars strictly <= 32px", () => {
  const mq768 = stylesCss.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?(?=@media|$)/)[0];
  const mq390 = stylesCss.match(/@media\s*\(max-width:\s*390px\)[\s\S]*?(?=@media|$)/)[0];

  // Avatars: 32px (768px), 28px (390px)
  assert.ok(mq768.includes(".inbox-item-avatar") && mq768.includes("width: 32px !important;"));
  assert.ok(mq768.includes(".sender-avatar") && mq768.includes("width: 32px !important;"));
  assert.ok(mq390.includes(".inbox-item-avatar") && mq390.includes("width: 28px !important;"));
  assert.ok(mq390.includes(".message-card .sender-avatar") && mq390.includes("width: 28px !important;"));

  // Badges: unread-pill and otp-chip
  assert.ok(mq768.includes(".unread-pill") && mq768.includes("font-size: 9px !important;"));
  assert.ok(mq768.includes(".otp-chip") && mq768.includes("font-size: 10.5px !important;"));
});

// ============================================================================
// SUITE 3: HORIZONTAL CONTAINMENT & ZERO BLOWOUT (320px - 390px)
// ============================================================================
console.log("\n🔹 [3/7] Adversarial Stress: Horizontal Containment & Zero Blowout (<=390px)...");

test("3.1 Viewport meta tag properly configures mobile responsive rendering", () => {
  assert.ok(
    indexHtml.includes('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'),
    "Missing standard responsive viewport meta tag"
  );
});

test("3.2 Global root and app-shell enforce horizontal overflow containment", () => {
  // Global rules in styles.css
  assert.ok(stylesCss.includes("html {\n  min-height: 100%;\n  width: 100%;\n  max-width: 100vw;\n  overflow-x: hidden;"));
  assert.ok(stylesCss.includes("body {\n  min-height: 100vh;\n  width: 100%;\n  max-width: 100vw;\n  margin: 0;"));

  // 390px breakpoint enforcement
  const mq390 = stylesCss.match(/@media\s*\(max-width:\s*390px\)[\s\S]*?(?=@media|$)/)[0];
  assert.ok(mq390.includes("overflow-x: hidden !important;"), "390px breakpoint must enforce overflow-x: hidden !important");
});

test("3.3 Card grids use minmax(0, 1fr) to prevent long email / subject horizontal blowout", () => {
  const mq768 = stylesCss.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?(?=@media|$)/)[0];
  const mq390 = stylesCss.match(/@media\s*\(max-width:\s*390px\)[\s\S]*?(?=@media|$)/)[0];

  assert.ok(
    mq768.includes("grid-template-columns: 32px minmax(0, 1fr) auto 28px !important;"),
    ".inbox-item must use minmax(0, 1fr) at 768px"
  );
  assert.ok(
    mq768.includes("grid-template-columns: 32px minmax(0, 1fr) auto !important;"),
    ".message-card must use minmax(0, 1fr) at 768px"
  );
  assert.ok(
    mq390.includes("grid-template-columns: 28px minmax(0, 1fr) auto !important;"),
    ".message-card must use minmax(0, 1fr) at 390px"
  );
});

test("3.4 Mobile bottom navigation contained without horizontal spillover", () => {
  const mq768 = stylesCss.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?(?=@media|$)/)[0];
  assert.ok(mq768.includes(".mobile-nav"), "Must style .mobile-nav");
  assert.ok(mq768.includes("max-width: 100vw;"), "Must constrain max-width to 100vw");
  assert.ok(mq768.includes("grid-template-columns: repeat(5, 1fr);"), "Must arrange in 5 equal columns");
  assert.ok(mq768.includes("box-sizing: border-box;"), "Must enforce border-box");
});

// ============================================================================
// SUITE 4: TOPBAR RESPONSIVENESS & WRAP PREVENTION
// ============================================================================
console.log("\n🔹 [4/7] Adversarial Stress: Topbar Responsiveness & Non-Wrapping Actions...");

test("4.1 .topbar-actions enforces flex-wrap: nowrap and overflow-x: auto on mobile", () => {
  const mq768 = stylesCss.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?(?=@media|$)/)[0];
  assert.ok(mq768.includes(".topbar-actions"), "Must target .topbar-actions");
  assert.ok(mq768.includes("flex-wrap: nowrap !important;"), "Must prevent action buttons from wrapping onto new lines");
  assert.ok(mq768.includes("overflow-x: auto !important;"), "Must enable horizontal container scrolling if needed");
  assert.ok(mq768.includes("scrollbar-width: none !important;"), "Must hide native scrollbars");
});

test("4.2 .topbar-actions gap and button sizes compress gracefully under 390px", () => {
  const mq390 = stylesCss.match(/@media\s*\(max-width:\s*390px\)[\s\S]*?(?=@media|$)/)[0];
  assert.ok(mq390.includes(".topbar-actions"), "Must configure .topbar-actions at 390px");
  assert.ok(mq390.includes("gap: 4px !important;"), "Must use compact 4px gap at 390px");
  assert.ok(mq390.includes(".topbar-actions .primary-button span"), "Must target primary button text");
  assert.ok(mq390.includes("font-size: 10px !important;"), "Must reduce font size at 390px");
});

test("4.3 Mobile topbar stacks into dedicated action row ensuring zero horizontal collision", () => {
  const mq768 = stylesCss.match(/@media\s*\(max-width:\s*768px\)[\s\S]*?(?=@media|$)/)[0];
  const mq390 = stylesCss.match(/@media\s*\(max-width:\s*390px\)[\s\S]*?(?=@media|$)/)[0];

  // In 768px: .topbar is column-stacked to give actions 100% full width
  assert.ok(mq768.includes("flex-direction: column;"), ".topbar must be flex-direction: column on mobile");
  assert.ok(mq768.includes("width: 100% !important;"), ".topbar-actions must occupy 100% width on mobile");

  // In 390px: brand elements and greeting text compressed
  assert.ok(mq390.includes(".brand-mark") && mq390.includes("width: 28px !important;"));
  assert.ok(mq390.includes(".brand-copy h1") && mq390.includes("font-size: 14px !important;"));
  assert.ok(mq390.includes(".brand-copy span") && mq390.includes("font-size: 9.5px !important;"));
});

// ============================================================================
// SUITE 5: DESKTOP 3-PANEL SPLIT VIEW (>= 1024px) & WIDESCREEN EXPANSION
// ============================================================================
console.log("\n🔹 [5/7] Adversarial Stress: Desktop 3-Panel Split View (>=1024px) & Widescreen (1720px)...");

test("5.1 Mobile reader concealment strictly capped below 1024px in reader.css", () => {
  assert.ok(readerCss.includes("@media (max-width: 1023px)"), "reader.css must scope single-panel reader to max-width 1023px");
  const mqMobileReader = readerCss.match(/@media\s*\(max-width:\s*1023px\)[\s\S]*?(?=@media|$)/)[0];
  assert.ok(mqMobileReader.includes("body[data-screen=\"reader\"] .sidebar"), "Conceals sidebar on mobile reader");
  assert.ok(mqMobileReader.includes("display:none !important;") || mqMobileReader.includes("display: none !important;"));
});

test("5.2 Desktop reader mode (>= 1024px) displays all 3 panels simultaneously", () => {
  const mqDesktopReader = readerCss.match(/@media\s*\(min-width:\s*1024px\)[\s\S]*?(?=@media|$)/)[0];

  // Panel 1: Sidebar
  assert.ok(mqDesktopReader.includes(".sidebar"), "Target sidebar in desktop reader");
  assert.ok(mqDesktopReader.includes("display: flex !important;"), "Sidebar must be display: flex !important");

  // Panel 2: Feed Shell
  assert.ok(mqDesktopReader.includes(".feed-shell"), "Target feed-shell in desktop reader");
  assert.ok(mqDesktopReader.includes("display: flex !important;"), "Feed shell must be display: flex !important");

  // Panel 3: Reader Shell
  assert.ok(mqDesktopReader.includes(".reader-shell"), "Target reader-shell in desktop reader");
  assert.ok(mqDesktopReader.includes("display: flex !important;"), "Reader shell must be display: flex !important");

  // Header Banner Spanning
  assert.ok(mqDesktopReader.includes(".active-inbox-bar"), "Target active-inbox-bar in desktop reader");
  assert.ok(mqDesktopReader.includes("grid-column: 1 / -1 !important;"), "Banner must span top of grid (1 / -1)");
});

test("5.3 Desktop grid column structure coordinates RTL sidebar, feed, and reader", () => {
  const mqDesktopStyles = stylesCss.match(/@media\s*\(min-width:\s*1024px\)[\s\S]*?(?=@media|$)/)[0];
  assert.ok(
    mqDesktopStyles.includes("grid-template-columns: minmax(0, 1fr) 300px !important;"),
    "Workspace must arrange main content + sidebar"
  );
  assert.ok(
    mqDesktopStyles.includes("grid-template-columns: minmax(0, 1.4fr) minmax(320px, 380px) !important;"),
    "Content panel must arrange reader (1.4fr) + feed (320px-380px)"
  );
});

test("5.4 public/app.js dynamically coordinates layout-3panel, is-reading, and is-selected", () => {
  assert.ok(appJs.includes("classList.add('is-reading')"), "app.js must add 'is-reading'");
  assert.ok(appJs.includes("classList.add('layout-3panel')"), "app.js must add 'layout-3panel'");
  assert.ok(appJs.includes("classList.remove('is-reading', 'layout-3panel')"), "app.js must remove classes on close");
  assert.ok(appJs.includes("classList.toggle('is-selected'"), "app.js must highlight active message card");
  assert.ok(appJs.includes("window.innerWidth >= 1024"), "app.js checks 1024px breakpoint dynamically");
  assert.ok(appJs.includes("window.addEventListener('resize'"), "app.js listens to window resize");
});

test("5.5 Desktop layout scales to 1720px widescreen without distortion", () => {
  assert.ok(stylesCss.includes("@media (min-width: 1280px)"), "Must support 1280px breakpoint");
  assert.ok(stylesCss.includes("@media (min-width: 1440px)"), "Must support 1440px breakpoint");
  assert.ok(stylesCss.includes("max-width: 1720px !important;"), "Must scale app-shell max-width to 1720px");
});

// ============================================================================
// SUITE 6: CLIENT SCRIPTS, SYNTAX & ZERO CONSOLE/NETWORK ERRORS AUDIT
// ============================================================================
console.log("\n🔹 [6/7] Adversarial Stress: Client Script Syntax, Error Handlers & Zero 404s...");

test("6.1 All client scripts pass syntax compilation with zero errors", () => {
  assert.doesNotThrow(() => {
    new vm.Script(appJs, { filename: "public/app.js" });
  }, "public/app.js syntax error");

  // mail-scene.js is an ES module using import * as THREE; test with node --check
  assert.doesNotThrow(() => {
    execSync(`node --check "${path.join(publicDir, "mail-scene.js")}"`, { stdio: "pipe" });
  }, "public/mail-scene.js syntax error");
});

test("6.2 Every fetch call in public/app.js is protected against unhandled promise rejections", () => {
  const lines = appJs.split("\n");
  const fetchLineIndices = [];
  lines.forEach((l, idx) => {
    if (l.includes("fetch(") && !l.trim().startsWith("//")) {
      fetchLineIndices.push(idx);
    }
  });

  assert.ok(fetchLineIndices.length > 0, "Expected fetch calls in app.js");

  // Verify each fetch is enclosed in try/catch or has .catch()
  for (const idx of fetchLineIndices) {
    const start = Math.max(0, idx - 10);
    const end = Math.min(lines.length, idx + 10);
    const windowText = lines.slice(start, end).join("\n");
    const isProtected = windowText.includes("try {") || windowText.includes(".catch(");
    assert.ok(
      isProtected,
      `fetch call at line ${idx + 1} must be protected by try/catch or .catch()`
    );
  }
});

test("6.3 Central api() helper enforces 12s timeout, token auth, and 401 session recovery", () => {
  assert.ok(appJs.includes("const controller = new AbortController();"), "Uses AbortController");
  assert.ok(appJs.includes("setTimeout(() => controller.abort(), 12000)"), "Enforces 12-second abort timeout");
  assert.ok(appJs.includes("response.status === 401"), "Handles 401 session expiry");
  assert.ok(appJs.includes("sessionStorage.removeItem(SESSION_TOKEN_KEY)"), "Cleans session storage on 401");
  assert.ok(appJs.includes("localStorage.removeItem(SESSION_TOKEN_KEY)"), "Cleans local storage on 401");
  assert.ok(appJs.includes("response.json().catch(() => ({}))"), "Safely decodes JSON with catch fallback");
});

test("6.4 SSE connection includes onerror recovery handler and offline polling fallback", () => {
  assert.ok(appJs.includes("sseSource.onerror ="), "Handles SSE error event");
  assert.ok(appJs.includes("sseConnected = false"), "Marks SSE disconnected on error");
  assert.ok(appJs.includes("!sseConnected && !document.hidden"), "Only polls when SSE is disconnected");
});

test("6.5 Zero 404 local asset references in HTML and CSS files", () => {
  // Check index.html linked local assets
  const htmlAssetMatches = [...indexHtml.matchAll(/(?:src|href)=["'](\/[^"']+)["']/g)].map(m => m[1]);
  for (const assetPath of htmlAssetMatches) {
    // Strip query string e.g. ?v=18
    const cleanPath = assetPath.split("?")[0].replace(/^\//, "");
    if (cleanPath && !cleanPath.startsWith("http")) {
      const fullPath = path.join(publicDir, cleanPath);
      assert.ok(fs.existsSync(fullPath), `Asset '${assetPath}' referenced in index.html must exist at ${fullPath}`);
    }
  }

  // Check CSS files for local url() references
  const allCss = stylesCss + "\n" + readerCss + "\n" + amazonCss;
  const cssUrlMatches = [...allCss.matchAll(/url\(['"]?(\/[^'")]+)['"]?\)/g)].map(m => m[1]);
  for (const urlPath of cssUrlMatches) {
    const cleanUrl = urlPath.split("?")[0].replace(/^\//, "");
    if (cleanUrl && !cleanUrl.startsWith("http") && !cleanUrl.startsWith("data:")) {
      const fullPath = path.join(publicDir, cleanUrl);
      assert.ok(fs.existsSync(fullPath), `Asset '${urlPath}' in CSS must exist at ${fullPath}`);
    }
  }
});

// ============================================================================
// SUITE 7: LIVE EPHEMERAL HTTP SERVER END-TO-END VERIFICATION
// ============================================================================
console.log("\n🔹 [7/7] Live Ephemeral HTTP Server Testing (Assets, Security, SSE)...");

async function runLiveServerSuite() {
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
    // 7.1 Verify static asset delivery
    const assets = [
      { path: "/", status: 200, mime: "text/html" },
      { path: "/index.html", status: 200, mime: "text/html" },
      { path: "/styles.css", status: 200, mime: "text/css" },
      { path: "/style.css", status: 200, mime: "text/css" },
      { path: "/reader.css", status: 200, mime: "text/css" },
      { path: "/amazon.css", status: 200, mime: "text/css" },
      { path: "/app.js", status: 200, mime: "application/javascript" },
      { path: "/mail-scene.js", status: 200, mime: "application/javascript" },
      { path: "/manifest.json", status: 200, mime: "application/json" },
      { path: "/icon.svg", status: 200, mime: "image/svg+xml" }
    ];

    for (const a of assets) {
      await testAsync(`7.1 Live GET ${a.path} returns ${a.status} and MIME ${a.mime}`, async () => {
        const res = await fetch(`${baseUrl}${a.path}`);
        assert.equal(res.status, a.status, `Expected ${a.status} for ${a.path}`);
        const ct = res.headers.get("content-type") || "";
        assert.ok(ct.includes(a.mime), `Expected MIME ${a.mime}, got ${ct}`);
      });
    }

    // 7.2 Non-existent asset returns 404 without crashing server
    await testAsync("7.2 Non-existent asset GET /missing_asset_123.png returns 404 safely", async () => {
      const res = await fetch(`${baseUrl}/missing_asset_123.png`);
      assert.equal(res.status, 404);
    });

    // 7.3 Public health check and version
    await testAsync("7.3 Public endpoints /api/health and /api/app/version accessible without auth", async () => {
      const hRes = await fetch(`${baseUrl}/api/health`);
      assert.equal(hRes.status, 200);
      const vRes = await fetch(`${baseUrl}/api/app/version`);
      assert.equal(vRes.status, 200);
    });

    // 7.4 Security Guard: Unauthenticated access to /api/inbox/current returns 401
    await testAsync("7.4 Protected route /api/inbox/current returns 401 AUTH_REQUIRED", async () => {
      const res = await fetch(`${baseUrl}/api/inbox/current`);
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.code, "AUTH_REQUIRED");
    });

    // 7.5 Authenticated login and token check
    let authToken = null;
    await testAsync("7.5 Master PIN authentication yields valid session token", async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "0530" })
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(data.token);
      authToken = data.token;
    });

    // 7.6 Inbound Webhook Ingestion & Query Lifecycle
    await testAsync("7.6 Webhook ingestion and targeted inbox query lifecycle", async () => {
      const testEmail = `challenger2_${Date.now()}@batabitoo.com`;
      const testOtp = "654321";

      const whRes = await fetch(`${baseUrl}/api/webhook/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: testEmail,
          sender: "noreply@security.amazon.com",
          subject: "Your OTP code is 654321",
          text: "Verification code: 654321. Do not disclose."
        })
      });
      assert.equal(whRes.status, 200);
      const whData = await whRes.json();
      assert.equal(whData.success, true);
      assert.equal(whData.otp, testOtp);

      // Query inbox with auth token
      const qRes = await fetch(`${baseUrl}/api/inbox/current?email=${encodeURIComponent(testEmail)}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      assert.equal(qRes.status, 200);
      const qData = await qRes.json();
      assert.equal(qData.success, true);
      assert.equal(qData.inbox.email, testEmail);
      assert.ok(qData.messages.some(m => m.otp === testOtp));
    });

  } finally {
    if (server) server.close();
  }
}

async function main() {
  await runLiveServerSuite();

  console.log("\n========================================================================");
  console.log(`📊 CHALLENGER 2 SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log("========================================================================\n");

  if (failedTests > 0) {
    console.error(`❌ ${failedTests} test(s) failed:`);
    for (const f of failures) {
      console.error(`- ${f.name}: ${f.error}`);
    }
    process.exit(1);
  } else {
    console.log("🎉 ALL ADVERSARIAL TIER 5 TESTS PASSED CONVINCINGLY WITH ZERO DEFECTS!");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Fatal Error in Challenger 2 Test Harness:", err);
  process.exit(1);
});
