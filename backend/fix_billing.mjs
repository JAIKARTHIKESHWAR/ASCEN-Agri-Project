// Fix billing_type classifications: ZF2=GROSS_SALE, ZRE/ZIRE=RETURN, ZS1=CANCELLED, ZSTO/ZIF2/IPT=STOCK_TRANSFER
import { dbRun, dbAll } from './src/database.js';

const corrections = [
  ['ZF2',  'ACSEN Gross Invoice',              'GROSS_SALE'],
  ['ZIF2', 'ACSEN Internal Invoice',           'GROSS_SALE'],
  ['ZRE',  'ACSEN Credit for Returns',         'RETURN'],
  ['ZIRE', 'ACSEN IPT Credit for Returns',     'RETURN'],
  ['ZS1',  'ACSEN Cancelled Invoice',          'CANCELLED'],
  ['ZSTO', 'ACSEN Stock Transfer Order',       'STOCK_TRANSFER'],
  ['IPT',  'Inter-Plant Transfer',             'STOCK_TRANSFER'],
  ['F2',   'Standard Invoice',                 'GROSS_SALE'],
  ['RE',   'Credit for Returns',               'RETURN'],
  ['S1',   'Cancelled Invoice',                'CANCELLED'],
];

console.log('Applying billing_type classification corrections...');
for (const [code, desc, cls] of corrections) {
  await dbRun(
    "INSERT INTO billing_types (billing_type, billing_desc, classification) VALUES ($1,$2,$3) ON CONFLICT (billing_type) DO UPDATE SET billing_desc=EXCLUDED.billing_desc, classification=EXCLUDED.classification",
    [code, desc, cls]
  );
  console.log(`  ${code.padEnd(6)} → ${cls}`);
}

const all = await dbAll('SELECT billing_type, classification FROM billing_types ORDER BY billing_type');
console.log('\nFinal billing_types table:');
console.table(all);

// Verify: how much revenue is now in GROSS_SALE?
const check = await dbAll(`
  SELECT bt.classification, COUNT(*) rows, SUM(sdr.sales_amount_inr) revenue
  FROM sales_data_raw sdr
  JOIN billing_types bt ON sdr.billing_type = bt.billing_type
  GROUP BY bt.classification ORDER BY revenue DESC
`);
console.log('\nRevenue by classification after fix:');
console.table(check);

process.exit(0);
