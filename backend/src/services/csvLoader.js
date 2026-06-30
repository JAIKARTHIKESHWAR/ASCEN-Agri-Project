import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { dbRun, dbAll, dbGet, dbTransaction } from '../database.js';
import { initializeDatabase } from '../scripts/initDb.js';
import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_CSV_PATH = join(__dirname, '..', '..', 'sample_sap_sales.csv');

// ─────────────────────────────────────────────────────────────────────────────
// NORMALISATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flatten a header string to lowercase with no spaces/underscores/dashes/dots/parens.
 * "Billing Type Descrp." → "billingtypedescrp"
 * "Sales Amt. INR"       → "salesamtinr"
 */
function normalizeHeader(header = '') {
  return String(header)
    .trim()
    .toLowerCase()
    .replace(/[\s_\-/\.\(\)]+/g, ''); // strips spaces, _, -, /, ., (, )
}

/**
 * Canonical column aliases — maps ANY Excel/CSV header variant to a stable internal key.
 * normalizeHeader() is applied first: lowercase, no spaces/underscores/dashes/dots/parens.
 */
const COLUMN_ALIASES = {
  // ── Invoice ────────────────────────────────────────────────────────────────
  invoiceid: 'invoice_id',
  invoiceno: 'invoice_id',
  invoicenumber: 'invoice_id',
  billingdocument: 'invoice_id',
  billingdoc: 'invoice_id',
  billingdocno: 'invoice_id',
  billingdocnumber: 'invoice_id',

  // ── Date ──────────────────────────────────────────────────────────────────
  invoicedate: 'invoice_date',
  billingdate: 'invoice_date',
  date: 'invoice_date',
  documentdate: 'invoice_date',

  // ── Billing type ──────────────────────────────────────────────────────────
  billingtype: 'billing_type',
  type: 'billing_type',
  billingtypedescrp: 'billing_type_desc',
  billingtypedescription: 'billing_type_desc',
  billingtypedesc: 'billing_type_desc',
  typedescription: 'billing_type_desc',
  typedesc: 'billing_type_desc',
  description: 'billing_type_desc',

  // ── Distribution channel & Division ────────────────────────────────────────
  distributionchannel: 'distribution_channel',
  distchannel: 'distribution_channel',
  channel: 'distribution_channel',
  division: 'division',
  div: 'division',

  // ── Customer ──────────────────────────────────────────────────────────────
  customerid: 'customer_no',
  customercode: 'customer_no',
  customerno: 'customer_no',   // ← Excel: "Customer No."
  customernumber: 'customer_no',
  custno: 'customer_no',
  custid: 'customer_no',
  customername: 'customer_name',
  custname: 'customer_name',
  customer: 'customer_name',

  // ── Crop / Material ───────────────────────────────────────────────────────
  crop: 'crop_name',
  cropname: 'crop_name',          // ← Excel: "Crop Name"
  variety: 'variety_name',
  varietyname: 'variety_name',       // ← Excel: "Variety Name"
  materialcode: 'material_code',
  matcode: 'material_code',
  material: 'material_code',
  materialdescription: 'material_name',
  materialname: 'material_name', // ← Excel: "Material Name"
  materialdesc: 'material_name',
  matdesc: 'material_name',
  matname: 'material_name',

  // ── Sales unit / own-trade ────────────────────────────────────────────────
  salesunit: 'sales_unit',
  sunit: 'sales_unit',
  unit: 'sales_unit',
  uom: 'sales_unit',
  owntrade: 'own_trade',
  ownortrade: 'own_trade',
  owntradecategory: 'own_trade',
  owntradecat: 'own_trade',

  // ── Territory ─────────────────────────────────────────────────────────────
  state: 'state',
  statename: 'state',
  territory: 'territory_name',
  territoryname: 'territory_name',     // ← Excel: "Territory Name"
  terrname: 'territory_name',
  territoryid: 'territory_id_excel',
  terrid: 'territory_id_excel',

  // ── Sales hierarchy ───────────────────────────────────────────────────────
  tiid: 'ti_id',
  tiname: 'ti_name',
  amid: 'am_id',
  amname: 'am_name',
  am: 'am_name',
  areamanager: 'am_name',
  areaman: 'am_name',
  rbmid: 'rbm_id',
  rbmname: 'rbm_name',
  rbm: 'rbm_name',
  regionalbusinessmanager: 'rbm_name',
  dbmid: 'dbm_id',
  dbmname: 'dbm_name',
  dbm: 'dbm_name',
  districtbusinessmanager: 'dbm_name',

  // ── Metrics ───────────────────────────────────────────────────────────────
  quantity: 'qty',
  qty: 'qty',
  salesprice: 'sales_price',
  salespriceinr: 'sales_price_inr',   // ← Excel: "Sales Price INR"
  salespriceperinr: 'sales_price_inr',
  price: 'sales_price',
  rate: 'sales_price',
  salesamount: 'sales_amount',
  salesamountinr: 'sales_amount_inr',
  salesamt: 'sales_amount_inr',
  salesamtinr: 'sales_amount_inr',
  amountinr: 'sales_amount_inr',
  amount: 'sales_amount_inr',
  revenue: 'sales_amount_inr',
  netsalesinr: 'sales_amount_inr',
  netsales: 'sales_amount_inr',
  cogm: 'cogm',
  costofgoodsmanufactured: 'cogm',
  cogs: 'cogm',

  // ── Season / FY ───────────────────────────────────────────────────────────
  seasoncode: 'season_code',
  season: 'season_code',
  fycode: 'fy_code',
  fy: 'fy_code',
  financialyear: 'fy_code',
  fiscalyear: 'fy_code',
  year: 'fiscal_year', // Excel "Year" column = raw calendar year number

  // ── Extra Document Details ───────────────────────────────────────────────
  plant: 'plant',
  storagelocation: 'storage_location',
  salesorderno: 'sales_order_no',
  customerreference: 'customer_reference',
  indentno: 'indent_no',
  iptsrrequestno: 'ipt_sr_request_no',
  iptsrrequestdate: 'ipt_sr_request_date',
  accdocno: 'accounting_doc_no',
  lineitemno: 'line_item_no',
  batchno: 'batch_no',
  expirydate: 'expiry_date',
  currency: 'currency',
  exchangerate: 'exchange_rate',
  basecurrencyinr: 'base_currency_inr',
  createdby: 'created_by'
};

/**
 * Convert an Excel serial date (45539), a JS Date object, or any string date
 * to a YYYY-MM-DD string. Returns null on failure.
 */
function parseExcelDate(value) {
  if (value === null || value === undefined || value === '') return null;

  // Already a proper JS Date (cellDates: true)
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const tzOffset = value.getTimezoneOffset() * 60000;
    return new Date(value.getTime() - tzOffset).toISOString().split('T')[0];
  }

  // Numeric serial — Excel epoch is Dec 30, 1899 UTC
  if (typeof value === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(excelEpoch.getTime() + value * 86400000).toISOString().split('T')[0];
  }

  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;

    // Pure number string → treat as Excel serial
    if (/^\d+$/.test(s) && Number(s) > 1000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      return new Date(excelEpoch.getTime() + Number(s) * 86400000).toISOString().split('T')[0];
    }

    // DD/MM/YYYY
    const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[1].padStart(2, '0')}-${dmy[2].padStart(2, '0')}`;

    // MM-DD-YYYY or YYYY-MM-DD (native Date handles both)
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }

  return null;
}

/**
 * Parse a number from a cell that might be "1,23,456.78", 123456, or " 456 ".
 */
function parseNumeric(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).replace(/,/g, '').trim());
  return isNaN(n) ? 0 : n;
}

/**
 * Convert a raw calendar year value to an Indian Financial Year code.
 * Handles:
 *   2024        → "FY2425"    (number)
 *   "2024"      → "FY2425"    (string)
 *   "FY2425"    → "FY2425"    (already correct, pass-through)
 *   45539 (date serial) → derived from invoice_date instead (return null so caller falls back)
 */
function deriveFinancialYear(value) {
  if (!value && value !== 0) return null;
  const s = String(value).trim();

  // Already in FY format
  if (/^FY\d{4}$/i.test(s)) return s.toUpperCase();

  // Pure 4-digit year like 2024 or 2025
  const year = parseInt(s, 10);
  if (!isNaN(year) && year > 1900 && year < 2200) {
    const startYr = year % 100;
    const endYr = (year + 1) % 100;
    return `FY${String(startYr).padStart(2, '0')}${String(endYr).padStart(2, '0')}`;
  }

  return null; // caller will derive from invoice_date
}



// ─────────────────────────────────────────────────────────────────────────────
// CSV PARSER (quote-aware)
// ─────────────────────────────────────────────────────────────────────────────
export function parseCSV(text) {
  const lines = [];
  let row = [''];
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
      if (inQuotes) row[row.length - 1] += ',';
      else row.push('');
    } else if (char === '\r' || char === '\n') {
      if (inQuotes) {
        row[row.length - 1] += char;
      } else {
        if (char === '\r' && nextChar === '\n') i++;
        lines.push(row);
        row = [''];
      }
    } else {
      row[row.length - 1] += char;
    }
  }
  if (row.length > 1 || row[0] !== '') lines.push(row);
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN IMPORTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Import a CSV/Excel file into the PostgreSQL database.
 * Both paths produce a unified array-of-objects [{normalizedKey: value, …}].
 */
export async function importCSV(filePath, originalFileName, fileHash) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at ${filePath}`);
  }

  // ── Step 1: Parse file into normalised row objects ──────────────────────────
  let normalizedRows = [];  // [{invoice_id, invoice_date, qty, …}]
  const lowercaseName = originalFileName.toLowerCase();
  const isExcel = lowercaseName.endsWith('.xlsx') || lowercaseName.endsWith('.xls');

  if (isExcel) {
    console.log(`Parsing Excel file using SheetJS: ${originalFileName}`);
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // sheet_to_json with header:1 gives us [[headerRow...], [dataRow...], ...]
    // We use this to handle header normalisation ourselves
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    if (rawRows.length < 2) throw new Error('Excel file does not contain enough data.');

    const headerRow = rawRows[0];
    // Build a mapping: column_index → canonical_key
    const colMap = {};
    headerRow.forEach((h, idx) => {
      const normalized = normalizeHeader(h);
      const canonical = COLUMN_ALIASES[normalized];
      if (canonical) colMap[idx] = canonical;
      else colMap[idx] = normalized; // keep unknown cols as-is
    });

    // Log headers for diagnostics
    console.log('[Excel] Detected headers:', headerRow.map((h, i) => `${h} → ${colMap[i]}`).join(' | '));

    for (let i = 1; i < rawRows.length; i++) {
      const raw = rawRows[i];
      if (!raw || raw.every(c => c === '' || c === null || c === undefined)) continue;

      const obj = {};
      raw.forEach((cell, idx) => {
        const key = colMap[idx];
        if (key) obj[key] = cell;
      });
      normalizedRows.push(obj);
    }

    // Log first parsed row so you can verify in nodemon console
    if (normalizedRows.length > 0) {
      console.log('[Excel] First parsed row:', JSON.stringify(normalizedRows[0], null, 2));
    }

  } else {
    // CSV path: already a 2-D array, convert to objects via header row
    console.log(`Parsing CSV file: ${originalFileName}`);
    const content = fs.readFileSync(filePath, 'utf-8');
    const rawRows = parseCSV(content);

    if (rawRows.length < 2) throw new Error('CSV file does not contain enough data.');

    const headerRow = rawRows[0].map(h => h.trim());
    const colMap = {};
    headerRow.forEach((h, idx) => {
      const normalized = normalizeHeader(h);
      const canonical = COLUMN_ALIASES[normalized];
      colMap[idx] = canonical || normalized;
    });

    for (let i = 1; i < rawRows.length; i++) {
      const raw = rawRows[i];
      if (raw.length < 2 || (raw.length === 1 && raw[0] === '')) continue;
      const obj = {};
      raw.forEach((cell, idx) => {
        const key = colMap[idx];
        if (key) obj[key] = cell;
      });
      normalizedRows.push(obj);
    }
  }

  if (normalizedRows.length === 0) throw new Error('File contains no data rows after parsing.');

  // ── Step 2: Create upload batch record ────────────────────────────────────
  const uploadBatchRes = await dbRun(
    'INSERT INTO upload_batches (file_name, uploaded_at, source_row_count, rows_imported, rows_rejected, file_hash, is_active) VALUES ($1, $2, $3, 0, 0, $4, TRUE) RETURNING batch_id',
    [originalFileName, new Date().toISOString(), normalizedRows.length, fileHash || null]
  );
  const batchId = uploadBatchRes.lastID || (uploadBatchRes.rows && uploadBatchRes.rows[0] ? uploadBatchRes.rows[0].batch_id : null);

  let importedCount = 0;
  let rejectedCount = 0;

  // In-memory caches to minimise DB round-trips
  const employeeMap = new Map();
  const customerSet = new Set();
  const materialSet = new Set();
  const territoryMap = new Map();

  async function getEmployeeId(name, role) {
    if (!name || !String(name).trim()) return null;
    const cleanName = String(name).trim();
    const mapKey = `${cleanName}|${role}`;
    if (employeeMap.has(mapKey)) return employeeMap.get(mapKey);

    const existing = await dbAll('SELECT employee_id FROM employees WHERE employee_name = $1 AND role = $2', [cleanName, role]);
    if (existing.length > 0) {
      employeeMap.set(mapKey, existing[0].employee_id);
      return existing[0].employee_id;
    }
    const countRes = await dbAll('SELECT COUNT(*) as count FROM employees');
    const empId = `E-${100 + parseInt(countRes[0].count, 10)}`;
    await dbRun('INSERT INTO employees (employee_id, employee_name, role) VALUES ($1, $2, $3)', [empId, cleanName, role]);
    employeeMap.set(mapKey, empId);
    return empId;
  }

  // Pre-load caches
  (await dbAll('SELECT employee_id, employee_name, role FROM employees')).forEach(e =>
    employeeMap.set(`${e.employee_name}|${e.role}`, e.employee_id));
  (await dbAll('SELECT customer_id FROM customers')).forEach(c => customerSet.add(c.customer_id));
  (await dbAll('SELECT material_code FROM materials')).forEach(m => materialSet.add(m.material_code));
  (await dbAll('SELECT territory_id, state, territory FROM territories')).forEach(t =>
    territoryMap.set(`${t.state.toLowerCase()}|${t.territory.toLowerCase()}`, t.territory_id));

  // ── Step 3: Insert rows ───────────────────────────────────────────────────
  await dbTransaction(async () => {
    for (const row of normalizedRows) {
      try {
        // ── Mandatory fields ──────────────────────────────────────────────
        const invoiceId = row.invoice_id ? String(row.invoice_id).trim() : null;
        const dateRaw = row.invoice_date;

        if (!invoiceId) throw new Error('Missing invoice ID');
        
        let date = parseExcelDate(dateRaw);
        let fyCode;
        if (!date) {
          date = '1970-01-01'; // Fallback dummy date for database NOT NULL constraint
          fyCode = 'UNKNOWN';
        } else {
          // ── FY Code: prefer explicit value → deriveFinancialYear → derive from date ──
          fyCode = deriveFinancialYear(row.fy_code);
          if (!fyCode) {
            const pd = new Date(date);
            if (!isNaN(pd.getTime())) {
              const yr = pd.getFullYear();
              const mo = pd.getMonth(); // 0-based index
              const startYr = mo >= 3 ? yr % 100 : (yr - 1) % 100;
              const endYr = mo >= 3 ? (yr + 1) % 100 : yr % 100;
              fyCode = `FY${String(startYr).padStart(2, '0')}${String(endYr).padStart(2, '0')}`;
            } else {
              fyCode = 'UNKNOWN';
            }
          }
        }

        // ── String fields ─────────────────────────────────────────────────
        const billingType = row.billing_type ? String(row.billing_type).trim() : 'F2';
        const billingDesc = row.billing_type_desc ? String(row.billing_type_desc).trim() : 'Standard Invoice';
        const distChannel = row.distribution_channel ? String(row.distribution_channel).trim() : 'Dealer';
        const customerId = row.customer_no ? String(row.customer_no).trim() : 'CUST-000';
        const customerName = row.customer_name ? String(row.customer_name).trim() : 'Unknown Customer';
        const division = row.division ? String(row.division).trim().toUpperCase() : 'VG';
        const crop = row.crop_name ? String(row.crop_name).trim() : 'Unknown Crop';
        const variety = row.variety_name ? String(row.variety_name).trim() : 'Unknown Variety';
        const salesUnit = row.sales_unit ? String(row.sales_unit).trim() : 'Packets';
        const ownTrade = row.own_trade ? String(row.own_trade).trim() : 'Own';
        const materialCode = row.material_code ? String(row.material_code).trim() : 'MAT-000';
        const materialDesc = row.material_name ? String(row.material_name).trim() : 'Unknown Material';
        const state = row.state ? String(row.state).trim() : 'Unknown State';
        const territory = row.territory_name ? String(row.territory_name).trim() : 'Unknown Territory';
        const amName = row.am_name ? String(row.am_name).trim() : null;
        const rbmName = row.rbm_name ? String(row.rbm_name).trim() : null;
        const dbmName = row.dbm_name ? String(row.dbm_name).trim() : null;
        
        // ── Season Code — use raw value or default to 'N/A' ────────────────
        let seasonCode = (row.season_code && String(row.season_code).trim() !== 'NaN')
          ? String(row.season_code).trim()
          : 'N/A';

        // ── Numeric fields (strip commas, parse float) ────────────────────
        const qty = Math.round(parseNumeric(row.qty));
        const salesPrice = parseNumeric(row.sales_price_inr || row.sales_price);
        const salesAmountINR = parseNumeric(row.sales_amount_inr) || (qty * salesPrice);
        const cogm = parseNumeric(row.cogm) || (salesAmountINR * 0.7);

        // ── New raw columns ────────────────────────────────────────────────
        const billing_type_desc = row.billing_type_desc ? String(row.billing_type_desc).trim() : null;
        const distribution_channel = row.distribution_channel ? String(row.distribution_channel).trim() : null;
        const plant = row.plant ? String(row.plant).trim() : null;
        const storage_location = row.storage_location ? String(row.storage_location).trim() : null;
        const sales_order_no = row.sales_order_no ? String(row.sales_order_no).trim() : null;
        const customer_reference = row.customer_reference ? String(row.customer_reference).trim() : null;
        const indent_no = row.indent_no ? String(row.indent_no).trim() : null;
        const ipt_sr_request_no = row.ipt_sr_request_no ? String(row.ipt_sr_request_no).trim() : null;
        const ipt_sr_request_date = parseExcelDate(row.ipt_sr_request_date);
        const accounting_doc_no = row.accounting_doc_no ? String(row.accounting_doc_no).trim() : null;
        const fiscal_year = row.fiscal_year ? parseInt(String(row.fiscal_year).trim(), 10) : null;
        const customer_no = row.customer_no ? String(row.customer_no).trim() : null;
        const customer_name = row.customer_name ? String(row.customer_name).trim() : null;
        const line_item_no = row.line_item_no ? String(row.line_item_no).trim() : null;
        const crop_name = row.crop_name ? String(row.crop_name).trim() : null;
        const variety_name = row.variety_name ? String(row.variety_name).trim() : null;
        const own_trade = row.own_trade ? String(row.own_trade).trim() : null;
        const material_name = row.material_name ? String(row.material_name).trim() : null;
        const batch_no = row.batch_no ? String(row.batch_no).trim() : null;
        const expiry_date = parseExcelDate(row.expiry_date);
        const currency = row.currency ? String(row.currency).trim() : null;
        const sales_price = row.sales_price !== undefined ? parseNumeric(row.sales_price) : null;
        const sales_amount = row.sales_amount !== undefined ? parseNumeric(row.sales_amount) : null;
        const exchange_rate = row.exchange_rate !== undefined ? parseNumeric(row.exchange_rate) : null;
        const base_currency_inr = row.base_currency_inr ? String(row.base_currency_inr).trim() : null;
        const sales_price_inr = row.sales_price_inr !== undefined ? parseNumeric(row.sales_price_inr) : null;
        const territory_name = row.territory_name ? String(row.territory_name).trim() : null;
        const ti_id = row.ti_id ? String(row.ti_id).trim() : null;
        const ti_name = row.ti_name ? String(row.ti_name).trim() : null;
        const am_id = row.am_id ? String(row.am_id).trim() : null;
        const am_name = row.am_name ? String(row.am_name).trim() : null;
        const rbm_id = row.rbm_id ? String(row.rbm_id).trim() : null;
        const rbm_name = row.rbm_name ? String(row.rbm_name).trim() : null;
        const dbm_id = row.dbm_id ? String(row.dbm_id).trim() : null;
        const dbm_name = row.dbm_name ? String(row.dbm_name).trim() : null;
        const created_by = row.created_by ? String(row.created_by).trim() : null;

        // Seed FY lookup
        await dbRun(
          'INSERT INTO financial_years (fy_code, fy_name) VALUES ($1, $2) ON CONFLICT (fy_code) DO NOTHING',
          [fyCode, fyCode === 'UNKNOWN' ? 'Unknown Financial Year' : `Financial Year 20${fyCode.substring(2, 4)}-${fyCode.substring(4, 6)}`]
        );

        // Seed Customer
        if (!customerSet.has(customerId)) {
          await dbRun(
            'INSERT INTO customers (customer_id, customer_name, dist_channel) VALUES ($1, $2, $3) ON CONFLICT (customer_id) DO NOTHING',
            [customerId, customerName, distChannel]
          );
          customerSet.add(customerId);
        }

        // Seed Material
        if (!materialSet.has(materialCode)) {
          await dbRun(
            'INSERT INTO materials (material_code, material_desc, division, crop, variety, sales_unit, own_trade) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (material_code) DO NOTHING',
            [materialCode, materialDesc, division, crop, variety, salesUnit, ownTrade]
          );
          materialSet.add(materialCode);
        }

        // Seed Billing Type — classify Z-prefixed SAP codes correctly
        const billingClassification = (() => {
          const code = (billingType || '').toUpperCase();
          // Gross invoice sales (standard + SAP Z-prefixed variants)
          if (code === 'F2' || code === 'ZF2' || code === 'ZIF2') return 'GROSS_SALE';
          // Returns / credit memos
          if (code === 'RE' || code === 'ZRE' || code === 'ZIRE') return 'RETURN';
          // Cancellations
          if (code === 'S1' || code === 'ZS1') return 'CANCELLED';
          // Everything else (ZSTO, IPT, etc.) = stock transfer
          return 'STOCK_TRANSFER';
        })();
        // Use DO UPDATE so a re-import always corrects a previously-wrong classification
        await dbRun(
          `INSERT INTO billing_types (billing_type, billing_desc, classification)
           VALUES ($1, $2, $3)
           ON CONFLICT (billing_type) DO UPDATE SET classification = EXCLUDED.classification`,
          [billingType, billingDesc, billingClassification]
        );


        // Resolve employees
        const amId = await getEmployeeId(amName, 'AM');
        const rbmId = await getEmployeeId(rbmName, 'RBM');
        const dbmId = await getEmployeeId(dbmName, 'DBM');
        const inchargeId = dbmId;

        // Resolve territory
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

        // Insert sales row — directly into sales_data_raw with all 48 columns
        await dbRun(
          `INSERT INTO sales_data_raw (
            batch_id, invoice_id, invoice_date, billing_type, customer_id, material_code, territory_id, qty, sales_unit, sales_amount_inr, cogm, season_code, fy_code,
            billing_type_desc, division, distribution_channel, state, plant, storage_location, sales_order_no, customer_reference, indent_no, ipt_sr_request_no, ipt_sr_request_date,
            accounting_doc_no, fiscal_year, customer_no, customer_name, line_item_no, crop_name, variety_name, own_trade, material_name, batch_no, expiry_date,
            currency, sales_price, sales_amount, exchange_rate, base_currency_inr, sales_price_inr, territory_name,
            ti_id, ti_name, am_id, am_name, rbm_id, rbm_name, dbm_id, dbm_name, created_by
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
            $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
            $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,
            $36,$37,$38,$39,$40,$41,$42,
            $43,$44,$45,$46,$47,$48,$49,$50,$51
          )`,
          [
            batchId, invoiceId, date, billingType, customerId, materialCode, territoryId, qty, salesUnit, salesAmountINR, cogm, seasonCode, fyCode,
            billing_type_desc, division, distribution_channel, state, plant, storage_location, sales_order_no, customer_reference, indent_no, ipt_sr_request_no, ipt_sr_request_date,
            accounting_doc_no, fiscal_year, customer_no, customer_name, line_item_no, crop_name, variety_name, own_trade, material_name, batch_no, expiry_date,
            currency, sales_price, sales_amount, exchange_rate, base_currency_inr, sales_price_inr, territory_name,
            ti_id, ti_name, am_id, am_name, rbm_id, rbm_name, dbm_id, dbm_name, created_by
          ]
        );

        importedCount++;
      } catch (err) {
        rejectedCount++;
        try {
          await dbRun(
            'INSERT INTO import_rejected_rows (batch_id, reject_reason, raw_row) VALUES ($1, $2, $3)',
            [batchId, err.message, JSON.stringify(row)]
          );
        } catch (_) { }
      }
    }

    // Calculate batch-level metadata: min_date, max_date
    const statsQuery = `
      SELECT 
        MIN(invoice_date) as min_date,
        MAX(invoice_date) as max_date
      FROM sales_data_raw
      WHERE batch_id = $1 AND invoice_date > '1970-01-01'
    `;
    const batchStats = await dbGet(statsQuery, [batchId]) || {};
    
    // Derive batch fy_code from the imported rows' fy_code in the database
    const fyCodeQuery = `
      SELECT fy_code, COUNT(*) as cnt
      FROM sales_data_raw
      WHERE batch_id = $1 AND fy_code IS NOT NULL AND fy_code <> 'UNKNOWN'
      GROUP BY fy_code
      ORDER BY cnt DESC
      LIMIT 1
    `;
    const fyResult = await dbGet(fyCodeQuery, [batchId]);
    let batchFyCode = fyResult?.fy_code || 'UNKNOWN';

    // Finalise batch counts and metadata
    await dbRun(
      `UPDATE upload_batches 
       SET rows_imported = $1, 
           rows_rejected = $2, 
           record_count = $1,
           fy_code = $3, 
           min_date = $4, 
           max_date = $5 
       WHERE batch_id = $6`,
      [importedCount, rejectedCount, batchFyCode, batchStats.min_date || null, batchStats.max_date || null, batchId]
    );
  });

  console.log(`[Import] Batch ${batchId}: ${importedCount} imported, ${rejectedCount} rejected from ${originalFileName}`);
  logger.info(`Imported ${importedCount} rows from batch ${batchId}`);

  return { batchId, rowsImported: importedCount, rowsRejected: rejectedCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// STARTUP HOOK
// ─────────────────────────────────────────────────────────────────────────────
export async function seedDatabaseIfEmpty() {
  await initializeDatabase();
  console.log('Database initialized. Startup database seeding is disabled; all stats will load dynamically from user uploads.');
}
