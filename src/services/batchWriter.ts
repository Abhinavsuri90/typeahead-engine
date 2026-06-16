import fs from 'fs';
import path from 'path';
import { BatchStats, BatchEntry } from '../types';
import { CacheManager } from '../cache/CacheManager';
import { bulkUpsertQueries } from '../db/queries';
import { sanitize } from '../utils/sanitize';
import logger from '../utils/logger';

export class BatchWriter {
  private buffer: Map<string, { count: number, lastTimestamp: number }> = new Map();
  private batchSize: number;
  private flushIntervalMs: number;
  private maxBufferSize: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private walPath = path.join(__dirname, '..', '..', 'batch.wal');
  private isReplaying = false;
  
  private totalSearchesReceived = 0;
  private totalDbWrites = 0;
  private totalBatchesFlushed = 0;
  private totalDbWritesSaved = 0;

  constructor(private cacheManager: CacheManager) {
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100', 10);
    this.flushIntervalMs = parseInt(process.env.FLUSH_INTERVAL_MS || '5000', 10);
    this.maxBufferSize = parseInt(process.env.MAX_BUFFER_SIZE || '1000', 10);
    
    if (fs.existsSync(this.walPath)) {
      this.replayWAL();
    }
    
    this.flushTimer = setInterval(() => {
      this.flush().catch(err => logger.error({ event: "flush_error", error: err.message }));
    }, this.flushIntervalMs);
    
    logger.info({ event: "batch_writer_init", batchSize: this.batchSize, flushIntervalMs: this.flushIntervalMs });
  }

  private replayWAL(): void {
    try {
      this.isReplaying = true;
      const content = fs.readFileSync(this.walPath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim().length > 0);
      let count = 0;
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.query) {
            this.push(entry.query);
            count++;
          }
        } catch (e) {
          logger.warn({ event: "wal_line_skipped", line });
        }
      }
      logger.info({ event: "wal_replayed", linesReplayed: count });
    } catch (err: any) {
      logger.error({ event: "wal_replay_error", error: err.message });
    } finally {
      this.isReplaying = false;
    }
  }

  public push(rawQuery: string): void {
    const query = sanitize(rawQuery);
    if (!query) return;

    this.totalSearchesReceived++;
    const ts = Date.now();
    
    const existing = this.buffer.get(query);
    if (existing) {
      existing.count += 1;
      existing.lastTimestamp = ts;
    } else {
      this.buffer.set(query, { count: 1, lastTimestamp: ts });
    }
    
    if (!this.isReplaying) {
      try {
        fs.appendFileSync(this.walPath, JSON.stringify({ query, timestamp: ts }) + '\n');
      } catch (e: any) {
        logger.error({ event: "wal_write_error", error: e.message });
      }
    }

    if (this.buffer.size >= this.maxBufferSize) {
      logger.warn({ event: "buffer_max_reached", size: this.buffer.size });
      this.flush().catch(err => logger.error({ event: "flush_error", error: err.message }));
    } else if (this.buffer.size >= this.batchSize) {
      this.flush().catch(err => logger.error({ event: "flush_error", error: err.message }));
    }
  }

  public async flush(): Promise<void> {
    if (this.buffer.size === 0) return;

    const snapshot = new Map(this.buffer);
    this.buffer.clear();
    
    const entries: BatchEntry[] = Array.from(snapshot.entries()).map(([query, data]) => ({
      query,
      count: data.count,
      timestamp: data.lastTimestamp
    }));

    try {
      await bulkUpsertQueries(entries);
      
      this.totalDbWrites++;
      this.totalBatchesFlushed++;
      this.totalDbWritesSaved += Math.max(0, snapshot.size - 1);
      
      try { 
        if (fs.existsSync(this.walPath)) {
          fs.unlinkSync(this.walPath); 
        }
      } catch (e) {}

      for (const query of snapshot.keys()) {
        setImmediate(() => {
          this.cacheManager.invalidatePrefixes(query);
        });
      }
      
      logger.info({ event: "batch_flush_complete", uniqueQueries: snapshot.size, dbWritesSaved: Math.max(0, snapshot.size - 1) });
    } catch (err: any) {
      logger.error({ event: "flush_failed_wal_preserved", error: err.message });
    }
  }

  public getStats(): BatchStats {
    const savings = this.totalSearchesReceived > 0 
      ? (this.totalDbWritesSaved / this.totalSearchesReceived) * 100 
      : 0;
      
    return {
      bufferSize: this.buffer.size,
      totalSearchesReceived: this.totalSearchesReceived,
      totalDbWrites: this.totalDbWrites,
      dbWritesSaved: this.totalDbWritesSaved,
      avgBatchSize: this.totalBatchesFlushed > 0 ? this.totalDbWritesSaved / this.totalBatchesFlushed : 0,
      savingsPercentage: `${savings.toFixed(1)}%`
    };
  }

  public async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    await this.flush().catch(err => logger.error({ event: "flush_error", error: err.message }));
    logger.info({ event: "batch_writer_shutdown" });
  }
}
