(async () => {
  try {
    let count = 0;
    let pageToken = '';
    let types = {};
    do {
      const url = 'https://firestore.googleapis.com/v1/projects/batabitoo-mail-2026/databases/(default)/documents/inboxes?pageSize=300' + (pageToken ? '&pageToken=' + pageToken : '');
      const res = await fetch(url);
      const data = await res.json();
      const docs = data.documents || [];
      count += docs.length;
      docs.forEach(d => {
        const t = d.fields?.type?.stringValue || (d.fields?.isOfficial?.booleanValue ? 'official' : 'temp');
        types[t] = (types[t] || 0) + 1;
      });
      pageToken = data.nextPageToken;
    } while (pageToken);
    console.log('Total in Firestore:', count);
    console.log('Types:', types);
  } catch(e) {
    console.error(e.message);
  }
})();
