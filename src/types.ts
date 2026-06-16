export interface SearchQuery {
  id: number;
  query: string;
  count: number;
  lastSearchedAt: Date;
  createdAt: Date;
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface SuggestionResult {
  query: string;
  count: number;
  score?: number;
}

export interface BatchEntry {
  query: string;
  timestamp: number;
  count: number;
}

export interface CacheDebugResponse {
  node: string;
  hit: boolean;
  data?: SuggestionResult[] | null;
}

export interface TrendingResult {
  query: string;
  count: number;
  score: number;
  lastSearchedAt: Date;
}

export interface BatchStats {
  bufferSize: number;
  totalSearchesReceived: number;
  totalDbWrites: number;
  dbWritesSaved: number;
  avgBatchSize: number;
  savingsPercentage: string; // "97.2%"
}

export interface LatencyStats {
  p50: number;
  p95: number;
  p99: number;
  count: number;
}

export interface ApiError {
  error: string;
  code?: number;
}
