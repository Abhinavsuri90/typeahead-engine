import { CacheManager } from './cache/CacheManager';
import { BatchWriter } from './services/batchWriter';

export const cacheManager = new CacheManager();
export const batchWriter = new BatchWriter(cacheManager);
