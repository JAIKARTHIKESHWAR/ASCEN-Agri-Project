import db, { dbRun, dbAll, dbGet } from '../database.js';
import { TABLE_SCHEMAS } from '../schema.js';

/**
 * Ensures all tables exist in PostgreSQL. If any table is missing/deleted, it gets recreated.
 */
export async function initializeDatabase() {
  console.log('Verifying relational database tables...');

  // Ensure pgcrypto is enabled for gen_random_uuid()
  try {
    await dbRun('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  } catch (e) {
    console.error('Warning: could not enable pgcrypto extension:', e.message);
  }

  // ── Step 1: Remove any conflicting physical `sales_data` table ────────────
  // PostgreSQL can't replace a TABLE with a VIEW using CREATE OR REPLACE VIEW.
  // We must detect the relation type and drop it first.
  try {
    const relation = await dbGet(
      "SELECT table_type FROM information_schema.tables WHERE table_name = 'sales_data' AND table_schema = 'public'"
    );
    if (relation) {
      if (relation.table_type === 'BASE TABLE') {
        // Physical table exists — check if raw copy exists
        const rawExists = await dbGet(
          "SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_data_raw' AND table_schema = 'public'"
        );
        if (rawExists) {
          console.log('Dropping legacy physical "sales_data" table (data preserved in sales_data_raw)...');
          await dbRun('DROP TABLE sales_data CASCADE');
        } else {
          console.log('Migrating physical "sales_data" → "sales_data_raw"...');
          await dbRun('ALTER TABLE sales_data RENAME TO sales_data_raw');
        }
      } else if (relation.table_type === 'VIEW') {
        // Already a view — drop it so we can recreate fresh
        console.log('Dropping stale "sales_data" view...');
        await dbRun('DROP VIEW IF EXISTS sales_data CASCADE');
      }
    }
  } catch (err) {
    console.error('Error during sales_data migration:', err.message);
  }

  // ── Step 2: Ensure upload_batches columns for soft-reset ──────────────────
  try {
    await dbRun('ALTER TABLE upload_batches ADD COLUMN IF NOT EXISTS file_hash TEXT');
    await dbRun('ALTER TABLE upload_batches ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE');
    // Add unique index on file_hash (not constraint, to avoid errors on NULL)
    await dbRun('CREATE UNIQUE INDEX IF NOT EXISTS uq_upload_file_hash ON upload_batches (file_hash) WHERE file_hash IS NOT NULL');
  } catch (err) {
    console.log('upload_batches migration skipped (already applied):', err.message);
  }

  // ── Step 3: Create missing tables ─────────────────────────────────────────
  const existingTablesRows = await dbAll(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
  );
  const existingTables = new Set(existingTablesRows.map(r => r.name));

  for (const [tableName, createSql] of Object.entries(TABLE_SCHEMAS)) {
    if (!existingTables.has(tableName)) {
      console.warn(`Table "${tableName}" missing — creating now...`);
      await dbRun(createSql);
    }
  }

  // ── Step 4: Add UNIQUE constraint on (invoice_id, batch_id) ───────────────
  // This allows the same invoice_id from two different FY files without conflict.
  try {
    await dbRun('ALTER TABLE sales_data_raw DROP CONSTRAINT IF EXISTS uq_invoice_batch');
    await dbRun('ALTER TABLE sales_data_raw ADD CONSTRAINT uq_invoice_batch UNIQUE (invoice_id, batch_id)');
    console.log('Unique constraint (invoice_id, batch_id) ensured on sales_data_raw.');
  } catch (err) {
    console.log('Unique constraint already exists or skipped:', err.message);
  }

  // ── Step 5: Create the sales_data VIEW (filters inactive batches) ─────────
  console.log('Creating "sales_data" view...');
  await dbRun(`
    CREATE VIEW sales_data AS
    SELECT sd.*
    FROM sales_data_raw sd
    JOIN upload_batches ub ON sd.batch_id = ub.batch_id
    WHERE ub.is_active = true
  `);

  // ── Step 6: INSTEAD OF INSERT trigger so existing INSERT INTO sales_data works ──
  await dbRun(`
    CREATE OR REPLACE FUNCTION insert_sales_data_func()
    RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO sales_data_raw (
        invoice_id, invoice_date, billing_type, customer_id, material_code,
        territory_id, qty, sales_unit, sales_amount_inr, cogm, season_code, fy_code, batch_id
      ) VALUES (
        NEW.invoice_id, NEW.invoice_date, NEW.billing_type, NEW.customer_id, NEW.material_code,
        NEW.territory_id, NEW.qty, NEW.sales_unit, NEW.sales_amount_inr, NEW.cogm,
        NEW.season_code, NEW.fy_code, NEW.batch_id
      ) ON CONFLICT (invoice_id, batch_id) DO NOTHING;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await dbRun(`
    DROP TRIGGER IF EXISTS insert_sales_data_trigger ON sales_data;
    CREATE TRIGGER insert_sales_data_trigger
    INSTEAD OF INSERT ON sales_data
    FOR EACH ROW EXECUTE FUNCTION insert_sales_data_func();
  `);

  // ── Step 7: Pre-seed master data ──────────────────────────────────────────
  await seedMasterData();
}

/**
 * Pre-seed lookup tables using Postgres compatible ON CONFLICT syntax
 */
async function seedMasterData() {
  // Seed Financial Years if empty
  const fyCount = await dbAll("SELECT COUNT(*) as count FROM financial_years");
  if (parseInt(fyCount[0].count, 10) === 0) {
    await dbRun("INSERT INTO financial_years (fy_code, fy_name) VALUES ('FY2425', 'Financial Year 2024-25') ON CONFLICT (fy_code) DO NOTHING;");
    await dbRun("INSERT INTO financial_years (fy_code, fy_name) VALUES ('FY2526', 'Financial Year 2025-26') ON CONFLICT (fy_code) DO NOTHING;");
    await dbRun("INSERT INTO financial_years (fy_code, fy_name) VALUES ('FY2627', 'Financial Year 2026-27') ON CONFLICT (fy_code) DO NOTHING;");
  }

  // Seed Billing Type Classifications if empty
  const btCount = await dbAll("SELECT COUNT(*) as count FROM billing_types");
  if (parseInt(btCount[0].count, 10) === 0) {
    await dbRun("INSERT INTO billing_types (billing_type, billing_desc, classification) VALUES ('F2', 'Standard Invoice', 'GROSS_SALE') ON CONFLICT (billing_type) DO NOTHING;");
    await dbRun("INSERT INTO billing_types (billing_type, billing_desc, classification) VALUES ('RE', 'Returns', 'RETURN') ON CONFLICT (billing_type) DO NOTHING;");
    await dbRun("INSERT INTO billing_types (billing_type, billing_desc, classification) VALUES ('S1', 'Cancelled Invoice', 'CANCELLED') ON CONFLICT (billing_type) DO NOTHING;");
    await dbRun("INSERT INTO billing_types (billing_type, billing_desc, classification) VALUES ('IPT', 'Stock Transfer (IPT)', 'STOCK_TRANSFER') ON CONFLICT (billing_type) DO NOTHING;");
  }
}
