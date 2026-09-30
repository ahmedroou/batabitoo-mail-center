"use strict";
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const version = require('../public/version.json');

(async () => {
  assert.match(version.sha256, /^[a-f0-9]{64}$/);
  const gradle = fs.readFileSync(path.join(__dirname, '../android/app/build.gradle.kts'), 'utf8');
  assert.equal(version.latestVersionCode, Number(gradle.match(/versionCode = (\d+)/)[1]), 'Manifest/build version code mismatch');
  assert.equal(version.latestVersionName, gradle.match(/versionName = "([^"]+)"/)[1], 'Manifest/build version name mismatch');
  const apkDir = path.join(__dirname, '../android/app/build/outputs/apk/release');
  const built = JSON.parse(fs.readFileSync(path.join(apkDir, 'output-metadata.json'), 'utf8')).elements[0];
  assert.equal(built.versionCode, version.latestVersionCode, 'APK must be rebuilt first');
  assert.equal(built.versionName, version.latestVersionName);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(apkDir, built.outputFile))).digest('hex'), version.sha256, 'Manifest does not match the built APK');
  const response = await fetch(version.downloadUrl);
  assert.equal(response.status, 200, 'APK must be publicly downloadable before activating the update');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), version.sha256);
  if (process.argv.includes('--write')) {
    const { initializeApp, cert } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    initializeApp({ credential: cert(require('../serviceAccountKey.json')) });
    await getFirestore().collection('mailRuntime').doc('bootstrap').set({ appVersion: { ...version, updatedAt: new Date().toISOString() } }, { merge: true });
  }
  console.log(JSON.stringify({ version: version.latestVersionName, code: version.latestVersionCode, bytes: bytes.length, sha256: version.sha256, activated: process.argv.includes('--write') }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
