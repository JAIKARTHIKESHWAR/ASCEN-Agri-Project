import { dbGet, dbAll } from '../database.js';
import { buildFilterClause } from './filterBuilder.js';

/**
 * Get comparative metrics between a primary period and a comparison period.
 * Scoped strictly to the provided filters, joining all master tables to support cascading filters.
 * Supports YoY, QoQ, and MoM modes.
 * Properly aligns with the Indian Financial Year (April to March).
 */
function parseYear(val) {
  if (!val) return NaN;
  let str = String(val).trim().replace(/\s+/g, ''); // strip all spaces
  
  // 1. Matches "FY2024-2025" or "FY2024" -> extracts 2024
  const matchFY4 = str.match(/FY(20\d{2})/i);
  if (matchFY4) {
    return parseInt(matchFY4[1], 10);
  }
  
  // 2. Matches "FY24-25" -> extracts 24 -> returns 2024
  const matchFY2Dash = str.match(/FY(\d{2})-\d{2}/i);
  if (matchFY2Dash) {
    return 2000 + parseInt(matchFY2Dash[1], 10);
  }
  
  // 3. Matches "FY2425" -> extracts 24 -> returns 2024
  const matchFY22 = str.match(/FY(\d{2})(\d{2})/i);
  if (matchFY22) {
    return 2000 + parseInt(matchFY22[1], 10);
  }
  
  // 4. Matches "FY24" -> extracts 24 -> returns 2024
  const matchFY2 = str.match(/FY(\d{2})/i);
  if (matchFY2) {
    return 2000 + parseInt(matchFY2[1], 10);
  }
  
  // 5. Matches bare 4-digit year like "2024"
  const matchBare4 = str.match(/(\d{4})/);
  if (matchBare4) {
    return parseInt(matchBare4[1], 10);
  }
  
  const parsed = parseInt(str, 10);
  return isNaN(parsed) ? NaN : parsed;
}

export async function computeComparison(filters) {
  const {
    primaryYear,
    comparisonYear,
    primaryQuarter,
    comparisonQuarter,
    primaryMonth,
    comparisonMonth,
    mode
  } = filters;

  const pYear = parseYear(primaryYear);
  const cYear = parseYear(comparisonYear);

  if (isNaN(pYear) || isNaN(cYear)) {
    throw new Error('Primary and comparison years must be valid numbers.');
  }

  // Clean filters to remove any dataset/year/date specific filters
  const cleanFilters = { ...filters };
  delete cleanFilters.datasetId;
  delete cleanFilters.activeDatasetId;
  delete cleanFilters.fy_code;
  delete cleanFilters.financialYear;
  delete cleanFilters.fy;
  delete cleanFilters.start_date;
  delete cleanFilters.startDate;
  delete cleanFilters.end_date;
  delete cleanFilters.endDate;

  // Build the base filter clause and params
  const { whereClause: baseWhere, sqlParams } = buildFilterClause(cleanFilters);

  // Indian FY quarter -> calendar month mapping
  // Q1 = Apr-Jun (4-6), Q2 = Jul-Sep (7-9),
  // Q3 = Oct-Dec (10-12), Q4 = Jan-Mar (1-3)
  const fyQuarterToMonths = {
    1: [4, 5, 6],
    2: [7, 8, 9],
    3: [10, 11, 12],
    4: [1, 2, 3]
  };

  // Indian Financial Year SQL expression:
  // If month >= 4, FY is the calendar year.
  // If month <= 3, FY is the calendar year - 1.
  const fyExpression = `(CASE WHEN EXTRACT(MONTH FROM sd.invoice_date) >= 4 THEN EXTRACT(YEAR FROM sd.invoice_date)::int ELSE EXTRACT(YEAR FROM sd.invoice_date)::int - 1 END)`;

  // Build period filter clauses
  let primaryPeriodClause = `${fyExpression} = ${pYear}`;
  let compPeriodClause    = `${fyExpression} = ${cYear}`;

  if (mode === 'qoq' && primaryQuarter && comparisonQuarter) {
    const pq = parseInt(primaryQuarter, 10);
    const cq = parseInt(comparisonQuarter, 10);
    const pMonths = fyQuarterToMonths[pq] || [];
    const cMonths = fyQuarterToMonths[cq] || [];
    if (pMonths.length) primaryPeriodClause += ` AND EXTRACT(MONTH FROM sd.invoice_date) IN (${pMonths.join(',')})`;
    if (cMonths.length) compPeriodClause    += ` AND EXTRACT(MONTH FROM sd.invoice_date) IN (${cMonths.join(',')})`;
  } else if (mode === 'mom' && primaryMonth && comparisonMonth) {
    primaryPeriodClause += ` AND EXTRACT(MONTH FROM sd.invoice_date) = ${parseInt(primaryMonth, 10)}`;
    compPeriodClause    += ` AND EXTRACT(MONTH FROM sd.invoice_date) = ${parseInt(comparisonMonth, 10)}`;
  }

  const primaryWhereSQL = baseWhere 
    ? `${baseWhere} AND ${primaryPeriodClause}`
    : `WHERE ${primaryPeriodClause}`;

  const compWhereSQL = baseWhere
    ? `${baseWhere} AND ${compPeriodClause}`
    : `WHERE ${compPeriodClause}`;

  // Pre-flight: validate both periods have data
  const [pCount, cCount] = await Promise.all([
    dbGet(`
      SELECT COUNT(*) AS cnt 
      FROM sales_data_raw sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${primaryWhereSQL}
    `, sqlParams),
    dbGet(`
      SELECT COUNT(*) AS cnt 
      FROM sales_data_raw sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${compWhereSQL}
    `, sqlParams)
  ]);

  const primaryHasData = parseInt(pCount?.cnt || 0, 10) > 0;
  const compHasData    = parseInt(cCount?.cnt || 0, 10) > 0;

  if (!primaryHasData) {
    return {
      error: 'no_primary_data',
      message: `No data found for primary period (year ${pYear}).`,
      dataAvailability: { primaryHasData: false, compHasData, message: `No data for year ${pYear}.` }
    };
  }

  const skipComparison = !compHasData;

  // KPI queries (ensure F2, RE, S1 are correctly matched and aggregated with absolute values where appropriate)
  const kpiSelect = `
    COALESCE(SUM(CASE WHEN sd.billing_type IN ('F2', 'ZF2', 'ZIF2') THEN sd.sales_amount_inr ELSE 0 END), 0) AS gross_sales,
    ABS(COALESCE(SUM(CASE WHEN sd.billing_type IN ('RE', 'ZRE', 'ZIRE') THEN sd.sales_amount_inr ELSE 0 END), 0)) AS returns_value,
    ABS(COALESCE(SUM(CASE WHEN sd.billing_type IN ('S1', 'ZS1') THEN sd.sales_amount_inr ELSE 0 END), 0)) AS cancelled_value,
    COALESCE(COUNT(DISTINCT sd.customer_id), 0) AS customer_count,
    COALESCE(COUNT(DISTINCT sd.invoice_id),  0) AS invoice_count
  `;

  const [primaryKpis, compKpisRaw] = await Promise.all([
    dbGet(`
      SELECT ${kpiSelect} 
      FROM sales_data_raw sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${primaryWhereSQL}
    `, sqlParams),
    skipComparison ? Promise.resolve(null)
      : dbGet(`
          SELECT ${kpiSelect} 
          FROM sales_data_raw sd
          JOIN billing_types bt ON sd.billing_type = bt.billing_type
          JOIN materials m ON sd.material_code = m.material_code
          JOIN territories t ON sd.territory_id = t.territory_id
          JOIN customers c ON sd.customer_id = c.customer_id
          ${compWhereSQL}
        `, sqlParams)
  ]);
  const compKpis = compKpisRaw || {};

  const pGross     = parseFloat(primaryKpis?.gross_sales     || 0);
  const pReturns   = parseFloat(primaryKpis?.returns_value   || 0);
  const pCancelled = parseFloat(primaryKpis?.cancelled_value || 0);
  const pNet       = Math.max(0, pGross - pReturns - pCancelled);
  const pCusts     = parseInt(primaryKpis?.customer_count    || 0, 10);
  const pInvs      = parseInt(primaryKpis?.invoice_count     || 0, 10);
  const pAOV       = pInvs > 0 ? pNet / pInvs : 0;

  const cGross     = skipComparison ? null : parseFloat(compKpis.gross_sales     || 0);
  const cReturns   = skipComparison ? null : parseFloat(compKpis.returns_value   || 0);
  const cCancelled = skipComparison ? null : parseFloat(compKpis.cancelled_value || 0);
  const cNet       = cGross != null ? Math.max(0, cGross - (cReturns || 0) - (cCancelled || 0)) : null;
  const cCusts     = skipComparison ? null : parseInt(compKpis.customer_count    || 0, 10);
  const cInvs      = skipComparison ? null : parseInt(compKpis.invoice_count     || 0, 10);
  const cAOV       = (cInvs != null && cInvs > 0 && cNet != null) ? cNet / cInvs : null;

  // Null-safe growth calculator
  const getGrowth = (p, c) => {
    if (p == null || c == null || c === 0) return null;
    return parseFloat((((p - c) / c) * 100).toFixed(2));
  };

  const grossSalesGrowth = getGrowth(pGross,     cGross);
  const returnsGrowth    = getGrowth(pReturns,   cReturns);
  const cancelledGrowth  = getGrowth(pCancelled, cCancelled);
  const netSalesGrowth   = getGrowth(pNet,       cNet);
  const customerGrowth   = getGrowth(pCusts,     cCusts);
  const aovGrowth        = getGrowth(pAOV,       cAOV);

  // Comparative trend series
  let series = [];

  if (mode === 'yoy') {
    const trendQuery = `
      SELECT
        EXTRACT(MONTH FROM sd.invoice_date)::int AS idx,
        SUM(CASE WHEN ${fyExpression} = ${pYear} THEN sd.sales_amount_inr ELSE 0 END) AS primary_val,
        SUM(CASE WHEN ${fyExpression} = ${cYear} THEN sd.sales_amount_inr ELSE 0 END) AS comp_val
      FROM sales_data_raw sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${baseWhere ? `${baseWhere} AND` : 'WHERE'} sd.billing_type IN ('F2', 'ZF2', 'ZIF2')
        AND ${fyExpression} IN (${pYear}, ${cYear})
      GROUP BY idx
      ORDER BY idx
    `;
    const trendRows  = await dbAll(trendQuery, sqlParams);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    series = monthNames.map((name, i) => {
      const row = trendRows.find(r => r.idx === i + 1);
      return { label: name, primaryValue: parseFloat(row?.primary_val || 0), comparisonValue: parseFloat(row?.comp_val || 0) };
    });

  } else if (mode === 'qoq' && primaryQuarter && comparisonQuarter) {
    const pq = parseInt(primaryQuarter, 10);
    const cq = parseInt(comparisonQuarter, 10);
    const pMonths = fyQuarterToMonths[pq] || [];
    const cMonths = fyQuarterToMonths[cq] || [];

    const fyMonthLabels = { 1: ['Apr', 'May', 'Jun'], 2: ['Jul', 'Aug', 'Sep'], 3: ['Oct', 'Nov', 'Dec'], 4: ['Jan', 'Feb', 'Mar'] };
    const labels = fyMonthLabels[pq] || ['Month 1', 'Month 2', 'Month 3'];

    const trendQuery = `
      SELECT
        CASE
          ${pMonths.map((m, i) => `WHEN EXTRACT(MONTH FROM sd.invoice_date) = ${m} AND ${fyExpression} = ${pYear} THEN ${i + 1}`).join('\n          ')}
          ${cMonths.map((m, i) => `WHEN EXTRACT(MONTH FROM sd.invoice_date) = ${m} AND ${fyExpression} = ${cYear} THEN ${i + 1}`).join('\n          ')}
        END AS idx,
        SUM(CASE WHEN ${fyExpression} = ${pYear} AND EXTRACT(MONTH FROM sd.invoice_date) IN (${pMonths.join(',')}) THEN sd.sales_amount_inr ELSE 0 END) AS primary_val,
        SUM(CASE WHEN ${fyExpression} = ${cYear} AND EXTRACT(MONTH FROM sd.invoice_date) IN (${cMonths.join(',')}) THEN sd.sales_amount_inr ELSE 0 END) AS comp_val
      FROM sales_data_raw sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${baseWhere ? `${baseWhere} AND` : 'WHERE'} sd.billing_type IN ('F2', 'ZF2', 'ZIF2')
        AND (
          (${fyExpression} = ${pYear} AND EXTRACT(MONTH FROM sd.invoice_date) IN (${pMonths.join(',')}))
          OR (${fyExpression} = ${cYear} AND EXTRACT(MONTH FROM sd.invoice_date) IN (${cMonths.join(',')}))
        )
      GROUP BY idx
      ORDER BY idx
    `;
    const trendRows = await dbAll(trendQuery, sqlParams);
    series = labels.map((name, i) => {
      const row = trendRows.find(r => r.idx === i + 1);
      return { label: name, primaryValue: parseFloat(row?.primary_val || 0), comparisonValue: parseFloat(row?.comp_val || 0) };
    });

  } else if (mode === 'mom' && primaryMonth && comparisonMonth) {
    const pm = parseInt(primaryMonth, 10);
    const cm = parseInt(comparisonMonth, 10);
    const trendQuery = `
      SELECT
        EXTRACT(DAY FROM sd.invoice_date)::int AS idx,
        SUM(CASE WHEN ${fyExpression} = ${pYear} AND EXTRACT(MONTH FROM sd.invoice_date) = ${pm} THEN sd.sales_amount_inr ELSE 0 END) AS primary_val,
        SUM(CASE WHEN ${fyExpression} = ${cYear} AND EXTRACT(MONTH FROM sd.invoice_date) = ${cm} THEN sd.sales_amount_inr ELSE 0 END) AS comp_val
      FROM sales_data_raw sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${baseWhere ? `${baseWhere} AND` : 'WHERE'} sd.billing_type IN ('F2', 'ZF2', 'ZIF2')
        AND (
          (${fyExpression} = ${pYear} AND EXTRACT(MONTH FROM sd.invoice_date) = ${pm}) OR
          (${fyExpression} = ${cYear} AND EXTRACT(MONTH FROM sd.invoice_date) = ${cm})
        )
      GROUP BY idx
      ORDER BY idx
    `;
    const trendRows = await dbAll(trendQuery, sqlParams);
    series = Array.from({ length: 31 }, (_, i) => {
      const day = i + 1;
      const row = trendRows.find(r => r.idx === day);
      return { label: `Day ${day}`, primaryValue: parseFloat(row?.primary_val || 0), comparisonValue: parseFloat(row?.comp_val || 0) };
    });
  }

  return {
    primaryYear: pYear,
    comparisonYear: cYear,
    primaryKPIs: {
      grossSales:    pGross,
      returnsValue:  pReturns,
      cancelledValue: pCancelled,
      netSales:      pNet,
      customerCount: pCusts,
      invoiceCount:  pInvs,
      aov:           pAOV
    },
    comparisonKPIs: skipComparison ? null : {
      grossSales:    cGross,
      returnsValue:  cReturns,
      cancelledValue: cCancelled,
      netSales:      cNet,
      customerCount: cCusts,
      invoiceCount:  cInvs,
      aov:           cAOV
    },
    growth: {
      grossSalesGrowth,
      returnsGrowth,
      cancelledGrowth,
      netSalesGrowth,
      customerGrowth,
      aovGrowth
    },
    dataAvailability: {
      primaryHasData,
      compHasData,
      message: skipComparison
        ? `Comparison data unavailable for year ${cYear}. Showing primary period only.`
        : null
    },
    series
  };
}
