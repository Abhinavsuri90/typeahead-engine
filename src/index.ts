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

const app = express();
const PORT = parseInt(process.env.PORT as string, 10) || 3000;

app.use(express.json());
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
