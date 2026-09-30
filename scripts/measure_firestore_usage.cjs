'use strict';

// Read-only Cloud Monitoring query. Uses the existing gcloud identity without
// printing its credential or reading any mailbox content.
const { execFileSync } = require('node:child_process');
const project = 'batabitoo-mail-2026';
const end = new Date(process.argv[3] || Date.now());
const start = new Date(process.argv[2] || end.getTime() - 60 * 60 * 1000);
async function main() {
  const token = execFileSync(process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true }).trim();
  const totals = {};
  for (const name of ['read_count', 'write_count', 'delete_count']) {
    const url = new URL(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries`);
    url.searchParams.set('filter', `metric.type="firestore.googleapis.com/document/${name}"`);
    url.searchParams.set('interval.startTime', start.toISOString());
    url.searchParams.set('interval.endTime', end.toISOString());
    url.searchParams.set('aggregation.alignmentPeriod', '3600s');
    url.searchParams.set('aggregation.perSeriesAligner', 'ALIGN_SUM');
    url.searchParams.set('pageSize', '1000');
    let total = 0;
    do {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(`Monitoring HTTP ${response.status}: ${result.error?.message || 'unavailable'}`);
      for (const series of result.timeSeries || []) for (const point of series.points || []) total += Number(point.value?.int64Value || point.value?.doubleValue || 0);
      if (!result.nextPageToken) break;
      url.searchParams.set('pageToken', result.nextPageToken);
    } while (true);
    totals[name] = total;
  }
  console.log(JSON.stringify({ project, start: start.toISOString(), end: end.toISOString(), totals, note: 'Project-wide delayed monitoring metrics, not a billing cap or per-account attribution.' }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
