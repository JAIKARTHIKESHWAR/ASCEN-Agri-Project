// Final validation: simulate the exact KPI query used by getSummary
import { dbGet, dbAll } from './src/database.js';

const kpi = await dbGet(`
  SELECT
    SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.sales_amount_inr ELSE 0 END) AS gross_sales,
    SUM(CASE WHEN bt.classification='RETURN'     THEN sd.sales_amount_inr ELSE 0 END) AS returns_value,
    SUM(CASE WHEN bt.classification='CANCELLED'  THEN sd.sales_amount_inr ELSE 0 END) AS cancelled_value,
    SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.cogm ELSE 0 END) AS total_cogm
  FROM sales_data sd
  JOIN billing_types bt ON sd.billing_type = bt.billing_type
  JOIN materials m ON sd.material_code = m.material_code
  JOIN territories t ON sd.territory_id = t.territory_id
  JOIN customers c ON sd.customer_id = c.customer_id
`);
const toINR = n => '₹' + (parseFloat(n)||0).toLocaleString('en-IN', {maximumFractionDigits:0});
console.log('\n=== Dashboard KPI Validation ===');
console.log('Gross Invoice Sales :', toINR(kpi.gross_sales));
console.log('Sales Returns       :', toINR(kpi.returns_value));
console.log('Cancelled Invoices  :', toINR(kpi.cancelled_value));
console.log('Net Sales           :', toINR((kpi.gross_sales||0)-(kpi.returns_value||0)-(kpi.cancelled_value||0)));
console.log('COGM                :', toINR(kpi.total_cogm));

const trend = await dbAll(`
  SELECT to_char(sd.invoice_date,'YYYY-MM') AS m, SUM(sd.sales_amount_inr) rev
  FROM sales_data sd
  JOIN billing_types bt ON sd.billing_type=bt.billing_type
  WHERE bt.classification='GROSS_SALE'
  GROUP BY m ORDER BY m LIMIT 5
`);
console.log('\n=== Monthly Trend (first 5 months) ===');
console.table(trend);

const divs = await dbAll(`
  SELECT m.division, SUM(sd.sales_amount_inr) rev
  FROM sales_data sd
  JOIN billing_types bt ON sd.billing_type=bt.billing_type
  JOIN materials m ON sd.material_code=m.material_code
  WHERE bt.classification='GROSS_SALE'
  GROUP BY m.division ORDER BY rev DESC
`);
console.log('\n=== Division Split ===');
console.table(divs);

process.exit(0);
