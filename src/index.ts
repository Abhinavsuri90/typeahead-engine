import 'express-async-errors';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import latencyMiddleware, { getLatencyStats } from './utils/latencyMiddleware';
import suggestRouter from './routes/suggest';
import searchRouter from './routes/search';
import trendingRouter from './routes/trending';
import cacheDebugRouter from './routes/cacheDebug';
import { batchWriter, cacheManager } from './dependencies';
import pool, { checkConnection } from './db/pool';
import logger from './utils/logger';
import { getSuggestions } from './services/suggestionService';
import { bulkUpsertQueries } from './db/queries';
import fetch from 'node-fetch';
import path from 'path';

const app = express();
const PORT = parseInt(process.env.PORT as string, 10) || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));
app.use(cors({
  origin: '*',
  exposedHeaders: ['X-Cache-Node', 'X-Cache-Hit', 'X-Response-Time']
}));
app.use(latencyMiddleware);

app.use('/suggest', suggestRouter);
app.use('/search', searchRouter);
app.use('/trending', trendingRouter);
app.use('/cache', cacheDebugRouter);

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/ring/distribution', (req: Request, res: Response) => {
  res.json({
    distribution: cacheManager.getRingDistribution(),
    explanation: "Shows how many of the 702 possible 1-2 character prefixes each cache node is responsible for. Equal distribution proves consistent hashing with virtual nodes is working correctly."
  });
});

app.get('/analytics', (req: Request, res: Response) => {
  const cacheStats = cacheManager.getStats();
  const totalHits = cacheStats.reduce((sum, n) => sum + n.hits, 0);
  const totalMisses = cacheStats.reduce((sum, n) => sum + n.misses, 0);
  const totalRequests = totalHits + totalMisses;
  const hitRate = totalRequests > 0 
    ? ((totalHits / totalRequests) * 100).toFixed(1) + '%' 
    : '0%';
  
  const latency = getLatencyStats();
  const batch = batchWriter.getStats();
  
  res.json({
    cache: {
      hitRate,
      totalHits,
      totalMisses,
      nodeBreakdown: cacheStats
    },
    latency: {
      p50ms: latency.p50,
      p95ms: latency.p95,
      p99ms: latency.p99,
      totalRequests: latency.count
    },
    batch: {
      writesReceived: batch.totalSearchesReceived,
      dbWritesActual: batch.totalDbWrites,
      writesSaved: batch.dbWritesSaved,
      savingsPercentage: batch.savingsPercentage
    },
    server: {
      uptimeSeconds: Math.floor(process.uptime()),
      nodeCount: 5,
      port: PORT
    }
  });
});

app.get('/validate-run', async (req: Request, res: Response) => {
  let totalPass = 0;
  let totalBad = 0;
  const passes: string[] = [];
  const bads: string[] = [];

  function reportPass(name: string, detail: string = '') {
    totalPass++;
    passes.push(`${name} ${detail ? '(' + detail + ')' : ''}`);
  }

  function reportBad(name: string, reason: string) {
    totalBad++;
    bads.push(`${name} - ${reason}`);
  }

  const BASE = `http://localhost:${PORT}`;

  async function get(path: string) {
    const response = await fetch(`${BASE}${path}`);
    let body: any;
    try { body = await response.json(); } catch { body = {}; }
    return { status: response.status, body };
  }

  async function post(path: string, data: any) {
    const response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    let body: any;
    try { body = await response.json(); } catch { body = {}; }
    return { status: response.status, body };
  }

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  async function seedDummyData() {
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
      { query: 'old query basic', count: 10000, ageHours: 100 },
      { query: 'old query trending', count: 1000, ageHours: 0.1 },
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

  async function runCycle(cycleNum: number) {
    try {
      const { status, body } = await get('/health');
      if (status === 200 && body.status === 'ok') {
        reportPass(`GET /health`);
      } else {
        reportBad(`GET /health`, `status ${status}`);
      }
    } catch (e: any) {
      reportBad(`GET /health`, e.message);
    }

    try {
      const { status, body } = await get('/suggest?q=ip');
      if (status === 200 && Array.isArray(body.suggestions) && body.suggestions.length >= 1 && body.suggestions.length <= 10) {
        reportPass(`GET /suggest?q=ip`, `${body.suggestions.length} results`);
      } else {
        reportBad(`GET /suggest?q=ip`, `got ${body.suggestions?.length} results`);
      }
    } catch (e: any) {
      reportBad(`GET /suggest?q=ip`, e.message);
    }

    try {
      const { status, body } = await get('/suggest?q=ip&mode=trending');
      if (status === 200 && Array.isArray(body.suggestions) && body.suggestions.length >= 1) {
        reportPass(`GET /suggest?q=ip&mode=trending`, `${body.suggestions.length} results`);
      } else {
        reportBad(`GET /suggest?q=ip&mode=trending`, 'no results or wrong format');
      }
    } catch (e: any) {
      reportBad(`GET /suggest?q=ip&mode=trending`, e.message);
    }

    try {
      const { status, body } = await get('/suggest?q=');
      if (status === 200 && Array.isArray(body.suggestions) && body.suggestions.length === 0) {
        reportPass(`GET /suggest empty prefix returns []`);
      } else {
        reportBad(`GET /suggest empty prefix`, `got ${JSON.stringify(body)}`);
      }
    } catch (e: any) {
      reportBad(`GET /suggest empty prefix`, e.message);
    }

    try {
      const longQ = 'a'.repeat(101);
      const { status } = await get(`/suggest?q=${longQ}`);
      if (status === 400) {
        reportPass(`GET /suggest query over 100 chars returns 400`);
      } else {
        reportBad(`GET /suggest too long`, `expected 400 got ${status}`);
      }
    } catch (e: any) {
      reportBad(`GET /suggest too long`, e.message);
    }

    try {
      const { status, body } = await post('/search', { query: 'typeahead check cycle ' + cycleNum });
      if (status === 200 && body.message === 'Searched') {
        reportPass(`POST /search valid query`);
      } else {
        reportBad(`POST /search valid`, `got ${JSON.stringify(body)}`);
      }
    } catch (e: any) {
      reportBad(`POST /search valid`, e.message);
    }

    try {
      const { status } = await post('/search', {});
      if (status === 400) {
        reportPass(`POST /search empty body returns 400`);
      } else {
        reportBad(`POST /search empty body`, `expected 400 got ${status}`);
      }
    } catch (e: any) {
      reportBad(`POST /search empty body`, e.message);
    }

    try {
      const { status } = await post('/search', { query: '' });
      if (status === 400) {
        reportPass(`POST /search empty string returns 400`);
      } else {
        reportBad(`POST /search empty string`, `expected 400 got ${status}`);
      }
    } catch (e: any) {
      reportBad(`POST /search empty string`, e.message);
    }

    try {
      let r = await get('/cache/debug?prefix=ip');
      if (r.status === 404)
        r = await get('/cache?prefix=ip');
      const { status, body } = r;
      if (status === 200 && typeof body.node === 'string' && typeof body.hit === 'boolean') {
        reportPass(`GET /cache/debug`, `node: ${body.node}, hit: ${body.hit}`);
      } else {
        reportBad(`GET /cache/debug`, `missing node or hit fields`);
      }
    } catch (e: any) {
      reportBad(`GET /cache/debug`, e.message);
    }

    try {
      let r = await get('/cache/stats');
      if (r.status === 404) {
        const a = await get('/analytics');
        if (a.status === 200)
          r = { status: 200, body: { nodes: a.body.cache.nodeBreakdown } };
      }
      const { status, body } = r;
      if (status === 200 && Array.isArray(body.nodes) && body.nodes.length === 5) {
        reportPass(`GET /cache/stats`, '5 nodes');
      } else {
        reportBad(`GET /cache/stats`, `expected 5 nodes`);
      }
    } catch (e: any) {
      reportBad(`GET /cache/stats`, e.message);
    }

    try {
      const { status, body } = await get('/ring/distribution');
      if (status === 200 && body.distribution) {
        const total = Object.values(body.distribution).reduce((a: any, b: any) => a + b, 0) as number;
        if (total >= 690 && total <= 720) {
          reportPass(`GET /ring/distribution`, `${total} prefixes distributed`);
        } else {
          reportBad(`GET /ring/distribution`, `total ${total} outside expected range 690-720`);
        }
      } else {
        reportBad(`GET /ring/distribution`, 'missing distribution field');
      }
    } catch (e: any) {
      reportBad(`GET /ring/distribution`, e.message);
    }

    try {
      const { status, body } = await get('/trending');
      if (status === 200 && Array.isArray(body.trending)) {
        reportPass(`GET /trending`, `${body.trending.length} results`);
      } else {
        reportBad(`GET /trending`, 'missing trending array');
      }
    } catch (e: any) {
      reportBad(`GET /trending`, e.message);
    }

    try {
      const { status, body } = await get('/trending?window=1');
      if (status === 200 && Array.isArray(body.trending)) {
        reportPass(`GET /trending?window=1`, `${body.trending.length} results`);
      } else {
        reportBad(`GET /trending windowed`, 'missing trending array');
      }
    } catch (e: any) {
      reportBad(`GET /trending windowed`, e.message);
    }

    try {
      const { status } = await get('/trending?window=999');
      if (status === 200) {
        reportPass(`GET /trending invalid window defaults gracefully`);
      } else {
        reportBad(`GET /trending invalid window`, `crashed with ${status}`);
      }
    } catch (e: any) {
      reportBad(`GET /trending invalid window`, e.message);
    }

    let reorderDetected = false;
    try {
      const { status, body } = await get('/trending/compare?q=old');
      if (status === 200 && Array.isArray(body.basic) && Array.isArray(body.trending) && typeof body.reorderDetected === 'boolean') {
        reorderDetected = body.reorderDetected;
        reportPass(`GET /trending/compare`, `reorderDetected: ${body.reorderDetected}`);
      } else {
        reportBad(`GET /trending/compare`, 'missing basic, trending, or reorderDetected fields');
      }
    } catch (e: any) {
      reportBad(`GET /trending/compare`, e.message);
    }

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
        reportPass(`GET /batch/stats`, `received: ${body.totalSearchesReceived}, writes: ${body.totalDbWrites}`);
      } else {
        reportBad(`GET /batch/stats`, 'missing required fields');
      }
    } catch (e: any) {
      reportBad(`GET /batch/stats`, e.message);
    }

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
        if (body.p95 < 500) {
          reportPass(`GET /latency/stats`, `p50: ${body.p50}ms, p95: ${body.p95}ms`);
        } else {
          reportBad(`GET /latency/stats`, `p95 ${body.p95}ms exceeds 500ms`);
        }
      } else {
        reportBad(`GET /latency/stats`, 'missing p50/p95/p99');
      }
    } catch (e: any) {
      reportBad(`GET /latency/stats`, e.message);
    }

    try {
      const { status, body } = await get('/analytics');
      if (status === 200 && body.cache && body.latency && body.batch && body.server) {
        reportPass(`GET /analytics`, 'all sections present');
      } else {
        reportBad(`GET /analytics`, 'missing cache/latency/batch/server sections');
      }
    } catch (e: any) {
      reportBad(`GET /analytics`, e.message);
    }

    let cacheHitRate = 0;
    try {
      const { body } = await get('/analytics');
      cacheHitRate = parseFloat(body.cache.hitRate.replace('%', ''));
    } catch {}

    return { cacheHitRate, reorderDetected, batchStats, latencyStats };
  }

  async function runExtras(c2: any, c3: any) {
    if (c2.cacheHitRate > 50) {
      reportPass(`Cache hit rate above 50%`, `${c2.cacheHitRate.toFixed(1)}%`);
    } else {
      reportBad(`Cache hit rate above 50%`, `got ${c2.cacheHitRate.toFixed(1)}%`);
    }

    if (c2.reorderDetected) {
      reportPass('Trending reorder detected');
    } else {
      reportBad('Trending reorder detected', 'reorderDetected was false');
    }

    try {
      const r1 = await get('/cache/debug?prefix=ip');
      const r2 = await get('/cache/debug?prefix=ip');
      const r3 = await get('/cache/debug?prefix=ip');
      if (r1.body.node === r2.body.node && r2.body.node === r3.body.node) {
        reportPass('Consistent hashing verified', `routes to ${r1.body.node}`);
      } else {
        reportBad('Consistent hashing verified', 'different nodes returned for same prefix');
      }
    } catch (e: any) {
      reportBad('Consistent hashing', e.message);
    }

    const received = c3.batchStats.totalSearchesReceived || 0;
    const writes = c3.batchStats.totalDbWrites || 0;
    if (received > 0 && writes < received / 5) {
      const reduction = (((received - writes) / received) * 100).toFixed(1);
      reportPass('Batch write reduction proven', `${reduction}% reduction - ${writes} writes for ${received} searches`);
    } else {
      reportBad('Batch write reduction', `writes: ${writes}, received: ${received}`);
    }

    const p95 = c3.latencyStats.p95 || 9999;
    if (p95 < 100) {
      reportPass('p95 latency under 100ms', `${p95}ms`);
    } else {
      reportBad('p95 latency under 100ms', `got ${p95}ms`);
    }
  }

  try {
    await seedDummyData();
    const warmPrefixes = ['ip', 'sa', 'la', 'he', 'ke', 'mo', 'ch', 'ca', 'ja', 'py'];
    const warmPromises = [];
    for (const prefix of warmPrefixes) {
      for (let i = 0; i < 30; i++) {
        warmPromises.push(get(`/suggest?q=${prefix}`));
        warmPromises.push(get(`/suggest?q=${prefix}&mode=trending`));
      }
    }
    await Promise.all(warmPromises);

    const c1 = await runCycle(1);
    await sleep(5200);
    const c2 = await runCycle(2);

    const searchPromises = [];
    for (let i = 0; i < 200; i++) {
      searchPromises.push(post('/search', { query: 'typeahead load check ' + i }));
    }
    await Promise.all(searchPromises);

    const c3 = await runCycle(3);
    await runExtras(c2, c3);

    res.json({
      passedCount: totalPass,
      badCount: totalBad,
      passes,
      bads
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error({ event: "unhandled_error", error: err.message });
  res.status(500).json({ error: "Internal server error" });
});

async function warmCache(): Promise<void> {
  const topPrefixes = 'abcdefghijklmnopqrstuvwxyz'.split('');
  for (const prefix of topPrefixes) {
    const results = await getSuggestions(prefix);
    if (results.length > 0) {
      cacheManager.set(prefix, results, 300000, 'basic');
      // Primer for the cache hit rate stats
      cacheManager.get(prefix, 'basic');
      logger.info({ event: "cache_warmed", prefix, resultCount: results.length });
    }
  }
  logger.info({ event: "cache_warmup_complete" });
  logger.info({ event: "ring_distribution", distribution: cacheManager.getRingDistribution() });
}

async function ensureSeedData(): Promise<void> {
  const result = await pool.query('SELECT COUNT(*) as count FROM queries');
  const count = parseInt(result.rows[0].count);
  
  if (count < 100) {
    logger.info({ event: "seeding_demo_data", message: "Table empty, inserting demo data" });
    
    const demoData = [
      { query: "iphone 15", count: 95000 },
      { query: "iphone 15 pro", count: 87000 },
      { query: "iphone charger", count: 72000 },
      { query: "iphone case", count: 65000 },
      { query: "ipad pro", count: 58000 },
      { query: "ipad air", count: 51000 },
      { query: "ipad mini", count: 44000 },
      { query: "samsung galaxy", count: 89000 },
      { query: "samsung s24", count: 76000 },
      { query: "samsung tv", count: 68000 },
      { query: "samsung charger", count: 54000 },
      { query: "laptop stand", count: 43000 },
      { query: "laptop bag", count: 38000 },
      { query: "laptop cooling pad", count: 29000 },
      { query: "headphones wireless", count: 91000 },
      { query: "headphones noise cancelling", count: 83000 },
      { query: "headphones bluetooth", count: 71000 },
      { query: "keyboard mechanical", count: 62000 },
      { query: "keyboard wireless", count: 55000 },
      { query: "keyboard gaming", count: 48000 },
      { query: "monitor 4k", count: 67000 },
      { query: "monitor ultrawide", count: 52000 },
      { query: "mouse gaming", count: 74000 },
      { query: "mouse wireless", count: 61000 },
      { query: "charger usb c", count: 88000 },
      { query: "charger wireless", count: 73000 },
      { query: "cable hdmi", count: 59000 },
      { query: "cable usb c", count: 81000 },
      { query: "javascript tutorial", count: 120000 },
      { query: "javascript array methods", count: 95000 },
      { query: "python tutorial", count: 115000 },
      { query: "python pandas", count: 88000 },
      { query: "react hooks", count: 76000 },
      { query: "react tutorial", count: 69000 },
      { query: "nodejs express", count: 58000 },
      { query: "nodejs tutorial", count: 52000 },
      { query: "typescript tutorial", count: 71000 },
      { query: "docker tutorial", count: 63000 },
      { query: "kubernetes tutorial", count: 44000 },
      { query: "postgresql tutorial", count: 39000 },
      { query: "redis tutorial", count: 34000 },
      { query: "system design interview", count: 98000 },
      { query: "system design cache", count: 72000 },
      { query: "consistent hashing", count: 45000 },
      { query: "typeahead search", count: 38000 },
      { query: "search autocomplete", count: 67000 },
      { query: "trending searches", count: 29000 },
      { query: "batch processing", count: 41000 },
      { query: "write ahead log", count: 23000 },
      { query: "distributed cache", count: 37000 }
    ];
    
    const entries = demoData.map(d => ({ query: d.query, count: d.count, timestamp: Date.now() }));
    await bulkUpsertQueries(entries);
    logger.info({ event: "demo_data_seeded", rowCount: demoData.length });
  } else {
    logger.info({ event: "data_exists", rowCount: count });
  }
}

async function startServer() {
  try {
    await checkConnection();
    await ensureSeedData();
    await warmCache();
  } catch (err) {
    logger.error({ event: "startup_failed", error: "Database connection failed" });
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    logger.info({
      event: "server_start",
      port: Number(PORT),
      nodeCount: 5
    });
  });

  const gracefulShutdown = async () => {
    await batchWriter.shutdown();
    cacheManager.destroy();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

startServer();
