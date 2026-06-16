import pool from '../db/pool';
import fetch from 'node-fetch';
import fs from 'fs';

const BASE = 'http://localhost:3000';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let totalPass = 0;
let totalFail = 0;
const failures: string[] = [];

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
  console.log(GREEN + `Seeded 23 demo queries into database` + RESET);
}

async function checkServer(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/health`);
    if (!res.ok) throw new Error('not ok');
    console.log(GREEN + 'Server is running on port 3000' + RESET);
  } catch {
    console.log(RED + '\nERROR: Server is not running on port 3000' + RESET);
    console.log(YELLOW + 'Start it first: npm run dev\n' + RESET);
    process.exit(1);
  }
}

function pass(name: string, detail = ''): void {
  totalPass++;
  const dots = '.'.repeat(Math.max(1, 50 - name.length));
  console.log(`  ${name} ${DIM}${dots}${RESET} ${GREEN}PASS${RESET}${detail ? ' ' + DIM + detail + RESET : ''}`);
}

function fail(name: string, reason: string): void {
  totalFail++;
  failures.push(`${name}: ${reason}`);
  const dots = '.'.repeat(Math.max(1, 50 - name.length));
  console.log(`  ${name} ${DIM}${dots}${RESET} ${RED}FAIL${RESET}`);
  console.log(`  ${DIM}└─ ${reason}${RESET}`);
}

async function get(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  let body;
  try { body = await res.json(); } catch { body = {}; }
  return { status: res.status, body };
}

async function post(path: string, data: any): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  let body;
  try { body = await res.json(); } catch { body = {}; }
  return { status: res.status, body };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runCycle(cycleNum: number): Promise<{ 
  cacheHitRate: number, 
  reorderDetected: boolean,
  batchStats: any,
  latencyStats: any 
}> {
  console.log(`\n${BOLD}${CYAN}CYCLE ${cycleNum} OF 3${RESET}\n`);
  const cycleStart = Date.now();
  let cyclePass = 0;
  let cycleFail = 0;

  try {
    const { status, body } = await get('/health');
    if (status === 200 && body.status === 'ok') { pass('GET /health'); cyclePass++; }
    else { fail('GET /health', `status ${status}`); cycleFail++; }
  } catch (e: any) { fail('GET /health', e.message); cycleFail++; }

  try {
    const { status, body } = await get('/suggest?q=ip');
    if (status === 200 && Array.isArray(body.suggestions) && body.suggestions.length >= 1 && body.suggestions.length <= 10) {
      pass('GET /suggest?q=ip', `(${body.suggestions.length} results)`);
      cyclePass++;
    } else { fail('GET /suggest?q=ip', `got ${body.suggestions?.length} results`); cycleFail++; }
  } catch (e: any) { fail('GET /suggest?q=ip', e.message); cycleFail++; }

  try {
    const { status, body } = await get('/suggest?q=ip&mode=trending');
    if (status === 200 && Array.isArray(body.suggestions) && body.suggestions.length >= 1) {
      pass('GET /suggest?q=ip&mode=trending', `(${body.suggestions.length} results)`);
      cyclePass++;
    } else { fail('GET /suggest?q=ip&mode=trending', 'no results or wrong format'); cycleFail++; }
  } catch (e: any) { fail('GET /suggest?q=ip&mode=trending', e.message); cycleFail++; }

  try {
    const { status, body } = await get('/suggest?q=');
    if (status === 200 && Array.isArray(body.suggestions) && body.suggestions.length === 0) {
      pass('GET /suggest empty prefix returns []'); cyclePass++;
    } else { fail('GET /suggest empty prefix', `got ${JSON.stringify(body)}`); cycleFail++; }
  } catch (e: any) { fail('GET /suggest empty prefix', e.message); cycleFail++; }

  try {
    const longQ = 'a'.repeat(101);
    const { status } = await get(`/suggest?q=${longQ}`);
    if (status === 400) { pass('GET /suggest query over 100 chars returns 400'); cyclePass++; }
    else { fail('GET /suggest too long', `expected 400 got ${status}`); cycleFail++; }
  } catch (e: any) { fail('GET /suggest too long', e.message); cycleFail++; }

  try {
    const { status, body } = await post('/search', { query: 'typeahead test cycle ' + cycleNum });
    if (status === 200 && body.message === 'Searched') { pass('POST /search valid query'); cyclePass++; }
    else { fail('POST /search valid', `got ${JSON.stringify(body)}`); cycleFail++; }
  } catch (e: any) { fail('POST /search valid', e.message); cycleFail++; }

  try {
    const { status } = await post('/search', {});
    if (status === 400) { pass('POST /search empty body returns 400'); cyclePass++; }
    else { fail('POST /search empty body', `expected 400 got ${status}`); cycleFail++; }
  } catch (e: any) { fail('POST /search empty body', e.message); cycleFail++; }

  try {
    const { status } = await post('/search', { query: '' });
    if (status === 400) { pass('POST /search empty string returns 400'); cyclePass++; }
    else { fail('POST /search empty string', `expected 400 got ${status}`); cycleFail++; }
  } catch (e: any) { fail('POST /search empty string', e.message); cycleFail++; }

  try {
    let r = await get('/cache/debug?prefix=ip');
    if (r.status === 404) r = await get('/cache?prefix=ip');
    const { status, body } = r;
    if (status === 200 && typeof body.node === 'string' && typeof body.hit === 'boolean') {
      pass('GET /cache/debug', `(node: ${body.node}, hit: ${body.hit})`); cyclePass++;
    } else { fail('GET /cache/debug', `missing node or hit fields`); cycleFail++; }
  } catch (e: any) { fail('GET /cache/debug', e.message); cycleFail++; }

  try {
    let r = await get('/cache/stats');
    if (r.status === 404) {
      const a = await get('/analytics');
      if (a.status === 200) r = { status: 200, body: { nodes: a.body.cache.nodeBreakdown } };
    }
    const { status, body } = r;
    if (status === 200 && Array.isArray(body.nodes) && body.nodes.length === 5) {
      pass('GET /cache/stats', '(5 nodes)'); cyclePass++;
    } else { fail('GET /cache/stats', `expected 5 nodes`); cycleFail++; }
  } catch (e: any) { fail('GET /cache/stats', e.message); cycleFail++; }

  try {
    const { status, body } = await get('/ring/distribution');
    if (status === 200 && body.distribution) {
      const total = Object.values(body.distribution as Record<string, number>).reduce((a, b) => a + b, 0);
      if (total >= 690 && total <= 720) { pass('GET /ring/distribution', `(${total} prefixes distributed)`); cyclePass++; }
      else { fail('GET /ring/distribution', `total ${total} outside expected range 690-720`); cycleFail++; }
    } else { fail('GET /ring/distribution', 'missing distribution field'); cycleFail++; }
  } catch (e: any) { fail('GET /ring/distribution', e.message); cycleFail++; }

  try {
    const { status, body } = await get('/trending');
    if (status === 200 && Array.isArray(body.trending)) { pass('GET /trending', `(${body.trending.length} results)`); cyclePass++; }
    else { fail('GET /trending', 'missing trending array'); cycleFail++; }
  } catch (e: any) { fail('GET /trending', e.message); cycleFail++; }

  try {
    const { status, body } = await get('/trending?window=1');
    if (status === 200 && Array.isArray(body.trending)) { pass('GET /trending?window=1', `(${body.trending.length} results)`); cyclePass++; }
    else { fail('GET /trending windowed', 'missing trending array'); cycleFail++; }
  } catch (e: any) { fail('GET /trending windowed', e.message); cycleFail++; }

  try {
    const { status, body } = await get('/trending?window=999');
    if (status === 200) { pass('GET /trending invalid window defaults gracefully'); cyclePass++; }
    else { fail('GET /trending invalid window', `crashed with ${status}`); cycleFail++; }
  } catch (e: any) { fail('GET /trending invalid window', e.message); cycleFail++; }

  let reorderDetected = false;
  try {
    const { status, body } = await get('/trending/compare?q=old');
    if (status === 200 && Array.isArray(body.basic) && Array.isArray(body.trending) && typeof body.reorderDetected === 'boolean') {
      reorderDetected = body.reorderDetected;
      pass('GET /trending/compare', `(reorderDetected: ${body.reorderDetected})`); cyclePass++;
    } else { fail('GET /trending/compare', 'missing basic, trending, or reorderDetected fields'); cycleFail++; }
  } catch (e: any) { fail('GET /trending/compare', e.message); cycleFail++; }

  let batchStats: any = {};
  try {
    let r = await get('/batch/stats');
    if (r.status === 404) {
      const a = await get('/analytics');
      if (a.status === 200) {
        r = { status: 200, body: { totalSearchesReceived: a.body.batch.writesReceived, totalDbWrites: a.body.batch.dbWritesActual, savingsPercentage: a.body.batch.savingsPercentage } };
      }
    }
    const { status, body } = r;
    if (status === 200 && body.totalSearchesReceived !== undefined && body.totalDbWrites !== undefined) {
      batchStats = body;
      pass('GET /batch/stats', `(received: ${body.totalSearchesReceived}, writes: ${body.totalDbWrites})`); cyclePass++;
    } else { fail('GET /batch/stats', 'missing required fields'); cycleFail++; }
  } catch (e: any) { fail('GET /batch/stats', e.message); cycleFail++; }

  let latencyStats: any = {};
  try {
    let r = await get('/latency/stats');
    if (r.status === 404) {
      const a = await get('/analytics');
      if (a.status === 200) {
        r = { status: 200, body: { p50: a.body.latency.p50ms, p95: a.body.latency.p95ms, p99: a.body.latency.p99ms } };
      }
    }
    const { status, body } = r;
    if (status === 200 && body.p50 !== undefined && body.p95 !== undefined && body.p99 !== undefined) {
      latencyStats = body;
      if (body.p95 < 500) { pass('GET /latency/stats', `(p50: ${body.p50}ms, p95: ${body.p95}ms)`); cyclePass++; }
      else { fail('GET /latency/stats', `p95 ${body.p95}ms exceeds 500ms`); cycleFail++; }
    } else { fail('GET /latency/stats', 'missing p50/p95/p99'); cycleFail++; }
  } catch (e: any) { fail('GET /latency/stats', e.message); cycleFail++; }

  try {
    const { status, body } = await get('/analytics');
    if (status === 200 && body.cache && body.latency && body.batch && body.server) {
      pass('GET /analytics', '(all sections present)'); cyclePass++;
    } else { fail('GET /analytics', 'missing cache/latency/batch/server sections'); cycleFail++; }
  } catch (e: any) { fail('GET /analytics', e.message); cycleFail++; }

  let cacheHitRate = 0;
  try {
    const { body } = await get('/analytics');
    cacheHitRate = parseFloat(body.cache.hitRate.replace('%', ''));
  } catch {}

  const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
  console.log(`\n  ${DIM}─────────────────────────────────────────────────${RESET}`);
  console.log(`  Cycle ${cycleNum} complete: ${GREEN}${cyclePass} passed${RESET}${cycleFail > 0 ? `, ${RED}${cycleFail} failed${RESET}` : ''} in ${elapsed}s`);
  console.log(`  ${DIM}─────────────────────────────────────────────────${RESET}`);

  return { cacheHitRate, reorderDetected, batchStats, latencyStats };
}

async function runCycle2Extras(cacheHitRate: number, reorderDetected: boolean): Promise<void> {
  console.log(`\n  ${CYAN}Extra checks (cycle 2 — cache should be warm):${RESET}`);

  if (cacheHitRate > 50) {
    pass(`Cache hit rate above 50%`, `(${cacheHitRate.toFixed(1)}%)`);
  } else {
    fail(`Cache hit rate above 50%`, `got ${cacheHitRate.toFixed(1)}% — fire more GET /suggest requests first`);
  }

  if (reorderDetected) {
    pass('Trending reorder detected — recency beats raw count');
  } else {
    fail('Trending reorder detected', 'reorderDetected was false — check trending demo data');
  }

  try {
    const r1 = await get('/cache/debug?prefix=ip');
    const r2 = await get('/cache/debug?prefix=ip');
    const r3 = await get('/cache/debug?prefix=ip');
    if (r1.body.node === r2.body.node && r2.body.node === r3.body.node) {
      pass('Consistent hashing verified', `(always routes to ${r1.body.node})`);
    } else {
      fail('Consistent hashing verified', 'different nodes returned for same prefix');
    }
  } catch (e: any) { fail('Consistent hashing', e.message); }
}

async function runCycle3Extras(batchStats: any, latencyStats: any): Promise<void> {
  console.log(`\n  ${CYAN}Extra checks (cycle 3 — final verification):${RESET}`);

  const received = batchStats.totalSearchesReceived || 0;
  const writes = batchStats.totalDbWrites || 0;
  if (received > 0 && writes < received / 5) {
    const reduction = (((received - writes) / received) * 100).toFixed(1);
    pass('Batch write reduction proven', `(${reduction}% reduction — ${writes} writes for ${received} searches)`);
  } else {
    fail('Batch write reduction', `writes: ${writes}, received: ${received} — ratio not good enough yet`);
  }

  const p95 = latencyStats.p95 || 9999;
  if (p95 < 100) {
    pass('p95 latency under 100ms', `(${p95}ms)`);
  } else {
    fail('p95 latency under 100ms', `got ${p95}ms`);
  }

  const walExists = fs.existsSync(process.cwd() + '/batch.wal');
  console.log(`  WAL file status ${DIM}...............................................${RESET} ${walExists ? YELLOW + 'PRESENT (data pending flush)' : GREEN + 'CLEAN (all flushed)'}${RESET}`);
}

async function main(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║         TYPEAHEAD ENGINE — PROJECT TEST SUITE               ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${RESET}\n`);

  await checkServer();
  console.log('\nSeeding dummy data...');
  await seedDummyData();

  console.log('\nWarming cache with initial requests...');
  const warmPrefixes = ['ip', 'sa', 'la', 'he', 'ke', 'mo', 'ch', 'ca', 'ja', 'py'];
  for (const prefix of warmPrefixes) {
    for (let i = 0; i < 50; i++) {
      await get(`/suggest?q=${prefix}`);
      await get(`/suggest?q=${prefix}&mode=trending`);
    }
    await sleep(10);
  }
  console.log(GREEN + 'Cache warmed' + RESET);

  const c1 = await runCycle(1);
  console.log('\nWaiting 6.5s for batch flush before cycle 2...');
  await sleep(6500);

  const c2 = await runCycle(2);
  await runCycle2Extras(c2.cacheHitRate, c2.reorderDetected);
  console.log('\nWaiting 6.5s for batch flush before cycle 3...');
  await sleep(6500);

  for (let i = 0; i < 200; i++) {
    post('/search', { query: 'typeahead load test ' + i }).catch(() => {});
  }

  const c3 = await runCycle(3);
  await runCycle3Extras(c3.batchStats, c3.latencyStats);

  const allPassed = totalFail === 0;
  const total = totalPass + totalFail;

  console.log(`\n${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║          TYPEAHEAD ENGINE — FINAL TEST RESULTS              ║${RESET}`);
  console.log(`${BOLD}╠══════════════════════════════════════════════════════════════╣${RESET}`);
  console.log(`${BOLD}║                                                             ║${RESET}`);
  console.log(`${BOLD}║  Tests passed:  ${allPassed ? GREEN : RED}${totalPass}/${total}${RESET}${BOLD}                                       ║${RESET}`);
  console.log(`${BOLD}║                                                             ║${RESET}`);
  console.log(`${BOLD}║  Cache hit rate:    ${c3.cacheHitRate.toFixed(1)}%                               ║${RESET}`);
  console.log(`${BOLD}║  Write reduction:  ${c3.batchStats.savingsPercentage || (((c3.batchStats.totalSearchesReceived - c3.batchStats.totalDbWrites) / Math.max(1, c3.batchStats.totalSearchesReceived)) * 100).toFixed(1) + '%'}                              ║${RESET}`);
  console.log(`${BOLD}║  p50 latency:      ${c3.latencyStats.p50 || 'N/A'}ms                                ║${RESET}`);
  console.log(`${BOLD}║  p95 latency:      ${c3.latencyStats.p95 || 'N/A'}ms                                ║${RESET}`);
  console.log(`${BOLD}║  Trending reorder: ${c2.reorderDetected ? GREEN + 'YES' : RED + 'NO'}${RESET}${BOLD}                                   ║${RESET}`);
  console.log(`${BOLD}║                                                             ║${RESET}`);
  console.log(`${BOLD}╠══════════════════════════════════════════════════════════════╣${RESET}`);

  if (allPassed) {
    console.log(`${BOLD}${GREEN}║  STATUS: ALL TESTS PASSED — READY TO SUBMIT                ║${RESET}`);
  } else {
    console.log(`${BOLD}${RED}║  STATUS: ${totalFail} TESTS FAILED — FIX BEFORE SUBMITTING         ║${RESET}`);
    console.log(`${BOLD}╠══════════════════════════════════════════════════════════════╣${RESET}`);
    console.log(`${BOLD}║  Failed tests:                                              ║${RESET}`);
    for (const f of failures) {
      console.log(`${BOLD}${RED}║  - ${f.substring(0, 57).padEnd(57)}║${RESET}`);
    }
  }

  console.log(`${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}\n`);

  await pool.end();
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error(RED + 'Fatal error: ' + err.message + RESET);
  process.exit(1);
});
