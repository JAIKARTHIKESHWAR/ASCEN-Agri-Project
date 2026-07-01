import { dbRun } from '../backend/src/database.js';
import { initializeDatabase } from '../backend/src/scripts/initDb.js';

async function resetAndRecreateDB() {
  console.log('Resetting and dropping database tables/views to force schema updates...');
  try {
    // Drop views first
    await dbRun('DROP VIEW IF EXISTS sales_data CASCADE');
    await dbRun('DROP VIEW IF EXISTS ai_sales_records CASCADE');
    
    // Drop tables
    await dbRun('DROP TABLE IF EXISTS dataset_aggregates CASCADE');
    await dbRun('DROP TABLE IF EXISTS sales_data_raw CASCADE');
    await dbRun('DROP TABLE IF EXISTS import_rejected_rows CASCADE');
    await dbRun('DROP TABLE IF EXISTS upload_batches CASCADE');
    
    console.log('Tables and views dropped successfully. Re-running database initializer...');
    await initializeDatabase();
    console.log('Database initialized successfully with new schemas.');
  } catch (err) {
    console.error('Reset/Recreate failed:', err.message);
  }
}

resetAndRecreateDB();
