import { dbAll as originalDbAll, dbGet as originalDbGet } from '../database.js';
import { getTargetDatasetId } from './dashboardController.js';
import { buildFilterClause } from '../services/filterBuilder.js';


const dbAll = (sql, params) => originalDbAll(sql.replace(/\bsales_data\b/g, 'sales_data_raw'), params);
const dbGet = (sql, params) => originalDbGet(sql.replace(/\bsales_data\b/g, 'sales_data_raw'), params);


/**
 * Endpoint 6: GET /api/transactions
 */
export async function getTransactions(req, res) {
  try {
    req.query.datasetId = await getTargetDatasetId(req.query.datasetId || req.query.activeDatasetId);
    const { search, page = 1, limit = 12 } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    // Use Postgres position indexes
    const { whereClause, sqlParams, nextParamIndex } = buildFilterClause(req.query);

    let finalWhere = whereClause;
    const finalParams = [...sqlParams];
    let currentParamIdx = nextParamIndex;

    if (search && search.trim() !== '') {
      const searchSql = `
        (sd.invoice_id ILIKE $${currentParamIdx} 
         OR c.customer_name ILIKE $${currentParamIdx + 1} 
         OR m.crop ILIKE $${currentParamIdx + 2} 
         OR m.variety ILIKE $${currentParamIdx + 3} 
         OR m.material_code ILIKE $${currentParamIdx + 4} 
         OR t.state ILIKE $${currentParamIdx + 5} 
         OR t.territory ILIKE $${currentParamIdx + 6})
      `;
      if (finalWhere) {
        finalWhere += ` AND ${searchSql}`;
      } else {
        finalWhere = `WHERE ${searchSql}`;
      }
      const searchVal = `%${search.trim()}%`;
      for (let i = 0; i < 7; i++) {
        finalParams.push(searchVal);
      }
      currentParamIdx += 7;
    }

    // 1. Fetch Paginated List (including LIMIT/OFFSET position parameters)
    const querySql = `
      SELECT 
        sd.invoice_id AS invoiceId, 
        to_char(sd.invoice_date, 'YYYY-MM-DD') AS date, 
        sd.fy_code AS fy,
        bt.billing_type AS billingType, 
        bt.billing_desc AS billingTypeDescription,
        c.customer_name AS customerName, 
        c.dist_channel AS distributionChannel, 
        m.division AS division,
        m.own_trade AS ownTrade,
        sd.material_code AS materialCode,
        m.material_desc AS materialDescription,
        sd.season_code AS seasonCode,
        m.crop, 
        m.variety, 
        sd.qty, 
        sd.sales_unit AS salesUnit,
        sd.sales_amount_inr AS salesAmountINR, 
        sd.cogm, 
        t.state, 
        t.territory
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN customers c ON sd.customer_id = c.customer_id
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      ${finalWhere}
      ORDER BY sd.invoice_date DESC
      LIMIT $${currentParamIdx} OFFSET $${currentParamIdx + 1}
    `;

    const fetchParams = [...finalParams, limitNum, offset];
    const rawData = await dbAll(querySql, fetchParams);
    
    // Format returned row properties for consistency (PostgreSQL returns lowercase keys)
    const data = rawData.map(r => ({
      invoiceId: r.invoiceid || r.invoice_id,
      date: r.date || r.invoice_date,
      fy: r.fy || r.fy_code,
      billingType: r.billingtype || r.billing_type,
      billingTypeDescription: r.billingtypedescription || r.billing_desc,
      customerName: r.customername || r.customer_name,
      distributionChannel: r.distributionchannel || r.dist_channel,
      division: r.division,
      ownTrade: r.owntrade || r.own_trade,
      materialCode: r.materialcode || r.material_code,
      materialDescription: r.materialdescription || r.material_desc,
      seasonCode: r.seasoncode || r.season_code,
      crop: r.crop,
      variety: r.variety,
      qty: parseInt(r.qty || 0, 10),
      salesUnit: r.salesunit || r.sales_unit,
      salesAmountINR: parseFloat(r.salesamountinr || r.sales_amount_inr || 0),
      cogm: parseFloat(r.cogm || 0),
      state: r.state,
      territory: r.territory
    }));

    // 2. Count Total Records
    const countSql = `
      SELECT COUNT(*) AS total
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN customers c ON sd.customer_id = c.customer_id
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      ${finalWhere}
    `;
    const countRes = await dbGet(countSql, finalParams) || {};
    const totalRecords = parseInt(countRes.total || 0, 10);
    const totalPages = Math.max(Math.ceil(totalRecords / limitNum), 1);

    res.json({
      totalRecords,
      page: pageNum,
      limit: limitNum,
      totalPages,
      data
    });
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ error: 'Failed to fetch transactions list', details: err.message });
  }
}

/**
 * Endpoint 7: GET /api/transactions/export
 */
export async function exportTransactions(req, res) {
  try {
    req.query.datasetId = await getTargetDatasetId(req.query.datasetId || req.query.activeDatasetId);
    const { search, format = 'csv' } = req.query;

    const { whereClause, sqlParams, nextParamIndex } = buildFilterClause(req.query);

    let finalWhere = whereClause;
    const finalParams = [...sqlParams];
    let currentParamIdx = nextParamIndex;

    if (search && search.trim() !== '') {
      const searchSql = `
        (sd.invoice_id ILIKE $${currentParamIdx} 
         OR c.customer_name ILIKE $${currentParamIdx + 1} 
         OR m.crop ILIKE $${currentParamIdx + 2} 
         OR m.variety ILIKE $${currentParamIdx + 3} 
         OR m.material_code ILIKE $${currentParamIdx + 4} 
         OR t.state ILIKE $${currentParamIdx + 5} 
         OR t.territory ILIKE $${currentParamIdx + 6})
      `;
      if (finalWhere) {
        finalWhere += ` AND ${searchSql}`;
      } else {
        finalWhere = `WHERE ${searchSql}`;
      }
      const searchVal = `%${search.trim()}%`;
      for (let i = 0; i < 7; i++) {
        finalParams.push(searchVal);
      }
      currentParamIdx += 7;
    }

    const querySql = `
      SELECT 
        sd.invoice_id AS invoiceId, 
        to_char(sd.invoice_date, 'YYYY-MM-DD') AS date, 
        bt.billing_desc AS billingTypeDescription,
        c.customer_name AS customerName, 
        c.dist_channel AS distributionChannel, 
        m.crop, 
        m.variety, 
        sd.qty, 
        sd.sales_unit AS salesUnit,
        sd.sales_amount_inr AS salesAmountINR, 
        sd.cogm, 
        t.state, 
        t.territory
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN customers c ON sd.customer_id = c.customer_id
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      ${finalWhere}
      ORDER BY sd.invoice_date DESC
    `;

    const rawRecords = await dbAll(querySql, finalParams);
    
    const records = rawRecords.map(r => ({
      invoiceId: r.invoiceid || r.invoice_id,
      date: r.date || r.invoice_date,
      billingTypeDescription: r.billingtypedescription || r.billing_desc,
      customerName: r.customername || r.customer_name,
      distributionChannel: r.distributionchannel || r.dist_channel,
      crop: r.crop,
      variety: r.variety,
      qty: parseInt(r.qty || 0, 10),
      salesUnit: r.salesunit || r.sales_unit,
      salesAmountINR: parseFloat(r.salesamountinr || r.sales_amount_inr || 0),
      cogm: parseFloat(r.cogm || 0),
      state: r.state,
      territory: r.territory
    }));

    if (format.toLowerCase() === 'pdf') {
      res.status(400).json({ error: 'PDF export not supported directly in POC database backend, please export as CSV.' });
      return;
    }

    // Generate CSV string
    const headers = [
      'Invoice ID', 'Date', 'Billing Type', 'Customer Name', 'Distribution Channel', 
      'Crop', 'Variety', 'Qty', 'Unit', 'Amount INR', 'COGM', 'State', 'Territory'
    ];

    const csvLines = [headers.join(',')];
    records.forEach(r => {
      const row = [
        r.invoiceId,
        r.date,
        r.billingTypeDescription,
        `"${r.customerName.replace(/"/g, '""')}"`,
        r.distributionChannel,
        r.crop,
        r.variety,
        r.qty,
        r.salesUnit,
        r.salesAmountINR,
        r.cogm,
        r.state,
        r.territory
      ];
      csvLines.push(row.join(','));
    });

    const csvContent = csvLines.join('\n');
    const filename = `Acsen_Sales_Transactions_${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    console.error('Error exporting transactions:', err);
    res.status(500).json({ error: 'Failed to export transactions', details: err.message });
  }
}
