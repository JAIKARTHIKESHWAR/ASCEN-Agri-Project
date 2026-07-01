import db, { dbRun, dbAll, dbGet, dbTransaction } from '../database.js';
import { TABLE_SCHEMAS } from '../schema.js';
import { computeAndStoreAggregates } from '../services/aggregateService.js';

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
    await dbRun('ALTER TABLE upload_batches ADD COLUMN IF NOT EXISTS fy_code TEXT');
    await dbRun('ALTER TABLE upload_batches ADD COLUMN IF NOT EXISTS min_date DATE');
    await dbRun('ALTER TABLE upload_batches ADD COLUMN IF NOT EXISTS max_date DATE');
    await dbRun('ALTER TABLE upload_batches ADD COLUMN IF NOT EXISTS record_count INTEGER');
    await dbRun('ALTER TABLE upload_batches ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ');
    await dbRun('ALTER TABLE upload_batches ADD COLUMN IF NOT EXISTS schema_columns JSONB');
    
    // Drop the old unique constraint on file_hash if it exists —
    // duplicate prevention now uses deleted_at IS NULL scoping, not a DB-level unique index.
    await dbRun(`
      DO $$
      BEGIN
          IF EXISTS (
              SELECT 1
              FROM pg_constraint
              WHERE conname = 'uq_upload_batches_file_hash'
          ) THEN
              ALTER TABLE upload_batches
              DROP CONSTRAINT uq_upload_batches_file_hash;
          END IF;
      END $$;
    `);
  } catch (err) {
    console.log('upload_batches columns migration failed or skipped:', err.message);
  }

  // ── Step 3: Create missing tables ─────────────────────────────────────────
  const existingTablesRows = await dbAll(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
  );
  const existingTables = new Set(existingTablesRows.map(r => r.name));

  // Migration Check
  try {
    if (existingTables.has('sales_data_raw')) {
      const hasIdCol = await dbGet(`
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='sales_data_raw' AND column_name='id'
      `);
      if (!hasIdCol) {
        console.log('Schema migration detected: Old sales_data_raw schema (missing id column). Recreating...');
        
        await dbTransaction(async () => {
          // Drop dependent objects
          await dbRun('DROP VIEW IF EXISTS sales_data CASCADE');
          await dbRun('DROP TRIGGER IF EXISTS insert_sales_data_trigger ON sales_data');
          
          // Drop existing backup table if it exists
          await dbRun('DROP TABLE IF EXISTS sales_data_raw_backup CASCADE');
          
          // Rename table to backup
          await dbRun('ALTER TABLE sales_data_raw RENAME TO sales_data_raw_backup');
          
          // Recreate sales_data_raw
          console.log('Recreating sales_data_raw with new schema...');
          await dbRun(TABLE_SCHEMAS.sales_data_raw);
          
          // Migrate existing records
          console.log('Migrating existing records from backup...');
          await dbRun(`
            INSERT INTO sales_data_raw (invoice_id, invoice_date, billing_type, customer_id, material_code, territory_id, qty, sales_unit, sales_amount_inr, cogm, season_code, fy_code, batch_id)
            SELECT invoice_id, invoice_date, billing_type, customer_id, material_code, territory_id, qty, sales_unit, sales_amount_inr, cogm, season_code, fy_code, batch_id
            FROM sales_data_raw_backup
          `);
          console.log('Migration completed successfully.');
        });
      }
    }
  } catch (err) {
    console.error('Schema migration check failed:', err.message);
  }

  for (const [tableName, createSql] of Object.entries(TABLE_SCHEMAS)) {
    if (!existingTables.has(tableName)) {
      console.warn(`Table "${tableName}" missing — creating now...`);
      await dbRun(createSql);
    }
  }

  // Additive migrations for all 48 columns if sales_data_raw exists
  if (existingTables.has('sales_data_raw')) {
    const newCols = [
      ['billing_type_desc', 'TEXT'],
      ['division', 'TEXT'],
      ['distribution_channel', 'TEXT'],
      ['state', 'TEXT'],
      ['plant', 'TEXT'],
      ['storage_location', 'TEXT'],
      ['sales_order_no', 'TEXT'],
      ['customer_reference', 'TEXT'],
      ['indent_no', 'TEXT'],
      ['ipt_sr_request_no', 'TEXT'],
      ['ipt_sr_request_date', 'DATE'],
      ['accounting_doc_no', 'TEXT'],
      ['fiscal_year', 'INTEGER'],
      ['customer_no', 'TEXT'],
      ['customer_name', 'TEXT'],
      ['line_item_no', 'TEXT'],
      ['crop_name', 'TEXT'],
      ['variety_name', 'TEXT'],
      ['own_trade', 'TEXT'],
      ['material_name', 'TEXT'],
      ['batch_no', 'TEXT'],
      ['expiry_date', 'DATE'],
      ['currency', 'TEXT'],
      ['sales_price', 'NUMERIC(15,2)'],
      ['sales_amount', 'NUMERIC(15,2)'],
      ['exchange_rate', 'NUMERIC(15,4)'],
      ['base_currency_inr', 'TEXT'],
      ['sales_price_inr', 'NUMERIC(15,2)'],
      ['territory_name', 'TEXT'],
      ['ti_id', 'TEXT'],
      ['ti_name', 'TEXT'],
      ['am_id', 'TEXT'],
      ['am_name', 'TEXT'],
      ['rbm_id', 'TEXT'],
      ['rbm_name', 'TEXT'],
      ['dbm_id', 'TEXT'],
      ['dbm_name', 'TEXT'],
      ['created_by', 'TEXT']
    ];
    for (const [colName, colType] of newCols) {
      await dbRun(`ALTER TABLE sales_data_raw ADD COLUMN IF NOT EXISTS ${colName} ${colType}`);
    }
    console.log('Additive migrations for new sales_data_raw columns completed.');
  }

  // ── Step 4: Remove UNIQUE constraint on (invoice_id, batch_id) if it exists ──
  try {
    await dbRun('ALTER TABLE sales_data_raw DROP CONSTRAINT IF EXISTS uq_invoice_batch');
    console.log('Unique constraint uq_invoice_batch removed if it existed.');
  } catch (err) {
    console.log('Failed to drop unique constraint:', err.message);
  }

  // ── Step 4b: Deduplicate existing batches & rows, then apply uq_invoice_line_per_batch ──
  try {
    console.log('Cleaning up duplicate batches from database...');
    const duplicateBatches = await dbAll(`
      SELECT batch_id, fy_code, file_name FROM upload_batches ub1
      WHERE EXISTS (
        SELECT 1 FROM upload_batches ub2
        WHERE ub2.fy_code = ub1.fy_code AND ub2.uploaded_at > ub1.uploaded_at
      )
    `);

    for (const b of duplicateBatches) {
      console.log(`Deleting duplicate batch ${b.batch_id} (${b.fy_code} - ${b.file_name})...`);
      try {
        await dbRun('DELETE FROM dataset_aggregates WHERE batch_id = $1', [b.batch_id]);
      } catch (_) {}
      await dbRun('DELETE FROM import_rejected_rows WHERE batch_id = $1', [b.batch_id]);
      await dbRun('DELETE FROM sales_data_raw WHERE batch_id = $1', [b.batch_id]);
      await dbRun('DELETE FROM upload_batches WHERE batch_id = $1', [b.batch_id]);
    }

    const constraintExists = await dbGet(`
      SELECT 1 FROM pg_constraint WHERE conname = 'uq_invoice_line_per_batch'
    `);
    if (!constraintExists) {
      console.log('Deduplicating duplicate raw lines in sales_data_raw before applying constraint...');
      await dbRun(`
        DELETE FROM sales_data_raw a USING sales_data_raw b
        WHERE a.id > b.id 
          AND a.invoice_id = b.invoice_id 
          AND COALESCE(a.line_item_no, '') = COALESCE(b.line_item_no, '') 
          AND a.fy_code = b.fy_code
      `);
      console.log('Applying unique constraint uq_invoice_line_per_batch to sales_data_raw...');
      await dbRun('ALTER TABLE sales_data_raw ADD CONSTRAINT uq_invoice_line_per_batch UNIQUE (invoice_id, line_item_no, fy_code)');
      console.log('Unique constraint applied successfully.');
    }
  } catch (err) {
    console.error('Failed duplicate batch/row cleanup and constraint migration:', err.message);
  }

  // ── Step 5: Create the sales_data VIEW (filters inactive batches) ─────────
  console.log('Creating "sales_data" view...');
  await dbRun(`
    CREATE OR REPLACE VIEW sales_data AS
    SELECT 
      sd.id,
      sd.invoice_id,
      sd.invoice_date,
      sd.billing_type,
      sd.customer_id,
      sd.material_code,
      sd.territory_id,
      sd.qty,
      sd.sales_unit,
      sd.sales_amount_inr,
      sd.cogm,
      sd.season_code,
      sd.fy_code,
      sd.batch_id
    FROM sales_data_raw sd
    JOIN upload_batches ub ON sd.batch_id = ub.batch_id
    WHERE ub.is_active = true
  `);

  // ── Step 5b: Create the enriched ai_sales_records VIEW for AI Copilot ─────────
  console.log('Creating "ai_sales_records" view...');
  await dbRun(`
    CREATE OR REPLACE VIEW ai_sales_records AS
    SELECT 
      sd.*,
      bt.classification,
      fy.fy_name
    FROM sales_data_raw sd
    JOIN upload_batches ub ON sd.batch_id = ub.batch_id
    LEFT JOIN billing_types bt ON sd.billing_type = bt.billing_type
    LEFT JOIN financial_years fy ON sd.fy_code = fy.fy_code
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
      );
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

  // ── Step 8: Create Performance Optimization Indexes ──────────────────────────
  console.log('Creating database performance indexes...');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_sales_batch ON sales_data_raw(batch_id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_sales_fy ON sales_data_raw(fy_code)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_sales_batch_fy ON sales_data_raw(batch_id, fy_code)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_sales_invoice_date ON sales_data_raw(invoice_date)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_sales_raw_invoice ON sales_data_raw(invoice_id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_sales_raw_batch ON sales_data_raw(batch_id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_sales_raw_invoice_batch ON sales_data_raw(invoice_id, batch_id)');
  
  // GIN and B-Tree indexes for AI high-fidelity queries
  await dbRun('CREATE INDEX IF NOT EXISTS idx_raw_material_name_gin ON sales_data_raw USING GIN(to_tsvector(\'english\', material_name))');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_raw_customer_name_gin ON sales_data_raw USING GIN(to_tsvector(\'english\', customer_name))');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_raw_batch_no ON sales_data_raw(batch_no)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_raw_plant ON sales_data_raw(plant)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_raw_customer_no ON sales_data_raw(customer_no)');

  // ── Step 9: Startup Backfill for dataset_aggregates with per-batch try/catch ──
  try {
    const activeBatches = await dbAll("SELECT batch_id, fy_code FROM upload_batches WHERE is_active = true");
    for (const b of activeBatches) {
      try {
        const aggCount = await dbGet("SELECT COUNT(*) as count FROM dataset_aggregates WHERE batch_id = $1", [b.batch_id]);
        if (parseInt(aggCount.count || 0, 10) === 0) {
          console.log(`[Aggregates] Startup backfill: Computing aggregates for batch ${b.batch_id} (${b.fy_code})...`);
          await computeAndStoreAggregates(b.batch_id, b.fy_code);
          console.log(`[Aggregates] Startup backfill: Batch ${b.batch_id} completed successfully.`);
        }
      } catch (batchErr) {
        console.error(`[Aggregates] Startup backfill failed for batch ${b.batch_id} (${b.fy_code}):`, batchErr.message);
      }
    }
  } catch (err) {
    console.error('[Aggregates] Failed to run startup aggregates backfill checklist:', err.message);
  }
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
    await dbRun("INSERT INTO billing_types (billing_type, billing_desc, classification) VALUES ('ZF2', 'Acsen Invoice', 'GROSS_SALE') ON CONFLICT (billing_type) DO NOTHING;");
    await dbRun("INSERT INTO billing_types (billing_type, billing_desc, classification) VALUES ('ZIF2', 'Inter-Company Invoice', 'GROSS_SALE') ON CONFLICT (billing_type) DO NOTHING;");
    await dbRun("INSERT INTO billing_types (billing_type, billing_desc, classification) VALUES ('RE', 'Returns', 'RETURN') ON CONFLICT (billing_type) DO NOTHING;");
    await dbRun("INSERT INTO billing_types (billing_type, billing_desc, classification) VALUES ('ZRE', 'Acsen Returns', 'RETURN') ON CONFLICT (billing_type) DO NOTHING;");
    await dbRun("INSERT INTO billing_types (billing_type, billing_desc, classification) VALUES ('ZIRE', 'Inter-Company Returns', 'RETURN') ON CONFLICT (billing_type) DO NOTHING;");
    await dbRun("INSERT INTO billing_types (billing_type, billing_desc, classification) VALUES ('S1', 'Cancelled Invoice', 'CANCELLED') ON CONFLICT (billing_type) DO NOTHING;");
    await dbRun("INSERT INTO billing_types (billing_type, billing_desc, classification) VALUES ('ZS1', 'Acsen Cancel Invoice', 'CANCELLED') ON CONFLICT (billing_type) DO NOTHING;");
    await dbRun("INSERT INTO billing_types (billing_type, billing_desc, classification) VALUES ('IPT', 'Stock Transfer (IPT)', 'STOCK_TRANSFER') ON CONFLICT (billing_type) DO NOTHING;");
    await dbRun("INSERT INTO billing_types (billing_type, billing_desc, classification) VALUES ('ZSTO', 'Stock Transfer (ZSTO)', 'STOCK_TRANSFER') ON CONFLICT (billing_type) DO NOTHING;");
  }
}
