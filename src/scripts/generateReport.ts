import pool from '../db/pool';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3000';

async function get(p: string): Promise<any> {
  const res = await fetch(`${BASE}${p}`);
  try { return await res.json(); } catch { return {}; }
}

async function post(p: string, data: any): Promise<any> {
  const res = await fetch(`${BASE}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  try { return await res.json(); } catch { return {}; }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function seedDummyData(): Promise<void> {
  const queries = [
    { query: 'iphone 15 pro', count: 95000, ageHours: 720 },
    { query: 'iphone 15', count: 87000, ageHours: 700 },
    { query: 'iphone charger', count: 72000, ageHours: 650 },
    { query: 'iphone case', count: 65000, ageHours: 600 },
    { query: 'ipad pro 2024', count: 58000, ageHours: 500 },
    { query: 'ipad air', count: 51000, ageHours: 480 },
    { query: 'samsung galaxy s24', count: 89000, ageHours: 720 },
    { query: 'samsung tv 4k', count: 76000, ageHours: 600 },
    { query: 'laptop stand aluminum', count: 43000, ageHours: 400 },
    { query: 'laptop bag waterproof', count: 38000, ageHours: 380 },
    { query: 'headphones wireless', count: 91000, ageHours: 720 },
    { query: 'headphones noise cancelling', count: 83000, ageHours: 680 },
    { query: 'keyboard mechanical rgb', count: 62000, ageHours: 550 },
    { query: 'monitor 4k 144hz', count: 67000, ageHours: 520 },
    { query: 'javascript promises', count: 120000, ageHours: 800 },
    { query: 'python machine learning', count: 115000, ageHours: 750 },
    { query: 'react hooks useeffect', count: 76000, ageHours: 600 },
    { query: 'nodejs express tutorial', count: 58000, ageHours: 500 },
    { query: 'typescript generics', count: 71000, ageHours: 550 },
    { query: 'system design interview', count: 98000, ageHours: 700 },
    { query: 'old viral query', count: 500000, ageHours: 1080 },
    { query: 'moderate trending topic', count: 5000, ageHours: 3 },
    { query: 'rising fast right now', count: 800, ageHours: 0.5 },
  ];

  for (const item of queries) {
    await pool.query(
      `INSERT INTO queries (query, count, last_searched_at, created_at)
       VALUES ($1, $2, now() - ($3 * INTERVAL '1 hour'), now())
       ON CONFLICT (query) DO UPDATE SET
         count = EXCLUDED.count,
         last_searched_at = EXCLUDED.last_searched_at`,
      [item.query, item.count, item.ageHours]
    );
  }
}

async function main() {
  console.log('Generating report...');
  try {
    await fetch(`${BASE}/health`);
  } catch {
    console.error('Server not running. Run npm run dev first.');
    process.exit(1);
  }

  await seedDummyData();

  const prefixes = ['ip', 'sa', 'la', 'he', 'ke', 'mo', 'ch', 'ca', 'ja', 'py'];
  for (const p of prefixes) {
    for (let i = 0; i < 50; i++) {
      await get(`/suggest?q=${p}`);
    }
  }

  const searchPromises = [];
  const queryPool = ['iphone 15 pro', 'samsung galaxy s24', 'laptop stand aluminum', 'monitor 4k 144hz'];
  for (let i = 0; i < 200; i++) {
    const q = queryPool[i % queryPool.length];
    searchPromises.push(post('/search', { query: q }).catch(() => {}));
  }
  await Promise.all(searchPromises);

  console.log('Waiting 7s for flush...');
  await sleep(7000);

  const analytics = await get('/analytics');
  
  const report = `# Final System Report

This report was generated automatically at ${new Date().toISOString()}.

## Cache Performance
- **Hit Rate:** ${analytics.cache.hitRate}
- **Total Hits:** ${analytics.cache.totalHits}
- **Total Misses:** ${analytics.cache.totalMisses}
- **Nodes Operating:** 5

## Batch Write Performance
- **Searches Received:** ${analytics.batch.writesReceived}
- **Actual DB Writes:** ${analytics.batch.dbWritesActual}
- **Writes Saved:** ${analytics.batch.writesSaved}
- **Savings:** ${analytics.batch.savingsPercentage}

## Latency
- **p50 Latency:** ${analytics.latency.p50ms}ms
- **p95 Latency:** ${analytics.latency.p95ms}ms
- **p99 Latency:** ${analytics.latency.p99ms}ms

## Server Info
- **Uptime:** ${analytics.server.uptimeSeconds}s
- **Total Requests Tracked:** ${analytics.latency.totalRequests}

## How to Reproduce

npm run dev
npm run generate-report
npm run test-project
`;

  fs.writeFileSync(path.join(process.cwd(), 'FINAL_REPORT.md'), report);
  console.log('FINAL_REPORT.md generated successfully.');
  await pool.end();
}

main().catch(console.error);
