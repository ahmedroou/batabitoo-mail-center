"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { equivalent, oauthNeedsWrite } = require('./lib/cloudWritePolicy');
const { applicationDefault, cert, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const {
  buildDataset,
  buildChunkDocuments,
  buildLocatorDocuments,
  canonicalInbox,
  canonicalMessage,
  isOfficialInbox,
  isOfficialMessage,
  normalizeEmail,
  locatorShard,
  sha256,
  TARGET_CHUNK_BYTES,
} = require("./lib/cloudDataModel");

const SERVICE_ACCOUNT_FILE = path.join(__dirname, "serviceAccountKey.json");
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "batabitoo-mail-2026";
const FALLBACK_DATASET_PATH = "mailDatasets/v2";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asDateMs(value) {
  const ms = Date.parse(value || 0);
  return Number.isFinite(ms) ? ms : 0;
}

function sortNewest(items) {
  return [...items].sort((a, b) => asDateMs(b.createdAt) - asDateMs(a.createdAt));
}

function initializeFirebase() {
  const testOptions = require('./lib/testDatabaseSafety').testDatabaseOptions();
  if (testOptions) {
    const apps = getApps();
    if (apps.some(app => app.options.projectId !== testOptions.projectId)) {
      throw new Error('Refusing to reuse a production Firebase app in integration tests.');
    }
    return apps[0] || initializeApp(testOptions);
  }
  if (getApps().length) return getApps()[0];
  const options = {
    projectId: PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`,
  };
  if (fs.existsSync(SERVICE_ACCOUNT_FILE)) {
    options.credential = cert(JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, "utf8")));
  } else {
    options.credential = applicationDefault();
  }
  return initializeApp(options);
}

function chunkRefs(root, meta, { includeCategories = true } = {}) {
  const refs = [];
  for (const [partition, ids] of Object.entries(meta?.chunkMap || {})) {
    if (!includeCategories && partition.startsWith("category_")) continue;
    const collection = partition.startsWith("inboxes_")
      ? "inboxChunks"
      : partition.startsWith("messages_")
        ? "messageChunks"
        : "categoryChunks";
    for (const id of ids || []) refs.push(root.collection(collection).doc(id));
  }
  return refs;
}

function materializeChunkSnapshots(snapshots) {
  const inboxes = [];
  const messages = [];
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    const data = snapshot.data();
    if (data.partition?.startsWith("inboxes_")) inboxes.push(...(data.items || []));
    if (data.partition?.startsWith("messages_")) messages.push(...(data.items || []));
  }
  return { inboxes, messages };
}

class CloudMailDatabase {
  constructor() {
    this.firestore = getFirestore(initializeFirebase());
    this.cache = {
      inboxes: [],
      messages: [],
      activeInboxId: null,
      oauthAccounts: [],
      settings: {},
      ignoredPatterns: [],
      deletedAmazonAccounts: [],
      appVersion: null,
      niveaLogs: [],
      aiFeedback: [],
    };
    this.meta = null;
    this.datasetPath = FALLBACK_DATASET_PATH;
    this.isCloudConnected = false;
    this._writeQueue = Promise.resolve();
    this.readyPromise = this.initialize();
  }

  async initialize() {
    const pointer = await this.firestore.collection("system").doc("data_pointer").get();
    if (pointer.exists && pointer.data().activeDatasetPath) {
      this.datasetPath = pointer.data().activeDatasetPath;
    }
    await Promise.all([this._loadCore(), this._loadAuxiliary()]);
    this._lastRefreshAt = Date.now();
    this.isCloudConnected = true;
    return this;
  }

  ready() {
    return this.readyPromise;
  }

  async refreshIfChanged({ force = false } = {}) {
    await this.ready();
    if (this._refreshPromise) return this._refreshPromise;
    if (!force && Date.now() - (this._lastRefreshAt || 0) < 30000) return;
    this._refreshPromise = this._enqueue(async () => {
      const [pointer, bootstrap] = await Promise.all([
        this.firestore.collection('system').doc('data_pointer').get(),
        this.firestore.collection('mailRuntime').doc('bootstrap').get(),
      ]);
      const remotePath = pointer.data()?.activeDatasetPath || this.datasetPath;
      const datasetChanged = remotePath !== this.datasetPath;
      this.datasetPath = remotePath;
      // The pointer already carries the core revision; no third metadata read
      // on every idle check. Older pointers are supported with a root fallback.
      const pointerData = pointer.data() || {};
      const remoteMeta = pointerData.revision == null ? (await this._datasetRef().get()).data() : pointerData;
      if (this._coreDirty || datasetChanged || remoteMeta?.revision !== this.meta?.revision || remoteMeta?.checksum !== this.meta?.checksum) {
        await this._loadCore();
        this._coreDirty = false;
      }
      const data = bootstrap.data() || {};
      this.cache.appVersion = data.appVersion || null;
      this.cache.deletedAmazonAccounts = data.deletedAmazonAccounts || [];
      this.cache.activeInboxId = data.activeInboxId || null;
      this.cache.oauthAccounts = data.oauthAccounts || this.cache.oauthAccounts;
      this.cache.settings = data.values || this.cache.settings;
      this._lastRefreshAt = Date.now();
    }).finally(() => { this._refreshPromise = null; });
    return this._refreshPromise;
  }

  async getCloudAppVersion() {
    await this.refreshIfChanged();
    return this.getAppVersion();
  }

  _datasetRef() {
    const [collection, id] = this.datasetPath.split("/");
    if (!collection || !id) throw new Error(`Invalid active dataset path: ${this.datasetPath}`);
    return this.firestore.collection(collection).doc(id);
  }

  async _loadCore() {
    const root = this._datasetRef();
    const metaSnapshot = await root.get();
    if (!metaSnapshot.exists) {
      throw new Error(`Cloud dataset ${this.datasetPath} is not staged. Run npm run migrate:cloud:stage first.`);
    }
    const meta = metaSnapshot.data();
    const refs = chunkRefs(root, meta, { includeCategories: false });
    const snapshots = refs.length ? await this.firestore.getAll(...refs) : [];
    const state = materializeChunkSnapshots(snapshots);
    this.cache.inboxes = sortNewest(state.inboxes);
    this.cache.messages = sortNewest(state.messages);
    this.meta = meta;
  }

  async _loadAuxiliary() {
    const bootstrapRef = this.firestore.collection("mailRuntime").doc("bootstrap");
    const bootstrap = await bootstrapRef.get();
    if (!bootstrap.exists) {
      // One-time compatibility import. The migration writes bootstrap directly,
      // so normal cold starts never fan out across these legacy collections.
      const [runtime, config, oauth, nivea, feedback] = await Promise.all([
        this.firestore.collection("mailRuntime").doc("state").get(),
        this.firestore.collection("mailConfig").doc("settings").get(),
        this.firestore.collection("mailOAuthAccounts").get(),
        this.firestore.collection("mailNiveaLogs").orderBy("registeredAt", "desc").limit(1000).get(),
        this.firestore.collection("mailAiFeedback").orderBy("createdAt", "desc").limit(1000).get(),
      ]);
      const runtimeData = runtime.exists ? runtime.data() : {};
      const configData = config.exists ? config.data() : {};
      this.cache.activeInboxId = runtimeData.activeInboxId || null;
      this.cache.settings = configData.values || {};
      this.cache.ignoredPatterns = configData.ignoredPatterns || [];
      this.cache.appVersion = runtimeData.appVersion || null;
      this.cache.oauthAccounts = oauth.docs.map(doc => doc.data());
      this.cache.niveaLogs = nivea.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      this.cache.aiFeedback = feedback.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const niveaChunks = buildChunkDocuments("nivea", this.cache.niveaLogs.map(item => ({
        ...item,
        id: String(item.id || `nivea_${sha256(item).slice(0, 20)}`),
        createdAt: item.registeredAt || item.createdAt || new Date().toISOString(),
      })), { maxItems: 100, maxBytes: TARGET_CHUNK_BYTES, kind: "nivea" });
      const feedbackChunks = buildChunkDocuments("aiFeedback", this.cache.aiFeedback.map(item => ({
        ...item,
        id: String(item.id || `feedback_${sha256(item).slice(0, 20)}`),
        createdAt: item.createdAt || new Date().toISOString(),
      })), { maxItems: 100, maxBytes: TARGET_CHUNK_BYTES, kind: "aiFeedback" });
      const batch = this.firestore.batch();
      for (const doc of niveaChunks) batch.set(this.firestore.collection("mailAuxChunks").doc(doc.id), { ...doc.data, entity: "nivea" });
      for (const doc of feedbackChunks) batch.set(this.firestore.collection("mailAuxChunks").doc(doc.id), { ...doc.data, entity: "aiFeedback" });
      batch.set(bootstrapRef, this._bootstrapData({
        auxChunkMap: {
          nivea: niveaChunks.map(doc => doc.id).sort().reverse(),
          aiFeedback: feedbackChunks.map(doc => doc.id).sort().reverse(),
        },
        auxCounts: { nivea: this.cache.niveaLogs.length, aiFeedback: this.cache.aiFeedback.length },
        revision: 1,
        oauthManifestVersion: 1,
      }));
      await batch.commit();
      return;
    }

    const data = bootstrap.data();
    this.cache.activeInboxId = data.activeInboxId || null;
    this.cache.settings = data.values || {};
    this.cache.ignoredPatterns = data.ignoredPatterns || [];
    this.cache.deletedAmazonAccounts = Array.isArray(data.deletedAmazonAccounts)
      ? data.deletedAmazonAccounts.map(e => String(e).toLowerCase().trim()).filter(Boolean)
      : [];
    this.cache.appVersion = data.appVersion || null;
    this.cache.oauthAccounts = data.oauthAccounts || [];

    if (!this.cache.settings.google_oauth_config) {
      try {
        const configDoc = await this.firestore.collection("mailConfig").doc("settings").get();
        if (configDoc.exists && configDoc.data()?.values?.google_oauth_config) {
          this.cache.settings.google_oauth_config = configDoc.data().values.google_oauth_config;
        }
      } catch (_) {}
    }

    if (data.oauthManifestVersion !== 1) try {
      const oauthColl = await this.firestore.collection("mailOAuthAccounts").get();
      if (oauthColl && oauthColl.size > 0) {
        const collAccounts = oauthColl.docs.map(doc => doc.data());
        const mergedMap = new Map();
        for (const acc of (this.cache.oauthAccounts || [])) {
          if (acc && acc.email) mergedMap.set(normalizeEmail(acc.email), acc);
        }
        for (const acc of collAccounts) {
          if (acc && acc.email) {
            const key = normalizeEmail(acc.email);
            const existing = mergedMap.get(key) || {};
            // Bootstrap is authoritative for existing accounts. The legacy
            // collection is imported once only, never on every cold start.
            mergedMap.set(key, { ...acc, ...existing });
          }
        }
        this.cache.oauthAccounts = Array.from(mergedMap.values());
      }
      await this.firestore.runTransaction(async transaction => {
        const latest = await transaction.get(bootstrapRef);
        if (latest.data()?.oauthManifestVersion === 1) return;
        const accounts = new Map(this.cache.oauthAccounts.map(account => [normalizeEmail(account.email), account]));
        for (const account of latest.data()?.oauthAccounts || []) accounts.set(normalizeEmail(account.email), account);
        this.cache.oauthAccounts = [...accounts.values()];
        transaction.set(bootstrapRef, { oauthAccounts: this.cache.oauthAccounts, oauthManifestVersion: 1 }, { merge: true });
      });
    } catch (_) {}

    const map = data.auxChunkMap || {};
    const ids = [...(map.nivea || []), ...(map.aiFeedback || [])];
    const refs = ids.map(id => this.firestore.collection("mailAuxChunks").doc(id));
    const snapshots = refs.length ? await this.firestore.getAll(...refs) : [];
    this.cache.niveaLogs = [];
    this.cache.aiFeedback = [];
    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;
      const chunk = snapshot.data();
      if (chunk.entity === "nivea") this.cache.niveaLogs.push(...(chunk.items || []));
      if (chunk.entity === "aiFeedback") this.cache.aiFeedback.push(...(chunk.items || []));
    }
    this.cache.niveaLogs = sortNewest(this.cache.niveaLogs.map(item => ({ ...item, createdAt: item.registeredAt || item.createdAt })));
    this.cache.aiFeedback = sortNewest(this.cache.aiFeedback);
  }

  _bootstrapData(extra = {}) {
    return {
      activeInboxId: this.cache.activeInboxId || null,
      values: clone(this.cache.settings),
      ignoredPatterns: [...this.cache.ignoredPatterns],
      deletedAmazonAccounts: [...(this.cache.deletedAmazonAccounts || [])],
      appVersion: clone(this.cache.appVersion),
      oauthAccounts: clone(this.cache.oauthAccounts),
      ...extra,
      updatedAt: new Date().toISOString(),
    };
  }

  _persistBootstrap(fields = null) {
    return this._enqueue(async () => {
      const docRef = this.firestore.collection("mailRuntime").doc("bootstrap");
      if (fields && Array.isArray(fields)) {
        const fullData = this._bootstrapData();
        const partial = { updatedAt: new Date().toISOString() };
        for (const field of fields) {
          if (field in fullData) partial[field] = fullData[field];
        }
        await docRef.set(partial, { merge: true });
        return;
      }
      const currentDoc = await docRef.get().catch(() => null);
      let mergedOAuth = clone(this.cache.oauthAccounts || []);
      if (currentDoc && currentDoc.exists) {
        const remoteOAuth = currentDoc.data()?.oauthAccounts || [];
        for (const rAcc of remoteOAuth) {
          const rEmail = normalizeEmail(rAcc.email);
          if (rEmail && !mergedOAuth.some(lAcc => normalizeEmail(lAcc.email) === rEmail)) {
            mergedOAuth.push(rAcc);
          }
        }
      }
      this.cache.oauthAccounts = mergedOAuth;
      const data = this._bootstrapData();
      await docRef.set(data, { merge: true });
    });
  }

  _appendAux(entity, item) {
    const collection = this.firestore.collection("mailAuxChunks");
    return this._enqueue(async () => {
      await this.firestore.runTransaction(async transaction => {
        const bootstrapRef = this.firestore.collection("mailRuntime").doc("bootstrap");
        const bootstrapSnapshot = await transaction.get(bootstrapRef);
        const bootstrap = bootstrapSnapshot.exists ? bootstrapSnapshot.data() : this._bootstrapData();
        const auxChunkMap = clone(bootstrap.auxChunkMap || { nivea: [], aiFeedback: [] });
        if (!auxChunkMap[entity]) auxChunkMap[entity] = [];
        const latestId = auxChunkMap[entity][0] || null;
        const latestRef = latestId ? collection.doc(latestId) : null;
        const latestSnapshot = latestRef ? await transaction.get(latestRef) : null;
        const currentItems = latestSnapshot?.exists ? [...(latestSnapshot.data().items || [])] : [];
        const candidate = [item, ...currentItems];
        const fits = candidate.length <= 100 && Buffer.byteLength(JSON.stringify({ entity, items: candidate }), "utf8") <= TARGET_CHUNK_BYTES;
        let chunkId = latestId;
        let items = candidate;
        if (!fits || !chunkId) {
          const latestSequence = Number(latestSnapshot?.data()?.seq ?? -1);
          chunkId = `${entity}_${String(latestSequence + 1).padStart(6, "0")}`;
          items = [item];
          auxChunkMap[entity].unshift(chunkId);
        }
        transaction.set(collection.doc(chunkId), {
          id: chunkId,
          entity,
          seq: Number(chunkId.split("_").pop()),
          itemCount: items.length,
          items,
          encodedBytes: Buffer.byteLength(JSON.stringify({ entity, items }), "utf8"),
          updatedAt: new Date().toISOString(),
        });
        transaction.set(bootstrapRef, {
          auxChunkMap,
          auxCounts: {
            nivea: entity === "nivea" ? this.cache.niveaLogs.length : Number(bootstrap.auxCounts?.nivea || 0),
            aiFeedback: entity === "aiFeedback" ? this.cache.aiFeedback.length : Number(bootstrap.auxCounts?.aiFeedback || 0),
          },
          revision: Number(bootstrap.revision || 0) + 1,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      });
    });
  }

  _enqueue(task) {
    const run = this._writeQueue.then(() => this.readyPromise).then(task);
    this._writeQueue = run.catch(error => {
      console.error("Firestore write failed:", error.message);
    });
    return run;
  }

  _partitionFor(entity, item) {
    if (entity === "inbox") return isOfficialInbox(item) ? "inboxes_official" : "inboxes_temp";
    return isOfficialMessage(item) ? "messages_official" : "messages_temp";
  }

  _collectionFor(entity) {
    return entity === "inbox" ? "inboxChunks" : "messageChunks";
  }

  _categoryMembership(inbox) {
    return {
      amazon: Boolean(inbox?.isAmazon || inbox?.isBanned || ["confirmed", "suspected"].includes(inbox?.banStatus)),
      banned: Boolean(inbox?.isBanned || inbox?.banStatus === "confirmed"),
      suspected: Boolean(!inbox?.isBanned && inbox?.banStatus === "suspected"),
    };
  }

  _targetedUpsert(entity, records) {
    const prepared = records.map(clone);
    if (!prepared.length) return Promise.resolve([]);
    return this._enqueue(async () => {
      let committedRecords = [];
      let committedMeta;
      let coreWasStale = false;
      await this.firestore.runTransaction(async transaction => {
        // Firestore can retry this callback; never retain the previous attempt.
        committedRecords = [];
        const root = this._datasetRef();
        const metaSnapshot = await transaction.get(root);
        if (!metaSnapshot.exists) throw new Error(`Active cloud dataset missing: ${this.datasetPath}`);
        const meta = clone(metaSnapshot.data());
        committedMeta = meta;
        coreWasStale = meta.revision !== this.meta?.revision || meta.checksum !== this.meta?.checksum;
        const collectionName = this._collectionFor(entity);
        const locatorCollection = root.collection("locatorShards");
        const shardIds = [...new Set(prepared.map(item => `${entity}_${locatorShard(item.id).toString(16)}`))];
        const shardRefs = shardIds.map(id => locatorCollection.doc(id));
        const shardSnapshots = shardRefs.length ? await transaction.getAll(...shardRefs) : [];
        const shards = new Map(shardSnapshots.map(snapshot => [snapshot.id, clone(snapshot.data() || { entity, entries: {} })]));

        const requiredChunkIds = new Set();
        for (const item of prepared) {
          const shard = shards.get(`${entity}_${locatorShard(item.id).toString(16)}`);
          const existing = shard?.entries?.[item.id];
          if (existing?.chunkId) requiredChunkIds.add(existing.chunkId);
          const latest = meta.chunkMap?.[this._partitionFor(entity, item)]?.[0];
          if (latest) requiredChunkIds.add(latest);
        }
        const chunkRefsToRead = [...requiredChunkIds].map(id => root.collection(collectionName).doc(id));
        const allSnapshots = chunkRefsToRead.length ? await transaction.getAll(...chunkRefsToRead) : [];
        const chunks = new Map();
        const categories = { amazon: [], banned: [], suspected: [] };
        for (const snapshot of allSnapshots) {
          if (!snapshot.exists) continue;
          const data = clone(snapshot.data());
          chunks.set(snapshot.id, data);
        }
        const touchedChunks = new Set();
        const touchedShards = new Set();
        const removedChunkIds = new Set();
        const oldNewPairs = [];
        for (const incoming of prepared) {
          const shardId = `${entity}_${locatorShard(incoming.id).toString(16)}`;
          const shard = shards.get(shardId) || { entity, shard: locatorShard(incoming.id), entries: {}, itemCount: 0 };
          if (!shard.entries) shard.entries = {};
          shards.set(shardId, shard);
          const location = shard.entries[incoming.id];
          let oldItem = null;
          let sourceChunk = location?.chunkId ? chunks.get(location.chunkId) : null;
          if (sourceChunk) {
            oldItem = sourceChunk.items.find(item => item.id === incoming.id) || null;
          }
          const merged = oldItem ? { ...oldItem, ...incoming, id: oldItem.id } : incoming;
          if (oldItem && equivalent(oldItem, merged, ['updatedAt', 'syncedFromRemoteAt'])) {
            committedRecords.push(oldItem);
            continue;
          }
          if (sourceChunk) {
            sourceChunk.items = sourceChunk.items.filter(item => item.id !== incoming.id);
            sourceChunk.itemCount = sourceChunk.items.length;
            touchedChunks.add(sourceChunk.id);
          }
          const partition = this._partitionFor(entity, merged);
          let targetChunk = sourceChunk && sourceChunk.partition === partition ? sourceChunk : null;
          if (!targetChunk) {
            const latestId = meta.chunkMap?.[partition]?.[0];
            targetChunk = latestId ? chunks.get(latestId) : null;
          }
          const candidateItems = sortNewest([...(targetChunk?.items || []), merged]);
          const fits = targetChunk && candidateItems.length <= 100 && Buffer.byteLength(JSON.stringify({ partition, items: candidateItems }), "utf8") <= TARGET_CHUNK_BYTES;
          if (!fits) {
            const existingIds = meta.chunkMap?.[partition] || [];
            const nextSeq = existingIds.reduce((max, id) => Math.max(max, Number(id.split("_").pop()) || 0), -1) + 1;
            const id = `${partition}_${String(nextSeq).padStart(6, "0")}`;
            targetChunk = { id, partition, seq: nextSeq, items: [], itemCount: 0 };
            chunks.set(id, targetChunk);
            if (!meta.chunkMap[partition]) meta.chunkMap[partition] = [];
            meta.chunkMap[partition].unshift(id);
          }
          targetChunk.items = sortNewest([...targetChunk.items.filter(item => item.id !== merged.id), merged]);
          targetChunk.itemCount = targetChunk.items.length;
          targetChunk.newestAt = targetChunk.items[0]?.createdAt || null;
          targetChunk.oldestAt = targetChunk.items[targetChunk.items.length - 1]?.createdAt || null;
          targetChunk.encodedBytes = Buffer.byteLength(JSON.stringify(targetChunk), "utf8");
          targetChunk.checksum = sha256(targetChunk.items);
          touchedChunks.add(targetChunk.id);
          if (shard.entries[merged.id]?.chunkId !== targetChunk.id) touchedShards.add(shardId);
          shard.entries[merged.id] = { chunkId: targetChunk.id };
          shard.itemCount = Object.keys(shard.entries).length;
          oldNewPairs.push({ oldItem, newItem: merged });
          committedRecords.push(merged);
        }
        if (!oldNewPairs.length) return;

        // Decide from the record actually read inside this transaction, not
        // from the process cache (which can be stale in another server instance).
        const needsCategoryUpdate = entity === "inbox" && oldNewPairs.some(({ oldItem, newItem }) => {
          const oldMembership = this._categoryMembership(oldItem);
          const newMembership = this._categoryMembership(newItem);
          return Object.keys(newMembership).some(category => oldMembership[category] !== newMembership[category]);
        });
        if (needsCategoryUpdate) {
          const categoryIds = ["category_amazon", "category_banned", "category_suspected"]
            .flatMap(partition => meta.chunkMap?.[partition] || []);
          const categoryRefs = categoryIds.map(id => root.collection("categoryChunks").doc(id));
          const categorySnapshots = categoryRefs.length ? await transaction.getAll(...categoryRefs) : [];
          for (const snapshot of categorySnapshots) {
            if (!snapshot.exists) continue;
            const data = clone(snapshot.data());
            const category = data.partition?.slice("category_".length);
            if (categories[category]) categories[category].push(...(data.items || []));
          }
        }

        for (const chunkId of touchedChunks) {
          const chunk = chunks.get(chunkId);
          if (!chunk || !chunk.items.length) {
            if (chunk) {
              meta.chunkMap[chunk.partition] = (meta.chunkMap[chunk.partition] || []).filter(id => id !== chunkId);
              removedChunkIds.add(chunkId);
            }
            continue;
          }
        }

        const counts = { ...(meta.counts || {}) };
        for (const { oldItem, newItem } of oldNewPairs) {
          if (!oldItem) {
            if (entity === "inbox") counts.totalInboxes = Number(counts.totalInboxes || 0) + 1;
            else counts.totalMessages = Number(counts.totalMessages || 0) + 1;
          }
          const oldOfficial = oldItem ? (entity === "inbox" ? isOfficialInbox(oldItem) : isOfficialMessage(oldItem)) : null;
          const newOfficial = entity === "inbox" ? isOfficialInbox(newItem) : isOfficialMessage(newItem);
          const officialKey = entity === "inbox" ? "official" : "officialMessages";
          const tempKey = entity === "inbox" ? "temp" : "tempMessages";
          if (oldOfficial === null) {
            counts[newOfficial ? officialKey : tempKey] = Number(counts[newOfficial ? officialKey : tempKey] || 0) + 1;
          } else if (oldOfficial !== newOfficial) {
            counts[oldOfficial ? officialKey : tempKey] = Math.max(0, Number(counts[oldOfficial ? officialKey : tempKey] || 0) - 1);
            counts[newOfficial ? officialKey : tempKey] = Number(counts[newOfficial ? officialKey : tempKey] || 0) + 1;
          }
        }

        if (needsCategoryUpdate) {
          for (const { oldItem, newItem } of oldNewPairs) {
            for (const category of Object.keys(categories)) {
              categories[category] = categories[category].filter(item => item.id !== newItem.id);
              if (this._categoryMembership(newItem)[category]) categories[category].push({ id: newItem.id, createdAt: newItem.createdAt });
            }
          }
          for (const category of Object.keys(categories)) {
            const partition = `category_${category}`;
            const oldIds = meta.chunkMap?.[partition] || [];
            const docs = buildChunkDocuments(partition, categories[category], { maxItems: 100, maxBytes: TARGET_CHUNK_BYTES, kind: "ids" });
            const newIds = docs.map(doc => doc.id).sort().reverse();
            for (const id of oldIds) if (!newIds.includes(id)) transaction.delete(root.collection("categoryChunks").doc(id));
            for (const doc of docs) transaction.set(root.collection("categoryChunks").doc(doc.id), doc.data);
            meta.chunkMap[partition] = newIds;
            counts[category] = categories[category].length;
          }
        }

        for (const chunkId of removedChunkIds) transaction.delete(root.collection(collectionName).doc(chunkId));
        for (const chunkId of touchedChunks) {
          if (!removedChunkIds.has(chunkId)) transaction.set(root.collection(collectionName).doc(chunkId), chunks.get(chunkId));
        }
        for (const shardId of touchedShards) transaction.set(locatorCollection.doc(shardId), shards.get(shardId));
        meta.counts = counts;
        meta.revision = Number(meta.revision || 0) + 1;
        meta.updatedAt = new Date().toISOString();
        meta.checksum = sha256({ previous: meta.checksum, entity, records: committedRecords, revision: meta.revision });
        transaction.set(root, meta);
        transaction.set(this.firestore.collection("system").doc("data_pointer"), {
          activeDatasetPath: this.datasetPath,
          activeVersion: this.datasetPath.split("/").pop(),
          migrationId: meta.migrationId,
          checksum: meta.checksum,
          revision: meta.revision,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      this.meta = committedMeta;
      this._coreDirty = this._coreDirty || coreWasStale;

      const key = entity === "inbox" ? "inboxes" : "messages";
      const byId = new Map(this.cache[key].map(item => [item.id, item]));
      for (const item of committedRecords) byId.set(item.id, item);
      this.cache[key] = sortNewest([...byId.values()]);
      return clone(committedRecords);
    });
  }

  _mutateCore(mutator) {
    return this._enqueue(async () => {
      let committed = null;
      await this.firestore.runTransaction(async transaction => {
        const root = this._datasetRef();
        const metaSnapshot = await transaction.get(root);
        if (!metaSnapshot.exists) throw new Error(`Active cloud dataset missing: ${this.datasetPath}`);
        const oldMeta = metaSnapshot.data();
        const oldRefs = chunkRefs(root, oldMeta);
        const oldSnapshots = oldRefs.length ? await transaction.getAll(...oldRefs) : [];
        const state = materializeChunkSnapshots(oldSnapshots);
        const before = sha256(state);
        const result = await mutator(state);
        if (sha256(state) === before) {
          committed = { state, dataset: { meta: oldMeta }, result };
          return;
        }
        const dataset = buildDataset(state, {
          migrationId: oldMeta.migrationId || `runtime_${Date.now()}`,
          createdAt: oldMeta.createdAt || new Date().toISOString(),
        });
        dataset.meta.status = oldMeta.status || "active";
        dataset.meta.revision = Number(oldMeta.revision || 0) + 1;
        dataset.meta.updatedAt = new Date().toISOString();

        const newDocs = [
          ...dataset.inboxChunks.map(doc => ["inboxChunks", doc]),
          ...dataset.messageChunks.map(doc => ["messageChunks", doc]),
          ...dataset.categoryChunks.map(doc => ["categoryChunks", doc]),
          ...dataset.locatorDocs.map(doc => ["locatorShards", doc]),
        ];
        const newPaths = new Set(newDocs.map(([collection, doc]) => `${collection}/${doc.id}`));
        const oldDocs = new Map(oldSnapshots.filter(snapshot => snapshot.exists)
          .map(snapshot => [`${snapshot.ref.parent.id}/${snapshot.id}`, snapshot.data()]));
        // Locators are derived from the actual old chunks, without reading all
        // 32 shards merely to discover that most have not changed.
        for (const [entity, partition] of [['inbox', 'inboxes_'], ['message', 'messages_']]) {
          const chunks = oldSnapshots.filter(snapshot => snapshot.exists && snapshot.data().partition?.startsWith(partition))
            .map(snapshot => ({ id: snapshot.id, data: snapshot.data() }));
          for (const doc of buildLocatorDocuments(entity, chunks)) oldDocs.set(`locatorShards/${doc.id}`, doc.data);
        }
        for (const oldRef of oldRefs) {
          const relative = `${oldRef.parent.id}/${oldRef.id}`;
          if (!newPaths.has(relative)) transaction.delete(oldRef);
        }
        for (const [collection, doc] of newDocs) {
          const previous = oldDocs.get(`${collection}/${doc.id}`);
          const unchanged = previous && (collection === 'locatorShards'
            ? equivalent(previous, doc.data, [])
            : previous.checksum === doc.data.checksum && equivalent(previous.items, doc.data.items, []));
          if (!unchanged) transaction.set(root.collection(collection).doc(doc.id), doc.data);
        }
        transaction.set(root, dataset.meta);
        transaction.set(this.firestore.collection("system").doc("data_pointer"), {
          activeDatasetPath: this.datasetPath,
          activeVersion: this.datasetPath.split("/").pop(),
          migrationId: dataset.meta.migrationId,
          checksum: dataset.meta.checksum,
          revision: dataset.meta.revision,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        committed = { state, dataset, result };
      });
      this.cache.inboxes = sortNewest(committed.state.inboxes);
      this.cache.messages = sortNewest(committed.state.messages);
      this.meta = committed.dataset.meta;
      return committed.result;
    });
  }

  getStatusCounts() {
    const inboxes = this.cache.inboxes;
    const messages = this.cache.messages;
    return {
      totalInboxes: inboxes.length,
      official: inboxes.filter(isOfficialInbox).length,
      temp: inboxes.filter(item => !isOfficialInbox(item)).length,
      amazon: inboxes.filter(item => item.isAmazon || item.isBanned || ["confirmed", "suspected"].includes(item.banStatus)).length,
      banned: inboxes.filter(item => item.isBanned || item.banStatus === "confirmed").length,
      suspected: inboxes.filter(item => !item.isBanned && item.banStatus === "suspected").length,
      messages: messages.length,
      amazonMessages: messages.filter(item => item.isAmazon || item.isBanned).length,
      bannedMessages: messages.filter(item => item.isBanned).length,
      winningMessages: messages.filter(item => item.isWinning).length,
    };
  }

  getAllInboxes() { return clone(sortNewest(this.cache.inboxes)); }
  getOfficialInboxes() { return this.getAllInboxes().filter(isOfficialInbox); }
  getTempInboxes() { return this.getAllInboxes().filter(item => !isOfficialInbox(item)); }
  getAmazonInboxes() { return this.getOfficialInboxes().filter(item => item.isAmazon || item.isBanned || ["confirmed", "suspected"].includes(item.banStatus)); }
  getBannedInboxes() { return this.getOfficialInboxes().filter(item => item.isBanned || item.banStatus === "confirmed"); }
  getSuspectedInboxes() { return this.getOfficialInboxes().filter(item => !item.isBanned && item.banStatus === "suspected"); }
  findInboxById(id) { return clone(this.cache.inboxes.find(item => item.id === String(id)) || null); }
  findInboxByEmail(email) { const clean = normalizeEmail(email); return clone(this.cache.inboxes.find(item => normalizeEmail(item.email) === clean) || null); }
  getActiveInboxId() { return this.cache.activeInboxId; }
  getActiveInbox() { return this.findInboxById(this.cache.activeInboxId); }

  setActiveInboxId(id) {
    if (this.cache.activeInboxId === (id || null)) return Promise.resolve(true);
    const activeInboxId = id || null;
    return this._enqueue(async () => {
      await this.firestore.collection("mailRuntime").doc("bootstrap").set(
        { activeInboxId, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      this.cache.activeInboxId = activeInboxId;
      return true;
    });
  }

  async saveInbox(raw) {
    const existing = this.cache.inboxes.find(item => item.id === raw.id || normalizeEmail(item.email) === normalizeEmail(raw.email));
    const normalized = canonicalInbox({ ...existing, ...raw, id: existing?.id || raw.id });
    if (normalized.email && this.cache.deletedAmazonAccounts?.includes(normalizeEmail(normalized.email))) {
      // A tombstone is authoritative until the explicit restore endpoint removes
      // it. Background Gmail/IMAP synchronization must never resurrect an
      // account the user deliberately deleted.
      return null;
    }
    const [saved] = await this._targetedUpsert("inbox", [normalized]);
    return saved;
  }

  async deleteInbox(id) {
    const res = await this._mutateCore(state => {
      const inbox = state.inboxes.find(item => item.id === String(id));
      if (!inbox) return false;
      state.inboxes = state.inboxes.filter(item => item.id !== inbox.id);
      state.messages = state.messages.filter(item => normalizeEmail(item.inboxEmail) !== normalizeEmail(inbox.email));
      return true;
    });
    if (res && this.cache.activeInboxId === String(id)) {
      this.cache.activeInboxId = this.cache.inboxes[0]?.id || null;
      await this._persistBootstrap(['activeInboxId']);
    }
    return res;
  }

  async deleteInboxes(ids) {
    if (!Array.isArray(ids) || !ids.length) return 0;
    const idSet = new Set(ids.map(String));
    const res = await this._mutateCore(state => {
      const toDelete = state.inboxes.filter(item => idSet.has(String(item.id)));
      if (!toDelete.length) return 0;
      const emailsToDelete = new Set(toDelete.map(i => normalizeEmail(i.email)));
      state.inboxes = state.inboxes.filter(item => !idSet.has(String(item.id)) && !emailsToDelete.has(normalizeEmail(item.email)));
      state.messages = state.messages.filter(item => !emailsToDelete.has(normalizeEmail(item.inboxEmail)));
      return toDelete.length;
    });
    if (res && idSet.has(String(this.cache.activeInboxId))) {
      this.cache.activeInboxId = this.cache.inboxes[0]?.id || null;
      await this._persistBootstrap(['activeInboxId']);
    }
    return res;
  }

  updateInboxBanStatus(id, banStatus, reason = "", source = "system") {
    const now = new Date().toISOString();
    const cleanId = String(id || "").trim();
    const cleanEmail = normalizeEmail(cleanId);
    const cached = this.cache.inboxes.find(item => item.id === cleanId || normalizeEmail(item.email) === cleanEmail);
    if (!cached) return Promise.resolve(null);
    if (cached.banStatus === banStatus && cached.banReason === reason && cached.banDecisionSource === source) return Promise.resolve(clone(cached));
    const updated = { ...cached,
      banStatus,
      banReason: reason,
      banDecisionSource: source,
      banDecisionAt: now,
      isBanned: banStatus === "confirmed",
      isAmazon: banStatus === "confirmed" || banStatus === "suspected" || cached.isAmazon,
      updatedAt: now,
    };
    return this._targetedUpsert("inbox", [updated]).then(items => items[0] || null);
  }

  updateInboxAmazonFlag(id, isAmazon = true) {
    const inbox = this.cache.inboxes.find(item => item.id === String(id));
    if (!inbox) return Promise.resolve(null);
    if (inbox.isAmazon === Boolean(isAmazon)) return Promise.resolve(clone(inbox));
    return this._targetedUpsert("inbox", [{ ...inbox, isAmazon: Boolean(isAmazon), amazonDetectedAt: isAmazon ? new Date().toISOString() : "" }]).then(items => items[0] || null);
  }

  getAllMessages(filterType = null, limit = 1000) {
    let items = sortNewest(this.cache.messages);
    if (filterType === "official") items = items.filter(isOfficialMessage);
    else if (filterType === "temp") items = items.filter(item => !isOfficialMessage(item));
    else if (filterType === "amazon") items = items.filter(item => item.isAmazon || item.isBanned);
    else if (filterType === "banned") items = items.filter(item => item.isBanned);
    return clone(items.slice(0, Number(limit) || 1000));
  }
  getOfficialMessages(limit = 500) { return this.getAllMessages("official", limit); }
  getTempMessages(limit = 500) { return this.getAllMessages("temp", limit); }
  getAmazonMessages(limit = 500) { return this.getAllMessages("amazon", limit); }
  getBannedMessages(limit = 500) { return this.getAllMessages("banned", limit); }
  getWinningMessages(limit = 500) { return clone(sortNewest(this.cache.messages.filter(item => item.isWinning)).slice(0, limit)); }
  getMessagesByInboxEmail(email, limit = 500) { const clean = normalizeEmail(email); return clone(sortNewest(this.cache.messages.filter(item => normalizeEmail(item.inboxEmail) === clean)).slice(0, limit)); }
  getMessagesByInbox(id, limit = 500) { const inbox = this.findInboxById(id); return inbox ? this.getMessagesByInboxEmail(inbox.email, limit) : []; }
  findMessageById(id) { return clone(this.cache.messages.find(item => item.id === String(id)) || null); }

  async saveMessage(raw) {
    const existing = this.cache.messages.find(item => item.id === String(raw.id));
    const normalized = canonicalMessage({ ...existing, ...raw });
    const tombstones = new Set((this.cache.deletedAmazonAccounts || []).map(normalizeEmail));
    const relatedEmails = [normalized.inboxEmail, normalized.exactRecipient, normalized.parentEmail]
      .map(normalizeEmail)
      .filter(Boolean);
    if (relatedEmails.some(email => tombstones.has(email))) return null;
    const [saved] = await this._targetedUpsert("message", [normalized]);
    await this._refreshInboxMessageCounts([normalized.inboxEmail]);
    return saved;
  }

  async saveMessages(inboxEmail, messages) {
    const cleanEmail = normalizeEmail(inboxEmail);
    const tombstones = new Set((this.cache.deletedAmazonAccounts || []).map(normalizeEmail));
    const normalized = (messages || [])
      .map(item => canonicalMessage({ ...item, inboxEmail: normalizeEmail(item.inboxEmail) || cleanEmail }))
      .filter(item => ![item.inboxEmail, item.exactRecipient, item.parentEmail]
        .map(normalizeEmail)
        .filter(Boolean)
        .some(email => tombstones.has(email)));
    if (!normalized.length) return 0;
    const before = new Set(this.cache.messages.map(item => item.id));
    const merged = normalized.map(item => ({ ...(this.cache.messages.find(existing => existing.id === item.id) || {}), ...item }));
    await this._targetedUpsert("message", merged);
    await this._refreshInboxMessageCounts([cleanEmail, ...normalized.map(item => item.inboxEmail)]);
    return merged.filter(item => !before.has(item.id)).length;
  }

  async _refreshInboxMessageCounts(emails) {
    const inboxes = [...new Set(emails.map(normalizeEmail))]
      .map(email => this.cache.inboxes.find(item => normalizeEmail(item.email) === email))
      .filter(Boolean)
      .map(inbox => ({
        ...inbox,
        messageCount: this.cache.messages.filter(message => normalizeEmail(message.inboxEmail) === normalizeEmail(inbox.email)).length,
        updatedAt: new Date().toISOString(),
      }))
      .filter(inbox => inbox.messageCount !== this.cache.inboxes.find(item => item.id === inbox.id)?.messageCount);
    if (inboxes.length) await this._targetedUpsert("inbox", inboxes);
  }

  deleteMessage(id) {
    return this._mutateCore(state => {
      const before = state.messages.length;
      state.messages = state.messages.filter(item => item.id !== String(id));
      return state.messages.length !== before;
    });
  }

  getIgnoredPatterns() { return [...this.cache.ignoredPatterns]; }
  addIgnoredPattern(pattern) {
    const clean = String(pattern || "").trim().toLowerCase();
    if (!clean || this.cache.ignoredPatterns.includes(clean)) return false;
    this.cache.ignoredPatterns.push(clean);
    this._persistBootstrap(['ignoredPatterns']);
    return true;
  }
  removeIgnoredPattern(pattern) {
    const clean = String(pattern || "").trim().toLowerCase();
    if (!clean) return false;
    const before = this.cache.ignoredPatterns.length;
    this.cache.ignoredPatterns = this.cache.ignoredPatterns.filter(p => p !== clean);
    if (this.cache.ignoredPatterns.length !== before) {
      this._persistBootstrap(['ignoredPatterns']);
      return true;
    }
    return false;
  }

  getDeletedAmazonAccounts() {
    return [...(this.cache.deletedAmazonAccounts || [])];
  }

  async addDeletedAmazonAccount(email) {
    const clean = normalizeEmail(email);
    if (!clean) return false;
    if (!this.cache.deletedAmazonAccounts) this.cache.deletedAmazonAccounts = [];
    if (!this.cache.deletedAmazonAccounts.includes(clean)) {
      this.cache.deletedAmazonAccounts.push(clean);
      await this._persistBootstrap(['deletedAmazonAccounts']);
    }
    return true;
  }

  async removeDeletedAmazonAccount(email) {
    const clean = normalizeEmail(email);
    if (!clean) return false;
    if (!this.cache.deletedAmazonAccounts) this.cache.deletedAmazonAccounts = [];
    const before = this.cache.deletedAmazonAccounts.length;
    this.cache.deletedAmazonAccounts = this.cache.deletedAmazonAccounts.filter(e => e !== clean);
    if (this.cache.deletedAmazonAccounts.length !== before) {
      await this._persistBootstrap(['deletedAmazonAccounts']);
    }
    return true;
  }

  deleteMessagesForEmail(email) {
    const clean = normalizeEmail(email);
    if (!clean) return 0;
    return this._mutateCore(state => {
      const before = state.messages.length;
      state.messages = state.messages.filter(item => {
        const itemEmail = normalizeEmail(item.inboxEmail);
        const recipient = normalizeEmail(item.exactRecipient || item.to);
        const parentEmail = normalizeEmail(item.parentEmail);
        return itemEmail !== clean && recipient !== clean && parentEmail !== clean;
      });
      return before - state.messages.length;
    });
  }

  getSetting(key) { return this.cache.settings[String(key)] ?? null; }
  setSetting(key, value) {
    if (this.cache.settings[String(key)] === String(value)) return Promise.resolve(true);
    return this._enqueue(async () => {
      const ref = this.firestore.collection('mailRuntime').doc('bootstrap');
      let values;
      await this.firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        values = { ...(snapshot.data()?.values || {}) };
        if (values[String(key)] !== String(value)) {
          values[String(key)] = String(value);
          transaction.set(ref, { values, updatedAt: new Date().toISOString() }, { merge: true });
        }
      });
      this.cache.settings = values;
      return true;
    });
  }

  getAppVersion() {
    return clone(this.cache.appVersion || {
      latestVersionCode: 10,
      latestVersionName: "1.4.0",
      downloadUrl: "https://github.com/ahmedroou/batabitoo-mail-center/releases/download/v1.4.0/Batabitoo-Mail-Center-1.4.0.apk",
      sha256: "",
      releaseNotes: "الإصدار السحابي الموحد لمركز بريد بطابيطو.",
      mandatory: false,
      updatedAt: new Date().toISOString(),
    });
  }
  async updateAppVersion(data) {
    this.cache.appVersion = { ...this.getAppVersion(), ...clone(data), updatedAt: new Date().toISOString() };
    await this._persistBootstrap(['appVersion']);
    return this.getAppVersion();
  }

  getOAuthAccounts() { return clone(this.cache.oauthAccounts); }
  getOAuthAccount(email) {
    const clean = normalizeEmail(email);
    if (!clean) return null;
    const canonical = clean.endsWith("@gmail.com") ? clean.split("@")[0].replace(/\./g, "") + "@gmail.com" : clean;
    const found = this.cache.oauthAccounts.find(item => {
      const itemEmail = normalizeEmail(item.email);
      const itemCanonical = itemEmail.endsWith("@gmail.com") ? itemEmail.split("@")[0].replace(/\./g, "") + "@gmail.com" : itemEmail;
      return itemEmail === clean || itemCanonical === canonical;
    });
    return found ? clone(found) : null;
  }
  saveOAuthAccount(account) {
    const email = normalizeEmail(account?.email);
    if (!email) return Promise.resolve(false);
    const existing = this.cache.oauthAccounts.find(item => normalizeEmail(item.email) === email) || {};
    const normalized = {
      ...existing,
      ...clone(account),
      email,
      authType: account.authType || account.auth_type || existing.authType || existing.auth_type || "oauth2",
      auth_type: account.authType || account.auth_type || existing.authType || existing.auth_type || "oauth2",
      personName: account.personName || account.person_name || existing.personName || existing.person_name || email.split("@")[0],
      person_name: account.personName || account.person_name || existing.personName || existing.person_name || email.split("@")[0],
      refreshToken: account.refreshToken !== undefined ? account.refreshToken : (account.refresh_token !== undefined ? account.refresh_token : (existing.refreshToken ?? existing.refresh_token ?? null)),
      refresh_token: account.refreshToken !== undefined ? account.refreshToken : (account.refresh_token !== undefined ? account.refresh_token : (existing.refreshToken ?? existing.refresh_token ?? null)),
      accessToken: account.accessToken !== undefined ? account.accessToken : (account.access_token !== undefined ? account.access_token : (existing.accessToken ?? existing.access_token ?? null)),
      access_token: account.accessToken !== undefined ? account.accessToken : (account.access_token !== undefined ? account.access_token : (existing.accessToken ?? existing.access_token ?? null)),
      expiryDate: account.expiryDate !== undefined ? account.expiryDate : (account.expiry_date !== undefined ? account.expiry_date : (existing.expiryDate ?? existing.expiry_date ?? null)),
      expiry_date: account.expiryDate !== undefined ? account.expiryDate : (account.expiry_date !== undefined ? account.expiry_date : (existing.expiryDate ?? existing.expiry_date ?? null)),
      lastError: account.lastError !== undefined ? account.lastError : (account.last_error !== undefined ? account.last_error : (existing.lastError ?? existing.last_error ?? null)),
      last_error: account.lastError !== undefined ? account.lastError : (account.last_error !== undefined ? account.last_error : (existing.lastError ?? existing.last_error ?? null)),
      lastSyncAt: account.lastSyncAt || account.last_sync_at || existing.lastSyncAt || existing.last_sync_at || new Date().toISOString(),
      last_sync_at: account.lastSyncAt || account.last_sync_at || existing.lastSyncAt || existing.last_sync_at || new Date().toISOString(),
      connectedAt: account.connectedAt || account.connected_at || existing.connectedAt || existing.connected_at || new Date().toISOString(),
      connected_at: account.connectedAt || account.connected_at || existing.connectedAt || existing.connected_at || new Date().toISOString(),
      syncedCount: Number(account.syncedCount ?? account.synced_count ?? existing.syncedCount ?? existing.synced_count ?? 0),
      synced_count: Number(account.syncedCount ?? account.synced_count ?? existing.syncedCount ?? existing.synced_count ?? 0),
      appPassword: account.appPassword !== undefined ? account.appPassword : (account.app_password !== undefined ? account.app_password : (existing.appPassword ?? existing.app_password ?? null)),
      app_password: account.appPassword !== undefined ? account.appPassword : (account.app_password !== undefined ? account.app_password : (existing.appPassword ?? existing.app_password ?? null)),
      lastSeenUid: Number(account.lastSeenUid ?? account.last_seen_uid ?? existing.lastSeenUid ?? existing.last_seen_uid ?? 0) || null,
      last_seen_uid: Number(account.lastSeenUid ?? account.last_seen_uid ?? existing.lastSeenUid ?? existing.last_seen_uid ?? 0) || null,
      gmailHistoryId: account.gmailHistoryId !== undefined ? account.gmailHistoryId : (account.gmail_history_id !== undefined ? account.gmail_history_id : (existing.gmailHistoryId ?? existing.gmail_history_id ?? null)),
      gmail_history_id: account.gmailHistoryId !== undefined ? account.gmailHistoryId : (account.gmail_history_id !== undefined ? account.gmail_history_id : (existing.gmailHistoryId ?? existing.gmail_history_id ?? null)),
      status: account.status || existing.status || "connected",
      updatedAt: new Date().toISOString(),
    };
    if (!oauthNeedsWrite(existing, normalized)) return Promise.resolve(true);
    // Only overlay changed fields on the transactional cloud record. A warm
    // instance must not overwrite newer tokens/status for this or other users.
    const patch = Object.fromEntries(Object.entries(normalized).filter(([key, value]) =>
      key !== 'updatedAt' && JSON.stringify(existing[key]) !== JSON.stringify(value)));
    return this._enqueue(async () => {
      const bootstrapRef = this.firestore.collection("mailRuntime").doc("bootstrap");
      let committedAccounts;
      await this.firestore.runTransaction(async transaction => {
        const snap = await transaction.get(bootstrapRef);
        const remoteAccounts = clone(snap.data()?.oauthAccounts || []);
        const remoteIndex = remoteAccounts.findIndex(item => normalizeEmail(item.email) === email);
        const remote = remoteAccounts[remoteIndex];
        // Background work from a stale process must not revive a removed account.
        if (existing.email && !remote) { committedAccounts = remoteAccounts; return; }
        const next = { ...(remote || normalized), ...patch, email, updatedAt: new Date().toISOString() };
        if (oauthNeedsWrite(remote, next)) {
          if (remoteIndex >= 0) remoteAccounts[remoteIndex] = next;
          else remoteAccounts.push(next);
          transaction.set(bootstrapRef, { oauthAccounts: remoteAccounts, updatedAt: next.updatedAt }, { merge: true });
        }
        committedAccounts = remoteAccounts;
      });
      this.cache.oauthAccounts = committedAccounts;
      return true;
    });
  }
  upsertOAuthAccount(account) {
    return this.saveOAuthAccount(account);
  }
  deleteOAuthAccount(email) {
    const clean = normalizeEmail(email);
    const before = this.cache.oauthAccounts.length;
    this.cache.oauthAccounts = this.cache.oauthAccounts.filter(item => normalizeEmail(item.email) !== clean);
    return this._enqueue(async () => {
      await this.firestore.collection("mailOAuthAccounts").doc(clean).delete().catch(() => {});
      const bootstrapRef = this.firestore.collection("mailRuntime").doc("bootstrap");
      await this.firestore.runTransaction(async transaction => {
        const snap = await transaction.get(bootstrapRef);
        const accounts = snap.data()?.oauthAccounts || [];
        const remote = accounts.filter(item => normalizeEmail(item.email) !== clean);
        if (remote.length !== accounts.length) transaction.set(bootstrapRef, { oauthAccounts: remote, updatedAt: new Date().toISOString() }, { merge: true });
      });
      return before !== this.cache.oauthAccounts.length;
    });
  }

  logNiveaRegistration(entry) {
    const id = entry.id || `nivea_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const normalized = { ...clone(entry), id, registeredAt: entry.registeredAt || new Date().toISOString() };
    this.cache.niveaLogs.unshift(normalized);
    this._appendAux("nivea", normalized);
    return true;
  }
  getNiveaLogs(limit = 200) { return clone(this.cache.niveaLogs.slice(0, limit)); }

  saveAiFeedback(entry) {
    const id = entry.id || `fb_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const normalized = { ...clone(entry), id, createdAt: new Date().toISOString() };
    this.cache.aiFeedback.unshift(normalized);
    if (entry.verdict === "reject" && entry.subject && !entry.keepPattern) this.addIgnoredPattern(entry.subject);
    this._appendAux("aiFeedback", normalized);
    return normalized;
  }
  getAiFeedbackLogs(limit = 100) { return clone(this.cache.aiFeedback.slice(0, limit)); }
  close() {}
}

const mailDatabase = new CloudMailDatabase();

module.exports = { CloudMailDatabase, MailDatabase: CloudMailDatabase, mailDatabase, defaultMailDatabase: mailDatabase };
