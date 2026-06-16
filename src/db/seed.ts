import fs from 'fs';
import { parse } from 'csv-parse';
import { bulkUpsertQueries } from './queries';
import { BatchEntry } from '../types';
import logger from '../utils/logger';

async function seed() {
  const filePath = process.argv[2] || process.env.DATA_FILE;

  if (!filePath) {
    logger.error({ event: 'seed_error', message: 'No file path provided. Usage: ts-node src/db/seed.ts <path>' });
    process.exit(1);
  }

  logger.warn({ event: "seed_warning", message: "Running seed will ADD to existing counts, not replace them. To reset, truncate the queries table first." });

  const parser = fs.createReadStream(filePath).pipe(
    parse({
      columns: true,
      skip_empty_lines: true
    })
  );

  let batch: BatchEntry[] = [];
  let rowsProcessed = 0;
  const startTime = Date.now();

  try {
    for await (const record of parser) {
      if (record.query && record.count !== undefined) {
        batch.push({
          query: record.query,
          count: parseInt(record.count, 10),
          timestamp: Date.now()
        });
      }

      if (batch.length >= 500) {
        await bulkUpsertQueries(batch);
        rowsProcessed += batch.length;
        batch = [];

        logger.info({
          event: "seed_progress",
          rowsProcessed,
          elapsedMs: Date.now() - startTime
        });
      }
    }

    if (batch.length > 0) {
      await bulkUpsertQueries(batch);
      rowsProcessed += batch.length;
    }

    const elapsedMs = Date.now() - startTime;
    logger.info({
      event: "seed_complete",
      totalRows: rowsProcessed,
      elapsedMs,
      rowsPerSecond: elapsedMs > 0 ? (rowsProcessed / elapsedMs) * 1000 : 0
    });
    process.exit(0);
  } catch (error: any) {
    logger.error({ event: 'seed_error', error: error.message });
    process.exit(1);
  }
}

seed();
