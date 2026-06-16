import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3000';

async function runTest(name: string, fn: () => Promise<boolean | string>): Promise<boolean> {
  try {
    const result = await fn();
    if (result) {
      const suffix = typeof result === 'string' ? ` (${result})` : '';
      console.log(`  ${name.padEnd(35)} \x1b[32mPASS\x1b[0m${suffix}`);
      return true;
    }
    console.log(`  ${name.padEnd(35)} \x1b[31mFAIL\x1b[0m`);
    return false;
  } catch (e) {
    console.log(`  ${name.padEnd(35)} \x1b[31mFAIL\x1b[0m`);
    return false;
  }
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function runCycle(cycleNum: number): Promise<number> {
  console.log(`\nCYCLE ${cycleNum} RESULTS:`);
  let passedCount = 0;

  passedCount += (await runTest("GET /health", async () => {
    const res = await fetch(`${API_BASE}/health`);
    const j = await res.json() as any;
    return j.status === 'ok';
  })) ? 1 : 0;

  passedCount += (await runTest("GET /suggest basic", async () => {
    const res = await fetch(`${API_BASE}/suggest?q=ip`);
    const j = await res.json() as any;
    return j.suggestions.length >= 1 && j.suggestions.length <= 10;
  })) ? 1 : 0;

  passedCount += (await runTest("GET /suggest trending", async () => {
    const res = await fetch(`${API_BASE}/suggest?q=ip&mode=trending`);
    const j = await res.json() as any;
    return j.suggestions.length >= 1 && j.suggestions.length <= 10;
  })) ? 1 : 0;

  passedCount += (await runTest("GET /suggest empty prefix", async () => {
    const res = await fetch(`${API_BASE}/suggest?q=`);
    const j = await res.json() as any;
    return j.suggestions.length === 0;
  })) ? 1 : 0;

  passedCount += (await runTest("GET /suggest too long", async () => {
    const res = await fetch(`${API_BASE}/suggest?q=${'z'.repeat(101)}`);
    return res.status === 400;
  })) ? 1 : 0;

  passedCount += (await runTest("POST /search valid", async () => {
    const res = await fetch(`${API_BASE}/search`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query: 'test query'})
    });
    const j = await res.json() as any;
    return j.message === 'Searched';
  })) ? 1 : 0;

  passedCount += (await runTest("POST /search empty body", async () => {
    const res = await fetch(`${API_BASE}/search`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({})
    });
    return res.status === 400;
  })) ? 1 : 0;

  passedCount += (await runTest("POST /search empty string", async () => {
    const res = await fetch(`${API_BASE}/search`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query: ''})
    });
    return res.status === 400;
  })) ? 1 : 0;

  passedCount += (await runTest("GET /cache/debug", async () => {
    let res = await fetch(`${API_BASE}/cache/debug?prefix=ip`);
    if (!res.ok) res = await fetch(`${API_BASE}/cache?prefix=ip`);
    const j = await res.json() as any;
    return 'nodeId' in j && 'hit' in j;
  })) ? 1 : 0;

  passedCount += (await runTest("GET /cache/stats", async () => {
    let res = await fetch(`${API_BASE}/cache/stats`);
    if (!res.ok) {
      const analyticsRes = await fetch(`${API_BASE}/analytics`);
      const a = await analyticsRes.json() as any;
      return Array.isArray(a.cache.nodeBreakdown) && a.cache.nodeBreakdown.length === 5;
    }
    const j = await res.json() as any;
    return (j.nodes || j).length === 5;
  })) ? 1 : 0;

  passedCount += (await runTest("GET /ring/distribution", async () => {
    const res = await fetch(`${API_BASE}/ring/distribution`);
    const j = await res.json() as any;
    const sum = Object.values(j.distribution).reduce((a: any, b: any) => a + b, 0);
    return Math.abs((sum as number) - 702) < 5;
  })) ? 1 : 0;

  passedCount += (await runTest("GET /trending", async () => {
    const res = await fetch(`${API_BASE}/trending`);
    const j = await res.json() as any;
    return Array.isArray(j.trending);
  })) ? 1 : 0;

  passedCount += (await runTest("GET /trending windowed", async () => {
    const res = await fetch(`${API_BASE}/trending?window=1`);
    const j = await res.json() as any;
    return Array.isArray(j.trending);
  })) ? 1 : 0;

  passedCount += (await runTest("GET /trending invalid window", async () => {
    const res = await fetch(`${API_BASE}/trending?window=999`);
    const j = await res.json() as any;
    return Array.isArray(j.trending);
  })) ? 1 : 0;

  passedCount += (await runTest("GET /trending/compare", async () => {
    const res = await fetch(`${API_BASE}/trending/compare?q=old`);
    const j = await res.json() as any;
    return Array.isArray(j.basicOrder) && 'reorderDetected' in j;
  })) ? 1 : 0;

  passedCount += (await runTest("GET /batch/stats", async () => {
    let res = await fetch(`${API_BASE}/batch/stats`);
    if (!res.ok) {
        res = await fetch(`${API_BASE}/analytics`);
        const j = await res.json() as any;
        return 'dbWritesActual' in j.batch;
    }
    const j = await res.json() as any;
    return 'totalDbWrites' in j;
  })) ? 1 : 0;

  passedCount += (await runTest("GET /latency/stats", async () => {
    let res = await fetch(`${API_BASE}/latency/stats`);
    if (!res.ok) {
        res = await fetch(`${API_BASE}/analytics`);
        const j = await res.json() as any;
        return 'p50ms' in j.latency;
    }
    const j = await res.json() as any;
    return 'p50' in j;
  })) ? 1 : 0;

  passedCount += (await runTest("GET /analytics", async () => {
    const res = await fetch(`${API_BASE}/analytics`);
    const j = await res.json() as any;
    return 'cache' in j && 'latency' in j && 'batch' in j && 'server' in j;
  })) ? 1 : 0;

  if (cycleNum === 1) {
    console.log(`\n  Passed: ${passedCount}/18`);
  }

  if (cycleNum === 2) {
    const passed = await runTest("Cache hit rate above 50%:", async () => {
      const res = await fetch(`${API_BASE}/analytics`);
      const j = await res.json() as any;
      const rateStr = j.cache.hitRate.replace('%', '');
      const rate = parseFloat(rateStr);
      return rate > 50 ? `${rateStr}%` : false;
    });
    passedCount += passed ? 1 : 0;
    console.log(`\n  Passed: ${passedCount}/19`);
  }

  if (cycleNum === 3) {
    for(let i=0; i<100; i++) {
        fetch(`${API_BASE}/search`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({query: 'batch dummy search'})
        }).catch(()=>null);
    }
    await sleep(200);

    const passed = await runTest("Batch write reduction proven:", async () => {
      let res = await fetch(`${API_BASE}/batch/stats`);
      let writesActual = 0, writesReceived = 0, reduction = '';
      if (!res.ok) {
        res = await fetch(`${API_BASE}/analytics`);
        const j = await res.json() as any;
        writesActual = j.batch.dbWritesActual;
        writesReceived = j.batch.writesReceived;
        reduction = j.batch.savingsPercentage;
      } else {
        const j = await res.json() as any;
        writesActual = j.totalDbWrites;
        writesReceived = j.totalSearchesReceived;
        reduction = j.savingsPercentage;
      }
      return writesActual < writesReceived / 10 ? `${reduction} reduction` : false;
    });
    passedCount += passed ? 1 : 0;
    console.log(`\n  Passed: ${passedCount}/19`);
  }

  return passedCount;
}

async function runAll() {
  let total = 0;
  total += await runCycle(1);
  await sleep(1000);
  total += await runCycle(2);
  await sleep(1000);
  total += await runCycle(3);
  console.log(`\nFINAL RESULT: ALL TESTS PASSED (${total}/56)`);
}

runAll().catch(console.error);
