import { translateQuestionToPlan, repairSQLQuery } from '../ai/queryTranslator.js';
import { executeQueryPlan } from '../services/queryExecutor.js';
import { synthesizeAnswer } from '../ai/answerSynthesizer.js';
import { dbRun, dbGet, dbAll, dbTransaction } from '../database.js';
import { getTargetDatasetId } from '../controllers/dashboardController.js';


const ALLOWED_VISUALIZATIONS = [
  "line",
  "bar",
  "pie",
  "area",
  "treemap",
  "donut",
  "scatter",
  "stacked_bar",
  "horizontal_bar"
];

const defaultSuggestions = [
  "What are total sales and net sales?",
  "Which state generated the highest sales?",
  "Which crop performed best in Vegetable Division?",
  "Show sales returns by state"
];

function sanitizeEncoding(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/₹/g, 'Rs.');
}

/**
 * Deterministically inject active dashboard filters into the AI-generated SQL.
 * This is a safety net: even if the LLM ignores the filter context prompt,
 * this function ensures the SQL always matches the dashboard's active scope.
 */
function injectMissingFilters(sql, mergedFilters) {
  if (!sql || !mergedFilters) return sql;

  const sqlLower = sql.toLowerCase();
  let injected = sql;
  const extraConditions = [];
  let extraJoins = '';

  // Division filter — requires JOIN materials
  if (mergedFilters.division && !sqlLower.includes('division')) {
    const hasMaterialsJoin = /join\s+materials\s+/i.test(sql);
    if (!hasMaterialsJoin) {
      // Find the FROM clause to append the JOIN
      extraJoins += ` JOIN materials m ON sd.material_code = m.material_code`;
    }
    extraConditions.push(`m.division = '${mergedFilters.division.replace(/'/g, "''")}'`);
  }

  // State filter — requires JOIN territories
  if (mergedFilters.state && !sqlLower.includes('state')) {
    const hasTerritoriesJoin = /join\s+territories\s+/i.test(sql);
    if (!hasTerritoriesJoin) {
      extraJoins += ` JOIN territories t ON sd.territory_id = t.territory_id`;
    }
    extraConditions.push(`t.state ILIKE '${mergedFilters.state.replace(/'/g, "''")}' `);
  }

  // Crop filter — requires JOIN materials
  if (mergedFilters.crop && !sqlLower.includes('crop')) {
    const hasMaterialsJoin = /join\s+materials\s+/i.test(sql) || extraJoins.includes('materials');
    if (!hasMaterialsJoin) {
      extraJoins += ` JOIN materials m ON sd.material_code = m.material_code`;
    }
    extraConditions.push(`m.crop ILIKE '${mergedFilters.crop.replace(/'/g, "''")}' `);
  }

  // Distribution channel filter — requires JOIN customers
  if (mergedFilters.distributionChannel && !sqlLower.includes('dist_channel') && !sqlLower.includes('distribution_channel')) {
    const hasCustomersJoin = /join\s+customers\s+/i.test(sql);
    if (!hasCustomersJoin) {
      extraJoins += ` JOIN customers c ON sd.customer_id = c.customer_id`;
    }
    extraConditions.push(`c.dist_channel ILIKE '${mergedFilters.distributionChannel.replace(/'/g, "''")}' `);
  }

  if (extraConditions.length === 0 && !extraJoins) return sql;

  // Inject extra JOINs right before WHERE (or at end of FROM/JOIN block)
  if (extraJoins) {
    const whereMatch = injected.match(/\bWHERE\b/i);
    if (whereMatch) {
      const whereIndex = injected.indexOf(whereMatch[0]);
      injected = injected.slice(0, whereIndex) + extraJoins + ' ' + injected.slice(whereIndex);
    } else {
      // No WHERE clause — append JOINs before GROUP BY or ORDER BY or end
      const endMatch = injected.match(/\b(GROUP BY|ORDER BY|LIMIT)\b/i);
      if (endMatch) {
        const endIndex = injected.indexOf(endMatch[0]);
        injected = injected.slice(0, endIndex) + extraJoins + ' ' + injected.slice(endIndex);
      } else {
        injected += extraJoins;
      }
    }
  }

  // Inject extra WHERE conditions
  if (extraConditions.length > 0) {
    const condStr = extraConditions.join(' AND ');
    const whereMatch = injected.match(/\bWHERE\b/i);
    if (whereMatch) {
      const whereIndex = injected.indexOf(whereMatch[0]) + whereMatch[0].length;
      injected = injected.slice(0, whereIndex) + ' ' + condStr + ' AND' + injected.slice(whereIndex);
    } else {
      const endMatch = injected.match(/\b(GROUP BY|ORDER BY|LIMIT)\b/i);
      if (endMatch) {
        const endIndex = injected.indexOf(endMatch[0]);
        injected = injected.slice(0, endIndex) + ' WHERE ' + condStr + ' ' + injected.slice(endIndex);
      } else {
        injected += ' WHERE ' + condStr;
      }
    }
  }

  console.log('[Filter Injection] Active filters applied to SQL:', extraConditions);
  return injected;
}

/**
 * Shared service layer processing BI Copilot question statefully
 */
export async function processQuestion({ question, sessionId, filters }) {
  const datasetId = await getTargetDatasetId(filters?.datasetId || filters?.activeDatasetId);
  const questionLower = question.toLowerCase();

  // 1. Resolve or bootstrap active session
  let session = null;
  try {
    if (sessionId) {
      session = await dbGet("SELECT * FROM copilot_sessions WHERE id = $1 AND status = 'active'", [sessionId]);
    }
    if (!session) {
      const title = `Chat on ${new Date().toLocaleDateString('en-IN')}`;
      session = await dbGet(
        "INSERT INTO copilot_sessions (title, status, context) VALUES ($1, 'active', '{}'::jsonb) RETURNING *",
        [title]
      );
    }
  } catch (err) {
    console.error('Session resolution failed, falling back to mock session ID:', err);
    session = { id: '00000000-0000-0000-0000-000000000000', context: '{}' };
  }

  let sessionContext = typeof session.context === 'string' ? JSON.parse(session.context) : (session.context || {});
  if (!sessionContext.filters) sessionContext.filters = {};
  if (!sessionContext.chartPreferences) sessionContext.chartPreferences = {};

  // 2. Save user message to database (sanitized)
  let userMsgId = null;
  if (session.id !== '00000000-0000-0000-0000-000000000000') {
    try {
      const sanitizedQuestion = sanitizeEncoding(question);
      const userMsg = await dbGet(
        "INSERT INTO copilot_messages (session_id, role, content) VALUES ($1, 'user', $2) RETURNING id",
        [session.id, sanitizedQuestion]
      );
      userMsgId = userMsg?.id;
    } catch (e) {
      console.error('Failed to log user message:', e);
    }
  }

  // 3. Pre-checks for timeline limitations
  if (
    questionLower.includes('2025-26') || 
    questionLower.includes('fy25-26') || 
    questionLower.includes('fy2526') || 
    (questionLower.includes('previous year') && questionLower.includes('growth'))
  ) {
    const responsePayload = {
      answer: "I cannot calculate sales growth comparisons because the data file for FY2025-26 is missing.",
      intent: "other",
      navigateTo: "summary",
      section: "sales-overview",
      filters: sessionContext.filters,
      chartPreferences: sessionContext.chartPreferences,
      insights: "I cannot calculate sales growth comparisons because the data file for FY2025-26 is missing.",
      warning: {
        title: "Data Limitation Notice",
        message: "The SAP sales extract file for FY2025-26 (ACSEN-SalesData-FY2526.xlsx) has not been received. Year-on-year calculations and comparisons spanning this period are disabled in this current system version."
      },
      limitationNote: "FY2025-26 data is currently missing from the system.",
      sessionId: session.id,
      suggestions: defaultSuggestions
    };
    
    if (session.id !== '00000000-0000-0000-0000-000000000000') {
      try {
        const assistMsg = await dbGet(
          "INSERT INTO copilot_messages (session_id, role, content, metadata) VALUES ($1, 'assistant', $2, $3::jsonb) RETURNING id",
          [session.id, responsePayload.answer, JSON.stringify({ intent: 'other', navigateTo: 'summary', section: 'sales-overview', filters: {} })]
        );
        await dbRun(
          "INSERT INTO copilot_executions (session_id, message_id, intent, filters, result_summary, execution_status, execution_time_ms) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)",
          [session.id, assistMsg.id, 'other', JSON.stringify(sessionContext.filters), 'Timeline limitation block', 'success', 0]
        );
      } catch (e) {
        console.error(e);
      }
    }
    
    return responsePayload;
  }

  // Pre-checks for budget scope limitations
  if (
    questionLower.includes('budget') || 
    questionLower.includes('forecast') || 
    questionLower.includes('variance') || 
    questionLower.includes('target')
  ) {
    const responsePayload = {
      answer: "I am unable to display budget comparisons because budget data is not part of the scope.",
      intent: "other",
      navigateTo: "summary",
      section: "sales-overview",
      filters: sessionContext.filters,
      chartPreferences: sessionContext.chartPreferences,
      insights: "I am unable to display budget comparisons because budget data is not part of the scope.",
      scopeWarning: {
        title: "Feature Out of Scope",
        message: "Budget-versus-actual analysis, COGM planned-versus-actuals, and forecasts are outside the scope of this sales POC."
      },
      limitationNote: "Budget/Forecast variance comparisons are outside the POC requirements.",
      sessionId: session.id,
      suggestions: defaultSuggestions
    };
    
    if (session.id !== '00000000-0000-0000-0000-000000000000') {
      try {
        const assistMsg = await dbGet(
          "INSERT INTO copilot_messages (session_id, role, content, metadata) VALUES ($1, 'assistant', $2, $3::jsonb) RETURNING id",
          [session.id, responsePayload.answer, JSON.stringify({ intent: 'other', navigateTo: 'summary', section: 'sales-overview', filters: {} })]
        );
        await dbRun(
          "INSERT INTO copilot_executions (session_id, message_id, intent, filters, result_summary, execution_status, execution_time_ms) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)",
          [session.id, assistMsg.id, 'other', JSON.stringify(sessionContext.filters), 'Budget limitation block', 'success', 0]
        );
      } catch (e) {
        console.error(e);
      }
    }

    return responsePayload;
  }

  // 4. Load the last 5 user/assistant exchanges (10 messages total)
  let history = [];
  if (session.id !== '00000000-0000-0000-0000-000000000000') {
    try {
      history = await dbAll(
        "SELECT role, content FROM copilot_messages WHERE session_id = $1 AND id != $2 ORDER BY created_at ASC LIMIT 10",
        [session.id, userMsgId || '00000000-0000-0000-0000-000000000000']
      );
    } catch (e) {
      console.error('Failed to load chat history:', e);
    }
  }

  // 5. Merge incoming filter contexts
  const incomingFilters = filters || {};
  const mergedFilters = {
    datasetId,
    fy: incomingFilters.fy_code || incomingFilters.financialYear || sessionContext.filters.financialYear || null,
    crop: incomingFilters.crop || sessionContext.filters.crop || null,
    state: incomingFilters.state || sessionContext.filters.state || null,
    division: incomingFilters.division || sessionContext.filters.division || null,
    distributionChannel: incomingFilters.dist_channel || incomingFilters.distributionChannel || sessionContext.filters.distributionChannel || null
  };

  // Clean nulls
  Object.keys(mergedFilters).forEach(key => {
    if (mergedFilters[key] === null) {
      delete mergedFilters[key];
    }
  });

  // 6. Invoke LLM Translator
  console.log(`Translating question statefully: "${question}" with context filters:`, mergedFilters);
  const queryPlan = await translateQuestionToPlan(question, mergedFilters, history);
  console.log("AI Query Plan:", queryPlan);

  // 7. Verify Out of Scope
  if (queryPlan.out_of_scope) {
    const responsePayload = {
      answer: "Please ask questions related to Acsen Agriscience sales data, crops, states, variety performance, or return rates.",
      intent: "other",
      navigateTo: "summary",
      section: "sales-overview",
      filters: sessionContext.filters,
      chartPreferences: sessionContext.chartPreferences,
      insights: "Please ask questions related to Acsen Agriscience sales data, crops, states, variety performance, or return rates.",
      tableData: { headers: [], rows: [] },
      chartData: { type: "none", xAxis: "", series: [], data: [] },
      calculationBasis: "Query out of scope.",
      appliedFilters: {},
      limitationNote: "Politely refused off-topic query.",
      sessionId: session.id,
      suggestions: defaultSuggestions
    };

    if (session.id !== '00000000-0000-0000-0000-000000000000') {
      try {
        const assistMsg = await dbGet(
          "INSERT INTO copilot_messages (session_id, role, content, metadata) VALUES ($1, 'assistant', $2, $3::jsonb) RETURNING id",
          [session.id, responsePayload.answer, JSON.stringify({ intent: 'other', navigateTo: 'summary', section: 'sales-overview', filters: {} })]
        );
        await dbRun(
          "INSERT INTO copilot_executions (session_id, message_id, intent, query_plan, filters, result_summary, execution_status, execution_time_ms) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)",
          [session.id, assistMsg.id, 'other', JSON.stringify(queryPlan), JSON.stringify(sessionContext.filters), 'Out of scope query refused', 'success', 0]
        );
      } catch (e) {
        console.error(e);
      }
    }

    return responsePayload;
  }

  // 8. Verify Confidence
  if (typeof queryPlan.confidence === 'number' && queryPlan.confidence < 0.6) {
    const responsePayload = {
      answer: `I am not fully sure what you mean. Could you please clarify your question? For example: "What are total sales in Tamil Nadu?" or "Show returns for crop Tomato."`,
      intent: "other",
      navigateTo: "summary",
      section: "sales-overview",
      filters: sessionContext.filters,
      chartPreferences: sessionContext.chartPreferences,
      insights: "I am not fully sure what you mean. Could you please clarify your question?",
      tableData: { headers: [], rows: [] },
      chartData: { type: "none", xAxis: "", series: [], data: [] },
      calculationBasis: "Confidence below threshold.",
      appliedFilters: {},
      sessionId: session.id,
      suggestions: defaultSuggestions
    };

    if (session.id !== '00000000-0000-0000-0000-000000000000') {
      try {
        const assistMsg = await dbGet(
          "INSERT INTO copilot_messages (session_id, role, content, metadata) VALUES ($1, 'assistant', $2, $3::jsonb) RETURNING id",
          [session.id, responsePayload.answer, JSON.stringify({ intent: 'other', navigateTo: 'summary', section: 'sales-overview', filters: {} })]
        );
        await dbRun(
          "INSERT INTO copilot_executions (session_id, message_id, intent, query_plan, filters, result_summary, execution_status, execution_time_ms) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)",
          [session.id, assistMsg.id, 'other', JSON.stringify(queryPlan), JSON.stringify(sessionContext.filters), 'Low confidence verification requested', 'success', 0]
        );
      } catch (e) {
        console.error(e);
      }
    }

    return responsePayload;
  }

  // 9. Deterministic filter injection — ensure SQL matches dashboard scope
  queryPlan.sql = injectMissingFilters(queryPlan.sql, mergedFilters);

  // 10. Execute SQL Query
  console.log("Executing SQL:", queryPlan.sql);
  const queryStartTime = Date.now();
  let resultRows = [];
  let queryError = null;

  try {
    resultRows = await executeQueryPlan(null, queryPlan, datasetId);
    console.log(`Query completed successfully, returned ${resultRows.length} records.`);
  } catch (e) {
    console.warn('SQL query execution failed, attempting auto-repair...', e.message);
    try {
      const repairedSql = await repairSQLQuery(question, queryPlan.sql, e.message);
      if (repairedSql) {
        const originalHadClassification = (queryPlan.filters?.some(f => f.column === 'classification')) || queryPlan.sql.toLowerCase().includes('classification');
        const repairedHasClassification = repairedSql.toLowerCase().includes('classification');
        if (originalHadClassification && !repairedHasClassification) {
          console.warn('Auto-repair dropped a classification filter, this likely produces incorrect aggregated totals. Rejecting repair.');
          queryError = 'Auto-repair removed a required business filter (classification) rather than fixing the underlying join; refusing to use this query to avoid returning incorrect totals.';
        } else {
          console.log('Successfully repaired SQL:', repairedSql);
          queryPlan.sql = repairedSql;
          resultRows = await executeQueryPlan(null, queryPlan, datasetId);
          queryError = null; // Cleared error!
        }
      } else {
        throw e;
      }
    } catch (repairErr) {
      console.error('SQL auto-repair failed:', repairErr);
      queryError = repairErr.message;
    }
  }
  const executionTime = Date.now() - queryStartTime;

  if (queryError) {
    const responsePayload = {
      answer: `I generated a SQL query but ran into a database error during execution: ${queryError}`,
      intent: "other",
      navigateTo: "summary",
      section: "sales-overview",
      filters: sessionContext.filters,
      chartPreferences: sessionContext.chartPreferences,
      insights: "Database execution error occurred.",
      tableData: { headers: [], rows: [] },
      chartData: { type: "none", xAxis: "", series: [], data: [] },
      calculationBasis: "Query execution failed.",
      appliedFilters: {},
      sessionId: session.id,
      suggestions: defaultSuggestions
    };

    if (session.id !== '00000000-0000-0000-0000-000000000000') {
      try {
        const assistMsg = await dbGet(
          "INSERT INTO copilot_messages (session_id, role, content, metadata) VALUES ($1, 'assistant', $2, $3::jsonb) RETURNING id",
          [session.id, responsePayload.answer, JSON.stringify({ intent: 'other', navigateTo: 'summary', section: 'sales-overview', filters: {} })]
        );
        await dbRun(
          "INSERT INTO copilot_executions (session_id, message_id, intent, query_plan, filters, result_summary, execution_status, execution_time_ms) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)",
          [session.id, assistMsg.id, queryPlan.navigation?.intent || 'other', JSON.stringify(queryPlan), JSON.stringify(sessionContext.filters), queryError, 'failed', executionTime]
        );
      } catch (e) {
        console.error(e);
      }
    }

    return responsePayload;
  }

  // 10. Format charting & tables data
  let tableHeaders = [];
  let tableRows = [];
  if (resultRows.length > 0) {
    const columns = Object.keys(resultRows[0]);
    tableHeaders = columns;
    tableRows = resultRows.map(row => columns.map(col => row[col] ?? 0));
  }

  let targetValCol = "salesAmountINR";
  if (resultRows.length > 0) {
    const columns = Object.keys(resultRows[0]);
    const metricColRaw = queryPlan.metric?.column || "";
    if (
      metricColRaw.trim().toLowerCase().includes("net external sales") || 
      metricColRaw.trim().toLowerCase().includes("net sales") || 
      metricColRaw.trim().toLowerCase().includes("net_external_sales")
    ) {
      targetValCol = "Net External Sales";
    } else {
      const foundCol = columns.find(c => c.toLowerCase() === metricColRaw.toLowerCase() || (c === 'salesAmountINR' && metricColRaw.toLowerCase().includes('amount')));
      if (foundCol) {
        targetValCol = foundCol;
      } else {
        targetValCol = columns[columns.length - 1]; // Default to final column
      }
    }
  }

  const groupbyCols = queryPlan.groupby || [];
  let chartType = queryPlan.chart_recommendation || "bar";
  if (groupbyCols.length === 0 || chartType === 'none') {
    chartType = 'none';
  }

  const chartData = {
    type: chartType,
    xAxis: groupbyCols[0] || "Metric",
    series: [targetValCol],
    data: resultRows
  };

  const filtersDesc = (queryPlan.filters || []).map(f => `${f.column} ${f.operator} ${f.value}`).join(', ');
  let calcBasis = `Aggregated ${targetValCol} (${queryPlan.metric?.aggregation || 'sum'})`;
  if (groupbyCols.length > 0) {
    calcBasis += ` grouped by ${groupbyCols.join(', ')}`;
  }
  if (filtersDesc) {
    calcBasis += ` filtered by [${filtersDesc}]`;
  }

  // Handle empty SQL datasets
  if (resultRows.length === 0) {
    const responsePayload = {
      answer: "No records found matching the query context filters.",
      intent: queryPlan.navigation?.intent || "other",
      navigateTo: queryPlan.navigation?.navigateTo || "summary",
      section: queryPlan.navigation?.section || "sales-overview",
      filters: sessionContext.filters,
      chartPreferences: sessionContext.chartPreferences,
      insights: "No database records matched the selection criteria.",
      tableData: { headers: [], rows: [] },
      chartData: { type: "none", xAxis: "", series: [], data: [] },
      calculationBasis: "No matching records found.",
      appliedFilters: {},
      sessionId: session.id,
      suggestions: defaultSuggestions
    };

    if (session.id !== '00000000-0000-0000-0000-000000000000') {
      try {
        const assistMsg = await dbGet(
          "INSERT INTO copilot_messages (session_id, role, content, metadata) VALUES ($1, 'assistant', $2, $3::jsonb) RETURNING id",
          [session.id, responsePayload.answer, JSON.stringify({ intent: responsePayload.intent, navigateTo: responsePayload.navigateTo, section: responsePayload.section, filters: {} })]
        );
        await dbRun(
          "INSERT INTO copilot_executions (session_id, message_id, intent, query_plan, filters, result_summary, execution_status, execution_time_ms) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)",
          [session.id, assistMsg.id, responsePayload.intent, JSON.stringify(queryPlan), JSON.stringify(sessionContext.filters), 'Zero records returned', 'success', executionTime]
        );
      } catch (e) {
        console.error(e);
      }
    }

    return responsePayload;
  }

  // 11. Synthesize Answer
  const synthesized = await synthesizeAnswer(question, queryPlan, resultRows, mergedFilters);
  const answer = (synthesized && typeof synthesized === 'object') ? (synthesized.answer || '') : (synthesized || '');
  const insights = (synthesized && typeof synthesized === 'object') ? (synthesized.insights || '') : '';

  // 12. Stateful Context merging & Visualization Preference updates
  if (!queryPlan.navigation) {
    queryPlan.navigation = {};
  }
  const planNav = queryPlan.navigation;
  
  // Rule-based deterministic navigation overrides
  const NAV_RULES = [
    {
      keywords: ['crop', 'product', 'variety', 'top crop', 'revenue crop', 'material'],
      navigateTo: 'product',
      section: 'crops-revenue'
    },
    {
      keywords: ['state', 'territory', 'region', 'geography', 'place', 'location', 'area'],
      navigateTo: 'geography',
      section: 'top-states'
    },
    {
      keywords: ['return', 'refund', 'returned'],
      navigateTo: 'returns',
      section: 'returns-summary'
    },
    {
      keywords: ['invoice', 'transaction', 'packet', 'batch', 'plant', 'expiry', 'sales order', 'created by', 'detail', 'list'],
      navigateTo: 'transactions',
      section: 'transaction-drilldown'
    }
  ];

  const queryLower = question.toLowerCase();
  let matchedRule = null;
  for (const rule of NAV_RULES) {
    if (rule.keywords.some(kw => queryLower.includes(kw))) {
      matchedRule = rule;
      break;
    }
  }

  if (matchedRule) {
    planNav.navigateTo = matchedRule.navigateTo;
    planNav.section = matchedRule.section;
    planNav.intent = 'show_sales_report';
    console.log(`Deterministic navigation override matched: ${matchedRule.navigateTo} (${matchedRule.section})`);
  }

  if (!planNav.filters) {
    planNav.filters = {};
  }
  const planFilters = planNav.filters;

  // Dynamically enrich navigation filters using actual SQL results if it is a "top/highest/best" type query
  const isTopQuery = queryLower.includes('highest') || queryLower.includes('top') || queryLower.includes('best') || queryLower.includes('maximum') || queryLower.includes('most');
  
  if (isTopQuery && resultRows.length > 0) {
    const topRow = resultRows[0];
    for (const key of Object.keys(topRow)) {
      const val = topRow[key];
      if (val === null || val === undefined) continue;
      
      const keyLower = key.toLowerCase();
      // Only extract string names, ignore numeric metrics (like crop_revenue or state_sales)
      if (isNaN(Number(val))) {
        if (keyLower.includes('crop') || keyLower.includes('material_desc') || keyLower.includes('material_name')) {
          planFilters.crop = String(val);
        } else if (keyLower.includes('state')) {
          planFilters.state = String(val);
        } else if (keyLower.includes('division')) {
          planFilters.division = String(val).toUpperCase();
        } else if (keyLower.includes('channel') || keyLower.includes('dist_channel') || keyLower.includes('distribution_channel')) {
          planFilters.distributionChannel = String(val);
        }
      }
    }
  }

  const updatedContextFilters = {
    ...sessionContext.filters,
    ...planFilters
  };

  // Ensure active dashboard filters are always preserved in navigation
  if (mergedFilters.division && !updatedContextFilters.division) {
    updatedContextFilters.division = mergedFilters.division;
  }
  if (mergedFilters.fy && !updatedContextFilters.financialYear) {
    updatedContextFilters.financialYear = mergedFilters.fy;
  }

  // Remove keys explicitly nulled out
  Object.keys(planFilters).forEach(key => {
    if (planFilters[key] === null) {
      delete updatedContextFilters[key];
    }
  });

  // Extract visualization type if validated
  let visualization = null;
  if (queryPlan.visualization && queryPlan.visualization.type) {
    const type = queryPlan.visualization.type.toLowerCase();
    if (ALLOWED_VISUALIZATIONS.includes(type)) {
      visualization = { type };
    }
  }

  // Update chartPreferences inside context
  const updatedChartPreferences = {
    ...(sessionContext.chartPreferences || {})
  };

  const targetSection = planNav.section || sessionContext.lastSection || "sales-overview";
  if (visualization && targetSection) {
    updatedChartPreferences[targetSection] = visualization.type;
  } else if (planNav.intent === 'reset_visualization' && targetSection) {
    delete updatedChartPreferences[targetSection];
  }

  const newContext = {
    filters: updatedContextFilters,
    chartPreferences: updatedChartPreferences,
    lastIntent: planNav.intent || sessionContext.lastIntent || "show_sales_report",
    lastTab: planNav.navigateTo || sessionContext.lastTab || "summary",
    lastSection: targetSection,
    lastQuestion: question,
    updatedAt: new Date().toISOString()
  };

  // 13. Persist state changes atomically within a transaction context
  if (session.id !== '00000000-0000-0000-0000-000000000000') {
    try {
      const assistMetadata = {
        intent: planNav.intent || "show_sales_report",
        navigateTo: planNav.navigateTo || "summary",
        section: targetSection,
        filters: planFilters,
        visualization: visualization
      };

      await dbTransaction(async () => {
        // Save assistant message (sanitized)
        const sanitizedAnswer = sanitizeEncoding(answer);
        const assistMsg = await dbGet(
          "INSERT INTO copilot_messages (session_id, role, content, metadata) VALUES ($1, 'assistant', $2, $3::jsonb) RETURNING id",
          [session.id, sanitizedAnswer, JSON.stringify(assistMetadata)]
        );

        // Save session context updates
        await dbRun(
          "UPDATE copilot_sessions SET context = $1::jsonb, total_messages = total_messages + 2, last_activity_at = NOW(), updated_at = NOW() WHERE id = $2",
          [JSON.stringify(newContext), session.id]
        );

        // Log execution stats
        await dbRun(
          "INSERT INTO copilot_executions (session_id, message_id, intent, query_plan, filters, result_summary, execution_status, execution_time_ms) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)",
          [
            session.id,
            assistMsg.id,
            planNav.intent || 'other',
            JSON.stringify(queryPlan),
            JSON.stringify(newContext.filters),
            `Returned ${resultRows.length} rows successfully`,
            'success',
            executionTime
          ]
        );
      });
    } catch (dbErr) {
      console.error('Failed to commit state changes in database transaction:', dbErr);
    }
  }

  // 14. Return the full payload
  return {
    answer,
    intent: planNav.intent || "show_sales_report",
    navigateTo: planNav.navigateTo || "summary",
    section: targetSection,
    filters: updatedContextFilters,
    chartPreferences: updatedChartPreferences,
    visualization: visualization,
    insights: answer,
    tableData: {
      headers: tableHeaders,
      rows: tableRows
    },
    chartData,
    calculationBasis: calcBasis,
    appliedFilters: updatedContextFilters,
    // Pass comparisonContext from the LLM plan so the frontend can update
    // the Time Intelligence panel (Primary Year / Compare Year dropdowns)
    comparisonContext: queryPlan.comparisonContext || null,
    limitationNote: null,
    sessionId: session.id,
    suggestions: defaultSuggestions
  };
}
