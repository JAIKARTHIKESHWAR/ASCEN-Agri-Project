import { dbRun, dbAll, dbGet } from '../database.js';

// ─────────────────────────────────────────────────────────────────────────────
// PRE-COMPUTED AGGREGATES GENERATOR
// Neither csvLoader.js nor initDb.js should define this function — they both
// import it from here to avoid a circular module dependency.
// ─────────────────────────────────────────────────────────────────────────────

export async function computeAndStoreAggregates(batchId, fyCode) {
  console.log(`[Aggregates] Starting pre-computation for batch ${batchId} (${fyCode})...`);
  const dimensions = [
    { 
      type: 'overall', 
      sql: `SELECT 'overall' AS dim_value,
          SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.sales_amount_inr ELSE 0 END) AS gross_sales,
          ABS(SUM(CASE WHEN bt.classification='RETURN' THEN sd.sales_amount_inr ELSE 0 END)) AS returns_value,
          ABS(SUM(CASE WHEN bt.classification='CANCELLED' THEN sd.sales_amount_inr ELSE 0 END)) AS cancelled_value,
          SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.cogm ELSE 0 END) AS total_cogm,
          COUNT(*) AS transaction_count
        FROM sales_data_raw sd
        JOIN billing_types bt ON sd.billing_type = bt.billing_type
        WHERE sd.batch_id = $1` 
    },
    { 
      type: 'crop', 
      sql: `SELECT m.crop AS dim_value,
          SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.sales_amount_inr ELSE 0 END) AS gross_sales,
          ABS(SUM(CASE WHEN bt.classification='RETURN' THEN sd.sales_amount_inr ELSE 0 END)) AS returns_value,
          ABS(SUM(CASE WHEN bt.classification='CANCELLED' THEN sd.sales_amount_inr ELSE 0 END)) AS cancelled_value,
          SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.cogm ELSE 0 END) AS total_cogm,
          COUNT(*) AS transaction_count
        FROM sales_data_raw sd
        JOIN billing_types bt ON sd.billing_type = bt.billing_type
        JOIN materials m ON sd.material_code = m.material_code
        WHERE sd.batch_id = $1
        GROUP BY m.crop` 
    },
    { 
      type: 'state', 
      sql: `SELECT t.state AS dim_value,
          SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.sales_amount_inr ELSE 0 END) AS gross_sales,
          ABS(SUM(CASE WHEN bt.classification='RETURN' THEN sd.sales_amount_inr ELSE 0 END)) AS returns_value,
          ABS(SUM(CASE WHEN bt.classification='CANCELLED' THEN sd.sales_amount_inr ELSE 0 END)) AS cancelled_value,
          SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.cogm ELSE 0 END) AS total_cogm,
          COUNT(*) AS transaction_count
        FROM sales_data_raw sd
        JOIN billing_types bt ON sd.billing_type = bt.billing_type
        JOIN territories t ON sd.territory_id = t.territory_id
        WHERE sd.batch_id = $1
        GROUP BY t.state` 
    },
    { 
      type: 'division', 
      sql: `SELECT m.division AS dim_value,
          SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.sales_amount_inr ELSE 0 END) AS gross_sales,
          ABS(SUM(CASE WHEN bt.classification='RETURN' THEN sd.sales_amount_inr ELSE 0 END)) AS returns_value,
          ABS(SUM(CASE WHEN bt.classification='CANCELLED' THEN sd.sales_amount_inr ELSE 0 END)) AS cancelled_value,
          SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.cogm ELSE 0 END) AS total_cogm,
          COUNT(*) AS transaction_count
        FROM sales_data_raw sd
        JOIN billing_types bt ON sd.billing_type = bt.billing_type
        JOIN materials m ON sd.material_code = m.material_code
        WHERE sd.batch_id = $1
        GROUP BY m.division` 
    },
    { 
      type: 'month', 
      sql: `SELECT to_char(sd.invoice_date, 'YYYY-MM') AS dim_value,
          SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.sales_amount_inr ELSE 0 END) AS gross_sales,
          ABS(SUM(CASE WHEN bt.classification='RETURN' THEN sd.sales_amount_inr ELSE 0 END)) AS returns_value,
          ABS(SUM(CASE WHEN bt.classification='CANCELLED' THEN sd.sales_amount_inr ELSE 0 END)) AS cancelled_value,
          SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.cogm ELSE 0 END) AS total_cogm,
          COUNT(*) AS transaction_count
        FROM sales_data_raw sd
        JOIN billing_types bt ON sd.billing_type = bt.billing_type
        WHERE sd.batch_id = $1
        GROUP BY to_char(sd.invoice_date, 'YYYY-MM')` 
    }
  ];

  // Get total raw rows in batch for diagnostic log comparison
  let totalRawRows = 0;
  try {
    const rawCountRes = await dbGet('SELECT COUNT(*) as count FROM sales_data_raw WHERE batch_id = $1', [batchId]);
    totalRawRows = parseInt(rawCountRes?.count || 0, 10);
  } catch (err) {
    console.error(`[Aggregates] Failed to fetch total raw rows count for batch ${batchId}:`, err.message);
  }

  for (const dim of dimensions) {
    try {
      const rows = await dbAll(dim.sql, [batchId]);
      
      // Special check: Log the included state dimension row count vs total batch count
      if (dim.type === 'state') {
        const aggregatedTxCount = rows.reduce((sum, r) => sum + parseInt(r.transaction_count || 0, 10), 0);
        console.log(`[Aggregates] State dimension: ${rows.length} states computed. Covered ${aggregatedTxCount} of ${totalRawRows} total batch rows.`);
      }

      for (const row of rows) {
        const netExternal = (row.gross_sales || 0) - (row.returns_value || 0) - (row.cancelled_value || 0);
        await dbRun(`
          INSERT INTO dataset_aggregates 
            (batch_id, fy_code, dimension_type, dimension_value, gross_sales, returns_value, cancelled_value, net_external_sales, total_cogm, transaction_count)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (batch_id, dimension_type, dimension_value) DO UPDATE SET
            gross_sales = EXCLUDED.gross_sales,
            returns_value = EXCLUDED.returns_value,
            cancelled_value = EXCLUDED.cancelled_value,
            net_external_sales = EXCLUDED.net_external_sales,
            total_cogm = EXCLUDED.total_cogm,
            transaction_count = EXCLUDED.transaction_count,
            computed_at = NOW()
        `, [
          batchId, 
          fyCode, 
          dim.type, 
          row.dim_value, 
          row.gross_sales || 0, 
          row.returns_value || 0, 
          row.cancelled_value || 0, 
          netExternal, 
          row.total_cogm || 0, 
          row.transaction_count || 0
        ]);
      }
    } catch (dimErr) {
      console.error(`[Aggregates] Failed to pre-compute and store aggregates for dimension "${dim.type}":`, dimErr.message);
    }
  }

  console.log(`[Aggregates] Pre-computed stats successfully stored for batch ${batchId} (${fyCode})`);
}
