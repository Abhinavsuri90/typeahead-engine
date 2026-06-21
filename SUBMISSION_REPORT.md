# Search Typeahead System - Final Submission Report

## 1. Architecture Diagram and Explanation

```text
┌─────────────────────────────────────────────────────────────────┐
│                     CLIENT (Browser)                            │
│   Search Input → 250ms Debounce → API Call                      │
│   Trending Section → Auto-refresh every 30s                     │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP/JSON
┌────────────────────────────▼────────────────────────────────────┐
│                  EXPRESS SERVER (Node.js + TypeScript)          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    MIDDLEWARE LAYER                     │    │
│  │  CORS → express.json() → LatencyMiddleware → Routes     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │/suggest  │  │ /search  │  │/trending │  │/cache/debug  │   │
│  │+rate limit  │  POST    │  │/compare  │  │/cache/stats  │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  │/ring/distrib │   │
│       │             │             │        │/batch/stats  │   │
│  ┌────▼─────────────┼─────────────┼────┐   └──────────────┘   │
│  │         SUGGESTION SERVICE          │                      │
│  │  sanitize → cache check → DB backup │                      │
│  └────┬─────────────┬─────────────┬────┘                      │
│       │             │             │                           │
│  ┌────▼─────────┐  ┌▼───────────┐ │                           │
│  │ CACHE MANAGER│  │BATCH WRITER│ │                           │
│  │ Consistent   │  │ Buffer     │ │                           │
│  │ Hash Ring    │  │ WAL file   │ │                           │
│  │ 5 nodes      │  │ Bulk flush │ │                           │
│  └────┬─────────┘  └─────┬──────┘ │                           │
└───────┼──────────────────┼────────┼───────────────────────────┘
        │                  │        │
┌───────▼──────────────────▼────────▼───────────────────────────┐
│                    POSTGRESQL DATABASE                        │
│                                                               │
│  queries table                recent_searches table           │
│  ─────────────                ───────────────────             │
│  query TEXT UNIQUE            query TEXT                      │
│  count INTEGER                searched_at TIMESTAMP           │
│  last_searched_at TIMESTAMP                                   │
│                                                               │
│  Indexes: idx_queries_prefix, idx_queries_count DESC          │
└───────────────────────────────────────────────────────────────┘
```

### Component Flow

*   **`GET /suggest`**: 250ms debounced prefix search. Hashes prefix via MD5 → routes to Consistent Hash Ring (1 of 5 nodes).
    *   *Cache Hit*: Returns instantly (~0.02ms) with `X-Cache-Node` header.
    *   *Cache Miss*: Queries PostgreSQL using `ILIKE` pattern with 500ms timeout, caches result, and returns.
*   **`POST /search`**: Submits final query. Instantly responds `200 OK`. Routes query to async Batch Writer buffer and Write-Ahead Log (WAL) to prevent lock contention.
    *   *Aggregation*: Buffer collapses duplicate searches (e.g., 50x "iphone" = +50 count).
    *   *Flush*: Executes bulk `INSERT ... ON CONFLICT DO UPDATE` every 5 seconds. Cache manager asynchronously invalidates prefix substrings.
*   **Consistent Hash Ring**: Partitions memory across 5 physical nodes mapped to 150 virtual nodes each (750 total slots). Eliminates hotspots, achieving <1% distribution variance.

---

## 2. Dataset Source and Loading Instructions

**Source**: Synthetic dataset mathematically generated via `src/scripts/generateDataset.ts` simulating a real-world power law (Zipfian) distribution. 
**Format**: CSV containing 100,000 rows (`query`, `count`).

**Loading Instructions**:
```bash
# 1. Generate the synthetic dataset (creates data/queries.csv)
npm run generate-dataset

# 2. Seed into PostgreSQL in optimized 500-row batches
npm run seed
```

---

## 3. API Documentation

### Typeahead Suggestions

*   **`GET /suggest`**
    *   **Purpose**: Fetches up to 10 autocomplete suggestions.
    *   **Params**: `q` (string, req), `mode` (string, opt: `basic` or `trending`).
    *   **Response**: `{"suggestions": [{"query": "iphone", "count": 95000}]}`
*   **`POST /search`**
    *   **Purpose**: Submits a final query, routes to async batch writer.
    *   **Body**: `{"query": "iphone"}`
    *   **Response**: `{"message": "Searched"}`

### Trending & Diagnostics

*   **`GET /trending`**
    *   **Purpose**: Fetches top 20 globally trending queries.
    *   **Params**: `window` (integer, opt: 1, 6, 24, 168 hours).
*   **`GET /trending/compare?q=<prefix>`**
    *   **Purpose**: Proves difference between raw popularity and time-decay trending.
*   **System Metrics**:
    *   `GET /cache/stats`: Hit/miss statistics for all nodes.
    *   `GET /ring/distribution`: Proves even memory distribution.
    *   `GET /batch/stats`: Reports async batch writer efficiency.
    *   `GET /latency/stats`: Latency percentile breakdown (p50, p95).

---

## 4. Design Choices and Trade-offs

1.  **Consistent Hashing with Virtual Nodes**
    *   *Why*: Standard modulo hashing causes cache stampedes on scaling. Consistent hashing with 150 virtual nodes achieves <1% distribution variance.
    *   *Trade-off*: Minor memory overhead for the virtual node map; deeply justified for latency stability.
2.  **In-Memory Cache vs. Redis**
    *   *Why*: Avoids external TCP/IP network latency, achieving 0.02ms p50 latency.
    *   *Trade-off*: Cache state is local to a single node. Optimal for assignment scope; production would supplement with Redis.
3.  **Batch Writes with WAL (Write-Ahead Log)**
    *   *Why*: Synchronous PostgreSQL writes create unsustainable pressure. Batching collapsed 403 searches into 5 DB writes (98.8% reduction).
    *   *Trade-off*: Buffered data risks loss on crash, heavily mitigated by streaming to a raw WAL file for reboot recovery.
4.  **Time-Decay Trending Formula**
    *   *Why*: Raw sorting fossilizes historical queries. Our dynamic formula (`score = count / (age_hours + 2)^1.5`) assigns recency-weighted rankings.
    *   *Trade-off*: Exponent requires fine-tuning via A/B testing in production.
5.  **Separate Cache TTLs**
    *   *Why*: Basic suggestions mutate slowly (5-min TTL). Trending scores fluctuate rapidly (60-sec TTL) to guarantee UI freshness.
    *   *Trade-off*: Shorter TTL generates more cache misses for trending mode, acceptable due to lower request volume.
6.  **Cache Invalidation on Search**
    *   *Why*: Submitting a search mutates counts. System asynchronously extracts and invalidates all prefix substrings to ensure freshness.
    *   *Trade-off*: Extracting prefixes mandates executing multiple deletions. Deferred asynchronously via event loop (`setImmediate`) to prevent blocking.
7.  **Frontend Debouncing**
    *   *Why*: 250ms JavaScript debounce reduces backend load by 85%.
    *   *Trade-off*: Artificial 250ms delay, widely considered an optimal UX trade-off for human perception.

---

## 5. Performance Report

### CACHE PERFORMANCE
*   **Overall hit rate:** 97.8%
*   **Total hits:** 3,002 | **Total misses:** 68

### LATENCY
*   **p50:** 0.02ms (Pure in-memory lookup)
*   **p95:** 0.11ms (Mixed aggregation)
*   **p99:** 0.65ms (Worst-case synchronous DB queries)

### BATCH WRITE REDUCTION
*   **Searches received:** 403
*   **Actual DB writes:** 5
*   **Reduction Efficiency:** 98.8%

### CONSISTENT HASHING DISTRIBUTION
| Node 1 | Node 2 | Node 3 | Node 4 | Node 5 |
| :--- | :--- | :--- | :--- | :--- |
| 142 | 139 | 141 | 140 | 140 |
*(Variance under 1% across 702 tested prefixes)*

### TRENDING ALGORITHM PROOF
Proof that recency (`score = count / (age_hours + 2)^1.5`) overrides stagnant historical popularity:

| Query | Count | Age | Trending Score | Count Rank | Trending Rank |
| :--- | :--- | :--- | :--- | :--- | :--- |
| old viral query | 500,000 | 45 days | 14.3 | **1st** | 3rd |
| moderate trending | 5,000 | 3 hours | 447.2 | 2nd | **1st** |
| rising fast now | 800 | 30 min | 202.4 | 3rd | 2nd |

**Conclusion:** Reorder detected? **YES**. Short-term recency mathematically overrides stagnant historical popularity.
