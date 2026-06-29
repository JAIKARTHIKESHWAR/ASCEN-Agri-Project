import { dbAll } from '../database.js';

/**
 * Execute the SQL query inside the generated query plan against PostgreSQL
 */
export async function executeQueryPlan(dbConnection, queryPlan, datasetId) {
  if (!queryPlan || !queryPlan.sql) {
    throw new Error('No SQL query was found in the translated query plan.');
  }

  try {
    let sql = queryPlan.sql;
    if (datasetId) {
      sql = `WITH sales_data AS (
  SELECT * FROM sales_data_raw WHERE batch_id = ${parseInt(datasetId, 10)}
)
${sql}`;
    }
    const rows = await dbAll(sql);
    return rows;
  } catch (error) {
    console.error('SQL query execution failed:', queryPlan.sql, error);
    throw new Error(`Failed to execute data query: ${error.message}`);
  }
}
