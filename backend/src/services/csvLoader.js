import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { dbRun, dbAll, dbTransaction } from '../database.js';
import { initializeDatabase } from '../scripts/initDb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_CSV_PATH = join(__dirname, '..', '..', 'sample_sap_sales.csv');

// Quote-aware CSV parser
export function parseCSV(text) {
  const lines = [];
  let row = [""];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',') {
      if (inQuotes) {
        row[row.length - 1] += ',';
      } else {
        row.push("");
      }
    } else if (char === '\r' || char === '\n') {
      if (inQuotes) {
        row[row.length - 1] += char;
      } else {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        lines.push(row);
        row = [""];
      }
    } else {
      row[row.length - 1] += char;
    }
  }
  if (row.length > 1 || row[0] !== "") {
    lines.push(row);
  }
  return lines;
}

/**
 * Import a CSV file into the PostgreSQL database
 */
export async function importCSV(filePath, originalFileName) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV file not found at ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const rows = parseCSV(content);

  if (rows.length < 2) {
    throw new Error('CSV file does not contain enough data.');
  }

  const headers = rows[0].map(h => h.trim().toLowerCase());
  const findIndex = (fields) => headers.findIndex(h => fields.includes(h));

  const idxInvoice = findIndex(['invoice id', 'invoice number', 'billing document', 'invoiceno', 'invoice_id', 'invoiceid']);
  const idxDate = findIndex(['date', 'invoice date', 'billing date', 'date']);
  const idxBillingType = findIndex(['billing type', 'type', 'billing_type', 'billingtype']);
  const idxBillingDesc = findIndex(['billing type description', 'type description', 'billing_type_description', 'billingtypedescription', 'description']);
  const idxChannel = findIndex(['distribution channel', 'channel', 'distribution_channel', 'distributionchannel']);
  const idxCustId = findIndex(['customer id', 'customer code', 'customer_id', 'customerid']);
  const idxCustName = findIndex(['customer name', 'customer', 'customer_name', 'customername']);
  const idxDivision = findIndex(['division', 'division']);
  const idxCrop = findIndex(['crop', 'crop']);
  const idxVariety = findIndex(['variety', 'variety']);
  const idxSalesUnit = findIndex(['sales unit', 'unit', 'sales_unit', 'salesunit']);
  const idxOwnTrade = findIndex(['own/trade', 'own / trade', 'own_trade', 'owntrade']);
  const idxMaterialCode = findIndex(['material code', 'material', 'material_code', 'materialcode']);
  const idxMaterialDesc = findIndex(['material description', 'material_description', 'materialdescription']);
  const idxSeason = findIndex(['season code', 'season', 'season_code', 'seasoncode']);
  const idxState = findIndex(['state', 'state']);
  const idxTerritory = findIndex(['territory', 'territory']);
  const idxAM = findIndex(['am', 'area manager', 'am']);
  const idxRBM = findIndex(['rbm', 'regional business manager', 'rbm']);
  const idxDBM = findIndex(['dbm', 'district business manager', 'dbm']);
  const idxQty = findIndex(['quantity', 'qty', 'quantity']);
  const idxPrice = findIndex(['sales price', 'price', 'sales_price', 'salesprice']);
  const idxAmount = findIndex(['amount inr', 'sales amount inr', 'amount', 'revenue', 'sales_amount_inr', 'salesamountinr']);
  const idxCOGM = findIndex(['cogm', 'cogm']);

  // Insert upload batch row in PostgreSQL
  const uploadBatchRes = await dbRun(
    'INSERT INTO upload_batches (file_name, uploaded_at, source_row_count, rows_imported, rows_rejected) VALUES ($1, $2, $3, 0, 0) RETURNING batch_id',
    [originalFileName, new Date().toISOString(), rows.length - 1]
  );
  const batchId = uploadBatchRes.lastID || (uploadBatchRes.rows && uploadBatchRes.rows[0] ? uploadBatchRes.rows[0].batch_id : null);

  let importedCount = 0;
  let rejectedCount = 0;

  // We keep in-memory maps during execution to reduce DB queries/inserts
  const employeeMap = new Map(); // name -> ID
  const customerSet = new Set();
  const materialSet = new Set();
  const territoryMap = new Map(); // "state|territory" -> ID

  // Helper to resolve or create employee
  async function getEmployeeId(name, role) {
    if (!name || name.trim() === '') return null;
    const cleanName = name.trim();
    const mapKey = `${cleanName}|${role}`;
    
    if (employeeMap.has(mapKey)) {
      return employeeMap.get(mapKey);
    }
    
    // Check DB
    const existing = await dbAll('SELECT employee_id FROM employees WHERE employee_name = $1 AND role = $2', [cleanName, role]);
    if (existing.length > 0) {
      employeeMap.set(mapKey, existing[0].employee_id);
      return existing[0].employee_id;
    }
    
    // Generate new ID
    const countRes = await dbAll('SELECT COUNT(*) as count FROM employees');
    const empId = `E-${100 + parseInt(countRes[0].count, 10)}`;
    await dbRun('INSERT INTO employees (employee_id, employee_name, role) VALUES ($1, $2, $3)', [empId, cleanName, role]);
    employeeMap.set(mapKey, empId);
    return empId;
  }

  // Populate maps from database to avoid conflicts
  const currentEmployees = await dbAll('SELECT employee_id, employee_name, role FROM employees');
  currentEmployees.forEach(e => employeeMap.set(`${e.employee_name}|${e.role}`, e.employee_id));

  const currentCustomers = await dbAll('SELECT customer_id FROM customers');
  currentCustomers.forEach(c => customerSet.add(c.customer_id));

  const currentMaterials = await dbAll('SELECT material_code FROM materials');
  currentMaterials.forEach(m => materialSet.add(m.material_code));

  const currentTerritories = await dbAll('SELECT territory_id, state, territory FROM territories');
  currentTerritories.forEach(t => territoryMap.set(`${t.state.toLowerCase()}|${t.territory.toLowerCase()}`, t.territory_id));

  await dbTransaction(async () => {
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length < 2 || (row.length === 1 && row[0] === '')) {
        continue; // Skip blank lines
      }

      try {
        const invoiceId = idxInvoice !== -1 && row[idxInvoice] ? row[idxInvoice].trim() : null;
        const dateRaw = idxDate !== -1 && row[idxDate] ? row[idxDate].trim() : null;
        
        if (!invoiceId || !dateRaw) {
          throw new Error('Missing invoice ID or Date');
        }

        // Validate formats
        let date = dateRaw;
        // Standardize YYYY-MM-DD
        if (date.includes('/')) {
          const parts = date.split('/');
          if (parts[2]?.length === 4) {
            date = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
          }
        }

        const billingType = idxBillingType !== -1 && row[idxBillingType] ? row[idxBillingType].trim() : 'F2';
        const billingDesc = idxBillingDesc !== -1 && row[idxBillingDesc] ? row[idxBillingDesc].trim() : 'Standard Invoice';
        const distChannel = idxChannel !== -1 && row[idxChannel] ? row[idxChannel].trim() : 'Dealer';
        const customerId = idxCustId !== -1 && row[idxCustId] ? row[idxCustId].trim() : 'CUST-000';
        const customerName = idxCustName !== -1 && row[idxCustName] ? row[idxCustName].trim() : 'Unknown Customer';
        
        const division = idxDivision !== -1 && row[idxDivision] ? row[idxDivision].trim().toUpperCase() : 'VG';
        const crop = idxCrop !== -1 && row[idxCrop] ? row[idxCrop].trim() : 'Unknown Crop';
        const variety = idxVariety !== -1 && row[idxVariety] ? row[idxVariety].trim() : 'Unknown Variety';
        const salesUnit = idxSalesUnit !== -1 && row[idxSalesUnit] ? row[idxSalesUnit].trim() : 'Packets';
        const ownTrade = idxOwnTrade !== -1 && row[idxOwnTrade] ? row[idxOwnTrade].trim() : 'Own';
        
        const materialCode = idxMaterialCode !== -1 && row[idxMaterialCode] ? row[idxMaterialCode].trim() : 'MAT-000';
        const materialDesc = idxMaterialDesc !== -1 && row[idxMaterialDesc] ? row[idxMaterialDesc].trim() : 'Unknown Material';

        const state = idxState !== -1 && row[idxState] ? row[idxState].trim() : 'Unknown State';
        const territory = idxTerritory !== -1 && row[idxTerritory] ? row[idxTerritory].trim() : 'Unknown Territory';
        const amName = idxAM !== -1 && row[idxAM] ? row[idxAM].trim() : null;
        const rbmName = idxRBM !== -1 && row[idxRBM] ? row[idxRBM].trim() : null;
        const dbmName = idxDBM !== -1 && row[idxDBM] ? row[idxDBM].trim() : null;

        const qty = idxQty !== -1 ? parseInt(row[idxQty], 10) || 0 : 0;
        const salesPrice = idxPrice !== -1 ? parseFloat(row[idxPrice]) || 0 : 0;
        const salesAmountINR = idxAmount !== -1 ? parseFloat(row[idxAmount]) || (qty * salesPrice) : (qty * salesPrice);
        const cogm = idxCOGM !== -1 ? parseFloat(row[idxCOGM]) || (salesAmountINR * 0.7) : (salesAmountINR * 0.7);
        const seasonCode = idxSeason !== -1 && row[idxSeason] ? row[idxSeason].trim() : 'N/A';

        // Extract FY Code Dynamically (e.g. FY2425, FY2526, etc. based on Indian Financial Year Apr-Mar)
        let fyCode = 'FY2627';
        const parsedDate = new Date(date);
        if (!isNaN(parsedDate.getTime())) {
          const yr = parsedDate.getFullYear();
          const mo = parsedDate.getMonth(); // 0-11
          if (mo >= 3) {
            const startYr = yr % 100;
            const endYr = (yr + 1) % 100;
            fyCode = `FY${startYr.toString().padStart(2, '0')}${endYr.toString().padStart(2, '0')}`;
          } else {
            const startYr = (yr - 1) % 100;
            const endYr = yr % 100;
            fyCode = `FY${startYr.toString().padStart(2, '0')}${endYr.toString().padStart(2, '0')}`;
          }
        }

        // Dynamically seed Financial Year in database to prevent Foreign Key constraint violation
        await dbRun('INSERT INTO financial_years (fy_code, fy_name) VALUES ($1, $2) ON CONFLICT (fy_code) DO NOTHING', [
          fyCode, 
          `Financial Year 20${fyCode.substring(2,4)}-${fyCode.substring(4,6)}`
        ]);

        // Insert lookup data
        if (!customerSet.has(customerId)) {
          await dbRun('INSERT INTO customers (customer_id, customer_name, dist_channel) VALUES ($1, $2, $3) ON CONFLICT (customer_id) DO NOTHING', [customerId, customerName, distChannel]);
          customerSet.add(customerId);
        }

        if (!materialSet.has(materialCode)) {
          await dbRun(
            'INSERT INTO materials (material_code, material_desc, division, crop, variety, sales_unit, own_trade) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (material_code) DO NOTHING',
            [materialCode, materialDesc, division, crop, variety, salesUnit, ownTrade]
          );
          materialSet.add(materialCode);
        }

        // Insert Billing Type details
        await dbRun(
          'INSERT INTO billing_types (billing_type, billing_desc, classification) VALUES ($1, $2, $3) ON CONFLICT (billing_type) DO NOTHING',
          [billingType, billingDesc, billingType === 'F2' ? 'GROSS_SALE' : billingType === 'RE' ? 'RETURN' : billingType === 'S1' ? 'CANCELLED' : 'STOCK_TRANSFER']
        );

        // Resolve Sales Hierarchy Employees
        const amId = await getEmployeeId(amName, 'AM');
        const rbmId = await getEmployeeId(rbmName, 'RBM');
        const dbmId = await getEmployeeId(dbmName, 'DBM');
        const inchargeId = dbmId; // Territory incharge is district manager

        // Resolve Territory ID
        const terrKey = `${state.toLowerCase()}|${territory.toLowerCase()}`;
        let territoryId;
        if (territoryMap.has(terrKey)) {
          territoryId = territoryMap.get(terrKey);
        } else {
          const terrRes = await dbRun(
            `INSERT INTO territories (state, territory, territory_incharge_id, am_id, rbm_id, dbm_id) 
             VALUES ($1, $2, $3, $4, $5, $6) 
             ON CONFLICT (state, territory) 
             DO UPDATE SET territory = EXCLUDED.territory 
             RETURNING territory_id`,
            [state, territory, inchargeId, amId, rbmId, dbmId]
          );
          territoryId = terrRes.lastID || (terrRes.rows && terrRes.rows[0] ? terrRes.rows[0].territory_id : null);
          territoryMap.set(terrKey, territoryId);
        }

        // Insert Transaction Sales Data
        await dbRun(
          `INSERT INTO sales_data (
            invoice_id, invoice_date, billing_type, customer_id, material_code, 
            territory_id, qty, sales_unit, sales_amount_inr, cogm, season_code, fy_code, batch_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (invoice_id) DO UPDATE SET
            invoice_date = EXCLUDED.invoice_date,
            billing_type = EXCLUDED.billing_type,
            customer_id = EXCLUDED.customer_id,
            material_code = EXCLUDED.material_code,
            territory_id = EXCLUDED.territory_id,
            qty = EXCLUDED.qty,
            sales_unit = EXCLUDED.sales_unit,
            sales_amount_inr = EXCLUDED.sales_amount_inr,
            cogm = EXCLUDED.cogm,
            season_code = EXCLUDED.season_code,
            fy_code = EXCLUDED.fy_code,
            batch_id = EXCLUDED.batch_id`,
          [invoiceId, date, billingType, customerId, materialCode, territoryId, qty, salesUnit, salesAmountINR, cogm, seasonCode, fyCode, batchId]
        );

        importedCount++;
      } catch (err) {
        rejectedCount++;
        // Log rejected row in DB
        await dbRun(
          'INSERT INTO import_rejected_rows (batch_id, reject_reason, raw_row) VALUES ($1, $2, $3)',
          [batchId, err.message, JSON.stringify(row)]
        );
      }
    }

    // Update upload batch totals
    await dbRun(
      'UPDATE upload_batches SET rows_imported = $1, rows_rejected = $2 WHERE batch_id = $3',
      [importedCount, rejectedCount, batchId]
    );
  });

  return {
    batchId,
    rowsImported: importedCount,
    rowsRejected: rejectedCount
  };
}

/**
 * Initialize PostgreSQL schemas on server startup
 */
export async function seedDatabaseIfEmpty() {
  await initializeDatabase();
  console.log('Database initialized. Startup database seeding is disabled; all stats will load dynamically from user uploads.');
}
