import { getTrending as dbGetTrending, getSuggestions as dbGetSuggestions, getTrendingSuggestions as dbGetTrendingSuggestions } from '../db/queries';
import { SuggestionResult, TrendingResult } from '../types';
import { sanitize } from '../utils/sanitize';
import logger from '../utils/logger';
import { cacheManager } from '../dependencies';

export async function getTrendingSuggestions(prefix: string): Promise<TrendingResult[]> {
  const sanitized = sanitize(prefix);
  const cached = cacheManager.get(sanitized, 'trending') as TrendingResult[] | null;
  
  if (cached) {
    return cached;
  }

  const results = await dbGetTrendingSuggestions(sanitized);
  const trendingTtl = parseInt(process.env.TRENDING_CACHE_TTL_MS || '60000', 10);
  cacheManager.set(sanitized, results, trendingTtl, 'trending');
  
  return results;
}

export async function getTrending(windowHours: number = 168): Promise<TrendingResult[]> {
  const cacheKey = `global-trending:${windowHours}`;
  const cached = cacheManager.get(cacheKey, 'trending') as TrendingResult[] | null; // using prefix trick to store globally
  
  if (cached) {
    return cached;
  }

  const results = await dbGetTrending(windowHours);
  const trendingTtl = parseInt(process.env.TRENDING_CACHE_TTL_MS || '60000', 10);
  cacheManager.set(cacheKey, results, trendingTtl, 'trending');
  
  return results;
}

export async function compareTrendingVsBasic(prefix: string): Promise<{ basic: SuggestionResult[], trending: TrendingResult[], reorderDetected: boolean }> {
  const [basic, trending] = await Promise.all([
    dbGetSuggestions(prefix),
    dbGetTrendingSuggestions(prefix)
  ]);
  
  const top3basic = basic.slice(0, 3).map(r => r.query);
  const top3trending = trending.slice(0, 3).map(r => r.query);
  
  const reorderDetected = JSON.stringify(top3basic) !== JSON.stringify(top3trending);
  
  if (reorderDetected) {
    logger.info({ event: "trending_reorder_detected", prefix, basicOrder: top3basic, trendingOrder: top3trending });
  }
  
  return { basic, trending, reorderDetected };
}
