"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TARGET_CHUNK_BYTES,
  LOCATOR_SHARDS,
  mergeSources,
  chunkItems,
  buildDataset,
  locatorShard,
} = require("../lib/cloudDataModel");

const inbox = (id, email, createdAt, extra = {}) => ({ id, email, createdAt, ...extra });
const message = (id, inboxEmail, createdAt, extra = {}) => ({
  id,
  inboxEmail,
  createdAt,
  from: "sender@example.net",
  subject: id,
  text: `body-${id}`,
  ...extra,
});

test("mergeSources keeps one canonical inbox per email and records aliases", () => {
  const merged = mergeSources(
    { inboxes: [inbox("local-id", "User@Gmail.com", "2026-01-01T00:00:00Z", { label: "Primary" })], messages: [] },
    [inbox("cloud-id", "user@gmail.com", "2026-02-01T00:00:00Z", { personName: "Cloud Person" })],
    []
  );

  assert.equal(merged.inboxes.length, 1);
  assert.equal(merged.inboxes[0].id, "local-id");
  assert.equal(merged.inboxes[0].email, "user@gmail.com");
  assert.equal(merged.inboxes[0].label, "Primary");
  assert.equal(merged.inboxes[0].personName, "Cloud Person");
  assert.equal(merged.aliases["cloud-id"], "local-id");
});

test("mergeSources quarantines invalid/test records and derives inboxes for valid orphan messages", () => {
  const merged = mergeSources(
    { inboxes: [], messages: [] },
    [inbox("official_test", "test@example.com", "2026-01-01T00:00:00Z")],
    [
      message("valid-message", "orphan@gmail.com", "2026-03-01T00:00:00Z"),
      message("bad-message", "not-an-email", "2026-03-01T00:00:00Z"),
    ]
  );

  assert.equal(merged.messages.length, 1);
  assert.equal(merged.inboxes.length, 1);
  assert.equal(merged.inboxes[0].email, "orphan@gmail.com");
  assert.equal(merged.inboxes[0].isOfficial, true);
  assert.deepEqual(merged.quarantine.map(item => item.reason).sort(), ["invalid_or_test", "missing_recipient"]);
});

test("mergeSources deduplicates the same message fingerprint and preserves richer content", () => {
  const base = message("local-message", "box@dropjar.com", "2026-04-01T00:00:00Z", {
    subject: "Security code",
    text: "short",
  });
  const duplicate = message("cloud-message", "box@dropjar.com", "2026-04-01T00:00:00Z", {
    subject: "Security code",
    text: "a substantially longer complete body",
  });
  const merged = mergeSources({ inboxes: [], messages: [base] }, [], [duplicate]);

  assert.equal(merged.messages.length, 1);
  assert.equal(merged.messages[0].id, "local-message");
  assert.equal(merged.messages[0].text, "a substantially longer complete body");
});

test("chunkItems splits at 100 records and orders every chunk newest first", () => {
  const items = Array.from({ length: 205 }, (_, index) => inbox(
    `i-${index}`,
    `i-${index}@dropjar.com`,
    new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
  ));
  const chunks = chunkItems(items, { maxItems: 100, maxBytes: TARGET_CHUNK_BYTES, kind: "inboxes" });

  assert.deepEqual(chunks.map(chunk => chunk.length), [100, 100, 5]);
  for (const chunk of chunks) {
    for (let index = 1; index < chunk.length; index += 1) {
      assert.ok(Date.parse(chunk[index - 1].createdAt) >= Date.parse(chunk[index].createdAt));
    }
  }
});

test("chunkItems splits early when the byte budget is reached", () => {
  const items = Array.from({ length: 4 }, (_, index) => message(
    `large-${index}`,
    "large@dropjar.com",
    new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    { html: "x".repeat(300_000) }
  ));
  const chunks = chunkItems(items, { maxItems: 100, maxBytes: TARGET_CHUNK_BYTES, kind: "messages" });
  assert.deepEqual(chunks.map(chunk => chunk.length), [2, 2]);
});

test("buildDataset emits full chunks, ID-only categories and correct locators", () => {
  const merged = mergeSources({
    inboxes: [
      inbox("official-1", "official@gmail.com", "2026-01-02T00:00:00Z", { isAmazon: true, isBanned: true }),
      inbox("temp-1", "temp@dropjar.com", "2026-01-01T00:00:00Z"),
    ],
    messages: [message("msg-1", "official@gmail.com", "2026-01-03T00:00:00Z", { html: "<b>complete</b>", attachments: [] })],
  }, [], []);
  const dataset = buildDataset(merged, { migrationId: "fixed", createdAt: "2026-09-19T00:00:00.000Z" });

  assert.equal(dataset.counts.totalInboxes, 2);
  assert.equal(dataset.counts.totalMessages, 1);
  assert.equal(dataset.counts.amazon, 1);
  assert.equal(dataset.counts.banned, 1);
  assert.equal(dataset.counts.suspected, 0);
  assert.deepEqual(dataset.chunkMap.category_suspected, []);
  assert.equal(dataset.messageChunks[0].data.items[0].html, "<b>complete</b>");
  assert.deepEqual(Object.keys(dataset.categoryChunks[0].data.items[0]).sort(), ["createdAt", "id"]);

  for (const doc of [...dataset.inboxChunks, ...dataset.messageChunks, ...dataset.categoryChunks]) {
    assert.ok(doc.data.items.length <= 100);
    assert.ok(doc.data.encodedBytes <= TARGET_CHUNK_BYTES);
  }

  assert.equal(dataset.locatorDocs.length, LOCATOR_SHARDS * 2);
  const expectedShard = locatorShard("official-1");
  const locator = dataset.locatorDocs.find(doc => doc.id === `inbox_${expectedShard.toString(16)}`);
  assert.deepEqual(locator.data.entries["official-1"], { chunkId: "inboxes_official_000000" });
});

test("buildDataset is deterministic when migration metadata is fixed", () => {
  const merged = mergeSources({
    inboxes: [inbox("one", "one@dropjar.com", "2026-01-01T00:00:00Z")],
    messages: [],
  }, [], []);
  const options = { migrationId: "fixed", createdAt: "2026-09-19T00:00:00.000Z" };
  assert.deepEqual(buildDataset(merged, options), buildDataset(merged, options));
});
