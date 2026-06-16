import { getSuggestions as dbGetSuggestions, getTrendingSuggestions } from '../db/queries';
import { SuggestionResult, TrendingResult } from '../types';
import { sanitize } from '../utils/sanitize';
import logger from '../utils/logger';
import { cacheManager } from '../dependencies';

export async function getSuggestions(prefix: string, mode: 'basic' | 'trending' = 'basic'): Promise<SuggestionResult[] | TrendingResult[]> {
  const sanitized = sanitize(prefix);
  if (!sanitized) return [];

  const cached = cacheManager.get(sanitized, mode);
  if (cached) {
    logger.debug({ event: "suggestion_served", prefix: sanitized, mode, source: "cache" });
    return cached;
  }

  const dbPromise = mode === 'trending' ? getTrendingSuggestions(sanitized) : dbGetSuggestions(sanitized);
  const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 500));

  try {
    const results = await Promise.race([dbPromise, timeoutPromise]);
    cacheManager.set(sanitized, results, mode === 'trending' ? 60000 : 300000, mode);
    
    logger.info({ event: "suggestion_served", prefix: sanitized, mode, source: "db", resultCount: results.length });
    return results;
  } catch (err: any) {
    const staleData = cacheManager.getStale(sanitized, mode);
    logger.warn({ event: "db_timeout_serving_stale", prefix: sanitized });
    return staleData || [];
  }
}
