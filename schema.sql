CREATE TABLE IF NOT EXISTS queries (
  id SERIAL PRIMARY KEY,
  query TEXT UNIQUE NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  last_searched_at TIMESTAMP NOT NULL DEFAULT now(),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_queries_prefix ON queries (query text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_queries_count ON queries (count DESC);
CREATE INDEX IF NOT EXISTS idx_queries_last_searched ON queries (last_searched_at DESC);

CREATE TABLE IF NOT EXISTS recent_searches (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  searched_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recent_query ON recent_searches(query);
CREATE INDEX IF NOT EXISTS idx_recent_searched_at ON recent_searches(searched_at DESC);
