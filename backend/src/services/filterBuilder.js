/**
 * Centralized Filter Builder for Agri BI Dashboard
 * Ensures consistent filtering across KPIs, trends, and analytical modules.
 */
export function buildFilterClause(params, startParamIndex = 1) {
  const clauses = [];
  const sqlParams = [];
  let paramIdx = startParamIndex;

  // 1. Dataset / batch scoping (e.g. active uploaded dataset)
  if (params.datasetId && params.datasetId !== 'all') {
    if (String(params.datasetId).startsWith('FY')) {
      clauses.push(`sd.fy_code = $${paramIdx++}`);
      sqlParams.push(params.datasetId);
    } else {
      clauses.push(`sd.batch_id = $${paramIdx++}`);
      sqlParams.push(parseInt(params.datasetId, 10));
    }
  }

  // 2. Financial Year
  if (params.fy_code || params.financialYear || params.fy) {
    const fyVal = params.fy_code || params.financialYear || params.fy;
    if (fyVal && fyVal !== 'all' && fyVal !== 'All Financial Years') {
      clauses.push(`sd.fy_code = $${paramIdx++}`);
      sqlParams.push(fyVal);
    }
  }

  // 3. Division (VG / FC)
  if (params.division) {
    clauses.push(`m.division = $${paramIdx++}`);
    sqlParams.push(params.division);
  }

  // 4. Distribution Channel
  if (params.dist_channel || params.distributionChannel || params.channel) {
    const channelVal = params.dist_channel || params.distributionChannel || params.channel;
    if (channelVal === 'Dealer & Distributor') {
      clauses.push(`c.dist_channel = 'DD'`);
    } else if (channelVal === 'Institutional Sales') {
      clauses.push(`c.dist_channel IN ('ST', 'IS')`);
    } else if (channelVal === 'Government Sales') {
      clauses.push(`c.dist_channel = 'GS'`);
    } else if (channelVal === 'Export') {
      clauses.push(`c.dist_channel IN ('ES', 'EO')`);
    } else {
      clauses.push(`c.dist_channel = $${paramIdx++}`);
      sqlParams.push(channelVal);
    }
  }

  // 5. State
  if (params.state) {
    clauses.push(`t.state = $${paramIdx++}`);
    sqlParams.push(params.state);
  }

  // 6. Territory
  if (params.territory) {
    clauses.push(`t.territory = $${paramIdx++}`);
    sqlParams.push(params.territory);
  }

  // 7. Crop
  if (params.crop) {
    clauses.push(`m.crop = $${paramIdx++}`);
    sqlParams.push(params.crop);
  }

  // 8. Variety
  if (params.variety) {
    clauses.push(`m.variety = $${paramIdx++}`);
    sqlParams.push(params.variety);
  }

  // 9. Employee managers cascading (RBM, AM, DBM)
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

  // 10. Date boundaries
  if (params.start_date || params.startDate) {
    const startVal = params.start_date || params.startDate;
    clauses.push(`sd.invoice_date >= $${paramIdx++}`);
    sqlParams.push(startVal);
  }
  if (params.end_date || params.endDate) {
    const endVal = params.end_date || params.endDate;
    clauses.push(`sd.invoice_date <= $${paramIdx++}`);
    sqlParams.push(endVal);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { whereClause, sqlParams, nextParamIndex: paramIdx };
}
