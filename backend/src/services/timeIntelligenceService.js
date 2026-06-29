import { dbGet, dbAll } from '../database.js';
import { buildFilterClause } from './filterBuilder.js';

/**
 * Get comparative metrics between a primary period and a comparison period.
 * Scoped strictly to the provided filters, joining all master tables to support cascading filters.
 * Supports YoY, QoQ, and MoM modes.
 * Properly aligns with the Indian Financial Year (April to March).
 */
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

  const pYear = primaryYear;
  const cYear = comparisonYear;

  if (!pYear || !cYear) {
    throw new Error('Primary and comparison years are required');
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

  // Build period filter clauses
  let primaryPeriodClause = `sd.fy_code = '${pYear}'`;
  let compPeriodClause    = `sd.fy_code = '${cYear}'`;

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
    COALESCE(SUM(CASE WHEN sd.billing_type='F2' THEN sd.sales_amount_inr ELSE 0 END), 0) AS gross_sales,
    ABS(COALESCE(SUM(CASE WHEN sd.billing_type='RE' THEN sd.sales_amount_inr ELSE 0 END), 0)) AS returns_value,
    ABS(COALESCE(SUM(CASE WHEN sd.billing_type='S1' THEN sd.sales_amount_inr ELSE 0 END), 0)) AS cancelled_value,
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
        SUM(CASE WHEN sd.fy_code = '${pYear}' THEN sd.sales_amount_inr ELSE 0 END) AS primary_val,
        SUM(CASE WHEN sd.fy_code = '${cYear}' THEN sd.sales_amount_inr ELSE 0 END) AS comp_val
      FROM sales_data_raw sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${baseWhere ? `${baseWhere} AND` : 'WHERE'} sd.billing_type = 'F2'
        AND sd.fy_code IN ('${pYear}', '${cYear}')
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
          ${pMonths.map((m, i) => `WHEN EXTRACT(MONTH FROM sd.invoice_date) = ${m} AND sd.fy_code = '${pYear}' THEN ${i + 1}`).join('\n          ')}
          ${cMonths.map((m, i) => `WHEN EXTRACT(MONTH FROM sd.invoice_date) = ${m} AND sd.fy_code = '${cYear}' THEN ${i + 1}`).join('\n          ')}
        END AS idx,
        SUM(CASE WHEN sd.fy_code = '${pYear}' AND EXTRACT(MONTH FROM sd.invoice_date) IN (${pMonths.join(',')}) THEN sd.sales_amount_inr ELSE 0 END) AS primary_val,
        SUM(CASE WHEN sd.fy_code = '${cYear}' AND EXTRACT(MONTH FROM sd.invoice_date) IN (${cMonths.join(',')}) THEN sd.sales_amount_inr ELSE 0 END) AS comp_val
      FROM sales_data_raw sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${baseWhere ? `${baseWhere} AND` : 'WHERE'} sd.billing_type = 'F2'
        AND (
          (sd.fy_code = '${pYear}' AND EXTRACT(MONTH FROM sd.invoice_date) IN (${pMonths.join(',')}))
          OR (sd.fy_code = '${cYear}' AND EXTRACT(MONTH FROM sd.invoice_date) IN (${cMonths.join(',')}))
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
        SUM(CASE WHEN sd.fy_code = '${pYear}' AND EXTRACT(MONTH FROM sd.invoice_date) = ${pm} THEN sd.sales_amount_inr ELSE 0 END) AS primary_val,
        SUM(CASE WHEN sd.fy_code = '${cYear}' AND EXTRACT(MONTH FROM sd.invoice_date) = ${cm} THEN sd.sales_amount_inr ELSE 0 END) AS comp_val
      FROM sales_data_raw sd
      JOIN billing_types bt ON sd.billing_type = bt.billing_type
      JOIN materials m ON sd.material_code = m.material_code
      JOIN territories t ON sd.territory_id = t.territory_id
      JOIN customers c ON sd.customer_id = c.customer_id
      ${baseWhere ? `${baseWhere} AND` : 'WHERE'} sd.billing_type = 'F2'
        AND (
          (sd.fy_code = '${pYear}' AND EXTRACT(MONTH FROM sd.invoice_date) = ${pm}) OR
          (sd.fy_code = '${cYear}' AND EXTRACT(MONTH FROM sd.invoice_date) = ${cm})
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

  // 1. Division Contribution Comparison
  const divQuery = `
    SELECT
      m.division AS label,
      SUM(CASE WHEN (${primaryPeriodClause}) AND sd.billing_type = 'F2' THEN sd.sales_amount_inr ELSE 0 END) AS primary_val,
      SUM(CASE WHEN (${compPeriodClause}) AND sd.billing_type = 'F2' THEN sd.sales_amount_inr ELSE 0 END) AS comp_val
    FROM sales_data_raw sd
    JOIN billing_types bt ON sd.billing_type = bt.billing_type
    JOIN materials m ON sd.material_code = m.material_code
    JOIN territories t ON sd.territory_id = t.territory_id
    JOIN customers c ON sd.customer_id = c.customer_id
    ${baseWhere ? `${baseWhere} AND` : 'WHERE'} ((${primaryPeriodClause}) OR (${compPeriodClause}))
    GROUP BY m.division
  `;
  const divisionContributionRaw = await dbAll(divQuery, sqlParams);
  const divisionContribution = divisionContributionRaw.map(r => ({
    label: r.label,
    primaryValue: parseFloat(r.primary_val || 0),
    comparisonValue: parseFloat(r.comp_val || 0)
  }));

  // 2. Top States Comparison
  const stateQuery = `
    SELECT
      t.state AS label,
      SUM(CASE WHEN (${primaryPeriodClause}) AND sd.billing_type = 'F2' THEN sd.sales_amount_inr ELSE 0 END) AS primary_val,
      SUM(CASE WHEN (${compPeriodClause}) AND sd.billing_type = 'F2' THEN sd.sales_amount_inr ELSE 0 END) AS comp_val
    FROM sales_data_raw sd
    JOIN billing_types bt ON sd.billing_type = bt.billing_type
    JOIN materials m ON sd.material_code = m.material_code
    JOIN territories t ON sd.territory_id = t.territory_id
    JOIN customers c ON sd.customer_id = c.customer_id
    ${baseWhere ? `${baseWhere} AND` : 'WHERE'} ((${primaryPeriodClause}) OR (${compPeriodClause}))
    GROUP BY t.state
    ORDER BY primary_val DESC
    LIMIT 10
  `;
  const topStatesRaw = await dbAll(stateQuery, sqlParams);
  const topStates = topStatesRaw.map(r => ({
    label: r.label,
    primaryValue: parseFloat(r.primary_val || 0),
    comparisonValue: parseFloat(r.comp_val || 0)
  }));

  // 3. Top Crops Comparison
  const cropQuery = `
    SELECT
      m.crop AS label,
      SUM(CASE WHEN (${primaryPeriodClause}) AND sd.billing_type = 'F2' THEN sd.sales_amount_inr ELSE 0 END) AS primary_val,
      SUM(CASE WHEN (${compPeriodClause}) AND sd.billing_type = 'F2' THEN sd.sales_amount_inr ELSE 0 END) AS comp_val
    FROM sales_data_raw sd
    JOIN billing_types bt ON sd.billing_type = bt.billing_type
    JOIN materials m ON sd.material_code = m.material_code
    JOIN territories t ON sd.territory_id = t.territory_id
    JOIN customers c ON sd.customer_id = c.customer_id
    ${baseWhere ? `${baseWhere} AND` : 'WHERE'} ((${primaryPeriodClause}) OR (${compPeriodClause}))
    GROUP BY m.crop
    ORDER BY primary_val DESC
    LIMIT 10
  `;
  const topCropsRaw = await dbAll(cropQuery, sqlParams);
  const topCrops = topCropsRaw.map(r => ({
    label: r.label,
    primaryValue: parseFloat(r.primary_val || 0),
    comparisonValue: parseFloat(r.comp_val || 0)
  }));

  // 4. Top Dealers Comparison
  const dealerQuery = `
    SELECT
      c.customer_name AS label,
      SUM(CASE WHEN (${primaryPeriodClause}) AND sd.billing_type = 'F2' THEN sd.sales_amount_inr ELSE 0 END) AS primary_val,
      SUM(CASE WHEN (${compPeriodClause}) AND sd.billing_type = 'F2' THEN sd.sales_amount_inr ELSE 0 END) AS comp_val
    FROM sales_data_raw sd
    JOIN billing_types bt ON sd.billing_type = bt.billing_type
    JOIN materials m ON sd.material_code = m.material_code
    JOIN territories t ON sd.territory_id = t.territory_id
    JOIN customers c ON sd.customer_id = c.customer_id
    ${baseWhere ? `${baseWhere} AND` : 'WHERE'} ((${primaryPeriodClause}) OR (${compPeriodClause}))
    GROUP BY c.customer_name
    ORDER BY primary_val DESC
    LIMIT 10
  `;
  const topDealersRaw = await dbAll(dealerQuery, sqlParams);
  const topDealers = topDealersRaw.map(r => ({
    label: r.label,
    primaryValue: parseFloat(r.primary_val || 0),
    comparisonValue: parseFloat(r.comp_val || 0)
  }));

  // 5. Returns by State Comparison
  const returnsQuery = `
    SELECT
      t.state AS label,
      ABS(SUM(CASE WHEN (${primaryPeriodClause}) AND sd.billing_type = 'RE' THEN sd.sales_amount_inr ELSE 0 END)) AS primary_val,
      ABS(SUM(CASE WHEN (${compPeriodClause}) AND sd.billing_type = 'RE' THEN sd.sales_amount_inr ELSE 0 END)) AS comp_val
    FROM sales_data_raw sd
    JOIN billing_types bt ON sd.billing_type = bt.billing_type
    JOIN materials m ON sd.material_code = m.material_code
    JOIN territories t ON sd.territory_id = t.territory_id
    JOIN customers c ON sd.customer_id = c.customer_id
    ${baseWhere ? `${baseWhere} AND` : 'WHERE'} ((${primaryPeriodClause}) OR (${compPeriodClause}))
    GROUP BY t.state
    ORDER BY primary_val DESC
    LIMIT 10
  `;
  const returnsByStateRaw = await dbAll(returnsQuery, sqlParams);
  const returnsByState = returnsByStateRaw.map(r => ({
    label: r.label,
    primaryValue: parseFloat(r.primary_val || 0),
    comparisonValue: parseFloat(r.comp_val || 0)
  }));

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
    series,
    divisionContribution,
    topStates,
    topCrops,
    topDealers,
    returnsByState
  };
}
