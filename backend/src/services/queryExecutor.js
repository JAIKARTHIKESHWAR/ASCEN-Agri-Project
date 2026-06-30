import { dbAll } from '../database.js';

/**
 * Validate that the SQL query is read-only and does not contain destructive operations.
 */
export function validateSQLSafety(sql) {
  const blocked = [
    'UPDATE',
    'DELETE',
    'DROP',
    'TRUNCATE',
    'ALTER',
    'INSERT',
    'CREATE',
    'GRANT',
    'REVOKE'
  ];

  const upperSql = sql.toUpperCase();
  for (const keyword of blocked) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(upperSql)) {
      throw new Error(`Unsafe SQL statement detected: Contains blocked keyword "${keyword}"`);
    }
  }
  return true;
}

/**
 * Execute the SQL query inside the generated query plan against PostgreSQL
 */
export async function executeQueryPlan(dbConnection, queryPlan, datasetId) {
  if (!queryPlan || !queryPlan.sql) {
    throw new Error('No SQL query was found in the translated query plan.');
  }

  // Enforce read-only safety
  validateSQLSafety(queryPlan.sql);

  try {
    let sql = queryPlan.sql;
    const sqlHasExplicitFY = /fy_code\s*=\s*['"]FY\d{4}['"]/i.test(sql) || /batch_id\s*=/i.test(sql);
    if (datasetId && datasetId !== 'all' && !sqlHasExplicitFY) {
      const isBatchId = !isNaN(Number(datasetId));
      if (isBatchId) {
        sql = `WITH sales_data AS (
  SELECT * FROM sales_data_raw WHERE batch_id = ${Number(datasetId)}
),
ai_sales_records AS (
  SELECT sd.*, bt.classification, fy.fy_name 
  FROM sales_data_raw sd
  LEFT JOIN billing_types bt ON sd.billing_type = bt.billing_type
  LEFT JOIN financial_years fy ON sd.fy_code = fy.fy_code
  WHERE sd.batch_id = ${Number(datasetId)}
)
${sql}`;
      } else {
        sql = `WITH sales_data AS (
  SELECT * FROM sales_data_raw WHERE fy_code = '${datasetId.replace(/'/g, "''")}'
),
ai_sales_records AS (
  SELECT sd.*, bt.classification, fy.fy_name 
  FROM sales_data_raw sd
  LEFT JOIN billing_types bt ON sd.billing_type = bt.billing_type
  LEFT JOIN financial_years fy ON sd.fy_code = fy.fy_code
  WHERE sd.fy_code = '${datasetId.replace(/'/g, "''")}'
)
${sql}`;
      }
    }
    const rows = await dbAll(sql);
    return rows;
  } catch (error) {
    console.error('SQL query execution failed:', queryPlan.sql, error);
    throw new Error(`Failed to execute data query: ${error.message}`);
  }
}
