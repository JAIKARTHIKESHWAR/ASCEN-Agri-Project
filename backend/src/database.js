import pg from 'pg';
import dotenv from 'dotenv';
import { AsyncLocalStorage } from 'async_hooks';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Load environmental parameters
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

const { Pool } = pg;

// Instantiate PostgreSQL Connection Pool
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
  connectionTimeoutMillis: 2000 // Return error if connection takes > 2 seconds
});

// Configure connection encoding to support UTF8 characters (e.g. ₹ symbol) on Win1252 Windows server locales
pool.on('connect', (client) => {
  client.query("SET client_encoding TO 'UTF8'").catch(err => {
    console.error('Failed to set client encoding to UTF8:', err.message);
  });
});

// Test connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('CRITICAL: Failed to connect to PostgreSQL database:', err.message);
  } else {
    console.log('Successfully connected to PostgreSQL database:', process.env.DB_NAME);
  }
});

// Hook to store the client connection of an active transaction
const txStorage = new AsyncLocalStorage();

/**
 * Helper to get the correct query connection.
 * If running inside a transaction, returns the checked-out client. Otherwise, returns the pool.
 */
function getQueryTarget() {
  const client = txStorage.getStore();
  return client || pool;
}

/**
 * Execute a SQL query and return all rows
 */
export async function dbAll(sql, params = []) {
  try {
    const res = await getQueryTarget().query(sql, params);
    return res.rows;
  } catch (err) {
    console.error(`PostgreSQL dbAll query failed: ${sql}`, err.message);
    throw err;
  }
}

/**
 * Execute a SQL query and return a single row
 */
export async function dbGet(sql, params = []) {
  try {
    const res = await getQueryTarget().query(sql, params);
    return res.rows[0] || null;
  } catch (err) {
    console.error(`PostgreSQL dbGet query failed: ${sql}`, err.message);
    throw err;
  }
}

/**
 * Run a SQL statement (INSERT, UPDATE, DELETE) and return info about changes
 */
export async function dbRun(sql, params = []) {
  try {
    const res = await getQueryTarget().query(sql, params);
    const lastRow = res.rows ? res.rows[0] : null;
    const lastID = lastRow ? (lastRow.id || lastRow.territory_id || lastRow.batch_id || null) : null;
    return { 
      lastID, 
      changes: res.rowCount,
      rows: res.rows
    };
  } catch (err) {
    console.error(`PostgreSQL dbRun query failed: ${sql}`, err.message);
    throw err;
  }
}

/**
 * Run multiple statements inside a PostgreSQL transaction context
 */
export async function dbTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txStorage.run(client, callback);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PostgreSQL dbTransaction rolled back due to error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
