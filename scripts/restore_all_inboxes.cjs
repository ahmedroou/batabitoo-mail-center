const fs = require('fs');
const path = require('path');

(async () => {
  console.log('Fetching all inboxes from Firestore...');
  let pageToken = '';
  const firestoreInboxes = [];
  do {
    const url = 'https://firestore.googleapis.com/v1/projects/batabitoo-mail-2026/databases/(default)/documents/inboxes?pageSize=300' + (pageToken ? '&pageToken=' + pageToken : '');
    const res = await fetch(url);
    const data = await res.json();
    const docs = data.documents || [];
    for (const d of docs) {
      const f = d.fields || {};
      const inbox = {
        id: f.id?.stringValue || d.name.split('/').pop(),
        email: f.email?.stringValue || '',
        domain: f.domain?.stringValue || '',
        host: f.host?.stringValue || '',
        label: f.label?.stringValue || '',
        personName: f.personName?.stringValue || '',
        isOfficial: f.isOfficial?.booleanValue || false,
        type: f.type?.stringValue || (f.isOfficial?.booleanValue ? 'official' : 'temp'),
        password: f.password?.stringValue || '',
        token: f.token?.stringValue || '',
        accountId: f.accountId?.stringValue || '',
        messageCount: Number(f.messageCount?.integerValue || 0),
        isAmazon: f.isAmazon?.booleanValue || false,
        isBanned: f.isBanned?.booleanValue || false,
        banStatus: f.banStatus?.stringValue || 'none',
        banReason: f.banReason?.stringValue || '',
        createdAt: f.createdAt?.stringValue || f.createdAt?.timestampValue || new Date().toISOString(),
        updatedAt: f.updatedAt?.stringValue || f.updatedAt?.timestampValue || new Date().toISOString()
      };
      if (inbox.email) firestoreInboxes.push(inbox);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  console.log('Total fetched from Firestore:', firestoreInboxes.length);

  const dbPath = path.join(__dirname, '..', 'inboxes_db.json');
  const existing = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const backupName = 'inboxes_db_backup_' + Date.now() + '.json';
  fs.writeFileSync(path.join(__dirname, '..', backupName), JSON.stringify(existing, null, 2));

  // Merge Firestore inboxes with existing local inboxes
  const inboxesMap = new Map();
  for (const item of (existing.inboxes || [])) {
    if (item.email) inboxesMap.set(item.email.toLowerCase().trim(), item);
  }
  for (const item of firestoreInboxes) {
    const key = item.email.toLowerCase().trim();
    if (inboxesMap.has(key)) {
      inboxesMap.set(key, Object.assign({}, inboxesMap.get(key), item));
    } else {
      inboxesMap.set(key, item);
    }
  }

  const mergedInboxes = Array.from(inboxesMap.values());
  existing.inboxes = mergedInboxes;

  fs.writeFileSync(dbPath, JSON.stringify(existing, null, 2));
  console.log('SUCCESS: Restored inboxes_db.json!');
  console.log('New total in inboxes_db.json:', mergedInboxes.length);
  console.log('Official inboxes:', mergedInboxes.filter(i => i.isOfficial || i.type === 'official').length);
  console.log('Temp inboxes:', mergedInboxes.filter(i => !i.isOfficial && i.type !== 'official').length);
})();
