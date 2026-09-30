"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const auth = require("../auth");
const validators = require("../validators");

const root = path.join(__dirname, "..");

test("stateless authentication", async t => {
  await t.test("verifies the configured PIN timing-safely", () => {
    assert.equal(auth.verifyPin("0530"), true);
    assert.equal(auth.verifyPin("1234"), false);
    assert.equal(auth.verifyPin("053"), false);
    assert.equal(auth.verifyPin(""), false);
    assert.equal(auth.verifyPin(null), false);
  });

  await t.test("creates a signed expiring token without a database", async () => {
    const session = auth.createSession({ userAgent: "test-agent", ip: "127.0.0.1" });
    assert.match(session.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(auth.validateSession(session.token), true);
    const last = session.token.at(-1);
    const tampered = `${session.token.slice(0, -1)}${last === "A" ? "B" : "A"}`;
    assert.equal(auth.validateSession(tampered), false);
    assert.equal(auth.validateSession("invalid"), false);
    assert.equal(await auth.revokeSession(session.token), true);
    assert.equal(auth.validateSession(session.token), false);
  });
});

test("schema validators", async t => {
  await t.test("validates login and official inbox payloads", () => {
    assert.equal(validators.validateLoginPayload({ pin: "0530" }).valid, true);
    assert.equal(validators.validateLoginPayload({ pin: "" }).valid, false);
    assert.equal(validators.validateOfficialCreatePayload({ email: "ahmed@batabitoo.com" }).valid, true);
    assert.equal(validators.validateOfficialCreatePayload({ email: "ahmed@gmail.com" }).valid, true);
    assert.equal(validators.validateOfficialCreatePayload({ email: "invalid-email" }).valid, false);
  });

  await t.test("validates ban and app-version payloads", () => {
    const banById = validators.validateBanStatusPayload({ id: "inbox_1", banStatus: "confirmed" });
    assert.equal(banById.valid, true);
    assert.equal(banById.data.inboxId, "inbox_1");

    const banByEmail = validators.validateBanStatusPayload({ email: "test@batabitoo.com", banStatus: "safe" });
    assert.equal(banByEmail.valid, true);
    assert.equal(banByEmail.data.inboxId, "test@batabitoo.com");
    assert.equal(validators.validateBanStatusPayload({ id: "inbox_1", banStatus: "invalid" }).valid, false);
    assert.equal(validators.validateAppVersionPayload({
      latestVersionCode: 10,
      latestVersionName: "1.4.0",
      downloadUrl: "https://github.com/ahmedroou/batabitoo-mail-center/releases/download/v1.4.0/Batabitoo-Mail-Center-1.4.0.apk",
    }).valid, true);
  });
});

test("version and event configuration", async t => {
  await t.test("keeps web and Android version metadata synchronized", () => {
    const versionData = JSON.parse(fs.readFileSync(path.join(root, "public", "version.json"), "utf8"));
    const gradle = fs.readFileSync(path.join(root, "android", "app", "build.gradle.kts"), "utf8");
    assert.equal(versionData.latestVersionCode, Number(gradle.match(/versionCode = (\d+)/)[1]));
    assert.equal(versionData.latestVersionName, gradle.match(/versionName = "([^"]+)"/)[1]);
    assert.ok(versionData.sha256);
  });

  await t.test("broadcasts real-time events synchronously", () => {
    const { eventBus, broadcast } = require("../eventBus");
    let received = null;
    const handler = payload => { received = payload; };
    eventBus.once("broadcast", handler);
    broadcast("test:event", { messageId: "message-1" });
    assert.equal(received.event, "test:event");
    assert.deepEqual(received.data, { messageId: "message-1" });
    assert.ok(received.timestamp);
  });
});

test("Firestore-only runtime architecture", async t => {
  const runtimeFiles = ["CloudDatabase.js", "InboxDatabase.js", "GmailSyncService.js", "TempSyncService.js", "MailContent.js", "auth.js", "inbox_server.js", "functions.js"];

  await t.test("runtime code has no SQLite or local database dependency", () => {
    for (const file of runtimeFiles) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      assert.equal(source.includes("require('./database')"), false, `${file} still imports database.js`);
      assert.equal(source.includes('require("./database")'), false, `${file} still imports database.js`);
      assert.equal(source.includes("node:sqlite"), false, `${file} still imports SQLite`);
    }
  });

  await t.test("cloud adapter uses chunk transactions and Application Default Credentials", () => {
    const source = fs.readFileSync(path.join(root, "CloudDatabase.js"), "utf8");
    assert.match(source, /applicationDefault\(\)/);
    assert.match(source, /runTransaction/);
    assert.match(source, /buildDataset/);
    assert.match(source, /mailDatasets\/v2/);
    assert.match(source, /_targetedUpsert/);
    assert.match(source, /mailRuntime.*bootstrap/s);
    assert.match(source, /mailAuxChunks/);
  });

  await t.test("migration defaults to dry-run and requires explicit activation", () => {
    const source = fs.readFileSync(path.join(root, "scripts", "migrate_full_manifest_to_cloud.cjs"), "utf8");
    assert.match(source, /args\.has\("--write"\)/);
    assert.match(source, /args\.has\("--activate"\)/);
    assert.match(source, /system.*data_pointer/s);
    assert.equal(source.includes("collection(\"inboxes\").doc"), false);
  });

  await t.test("web client keeps only session and UI preferences locally", () => {
    const source = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
    assert.equal(source.includes("fetchManifestInboxes"), false);
    assert.equal(source.includes("CORRECT_PIN"), false);
    assert.equal(source.includes("gmail_token_"), false);
    assert.equal(source.includes("localToken"), false);
    assert.equal(source.includes("gmail/v1/users/me/messages"), false);
  });

  await t.test("Android uses SSE instead of the old eight-second full polling loop", () => {
    const viewModel = fs.readFileSync(path.join(root, "android", "app", "src", "main", "java", "com", "batabitoo", "mailcenter", "MailViewModel.kt"), "utf8");
    const repository = fs.readFileSync(path.join(root, "android", "app", "src", "main", "java", "com", "batabitoo", "mailcenter", "data", "MailRepository.kt"), "utf8");
    assert.equal(viewModel.includes("delay(8_000)"), false);
    assert.match(viewModel, /repository\.events\(\)(?:\.debounce\([^)]*\))?\.collect/);
    assert.match(repository, /text\/event-stream/);
    assert.equal(repository.includes('preferences.getString("cache_'), false);
  });

  await t.test("server owns Gmail polling without duplicating temporary-mail workers", () => {
    const gmail = fs.readFileSync(path.join(root, "GmailSyncService.js"), "utf8");
    const functions = fs.readFileSync(path.join(root, "functions.js"), "utf8");
    const temp = fs.readFileSync(path.join(root, "TempSyncService.js"), "utf8");
    assert.match(gmail, /setInterval\([^,]+, 60_000\)/s);
    assert.match(functions, /exports\.syncGmail/);
    assert.match(functions, /schedule:\s*"every 1 minutes"/);
    assert.doesNotMatch(functions, /exports\.syncMail\s*=\s*exports\.syncTempMail/);
    assert.match(temp, /rotatingPool/);
  });

  await t.test("attachments, production secrets and Android releases fail closed", () => {
    const server = fs.readFileSync(path.join(root, "inbox_server.js"), "utf8");
    const functions = fs.readFileSync(path.join(root, "functions.js"), "utf8");
    const gradle = fs.readFileSync(path.join(root, "android", "app", "build.gradle.kts"), "utf8");
    assert.match(server, /safeInlineRasterTypes/);
    assert.match(server, /Content-Security-Policy.*default-src 'none'; sandbox/s);
    assert.match(functions, /defineSecret\("MASTER_PIN"\)/);
    assert.equal(gradle.includes("debug.keystore"), false);
    assert.match(gradle, /Official release signing is not configured/);
  });
});
