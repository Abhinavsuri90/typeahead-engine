import pool from './pool';
import { SuggestionResult, TrendingResult, BatchEntry } from '../types';

const decayExponent = parseFloat(process.env.TRENDING_DECAY_EXPONENT || '1.5');

export async function getSuggestions(prefix: string, limit: number = 10): Promise<SuggestionResult[]> {
  const result = await pool.query(
    `SELECT query, count FROM queries WHERE query ILIKE $1 || '%' ORDER BY count DESC LIMIT $2`,
    [prefix, limit]
  );
  return result.rows;
}

export async function getTrendingSuggestions(prefix: string, limit: number = 10): Promise<TrendingResult[]> {
  const result = await pool.query(
    `SELECT query, count, COALESCE(last_searched_at, created_at) as last_searched_at, 
     count / POWER(EXTRACT(EPOCH FROM (now() - COALESCE(last_searched_at, created_at))) / 3600.0 + 2, $3::numeric) AS score 
     FROM queries WHERE query ILIKE $1 || '%' 
     ORDER BY score DESC LIMIT $2`,
    [prefix, limit, decayExponent]
  );

  return result.rows.map(row => ({
    query: row.query,
    count: row.count,
    lastSearchedAt: new Date(row.last_searched_at),
    score: Number(row.score)
  }));
}

export async function getTrending(windowHours: number = 168): Promise<TrendingResult[]> {
  const result = await pool.query(
    `SELECT query, count, COALESCE(last_searched_at, created_at) as last_searched_at, 
     count / POWER(EXTRACT(EPOCH FROM (now() - COALESCE(last_searched_at, created_at))) / 3600.0 + 2, $2::numeric) AS score 
     FROM queries 
     WHERE COALESCE(last_searched_at, created_at) > now() - make_interval(hours => $1::int) 
     ORDER BY score DESC LIMIT 20`,
    [windowHours, decayExponent]
  );

  return result.rows.map(row => ({
    query: row.query,
    count: row.count,
    lastSearchedAt: new Date(row.last_searched_at),
    score: Number(row.score)
  }));
}

export async function upsertQuery(query: string, count: number = 1): Promise<void> {
  await pool.query(
    `INSERT INTO queries (query, count, last_searched_at) VALUES ($1, $2, now()) 
     ON CONFLICT (query) DO UPDATE SET count = queries.count + EXCLUDED.count, last_searched_at = EXCLUDED.last_searched_at`,
    [query, count]
  );
}

export async function bulkUpsertQueries(entries: BatchEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const values: any[] = [];
    const placeholders: string[] = [];

    let index = 1;
    for (const entry of entries) {
      placeholders.push(`($${index}, $${index + 1}, now())`);
      values.push(entry.query, entry.count);
      index += 2;
    }

    const queryText = `
      INSERT INTO queries (query, count, last_searched_at) 
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (query) DO UPDATE 
      SET count = queries.count + EXCLUDED.count, last_searched_at = EXCLUDED.last_searched_at
    `;

    await client.query(queryText, values);
    await client.query('COMMIT');

    const logger = (await import('../utils/logger')).default;
    logger.info({ event: "db_bulk_upsert", rowCount: entries.length });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
