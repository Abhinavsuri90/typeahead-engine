import { Pool } from 'pg';
import logger from '../utils/logger';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  database: process.env.DB_NAME || 'typeahead',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  max: 10
});

pool.on('error', (err) => {
  logger.error({ event: 'db_pool_error', error: err.message });
});

export async function checkConnection(): Promise<void> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    logger.info({ event: 'db_connected' });
  } catch (err: any) {
    logger.error({ event: 'db_connection_failed', error: err.message });
    throw err;
  }
}

export default pool;
