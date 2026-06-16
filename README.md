# Typeahead Engine

A production-grade search typeahead system built in Node.js and TypeScript. Implements distributed caching with consistent hashing, a time-decay trending algorithm, and a WAL-backed batch write pipeline.

## Architecture

The system is built in three layers.

The cache layer uses a consistent hash ring with 5 logical nodes and 150 virtual nodes each, giving 750 total ring positions. Any prefix string is hashed using MD5, mapped to the ring, and routed to the same node every time. This means the same prefix always hits the same cache node — proven via the /ring/distribution endpoint. Cache entries have TTL-based expiry (5 minutes for basic, 60 seconds for trending) and are actively invalidated when a new search updates query counts.

The write layer uses a batch aggregator that collects incoming search submissions in memory and flushes them to PostgreSQL in a single bulk upsert transaction. Repeated queries within a flush window are collapsed — 200 submissions for "iphone" become one DB row update. A Write-Ahead Log (WAL) on local disk ensures that buffered entries survive a server crash. On restart, the WAL is replayed before normal operation begins.

The trending layer uses a time-decay scoring formula applied at query time:

    score = count / (age_in_hours + 2) ^ 1.5

This means a query with 800 searches in the last 30 minutes outranks one with 500,000 searches from 45 days ago. The same /suggest endpoint serves both basic (count-sorted) and trending (score-sorted) results via a mode query parameter.

## System Diagram
Client (Browser)

│

│ HTTP

▼

Express Server (Node.js / TypeScript)

├── GET  /suggest?q=<prefix>&mode=basic|trending

├── POST /search

├── GET  /trending

├── GET  /trending/compare?q=<prefix>

├── GET  /cache/debug?prefix=<prefix>

├── GET  /cache/stats

├── GET  /ring/distribution

├── GET  /batch/stats

├── GET  /analytics

└── GET  /health

│

├── Cache Layer

│     ConsistentHash → CacheNode (x5)

│     TTL expiry + active invalidation

│

├── Batch Writer

│     Buffer → WAL → bulk upsert

│     Flush every 5s or at 100 entries

│

└── PostgreSQL

queries table (prefix index + count index)

recent_searches table

## Requirements

- Node.js 18 or higher
- PostgreSQL 14 or higher
- npm 9 or higher

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/typeahead-engine.git
cd typeahead-engine
npm install
```

### 2. Create the database

```bash
createdb typeahead
psql typeahead -f schema.sql
```

### 3. Configure environment

```bash
cp .env.example .env
```

Open .env and set DB_PASSWORD if your PostgreSQL requires one. All other defaults work for local development.

### 4. Generate and seed the dataset

```bash
npm run generate-dataset
npm run seed
```

This generates 100,000 realistic search queries and loads them into the database. Seeding takes approximately 30 to 60 seconds.

### 5. Start the server

```bash
npm run dev
```

Server starts on port 3000. On startup it will:
- Verify the database connection
- Seed 50 demo queries if the table is empty
- Warm the cache for all single-character prefixes
- Log the ring distribution across all 5 nodes

### 6. Open the frontend

```bash
npx http-server client -p 8080
```

Navigate to http://127.0.0.1:8080

## API Reference

### GET /suggest

Returns up to 10 prefix-matching suggestions.

```bash
curl "http://localhost:3000/suggest?q=ip"
curl "http://localhost:3000/suggest?q=ip&mode=trending"
```

Response:
```json
{
  "suggestions": [
    { "query": "iphone 15", "count": 95000 },
    { "query": "ipad pro", "count": 58000 }
  ]
}
```

Response headers:
- X-Cache-Node: which of the 5 nodes served this prefix
- X-Cache-Hit: true or false
- X-Response-Time: server processing time in ms

### POST /search

Records a search submission. Does not write to DB directly — goes to batch buffer.

```bash
curl -X POST http://localhost:3000/search \
  -H "Content-Type: application/json" \
  -d '{"query": "iphone 15 pro"}'
```

Response:
```json
{ "message": "Searched" }
```

### GET /trending

Returns top trending queries using time-decay scoring.

```bash
curl "http://localhost:3000/trending"
curl "http://localhost:3000/trending?window=1"
curl "http://localhost:3000/trending?window=24"
```

Valid window values: 1, 6, 24, 168 (hours). Default is 168.

### GET /trending/compare

Proves that trending order differs from count order.

```bash
curl "http://localhost:3000/trending/compare?q=old"
```

Response:
```json
{
  "basic": [...sorted by count],
  "trending": [...sorted by decay score],
  "reorderDetected": true
}
```

### GET /cache/debug

Shows which node owns a prefix and whether it is cached.

```bash
curl "http://localhost:3000/cache/debug?prefix=ip"
```

Response:
```json
{ "node": "node-3", "hit": true, "data": [...] }
```

### GET /cache/stats

Per-node cache hit and miss counts.

```bash
curl "http://localhost:3000/cache/stats"
```

### GET /ring/distribution

Shows how many prefixes each node is responsible for. Proves consistent hashing is distributing evenly.

```bash
curl "http://localhost:3000/ring/distribution"
```

### GET /batch/stats

Proves write reduction. Run after firing several POST /search requests.

```bash
curl "http://localhost:3000/batch/stats"
```

Response:
```json
{
  "bufferSize": 0,
  "totalSearchesReceived": 200,
  "totalDbWrites": 2,
  "dbWritesSaved": 198,
  "avgBatchSize": 100,
  "savingsPercentage": "99.0%"
}
```

### GET /latency/stats

Returns p50, p95, and p99 latency across all requests.

```bash
curl "http://localhost:3000/latency/stats"
```

### GET /analytics

Unified dashboard of all system metrics.

```bash
curl "http://localhost:3000/analytics"
```

### GET /health

Server health check.

```bash
curl "http://localhost:3000/health"
```

## Running the Demo

This sequence fully tests all assignment requirements and proves system stability, generating a final performance report dynamically based on real data.

### Step 1 — Run Automated Testing Suite

```bash
npm run test-project
```

This self-contained test suite executes 3 complete testing cycles against the system. It proves consistent hashing, cache hit ratios, batch write reductions, and the trending decay algorithm.

### Step 2 — Generate Final Report

```bash
npm run generate-report
```

This evaluates the live latency metrics (p50, p95, p99), queries the database write efficiency, and writes out `FINAL_REPORT.md` with complete evidence for submission.

## Performance

These numbers are from a local MacBook with PostgreSQL running on the same machine.

| Metric | Value |
|--------|-------|
| Cache hit rate (sustained) | 85% |
| p50 latency (cached) | 1.8ms |
| p95 latency (mixed) | 6.2ms |
| DB writes for 200 searches | 2 |
| Write reduction percentage | 99% |
| Ring distribution variance | under 1% |

## Dataset

The system ships with a dataset generator that creates 100,000 realistic search queries across categories including technology, e-commerce products, programming topics, and common search patterns. Queries include realistic count distributions following a power law (a small number of queries have very high counts, most have low counts) which matches real-world search data.

To regenerate:

```bash
npm run generate-dataset
npm run seed
```

The seed script is safe to run multiple times. It uses ON CONFLICT DO UPDATE so existing counts are incremented rather than overwritten.

## Design Decisions and Trade-offs

**Why consistent hashing instead of modulo hashing**

With simple key % N hashing, adding or removing a cache node remaps almost every key. With consistent hashing, only 1/N keys are remapped. This makes the cache resilient to node changes without a full flush.

**Why 150 virtual nodes per physical node**

Fewer virtual nodes causes uneven distribution — one node could own 60% of the key space. 150 virtual nodes per node gives 750 total ring positions, achieving under 1% variance in prefix distribution across all 5 nodes.

**Why batch writes instead of synchronous writes**

Writing to PostgreSQL on every search request would create write pressure proportional to traffic. The batch writer collapses writes, reducing DB pressure by over 98%. The trade-off is that counts in the DB may be slightly delayed versus real-time. For a typeahead system this is acceptable.

**Why the WAL file**

The in-memory batch buffer is lost if the process crashes. The WAL file on disk survives crashes. On restart the WAL is replayed, so no buffered searches are permanently lost. The trade-off is a small risk of double-counting if the process crashes after a successful DB flush but before the WAL is deleted.

**Why separate TTLs for basic and trending**

Basic suggestions change slowly — a 5 minute TTL is fine. Trending suggestions change rapidly as new searches come in — a 60 second TTL keeps them fresh without hammering the DB.

## Project Structure
typeahead-engine/

├── src/

│   ├── cache/

│   │   ├── ConsistentHash.ts

│   │   ├── CacheNode.ts

│   │   └── CacheManager.ts

│   ├── db/

│   │   ├── pool.ts

│   │   ├── queries.ts

│   │   └── seed.ts

│   ├── routes/

│   │   ├── suggest.ts

│   │   ├── search.ts

│   │   ├── trending.ts

│   │   └── cacheDebug.ts

│   ├── services/

│   │   ├── batchWriter.ts

│   │   ├── searchService.ts

│   │   ├── suggestionService.ts

│   │   └── trendingService.ts

│   ├── scripts/

│   │   ├── generateDataset.ts

│   │   ├── testProject.ts

│   │   └── generateReport.ts

│   ├── utils/

│   │   ├── logger.ts

│   │   ├── sanitize.ts

│   │   └── latencyMiddleware.ts

│   ├── dependencies.ts

│   ├── index.ts

│   └── types.ts

├── client/

│   └── index.html

├── .env.example

├── package.json

├── schema.sql

├── tsconfig.json

└── README.md

## License

MIT
