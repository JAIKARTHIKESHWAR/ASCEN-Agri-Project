import { dbAll } from '../database.js';

/**
 * Execute the SQL query inside the generated query plan against PostgreSQL
 */
export async function executeQueryPlan(dbConnection, queryPlan) {
  if (!queryPlan || !queryPlan.sql) {
    throw new Error('No SQL query was found in the translated query plan.');
  }

  try {
    const rows = await dbAll(queryPlan.sql);
    return rows;
  } catch (error) {
    console.error('SQL query execution failed:', queryPlan.sql, error);
    throw new Error(`Failed to execute data query: ${error.message}`);
  }
}
