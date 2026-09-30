/**
 * Batabitoo Mail Center — Milestone M4 UI Layout & Mobile Responsiveness Test Suite
 * 
 * Target: test/ui_layout_m4.test.js
 * Compliant with PROJECT.md and TEST_INFRA.md.
 * 
 * Features Covered:
 * - F6: Desktop 3-Panel Experience & Screen Space Utilization (>=1024px, >=1280px)
 * - F7: Mobile Compact Active Banner (<70px) & Compact Cards on 390px Viewports
 * - Zero 404s, Static Asset Route Integrity & Zero JavaScript Parse Errors
 */

"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

// Stub firebase-admin storage
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

const { handleRequest } = require("../inbox_server");
const db = require("../InboxDatabase");

let server;
let baseUrl;

before(async () => {
  await db.ready();
  await new Promise(resolve => {
    server = http.createServer(handleRequest).listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => {
  if (server) server.close();
});

test("M4-SYN-01: public/app.js parses with zero syntax errors", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.doesNotThrow(() => {
    new vm.Script(appJs, { filename: "app.js" });
  });
});

test("M4-CSS-01: public/styles.css and reader.css have balanced braces", () => {
  function checkBraces(filename) {
    const text = fs.readFileSync(path.join(__dirname, "..", "public", filename), "utf8");
    let balance = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "{") balance++;
      else if (text[i] === "}") balance--;
      assert.ok(balance >= 0, `Unexpected closing brace in ${filename} at offset ${i}`);
    }
    assert.equal(balance, 0, `Unbalanced braces in ${filename}`);
  }
  checkBraces("styles.css");
  checkBraces("style.css");
  checkBraces("reader.css");
});

test("M4-BAN-01: Mobile compact active banner height is strictly under 70px in styles.css", () => {
  const stylesCss = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  assert.ok(stylesCss.includes("@media (max-width: 768px)"));
  assert.ok(stylesCss.includes("@media (max-width: 390px)"));
  assert.ok(stylesCss.includes("#activeInboxBanner"));
  assert.ok(stylesCss.includes(".active-inbox-banner"));
  assert.ok(stylesCss.includes(".inbox-hero-card"));

  const matches = stylesCss.match(/#activeInboxBanner[\s\S]*?\{([\s\S]*?)\}/g) || [];
  assert.ok(matches.length >= 2, "Must contain rules for active banner in multiple media queries");

  for (const match of matches) {
    const height = match.match(/height:\s*(\d+)px/);
    const maxHeight = match.match(/max-height:\s*(\d+)px/);
    if (height) assert.ok(parseInt(height[1], 10) < 70, `Height ${height[1]}px must be < 70px`);
    if (maxHeight) assert.ok(parseInt(maxHeight[1], 10) < 70, `Max-height ${maxHeight[1]}px must be < 70px`);
  }
});

test("M4-CRD-01: Mobile compact cards define compact vertical padding (<=10px) and typography", () => {
  const stylesCss = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  assert.ok(stylesCss.includes("padding: 8px 10px") || stylesCss.includes("padding: 6px 8px"));
  assert.ok(stylesCss.includes("font-size: 0.90rem") || stylesCss.includes("font-size: 0.88rem") || stylesCss.includes("font-size: 0.85rem"));
  assert.ok(stylesCss.includes(".inbox-item") && stylesCss.includes("min-height: 44px"));
  assert.ok(stylesCss.includes(".message-card") && stylesCss.includes("min-height: 48px"));
});

test("M4-390-01: 390px viewport enforces horizontal containment and topbar actions scrolling", () => {
  const stylesCss = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  assert.ok(stylesCss.includes("@media (max-width: 390px)"));
  assert.ok(stylesCss.includes("overflow-x: hidden !important;"));
  assert.ok(stylesCss.includes(".topbar-actions"));
  assert.ok(stylesCss.includes("overflow-x: auto"));
  assert.ok(stylesCss.includes("flex-wrap: nowrap"));
});

test("M4-DSK-01: Desktop screen space utilization expands container (>=1024px, >=1280px, >=1440px)", () => {
  const stylesCss = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  assert.ok(stylesCss.includes("@media (min-width: 1024px)"));
  assert.ok(stylesCss.includes("@media (min-width: 1280px)"));
  assert.ok(stylesCss.includes("@media (min-width: 1440px)"));
  assert.ok(stylesCss.includes("max-width: 1720px"));
});

test("M4-3PN-01: Desktop 3-panel layout preserves sidebar inboxes and messages list alongside reader", () => {
  const readerCss = fs.readFileSync(path.join(__dirname, "..", "public", "reader.css"), "utf8");
  const stylesCss = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");

  assert.ok(readerCss.includes("@media (min-width: 1024px)"));
  assert.ok(readerCss.includes(".sidebar") && readerCss.includes("display: flex !important;"));
  assert.ok(readerCss.includes(".feed-shell") && readerCss.includes("display: flex !important;"));
  assert.ok(readerCss.includes(".reader-shell") && readerCss.includes("display: flex !important;"));

  assert.ok(stylesCss.includes(".layout-3panel .sidebar") || stylesCss.includes('body[data-screen="reader"] .sidebar'));
  assert.ok(stylesCss.includes(".layout-3panel .feed-shell") || stylesCss.includes('body[data-screen="reader"] .feed-shell'));
});

test("M4-CLS-01: public/app.js cleanly coordinates layout-3panel, is-reading, and is-selected", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.ok(appJs.includes("classList.add('is-reading')"));
  assert.ok(appJs.includes("classList.add('layout-3panel')"));
  assert.ok(appJs.includes("classList.remove('is-reading', 'layout-3panel')"));
  assert.ok(appJs.includes("is-selected"));
});

test("M4-SRV-01: Static assets serve with HTTP 200 OK and zero 404s", async () => {
  const assets = ["/styles.css", "/style.css", "/reader.css", "/index.html", "/app.js"];
  for (const asset of assets) {
    const res = await fetch(`${baseUrl}${asset}`);
    assert.equal(res.status, 200, `${asset} must return HTTP 200 OK`);
    assert.ok(res.headers.get("content-type"));
  }
});
