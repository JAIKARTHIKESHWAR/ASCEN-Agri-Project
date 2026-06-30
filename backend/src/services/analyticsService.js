// backend/src/services/analyticsService.js

import { dbAll as originalDbAll, dbGet as originalDbGet } from '../database.js';
import { formatMonthLabel } from '../utils/formatUtils.js';

/** Helper to run a query with the provided where clause and params. */
function runQuery(sql, params) {
  return originalDbAll(sql, params);
}

/** Get KPI data for summary endpoint. */
export async function getSummaryData(whereClause, sqlParams) {
  // KPI Cards
  const kpiSql = `
    SELECT
      COALESCE(SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.sales_amount_inr ELSE 0 END), 0) AS gross_sales,
      ABS(COALESCE(SUM(CASE WHEN bt.classification='RETURN' THEN sd.sales_amount_inr ELSE 0 END), 0)) AS returns_value,
      ABS(COALESCE(SUM(CASE WHEN bt.classification='CANCELLED' THEN sd.sales_amount_inr ELSE 0 END), 0)) AS cancelled_value,
      COALESCE(SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.cogm ELSE 0 END), 0) AS total_cogm,
      COUNT(*) AS total_rows,
      MAX(sd.invoice_date) AS last_updated
    FROM sales_data sd
    JOIN billing_types bt ON sd.billing_type = bt.billing_type
    ${whereClause}
  `;
  const kpiRes = await originalDbGet(kpiSql, sqlParams) || {};
  const grossSales = parseFloat(kpiRes.gross_sales || 0);
  const returnsValue = parseFloat(kpiRes.returns_value || 0);
  const cancelledValue = parseFloat(kpiRes.cancelled_value || 0);
  const netExternalSales = grossSales - returnsValue - cancelledValue;

  // Monthly Trend
  const trendSql = `
    SELECT
      to_char(sd.invoice_date, 'YYYY-MM') AS sortKey,
      SUM(sd.sales_amount_inr) AS value
    FROM sales_data sd
    JOIN billing_types bt ON sd.billing_type = bt.billing_type
    ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE'
    GROUP BY sortKey
    ORDER BY sortKey
  `;
  const trendRes = await originalDbAll(trendSql, sqlParams);
  const monthlyTrend = trendRes.map(t => ({
    sortKey: t.sortkey,
    label: formatMonthLabel(t.sortkey),
    value: parseFloat(t.value || 0)
  }));

  // Division Split
  const divSql = `
    SELECT
      m.division AS label,
      SUM(sd.sales_amount_inr) AS value
    FROM sales_data sd
    JOIN billing_types bt ON sd.billing_type = bt.billing_type
    JOIN materials m ON sd.material_code = m.material_code
    ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE'
    GROUP BY label
  `;
  const DIVISION_LABELS = { VG: 'Vegetables (VG)', FC: 'Field Crops (FC)', HY: 'Hybrid (HY)', FV: 'Fruits & Veg (FV)' };
  const divRes = await originalDbAll(divSql, sqlParams);
  const divisionSplit = divRes.map(d => ({
    label: DIVISION_LABELS[d.label] || d.label || 'Other',
    value: parseFloat(d.value || 0)
  }));

  // Top States (limit 10)
  const topStatesRes = await originalDbAll(`
    SELECT
      t.state AS label,
      SUM(sd.sales_amount_inr) AS value
    FROM sales_data sd
    JOIN billing_types bt ON sd.billing_type = bt.billing_type
    JOIN territories t ON sd.territory_id = t.territory_id
    ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE'
    GROUP BY label
    ORDER BY value DESC
    LIMIT 10
  `, sqlParams);
  const topStates = topStatesRes.map(s => ({ label: s.label, value: parseFloat(s.value || 0) }));

  // Top Crops (limit 10)
  const topCropsRes = await originalDbAll(`
    SELECT
      m.crop AS label,
      SUM(sd.sales_amount_inr) AS value
    FROM sales_data sd
    JOIN billing_types bt ON sd.billing_type = bt.billing_type
    JOIN materials m ON sd.material_code = m.material_code
    ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE'
    GROUP BY label
    ORDER BY value DESC
    LIMIT 10
  `, sqlParams);
  const topCrops = topCropsRes.map(c => ({ label: c.label, value: parseFloat(c.value || 0) }));

  // Top Dealers (limit 10)
  const topDealersRes = await originalDbAll(`
    SELECT
      c.customer_name AS label,
      c.customer_id AS customerId,
      SUM(sd.sales_amount_inr) AS value
    FROM sales_data sd
    JOIN billing_types bt ON sd.billing_type = bt.billing_type
    JOIN customers c ON sd.customer_id = c.customer_id
    ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE'
    GROUP BY label, customerId
    ORDER BY value DESC
    LIMIT 10
  `, sqlParams);
  const topDealers = topDealersRes.map(d => ({ label: d.label, customerId: d.customerid, value: parseFloat(d.value || 0) }));

  // Distribution Channel Mix calculations
  const channelMixSql = `
    SELECT
      c.dist_channel AS label,
      SUM(sd.sales_amount_inr) AS value
    FROM sales_data sd
    JOIN billing_types bt ON sd.billing_type = bt.billing_type
    JOIN customers c ON sd.customer_id = c.customer_id
    ${whereClause} ${whereClause ? 'AND' : 'WHERE'} bt.classification = 'GROSS_SALE'
    GROUP BY label
  `;
  const channelMixRes = await originalDbAll(channelMixSql, sqlParams);

  const channelSalesAgg = {
    'Dealer & Distributor': 0,
    'Institutional Sales': 0,
    'Government Sales': 0,
    'Export': 0
  };
  channelMixRes.forEach(r => {
    const rawChan = r.label || '';
    let mapped = 'Dealer & Distributor';
    if (rawChan === 'DD') {
      mapped = 'Dealer & Distributor';
    } else if (rawChan === 'ST' || rawChan === 'IS') {
      mapped = 'Institutional Sales';
    } else if (rawChan === 'GS') {
      mapped = 'Government Sales';
    } else if (rawChan === 'ES' || rawChan === 'EO') {
      mapped = 'Export';
    }
    channelSalesAgg[mapped] += parseFloat(r.value || 0);
  });

  const distributionChannelMix = Object.keys(channelSalesAgg).map(name => ({
    label: name,
    value: channelSalesAgg[name]
  })).sort((a, b) => b.value - a.value);

  const fyRows = await originalDbAll('SELECT DISTINCT fy_code FROM sales_data_raw', []);
  const fyCoverage = fyRows.map(r => r.fy_code);
  const lastUpdatedFormatted = kpiRes.last_updated ? new Date(kpiRes.last_updated).toISOString().split('T')[0] : 'N/A';

  const kpis = {
    grossSales,
    returnsValue,
    cancelledValue,
    netExternalSales,
    totalCOGM,
    total_rows: kpiRes.total_rows,
    lastUpdatedFormatted,
    fyCoverage
  };

  return {
    kpis,
    monthlyTrend,
    divisionSplit,
    topStates,
    topCrops,
    topDealers,
    distributionChannelMix
  };
}

/** KPI data for sales performance endpoint. */
export async function getSalesKPIs(whereClause, sqlParams) {
  const kpiSql = `
    SELECT
      COALESCE(SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.sales_amount_inr ELSE 0 END), 0) AS gross_sales,
      ABS(COALESCE(SUM(CASE WHEN bt.classification='RETURN' THEN sd.sales_amount_inr ELSE 0 END), 0)) AS returns_value,
      ABS(COALESCE(SUM(CASE WHEN bt.classification='CANCELLED' THEN sd.sales_amount_inr ELSE 0 END), 0)) AS cancelled_value,
      COALESCE(SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.cogm ELSE 0 END), 0) AS total_cogm
    FROM sales_data sd
    JOIN billing_types bt ON sd.billing_type = bt.billing_type
    ${whereClause}
  `;
  const kpis = await originalDbGet(kpiSql, sqlParams) || {};
  const grossSales = parseFloat(kpis.gross_sales || 0);
  const returnsValue = parseFloat(kpis.returns_value || 0);
  const cancelledValue = parseFloat(kpis.cancelled_value || 0);
  const totalCOGM = parseFloat(kpis.total_cogm || 0);
  const netExternalSales = grossSales - returnsValue - cancelledValue;
  return { grossSales, returnsValue, cancelledValue, totalCOGM, netExternalSales };
}

/** KPI data for returns endpoint. */
export async function getReturnsKPIs(whereClause, sqlParams) {
  const kpiSql = `
    SELECT
      COALESCE(SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.sales_amount_inr ELSE 0 END), 0) AS gross_sales,
      ABS(COALESCE(SUM(CASE WHEN bt.classification='RETURN' THEN sd.sales_amount_inr ELSE 0 END), 0)) AS returns_value
    FROM sales_data sd
    JOIN billing_types bt ON sd.billing_type = bt.billing_type
    ${whereClause}
  `;
  const kpis = await originalDbGet(kpiSql, sqlParams) || {};
  const grossSales = parseFloat(kpis.gross_sales || 0);
  const returnsValue = parseFloat(kpis.returns_value || 0);
  return { grossSales, returnsValue };
}
