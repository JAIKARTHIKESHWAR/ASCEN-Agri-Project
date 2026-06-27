import { dbAll, dbGet } from '../database.js';

/**
 * Shared SQL filter builder helper for PostgreSQL (assigns dynamic param indices like $1, $2...)
 */
export function buildFilterClause(params, startParamIndex = 1) {
  const clauses = [];
  const sqlParams = [];
  let paramIdx = startParamIndex;

  if (params.fy_code) {
    clauses.push(`sd.fy_code = $${paramIdx++}`);
    sqlParams.push(params.fy_code);
  }
  if (params.division) {
    clauses.push(`m.division = $${paramIdx++}`);
    sqlParams.push(params.division);
  }
  if (params.dist_channel) {
    clauses.push(`c.dist_channel = $${paramIdx++}`);
    sqlParams.push(params.dist_channel);
  }
  if (params.state) {
    clauses.push(`t.state = $${paramIdx++}`);
    sqlParams.push(params.state);
  }
  if (params.territory) {
    clauses.push(`t.territory = $${paramIdx++}`);
    sqlParams.push(params.territory);
  }
  if (params.crop) {
    clauses.push(`m.crop = $${paramIdx++}`);
    sqlParams.push(params.crop);
  }
  if (params.variety) {
    clauses.push(`m.variety = $${paramIdx++}`);
    sqlParams.push(params.variety);
  }
  if (params.rbm_id) {
    clauses.push(`t.rbm_id = $${paramIdx++}`);
    sqlParams.push(params.rbm_id);
  }
  if (params.am_id) {
    clauses.push(`t.am_id = $${paramIdx++}`);
    sqlParams.push(params.am_id);
  }
  if (params.dbm_id) {
    clauses.push(`t.dbm_id = $${paramIdx++}`);
    sqlParams.push(params.dbm_id);
  }
  if (params.start_date) {
    clauses.push(`sd.invoice_date >= $${paramIdx++}`);
    sqlParams.push(params.start_date);
  }
  if (params.end_date) {
    clauses.push(`sd.invoice_date <= $${paramIdx++}`);
    sqlParams.push(params.end_date);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { whereClause, sqlParams, nextParamIndex: paramIdx };
}

/**
 * Format date row values (YYYY-MM) to short human formats (e.g. "Sep 24")
 */
function formatMonthLabel(dateStr) {
  if (!dateStr) return 'N/A';
  const parts = dateStr.split('-');
  const year = parts[0].substring(2);
  const monthIdx = parseInt(parts[1], 10) - 1;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[monthIdx] || 'Unk'} ${year}`;
}

/**
 * Endpoint 1: GET /api/dashboard/summary
 */
export async function getSummary(req, res) {
  try {
    const { whereClause, sqlParams } = buildFilterClause(req.query);

    // 1. KPI Cards
    const kpiSql = `
      SELECT
        SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.sales_amount_inr ELSE 0 END) AS gross_sales,
        SUM(CASE WHEN bt.classification='RETURN' THEN sd.sales_amount_inr ELSE 0 END) AS returns_value,
        SUM(CASE WHEN bt.classification='CANCELLED' THEN sd.sales_amount_inr ELSE 0 END) AS cancelled_value,
        SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.cogm ELSE 0 END) AS total_cogm
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause}
    `;
    const kpiRes = await dbGet(kpiSql, sqlParams) || {};
    const grossSales = parseFloat(kpiRes.gross_sales || 0);
    const returnsValue = parseFloat(kpiRes.returns_value || 0);
    const cancelledValue = parseFloat(kpiRes.cancelled_value || 0);
    const totalCOGM = parseFloat(kpiRes.total_cogm || 0);
    const netExternalSales = grossSales - returnsValue - cancelledValue;

    // 2. Monthly sales trend (PostgreSQL to_char format)
    const trendSql = `
      SELECT
        to_char(sd.invoice_date, 'YYYY-MM') AS sortKey,
        SUM(sd.sales_amount_inr) AS value
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE'
      GROUP BY sortKey
      ORDER BY sortKey
    `;
    const trendRes = await dbAll(trendSql, sqlParams);
    const monthlyTrend = trendRes.map(t => ({
      sortKey: t.sortkey, // pg returns lowercase column names
      label: formatMonthLabel(t.sortkey),
      value: parseFloat(t.value || 0)
    }));

    // 3. Division Split
    const divSql = `
      SELECT
        m.division AS label,
        SUM(sd.sales_amount_inr) AS value
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE'
      GROUP BY label
    `;
    const DIVISION_LABELS = { VG: 'Vegetables (VG)', FC: 'Field Crops (FC)', HY: 'Hybrid (HY)', FV: 'Fruits & Veg (FV)' };
    const divRes = await dbAll(divSql, sqlParams);
    const divisionSplit = divRes.map(d => ({
      label: DIVISION_LABELS[d.label] || d.label || 'Other',
      value: parseFloat(d.value || 0)
    }));


    // 4. Top Rankings
    const rankedBaseSql = (field, limits) => `
      SELECT
        ${field} AS label,
        SUM(sd.sales_amount_inr) AS value
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE'
      GROUP BY label
      ORDER BY value DESC
      LIMIT ${limits}
    `;
    
    const topStatesRes = await dbAll(rankedBaseSql('t.state', 10), sqlParams);
    const topStates = topStatesRes.map(s => ({ label: s.label, value: parseFloat(s.value || 0) }));

    const topCropsRes = await dbAll(rankedBaseSql('m.crop', 10), sqlParams);
    const topCrops = topCropsRes.map(c => ({ label: c.label, value: parseFloat(c.value || 0) }));
    
    const dealersSql = `
      SELECT
        c.customer_name AS label,
        c.customer_id AS customerId,
        SUM(sd.sales_amount_inr) AS value
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE'
      GROUP BY label, customerId
      ORDER BY value DESC
      LIMIT 10
    `;
    const topDealersRes = await dbAll(dealersSql, sqlParams);
    const topDealers = topDealersRes.map(d => ({
      label: d.label,
      customerId: d.customerid,
      value: parseFloat(d.value || 0)
    }));

    // 5. Sales by State intensity
    const intensitySql = `
      SELECT
        t.state AS label,
        SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.sales_amount_inr ELSE 0 END) AS value,
        SUM(CASE WHEN bt.classification='RETURN' THEN sd.sales_amount_inr ELSE 0 END) AS returns
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification IN ('GROSS_SALE', 'RETURN')
      GROUP BY label
      ORDER BY value DESC
    `;
    const salesByStateIntensityRes = await dbAll(intensitySql, sqlParams);
    const salesByStateIntensity = salesByStateIntensityRes.map(s => ({
      label: s.label,
      value: parseFloat(s.value || 0),
      returns: parseFloat(s.returns || 0)
    }));

    // 6. Dataset health (PostgreSQL MAX Date format verification)
    const health = await dbGet('SELECT COUNT(*) AS total_rows, MAX(invoice_date) AS last_updated FROM sales_data') || {};
    const fYears = await dbAll('SELECT DISTINCT fy_code FROM sales_data');
    const fyCoverage = fYears.map(f => f.fy_code);

    const rawLastUpdated = health.last_updated;
    let lastUpdatedFormatted = 'N/A';
    if (rawLastUpdated) {
      try {
        lastUpdatedFormatted = new Date(rawLastUpdated).toISOString().split('T')[0];
      } catch (e) {
        lastUpdatedFormatted = String(rawLastUpdated);
      }
    }

    res.json({
      kpis: {
        grossSales,
        returnsValue,
        cancelledValue,
        netExternalSales,
        totalCOGM,
        netSalesRuleNote: "Provisional: Gross - Returns - Cancelled, excludes IPT"
      },
      monthlyTrend,
      divisionSplit,
      topStates,
      topCrops,
      topDealers,
      salesByStateIntensity,
      datasetHealth: {
        totalRows: parseInt(health.total_rows || 0, 10),
        lastUpdated: lastUpdatedFormatted,
        fyCoverage,
        fy2526Missing: !fyCoverage.includes('FY2526')
      }
    });
  } catch (err) {
    console.error('Error fetching dashboard summary:', err);
    res.status(500).json({ error: 'Failed to fetch summary data', details: err.message });
  }
}

/**
 * Endpoint 2: GET /api/dashboard/sales
 */
export async function getSalesPerformance(req, res) {
  try {
    const division = req.query.division || 'VG';
    const filters = { ...req.query, division }; 
    const { whereClause, sqlParams } = buildFilterClause(filters);

    // 1. KPIs
    const kpiSql = `
      SELECT
        SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.sales_amount_inr ELSE 0 END) AS gross_sales,
        SUM(CASE WHEN bt.classification='RETURN' THEN sd.sales_amount_inr ELSE 0 END) AS returns_value,
        SUM(CASE WHEN bt.classification='CANCELLED' THEN sd.sales_amount_inr ELSE 0 END) AS cancelled_value
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause}
    `;
    const kpis = await dbGet(kpiSql, sqlParams) || {};
    const grossSales = parseFloat(kpis.gross_sales || 0);
    const returnsValue = parseFloat(kpis.returns_value || 0);
    const cancelledValue = parseFloat(kpis.cancelled_value || 0);
    const netExternalSales = grossSales - returnsValue - cancelledValue;

    // 2. Trend
    const trendSql = `
      SELECT
        to_char(sd.invoice_date, 'YYYY-MM') AS sortKey,
        SUM(sd.sales_amount_inr) AS value
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE'
      GROUP BY sortKey
      ORDER BY sortKey
    `;
    const trendRes = await dbAll(trendSql, sqlParams);
    const monthlyTrend = trendRes.map(t => ({
      sortKey: t.sortkey,
      label: formatMonthLabel(t.sortkey),
      value: parseFloat(t.value || 0)
    }));

    // 3. Channels split
    const chanSql = `
      SELECT
        c.dist_channel AS label,
        SUM(sd.sales_amount_inr) AS value
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE'
      GROUP BY label
    `;
    const channelsRes = await dbAll(chanSql, sqlParams);
    const channels = channelsRes.map(c => ({ label: c.label, value: parseFloat(c.value || 0) }));

    // 4. Seasons (FC division only)
    let seasons = [];
    if (division === 'FC') {
      const seasonSql = `
        SELECT
          sd.season_code AS label,
          SUM(sd.sales_amount_inr) AS value
        FROM sales_data sd
        JOIN billing_types bt ON sd.billing_type = bt.billing_type
        JOIN materials m ON sd.material_code = m.material_code
        JOIN territories t ON sd.territory_id = t.territory_id
        JOIN customers c ON sd.customer_id = c.customer_id
        ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE' AND sd.season_code != 'N/A'
        GROUP BY label
      `;
      const seasonsRes = await dbAll(seasonSql, sqlParams);
      seasons = seasonsRes.map(s => ({ label: s.label, value: parseFloat(s.value || 0) }));
    }

    res.json({
      kpis: {
        grossSales,
        returnsValue,
        netExternalSales
      },
      monthlyTrend,
      channels,
      seasons
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sales performance data' });
  }
}

/**
 * Endpoint 3: GET /api/dashboard/geography
 */
export async function getGeography(req, res) {
  try {
    const { whereClause, sqlParams } = buildFilterClause(req.query);

    // 1. States overview list
    const statesSql = `
      SELECT
        t.state AS name,
        SUM(sd.sales_amount_inr) AS gross,
        COUNT(DISTINCT sd.invoice_id) AS count
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE'
      GROUP BY name
      ORDER BY gross DESC
    `;
    const statesRes = await dbAll(statesSql, sqlParams);
    const states = statesRes.map(s => ({
      name: s.name,
      gross: parseFloat(s.gross || 0),
      count: parseInt(s.count || 0, 10)
    }));

    // 2. Drill down state details
    let selectedStateDetails = null;
    const selectedState = req.query.selected_state;
    if (selectedState) {
      // Find hierarchy details (RBM, AM, DBM names) using Postgres $1 parameter index
      const hierarchSql = `
        SELECT
          rbm.employee_id AS rbm_id, rbm.employee_name AS rbm_name,
          am.employee_id AS am_id, am.employee_name AS am_name,
          dbm.employee_id AS dbm_id, dbm.employee_name AS dbm_name
        FROM territories t
        LEFT JOIN employees rbm ON t.rbm_id = rbm.employee_id
        LEFT JOIN employees am ON t.am_id = am.employee_id
        LEFT JOIN employees dbm ON t.dbm_id = dbm.employee_id
        WHERE LOWER(t.state) = LOWER($1)
        LIMIT 1
      `;
      const hierarchyRes = await dbGet(hierarchSql, [selectedState.trim()]);
      const hierarchy = {
        rbm: hierarchyRes ? { id: hierarchyRes.rbm_id, name: hierarchyRes.rbm_name } : null,
        am: hierarchyRes ? { id: hierarchyRes.am_id, name: hierarchyRes.am_name } : null,
        dbm: hierarchyRes ? { id: hierarchyRes.dbm_id, name: hierarchyRes.dbm_name } : null
      };

      // Find Territories breakdown in state, using dynamic nextParamIndex
      const { whereClause: subWhere, sqlParams: subParams, nextParamIndex } = buildFilterClause(req.query);
      const stateParam = [...subParams, selectedState.trim()];
      const terrSql = `
        SELECT
          t.territory AS name,
          SUM(sd.sales_amount_inr) AS gross,
          dbm.employee_id AS incharge_id,
          dbm.employee_name AS incharge_name
        FROM sales_data sd
        JOIN billing_types bt ON sd.billing_type = bt.billing_type
        JOIN materials m ON sd.material_code = m.material_code
        JOIN territories t ON sd.territory_id = t.territory_id
        LEFT JOIN employees dbm ON t.dbm_id = dbm.employee_id
        JOIN customers c ON sd.customer_id = c.customer_id
        ${subWhere} ${subWhere ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE' AND LOWER(t.state) = LOWER($${nextParamIndex})
        GROUP BY name, incharge_id, incharge_name
        ORDER BY gross DESC
      `;
      const territories = (await dbAll(terrSql, stateParam)).map(t => ({
        name: t.name,
        gross: parseFloat(t.gross || 0),
        incharge: { id: t.incharge_id, name: t.incharge_name }
      }));

      // Top Crops in state
      const cropSql = `
        SELECT
          m.crop AS name,
          SUM(sd.sales_amount_inr) AS gross
        FROM sales_data sd
        JOIN billing_types bt ON sd.billing_type = bt.billing_type
        JOIN materials m ON sd.material_code = m.material_code
        JOIN territories t ON sd.territory_id = t.territory_id
        JOIN customers c ON sd.customer_id = c.customer_id
        ${subWhere} ${subWhere ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE' AND LOWER(t.state) = LOWER($${nextParamIndex})
        GROUP BY name
        ORDER BY gross DESC
        LIMIT 5
      `;
      const cropsRes = await dbAll(cropSql, stateParam);
      const crops = cropsRes.map(c => ({ name: c.name, gross: parseFloat(c.gross || 0) }));

      selectedStateDetails = {
        stateName: selectedState,
        hierarchy,
        territories,
        crops
      };
    }

    res.json({
      states,
      selectedStateDetails
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch geography performance data' });
  }
}

/**
 * Endpoint 4: GET /api/dashboard/product
 */
export async function getProductPerformance(req, res) {
  try {
    const division = req.query.division || 'VG';
    const filters = { ...req.query, division };
    const { whereClause, sqlParams } = buildFilterClause(filters);

    // 1. Crops revenue list
    const cropSql = `
      SELECT
        m.crop AS name,
        SUM(sd.sales_amount_inr) AS value
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE'
      GROUP BY name
      ORDER BY value DESC
    `;
    const cropsRes = await dbAll(cropSql, sqlParams);
    const crops = cropsRes.map(c => ({ name: c.name, value: parseFloat(c.value || 0) }));

    // 2. Own vs Trade
    const ownSql = `
      SELECT
        m.own_trade AS label,
        SUM(sd.sales_amount_inr) AS value
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE'
      GROUP BY label
    `;
    const ownTradeSplit = (await dbAll(ownSql, sqlParams)).map(o => ({
      label: o.label === 'Own' ? 'Own' : 'Trade',
      value: parseFloat(o.value || 0)
    }));

    // 3. Selected crop details drill down
    let selectedCropDetails = null;
    const selectedCrop = req.query.selected_crop || (crops[0] ? crops[0].name : null);
    if (selectedCrop) {
      const { whereClause: subWhere, sqlParams: subParams, nextParamIndex } = buildFilterClause(filters);
      const cropParams = [...subParams, selectedCrop.trim()];
      
      // Varieties
      const varSql = `
        SELECT
          m.variety AS name,
          SUM(sd.sales_amount_inr) AS value
        FROM sales_data sd
        JOIN billing_types bt ON sd.billing_type = bt.billing_type
        JOIN materials m ON sd.material_code = m.material_code
        JOIN territories t ON sd.territory_id = t.territory_id
        JOIN customers c ON sd.customer_id = c.customer_id
        ${subWhere} ${subWhere ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE' AND m.crop = $${nextParamIndex}
        GROUP BY name
        ORDER BY value DESC
      `;
      const varietiesRes = await dbAll(varSql, cropParams);
      const varieties = varietiesRes.map(v => ({ name: v.name, value: parseFloat(v.value || 0) }));

      // Materials (SKUs)
      const matSql = `
        SELECT
          m.material_code AS code,
          m.material_desc AS desc,
          m.sales_unit AS unit,
          SUM(sd.sales_amount_inr) AS value
        FROM sales_data sd
        JOIN billing_types bt ON sd.billing_type = bt.billing_type
        JOIN materials m ON sd.material_code = m.material_code
        JOIN territories t ON sd.territory_id = t.territory_id
        JOIN customers c ON sd.customer_id = c.customer_id
        ${subWhere} ${subWhere ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE' AND m.crop = $${nextParamIndex}
        GROUP BY code, desc, unit
        ORDER BY value DESC
        LIMIT 5
      `;
      const materialsRes = await dbAll(matSql, cropParams);
      const materials = materialsRes.map(m => ({
        code: m.code,
        desc: m.desc,
        unit: m.unit,
        value: parseFloat(m.value || 0)
      }));

      // Geographic state contribution percentage
      const stateSql = `
        SELECT
          t.state AS label,
          SUM(sd.sales_amount_inr) AS value
        FROM sales_data sd
        JOIN billing_types bt ON sd.billing_type = bt.billing_type
        JOIN materials m ON sd.material_code = m.material_code
        JOIN territories t ON sd.territory_id = t.territory_id
        JOIN customers c ON sd.customer_id = c.customer_id
        ${subWhere} ${subWhere ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE' AND m.crop = $${nextParamIndex}
        GROUP BY label
        ORDER BY value DESC
      `;
      const stateContribution = await dbAll(stateSql, cropParams);
      const totalCropRevenue = stateContribution.reduce((sum, item) => sum + parseFloat(item.value || 0), 0);
      const geographicContribution = stateContribution.map(item => ({
        label: item.label,
        value: parseFloat(item.value || 0),
        contributionPct: totalCropRevenue > 0 ? parseFloat((parseFloat(item.value) / totalCropRevenue * 100).toFixed(1)) : 0
      }));

      selectedCropDetails = {
        cropName: selectedCrop,
        varieties,
        materials,
        geographicContribution
      };
    }

    res.json({
      crops,
      ownTradeSplit,
      selectedCropDetails
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch product performance data' });
  }
}

/**
 * Endpoint 5: GET /api/dashboard/returns
 */
export async function getReturns(req, res) {
  try {
    const { whereClause, sqlParams } = buildFilterClause(req.query);

    // 1. KPIs
    const kpiSql = `
      SELECT
        SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.sales_amount_inr ELSE 0 END) AS gross_sales,
        SUM(CASE WHEN bt.classification='RETURN' THEN sd.sales_amount_inr ELSE 0 END) AS returns_value
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause}
    `;
    const kpis = await dbGet(kpiSql, sqlParams) || {};
    const grossSales = parseFloat(kpis.gross_sales || 0);
    const returnsValue = parseFloat(kpis.returns_value || 0);
    const returnRate = grossSales > 0 ? parseFloat((returnsValue / grossSales * 100).toFixed(2)) : 0;

    // 2. Returns trend
    const trendSql = `
      SELECT
        to_char(sd.invoice_date, 'YYYY-MM') AS sortKey,
        SUM(sd.sales_amount_inr) AS value
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'RETURN'
      GROUP BY sortKey
      ORDER BY sortKey
    `;
    const trendRes = await dbAll(trendSql, sqlParams);
    const returnsTrend = trendRes.map(t => ({
      sortKey: t.sortkey,
      label: formatMonthLabel(t.sortkey),
      value: parseFloat(t.value || 0)
    }));

    // 3. Channels split
    const chanSql = `
      SELECT
        c.dist_channel AS label,
        SUM(sd.sales_amount_inr) AS value
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'RETURN'
      GROUP BY label
    `;
    const channelsRes = await dbAll(chanSql, sqlParams);
    const channels = channelsRes.map(c => ({ label: c.label, value: parseFloat(c.value || 0) }));

    // 4. Returns by State (values & state-specific rates)
    const stateSql = `
      SELECT
        t.state AS name,
        SUM(CASE WHEN bt.classification='RETURN' THEN sd.sales_amount_inr ELSE 0 END) AS returns,
        SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.sales_amount_inr ELSE 0 END) AS gross
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification IN ('GROSS_SALE', 'RETURN')
      GROUP BY name
      ORDER BY returns DESC
    `;
    const stateRes = await dbAll(stateSql, sqlParams);
    const states = stateRes.map(s => ({
      name: s.name,
      returns: parseFloat(s.returns || 0),
      rate: parseFloat(s.gross || 0) > 0 ? parseFloat((parseFloat(s.returns) / parseFloat(s.gross) * 100).toFixed(2)) : 0
    }));

    // 5. Crops return values ranking
    const cropSql = `
      SELECT
        m.crop AS name,
        SUM(sd.sales_amount_inr) AS value
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'RETURN'
      GROUP BY name
      ORDER BY value DESC
    `;
    const cropsRes = await dbAll(cropSql, sqlParams);
    const crops = cropsRes.map(c => ({ name: c.name, value: parseFloat(c.value || 0) }));

    res.json({
      kpis: {
        grossSales,
        returnsValue,
        returnRate
      },
      returnsTrend,
      channels,
      states,
      crops
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch returns analysis data' });
  }
}

/**
 * Endpoint 10: GET /api/filters/options
 */
export async function getFiltersOptions(req, res) {
  try {
    const { state } = req.query;

    const fYears = await dbAll('SELECT DISTINCT fy_code FROM financial_years ORDER BY fy_code');
    
    const divisionsRes = await dbAll('SELECT DISTINCT division FROM materials WHERE division IS NOT NULL AND division != \'\' ORDER BY division');
    const divisions = divisionsRes.map(d => d.division);
    
    const distChannelsRes = await dbAll('SELECT DISTINCT dist_channel FROM customers WHERE dist_channel IS NOT NULL AND dist_channel != \'\' ORDER BY dist_channel');
    const distChannels = distChannelsRes.map(c => c.dist_channel);
    
    // States and territories cascading filtering
    const stateSql = 'SELECT DISTINCT state FROM territories ORDER BY state';
    const statesRes = await dbAll(stateSql);
    const states = statesRes.map(s => s.state);

    let terrSql = 'SELECT DISTINCT territory FROM territories';
    const terrParams = [];
    if (state) {
      terrSql += ' WHERE state = $1';
      terrParams.push(state);
    }
    terrSql += ' ORDER BY territory';
    const terrRes = await dbAll(terrSql, terrParams);
    const territories = terrRes.map(t => t.territory);

    const cropsRes = await dbAll('SELECT DISTINCT crop FROM materials ORDER BY crop');
    const crops = cropsRes.map(c => c.crop);

    const varietiesRes = await dbAll('SELECT DISTINCT variety FROM materials ORDER BY variety');
    const varieties = varietiesRes.map(v => v.variety);

    const rbms = await dbAll("SELECT employee_id AS id, employee_name AS name FROM employees WHERE role='RBM' ORDER BY name");

    res.json({
      financialYears: fYears.map(f => f.fy_code),
      divisions,
      distChannels,
      states,
      territories,
      crops,
      varieties,
      rbms
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch filter options dropdowns' });
  }
}

/**
 * Endpoint 11: GET /api/data/quality/:batchId
 */
export async function getImportQuality(req, res) {
  try {
    const batchId = parseInt(req.params.batchId, 10);
    if (isNaN(batchId)) {
      return res.status(400).json({ error: 'Invalid batchId param' });
    }

    const batch = await dbGet('SELECT * FROM upload_batches WHERE batch_id = $1', [batchId]);
    if (!batch) {
      return res.status(404).json({ error: `Batch ID ${batchId} not found` });
    }

    const rejectedRowsRes = await dbAll('SELECT id, reject_reason as rejectReason, raw_row as rawRow FROM import_rejected_rows WHERE batch_id = $1', [batchId]);
    const rejectedRows = rejectedRowsRes.map(r => ({
      id: r.id,
      rejectReason: r.rejectreason, // pg columns lowercase
      rawRow: JSON.parse(r.rawrow)
    }));

    res.json({
      batchId: batch.batch_id,
      fileName: batch.file_name,
      uploadedAt: batch.uploaded_at,
      sourceRowCount: batch.source_row_count,
      rowsImported: batch.rows_imported,
      rowsRejected: batch.rows_rejected,
      rejectedRows,
      unmappedMasterValues: {
        materials: [],
        territories: []
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve batch quality summary' });
  }
}
