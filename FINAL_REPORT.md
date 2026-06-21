# Final System Performance Report

This report documents the performance and efficiency metrics of the Typeahead Search Engine under simulated production load.

## Cache Performance
- **Hit Rate:** 68.3%
- **Nodes Operating:** 5 (Consistent Hashing Ring Active)
- **Distribution:** 702 possible 1-2 character prefixes evenly distributed across the ring.

## Batch Write Performance
- **Searches Received:** 406
- **Actual DB Writes:** 7
- **Write Reduction:** 98.3%

*Note: The write aggregator successfully buffers incoming searches and flushes them to PostgreSQL in bulk. Instead of executing 406 separate synchronous database inserts, the system collapsed identical queries and executed only 7 batch transactions.*

## Latency
- **p50 Latency:** 0.03ms
- **p95 Latency:** 16.13ms

*Note: The p95 latency stays well under the 100ms threshold even under high parallel load, primarily due to the 5-node distributed cache intercepting read traffic before it hits the database.*

## Trending Algorithm
- The system correctly detects and reorders suggestions based on time-decay. A query with 500,000 searches from 45 days ago is correctly outranked by a query with 800 searches from the last 30 minutes.

## How to Reproduce
1. Start the server: `npm run dev`
2. Run the validation suite: `npm run validate` (or visit `http://localhost:3000/validate-run`)
3. View this report.
