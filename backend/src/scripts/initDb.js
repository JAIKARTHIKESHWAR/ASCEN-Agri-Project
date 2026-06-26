import db, { dbRun, dbAll } from '../database.js';
import { TABLE_SCHEMAS } from '../schema.js';

/**
 * Ensures all tables exist in PostgreSQL. If any table is missing/deleted, it gets recreated.
 */
export async function initializeDatabase() {
  console.log('Verifying relational database tables...');
  
  // Get currently existing tables in PostgreSQL public schema
  const existingTablesRows = await dbAll("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'");
  const existingTables = new Set(existingTablesRows.map(r => r.name));

  // Create any missing table
  for (const [tableName, createSql] of Object.entries(TABLE_SCHEMAS)) {
    if (!existingTables.has(tableName)) {
      console.warn(`Table "${tableName}" is missing/deleted. Re-creating now...`);
      await dbRun(createSql);
    }
  }

  // Pre-seed core lookup metadata if missing
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
