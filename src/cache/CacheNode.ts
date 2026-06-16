import logger from '../utils/logger';

export class CacheNode<T> {
  public id: string;
  private store: Map<string, { value: T; expiresAt: number }> = new Map();
  private hits: number = 0;
  private misses: number = 0;
  private cleanupInterval: NodeJS.Timeout;

  constructor(id: string) {
    this.id = id;
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  public get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      logger.info({ event: "cache_op", nodeId: this.id, key, operation: "get", hit: false });
      return null;
    }

    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      this.misses++;
      logger.info({ event: "cache_op", nodeId: this.id, key, operation: "get", hit: false });
      return null;
    }

    this.hits++;
    logger.debug({ event: "cache_op", nodeId: this.id, key, operation: "get", hit: true });
    return entry.value;
  }

  public getStale(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    return entry.value;
  }

  public set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
    logger.info({ event: "cache_op", nodeId: this.id, key, operation: "set", ttlMs });
  }

  public delete(key: string): void {
    this.store.delete(key);
    logger.info({ event: "cache_op", nodeId: this.id, key, operation: "delete" });
  }

  public deletePrefix(prefix: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.store.delete(key);
    }
  }

  public stats() {
    const total = this.hits + this.misses;
    return {
      id: this.id,
      hits: this.hits,
      misses: this.misses,
      size: this.store.size,
      hitRate: total > 0 ? (this.hits / total) * 100 : 0
    };
  }

  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt < now) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.store.delete(key);
    }
  }

  public destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}
