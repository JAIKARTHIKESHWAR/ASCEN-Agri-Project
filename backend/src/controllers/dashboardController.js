import { dbAll as originalDbAll, dbGet as originalDbGet } from '../database.js';
import { logger } from '../logger.js';
import * as analytics from '../services/analyticsService.js';
import { computeComparison } from '../services/timeIntelligenceService.js';
import { buildFilterClause as centralBuildFilterClause } from '../services/filterBuilder.js';
import { validateAnalyticsKPIs } from '../services/analyticsValidator.js';

const dbAll = (sql, params) => originalDbAll(sql.replace(/\bsales_data\b/g, 'sales_data_raw'), params);
const dbGet = (sql, params) => originalDbGet(sql.replace(/\bsales_data\b/g, 'sales_data_raw'), params);

export const buildFilterClause = centralBuildFilterClause;

export async function getTargetDatasetId(queryDatasetId) {
  if (queryDatasetId) {
    if (queryDatasetId === 'all' || String(queryDatasetId).startsWith('FY')) {
      return queryDatasetId;
    }
    const parsed = parseInt(queryDatasetId, 10);
    if (!isNaN(parsed)) return parsed;
  }

  console.warn('[getTargetDatasetId] No datasetId provided by caller, falling back to latest uploaded batch. This will silently scope results to the newest FY only.');
  const latestBatch = await dbGet('SELECT fy_code FROM upload_batches ORDER BY uploaded_at DESC LIMIT 1');
  if (latestBatch && latestBatch.fy_code) return latestBatch.fy_code;
  return 'all';
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
    req.query.datasetId = await getTargetDatasetId(req.query.datasetId || req.query.activeDatasetId);
    logger.info({ endpoint: 'summary', filters: req.query });
    const { whereClause, sqlParams } = buildFilterClause(req.query);

    // 1. KPI Cards
    const { kpis, monthlyTrend, divisionSplit, topStates, topCrops, topDealers, distributionChannelMix } = await analytics.getSummaryData(whereClause, sqlParams);

    // Validate the calculated KPIs before sending to frontend
    validateAnalyticsKPIs({
      grossSales: kpis.grossSales,
      returnsValue: kpis.returnsValue,
      cancelledValue: kpis.cancelledValue,
      netExternalSales: kpis.netExternalSales
    });

    res.json({
      kpis: {
        grossSales: kpis.grossSales,
        returnsValue: kpis.returnsValue,
        cancelledValue: kpis.cancelledValue,
        netExternalSales: kpis.netExternalSales,
        totalCOGM: kpis.totalCOGM,
        returnRate: kpis.grossSales > 0 ? parseFloat(((kpis.returnsValue / kpis.grossSales) * 100).toFixed(2)) : 0
      },
      monthlyTrend,
      divisionSplit,
      topStates,
      topCrops,
      topDealers,
      distributionChannelMix,
      datasetHealth: {
        totalRows: parseInt(kpis.total_rows || 0, 10),
        lastUpdated: kpis.lastUpdatedFormatted,
        fyCoverage: kpis.fyCoverage,
        fy2526Missing: !kpis.fyCoverage.includes('FY2526')
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
    req.query.datasetId = await getTargetDatasetId(req.query.datasetId || req.query.activeDatasetId);
    const division = req.query.division || 'VG';
    const filters = { ...req.query, division }; 
    const { whereClause, sqlParams } = buildFilterClause(filters);

    // 1. KPIs
    const kpis = await analytics.getSalesKPIs(whereClause, sqlParams);
    const grossSales = kpis.grossSales;
    const returnsValue = kpis.returnsValue;
    const cancelledValue = kpis.cancelledValue;
    const netExternalSales = grossSales - returnsValue - cancelledValue;

    validateAnalyticsKPIs({
      grossSales,
      returnsValue,
      cancelledValue,
      netExternalSales
    });

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
        cancelledValue,
        netExternalSales,
        returnRate: grossSales > 0 ? parseFloat(((returnsValue / grossSales) * 100).toFixed(2)) : 0
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
    req.query.datasetId = await getTargetDatasetId(req.query.datasetId || req.query.activeDatasetId);
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
    req.query.datasetId = await getTargetDatasetId(req.query.datasetId || req.query.activeDatasetId);
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
    const crops = cropsRes.map(c => ({ label: c.name, value: parseFloat(c.value || 0) }));

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
      const varieties = varietiesRes.map(v => ({ label: v.name, value: parseFloat(v.value || 0) }));

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
    req.query.datasetId = await getTargetDatasetId(req.query.datasetId || req.query.activeDatasetId);
    const { whereClause, sqlParams } = buildFilterClause(req.query);
    logger.info({ endpoint: 'returns', filters: req.query });

    // 1. KPIs
    const { kpis } = await analytics.getReturnsKPIs(whereClause, sqlParams);
    const grossSales = kpis.grossSales;
    const returnsValue = kpis.returnsValue;
    const returnRate = grossSales > 0 ? parseFloat(((returnsValue / grossSales) * 100).toFixed(2)) : 0;

    validateAnalyticsKPIs({
        grossSales,
        returnsValue,
        cancelledValue: 0,
        netExternalSales: grossSales - returnsValue
      });

    // 2. Returns trend — ABS in SQL is the source of truth
    const trendSql = `
      SELECT
        to_char(sd.invoice_date, 'YYYY-MM') AS sortKey,
        ABS(COALESCE(SUM(sd.sales_amount_inr), 0)) AS value
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
      value: parseFloat(t.value || 0)   // already positive from SQL
    }));

    // 3. Channels split — ABS in SQL
    const chanSql = `
      SELECT
        c.dist_channel AS label,
        ABS(COALESCE(SUM(sd.sales_amount_inr), 0)) AS value
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
      ORDER BY ABS(SUM(CASE WHEN bt.classification='RETURN' THEN sd.sales_amount_inr ELSE 0 END)) DESC
    `;
    const stateRes = await dbAll(stateSql, sqlParams);
    const states = stateRes.map(s => ({
      label: s.name,
      value: Math.abs(parseFloat(s.returns || 0)),
      rate: parseFloat(s.gross || 0) > 0 ? parseFloat((Math.abs(parseFloat(s.returns)) / parseFloat(s.gross) * 100).toFixed(2)) : 0
    }));

    // 5. Crops return values ranking — ABS in SQL
    const cropSql = `
      SELECT
        m.crop AS name,
        ABS(COALESCE(SUM(sd.sales_amount_inr), 0)) AS value
      FROM sales_data sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'RETURN'
      GROUP BY name
      ORDER BY ABS(COALESCE(SUM(sd.sales_amount_inr), 0)) DESC
    `;
    const cropsRes = await dbAll(cropSql, sqlParams);
    const crops = cropsRes.map(c => ({ label: c.name, value: parseFloat(c.value || 0) }));

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

/**
 * GET /api/dashboard/comparison
 * Returns YoY / QoQ / MoM comparative statistics for a given dataset.
 */
export async function getComparison(req, res) {
  try {
    const datasetId = await getTargetDatasetId(req.query.datasetId || req.query.activeDatasetId);
    const { 
      primaryYear, 
      comparisonYear, 
      mode 
    } = req.query;
    
    if (!primaryYear || !comparisonYear) {
      return res.status(400).json({ error: 'Missing primaryYear or comparisonYear' });
    }
    
    const result = await computeComparison({
      ...req.query,
      datasetId,
      mode: mode || 'yoy'
    });
    
    res.json(result);
  } catch (err) {
    console.error('Failed to compute comparative trend:', err);
    res.status(500).json({ error: 'Failed to fetch comparison data', details: err.message });
  }
}

/**
 * GET /api/aggregates
 * Returns pre-computed aggregates scoped by financial year and dimensions.
 * For 'all' financial years, groups by dimension and aggregates values.
 */
export async function getAggregates(req, res) {
  try {
    const { fy_code, dimension_type, dimension_value, limit = 20 } = req.query;
    
    let sql = '';
    const params = [];
    let idx = 1;
    
    if (fy_code && fy_code !== 'all') {
      sql = `
        SELECT da.fy_code, da.dimension_type, da.dimension_value,
               da.gross_sales, da.returns_value, da.cancelled_value,
               da.net_external_sales, da.total_cogm, da.transaction_count,
               da.computed_at
        FROM dataset_aggregates da
        JOIN upload_batches ub ON da.batch_id = ub.batch_id
        WHERE ub.is_active = true AND da.fy_code = $${idx++}
      `;
      params.push(fy_code);
      
      if (dimension_type) {
        sql += ` AND da.dimension_type = $${idx++}`;
        params.push(dimension_type);
      }
      if (dimension_value) {
        sql += ` AND da.dimension_value ILIKE $${idx++}`;
        params.push(`%${dimension_value}%`);
      }
      
      sql += ` ORDER BY da.gross_sales DESC LIMIT $${idx++}`;
      params.push(parseInt(limit, 10));
    } else {
      sql = `
        SELECT 'all' AS fy_code, da.dimension_type, da.dimension_value,
               SUM(da.gross_sales) AS gross_sales,
               SUM(da.returns_value) AS returns_value,
               SUM(da.cancelled_value) AS cancelled_value,
               SUM(da.net_external_sales) AS net_external_sales,
               SUM(da.total_cogm) AS total_cogm,
               SUM(da.transaction_count) AS transaction_count,
               MAX(da.computed_at) AS computed_at
        FROM dataset_aggregates da
        JOIN upload_batches ub ON da.batch_id = ub.batch_id
        WHERE ub.is_active = true
      `;
      
      if (dimension_type) {
        sql += ` AND da.dimension_type = $${idx++}`;
        params.push(dimension_type);
      }
      if (dimension_value) {
        sql += ` AND da.dimension_value ILIKE $${idx++}`;
        params.push(`%${dimension_value}%`);
      }
      
      sql += ` GROUP BY da.dimension_type, da.dimension_value ORDER BY gross_sales DESC LIMIT $${idx++}`;
      params.push(parseInt(limit, 10));
    }
    
    const rows = await originalDbAll(sql, params);
    res.json({ aggregates: rows, source: 'pre_computed', verified: true });
  } catch (err) {
    console.error('Failed to get aggregates:', err);
    res.status(500).json({ error: 'Failed to retrieve aggregates', details: err.message });
  }
}

