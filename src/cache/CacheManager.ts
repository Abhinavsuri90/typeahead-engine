import { ConsistentHash } from './ConsistentHash';
import { CacheNode } from './CacheNode';
import { SuggestionResult, TrendingResult } from '../types';
import logger from '../utils/logger';

export class CacheManager {
  private hashRing: ConsistentHash;
  private nodes: Map<string, CacheNode<SuggestionResult[] | TrendingResult[]>> = new Map();

  constructor() {
    this.hashRing = new ConsistentHash();
    
    const nodeCount = parseInt(process.env.NODE_COUNT || '5', 10);
    for (let i = 1; i <= nodeCount; i++) {
      const nodeId = `node-${i}`;
      this.nodes.set(nodeId, new CacheNode<SuggestionResult[] | TrendingResult[]>(nodeId));
      this.hashRing.addNode(nodeId);
    }
    
    logger.info({ event: "cache_manager_init", nodeCount });
  }

  public get(prefix: string, mode: 'basic' | 'trending'): SuggestionResult[] | TrendingResult[] | null {
    const nodeId = this.hashRing.getNode(prefix);
    if (!nodeId) return null;

    const node = this.nodes.get(nodeId);
    if (!node) return null;

    const key = `${mode === 'trending' ? 'trending-suggest' : 'suggest'}:${prefix}`;
    const result = node.get(key);
    
    if (result !== null) {
      logger.debug({ event: "cache_manager_op", operation: "get", prefix, mode, nodeId, hit: true });
    } else {
      logger.info({ event: "cache_manager_op", operation: "get", prefix, mode, nodeId, hit: false });
    }
    
    return result;
  }

  public getStale(prefix: string, mode: 'basic' | 'trending'): SuggestionResult[] | TrendingResult[] | null {
    const nodeId = this.hashRing.getNode(prefix);
    if (!nodeId) return null;

    const node = this.nodes.get(nodeId);
    if (!node) return null;

    const key = `${mode === 'trending' ? 'trending-suggest' : 'suggest'}:${prefix}`;
    return node.getStale(key);
  }

  public set(prefix: string, data: SuggestionResult[] | TrendingResult[], ttlMs: number, mode: 'basic' | 'trending'): void {
    const nodeId = this.hashRing.getNode(prefix);
    if (!nodeId) return;

    const node = this.nodes.get(nodeId);
    if (!node) return;

    const key = `${mode === 'trending' ? 'trending-suggest' : 'suggest'}:${prefix}`;
    node.set(key, data, ttlMs);
    
    logger.info({ event: "cache_manager_op", operation: "set", prefix, mode, nodeId, ttlMs });
  }

  public invalidatePrefixes(query: string): void {
    const normalizedQuery = query.toLowerCase();
    let invalidatedCount = 0;
    
    for (let i = 1; i <= normalizedQuery.length; i++) {
      const substring = normalizedQuery.substring(0, i);
      
      const nodeId = this.hashRing.getNode(substring);
      if (!nodeId) continue;

      const node = this.nodes.get(nodeId);
      if (node) {
        node.delete(`suggest:${substring}`);
        node.delete(`trending-suggest:${substring}`);
        invalidatedCount += 2;
      }
    }
    
    logger.info({ event: "cache_manager_op", operation: "invalidatePrefixes", query, prefixesInvalidated: invalidatedCount });
  }

  public getNodeForPrefix(prefix: string): string | null {
    return this.hashRing.getNode(prefix);
  }

  public getStats(): { id: string, hits: number, misses: number, size: number, hitRate: number }[] {
    const statsArray = [];
    for (const node of this.nodes.values()) {
      statsArray.push(node.stats());
    }
    return statsArray;
  }

  public getRingDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {};
    for (const [nodeId] of this.nodes) {
      distribution[nodeId] = 0;
    }
    // Sample 1000 random prefixes and count which node handles each
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    const samples = [];
    for (const a of alphabet) {
      samples.push(a);
      for (const b of alphabet) {
        samples.push(a + b);
      }
    }
    for (const prefix of samples) {
      const nodeId = this.hashRing.getNode(prefix);
      if (nodeId && distribution[nodeId] !== undefined) {
        distribution[nodeId]++;
      }
    }
    return distribution;
  }

  public destroy(): void {
    for (const node of this.nodes.values()) {
      node.destroy();
    }
  }
}
