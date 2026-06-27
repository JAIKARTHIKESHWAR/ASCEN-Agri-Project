import { dbAll } from './src/database.js';

const bt = await dbAll("SELECT billing_type, COUNT(*) as cnt FROM sales_data_raw GROUP BY billing_type ORDER BY cnt DESC");
console.log('\n=== billing_type distribution ===');
console.table(bt);

const types = await dbAll("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='sales_data_raw' AND column_name IN ('invoice_date','sales_amount_inr','qty','cogm','sales_price')");
console.log('\n=== column data types ===');
console.table(types);

const agg = await dbAll("SELECT COUNT(*) total_rows, SUM(sales_amount_inr) total_sales, MIN(invoice_date) min_date, MAX(invoice_date) max_date FROM sales_data_raw WHERE is_active=TRUE");
console.log('\n=== aggregation sanity check ===');
console.table(agg);

const div = await dbAll("SELECT division, COUNT(*) cnt FROM sales_data_raw GROUP BY division ORDER BY cnt DESC");
console.log('\n=== division distribution ===');
console.table(div);

process.exit(0);
