"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const db = require("../InboxDatabase");
const { handleRequest } = require("../inbox_server");

let server;
let baseUrl;
const cleanupEmails = new Set();

before(async () => {
  await db.ready();
  await new Promise(resolve => {
    server = http.createServer(handleRequest).listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  for (const email of cleanupEmails) {
    const inbox = db.findInboxByEmail ? db.findInboxByEmail(email) : null;
    if (inbox?.id) await db.deleteInbox(inbox.id);
    if (db.removeDeletedAmazonAccount) await db.removeDeletedAmazonAccount(email);
  }
  if (server) await new Promise(resolve => server.close(resolve));
});

const MASTER_PIN = "0530";
const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "X-Master-PIN": MASTER_PIN,
};

test("Amazon Account Deletion & Suppression: CloudDatabase methods", async () => {
  const testEmail = `test_suppress_${Date.now()}@gmail.com`;
  cleanupEmails.add(testEmail);
  
  // 1. Add to deleted Amazon accounts
  const added = await db.addDeletedAmazonAccount(testEmail);
  assert.equal(added, true);
  
  let list = db.getDeletedAmazonAccounts();
  assert.ok(list.includes(testEmail.toLowerCase()));

  // Background writers cannot implicitly remove the tombstone or recreate it.
  const suppressed = await db.saveInbox({ email: testEmail, isOfficial: true, isAmazon: true });
  assert.equal(suppressed, null);
  assert.equal(db.findInboxByEmail(testEmail), null);
  
  // 2. Remove from deleted Amazon accounts
  const removed = await db.removeDeletedAmazonAccount(testEmail);
  assert.equal(removed, true);
  
  list = db.getDeletedAmazonAccounts();
  assert.equal(list.includes(testEmail.toLowerCase()), false);
});

test("Amazon Account Deletion & Restore Endpoints via HTTP", async () => {
  const testEmail = `del_http_${Date.now()}@gmail.com`;
  cleanupEmails.add(testEmail);
  
  // 1. Delete via POST /api/amazon/delete
  const delRes = await fetch(`${baseUrl}/api/amazon/delete`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ email: testEmail })
  });
  assert.equal(delRes.status, 200);
  const delData = await delRes.json();
  assert.equal(delData.success, true);
  assert.equal(delData.email, testEmail.toLowerCase());
  
  // 2. GET /api/amazon/deleted
  const getRes = await fetch(`${baseUrl}/api/amazon/deleted`, { headers: AUTH_HEADERS });
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.ok(getData.deleted.includes(testEmail.toLowerCase()));

  // Incoming mail is acknowledged but discarded while the tombstone exists.
  const inboundRes = await fetch(`${baseUrl}/api/webhook/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: testEmail, sender: "sender@example.com", subject: "must stay deleted", text: "ignored" })
  });
  assert.equal(inboundRes.status, 202);
  assert.equal((await inboundRes.json()).suppressed, true);
  assert.equal(db.findInboxByEmail(testEmail), null);
  
  // 3. GET /api/inboxes contains deletedAmazon
  const inboxesRes = await fetch(`${baseUrl}/api/inboxes`, { headers: AUTH_HEADERS });
  const inboxesData = await inboxesRes.json();
  assert.ok(Array.isArray(inboxesData.deletedAmazon));
  assert.ok(inboxesData.deletedAmazon.includes(testEmail.toLowerCase()));
  
  // 4. Restore via POST /api/amazon/restore
  const restoreRes = await fetch(`${baseUrl}/api/amazon/restore`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ email: testEmail })
  });
  assert.equal(restoreRes.status, 200);
  const restoreData = await restoreRes.json();
  assert.equal(restoreData.success, true);
  
  // 5. Verify no longer in deleted list
  const getRes2 = await fetch(`${baseUrl}/api/amazon/deleted`, { headers: AUTH_HEADERS });
  const getData2 = await getRes2.json();
  assert.equal(getData2.deleted.includes(testEmail.toLowerCase()), false);
});
