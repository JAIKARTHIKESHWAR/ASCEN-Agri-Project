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
  return str
    .replace(/₹/g, 'Rs.')
    .replace(/[\u2212\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-') // replace all unicode minus/dashes with standard ASCII hyphen (-)
    .replace(/[\u00d7\u2715]/g, 'x') // replace unicode multiplication signs with standard ASCII x
    .replace(/−/g, '-');
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

  // 1. If the query targets dataset_aggregates, only inject fy_code and do NOT attempt raw joins
  if (sqlLower.includes('dataset_aggregates')) {
    const targetFy = mergedFilters.fy || (mergedFilters.datasetId && mergedFilters.datasetId !== 'all' ? mergedFilters.datasetId : null);
    if (targetFy && !sqlLower.includes('fy_code')) {
      extraConditions.push(`fy_code = '${targetFy.replace(/'/g, "''")}'`);
    }
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
    return injected;
  }

  // 2. Resolve target table or alias dynamically for raw queries (prevents "missing FROM-clause entry for table 'sd'")
  let tableRef = 'sd';
  const fromMatch = sql.match(/\bFROM\s+([a-zA-Z0-9_]+)(?:\s+([a-zA-Z0-9_]+))?\b/i);
  if (fromMatch) {
    const tableName = fromMatch[1];
    const possibleAlias = fromMatch[2];
    if (possibleAlias && !['join', 'where', 'group', 'order', 'limit'].includes(possibleAlias.toLowerCase())) {
      tableRef = possibleAlias;
    } else {
      tableRef = tableName;
    }
  }

  // Dynamic fy_code filter injection
  const targetFy = mergedFilters.fy || (mergedFilters.datasetId && mergedFilters.datasetId !== 'all' ? mergedFilters.datasetId : null);
  if (targetFy && !sqlLower.includes('fy_code')) {
    extraConditions.push(`${tableRef}.fy_code = '${targetFy.replace(/'/g, "''")}'`);
  }

  // Division filter — requires JOIN materials
  if (mergedFilters.division && !sqlLower.includes('division')) {
    const hasMaterialsJoin = /join\s+materials\s+/i.test(sql);
    if (!hasMaterialsJoin) {
      extraJoins += ` JOIN materials m ON ${tableRef}.material_code = m.material_code`;
    }
    extraConditions.push(`m.division = '${mergedFilters.division.replace(/'/g, "''")}'`);
  }

  // State filter — requires JOIN territories
  if (mergedFilters.state && !sqlLower.includes('state')) {
    const hasTerritoriesJoin = /join\s+territories\s+/i.test(sql);
    if (!hasTerritoriesJoin) {
      extraJoins += ` JOIN territories t ON ${tableRef}.territory_id = t.territory_id`;
    }
    extraConditions.push(`t.state ILIKE '${mergedFilters.state.replace(/'/g, "''")}' `);
  }

  // Crop filter — requires JOIN materials
  if (mergedFilters.crop && !sqlLower.includes('crop')) {
    const hasMaterialsJoin = /join\s+materials\s+/i.test(sql) || extraJoins.includes('materials');
    if (!hasMaterialsJoin) {
      extraJoins += ` JOIN materials m ON ${tableRef}.material_code = m.material_code`;
    }
    extraConditions.push(`m.crop ILIKE '${mergedFilters.crop.replace(/'/g, "''")}' `);
  }

  // Distribution channel filter — requires JOIN customers
  if (mergedFilters.distributionChannel && !sqlLower.includes('dist_channel') && !sqlLower.includes('distribution_channel')) {
    const hasCustomersJoin = /join\s+customers\s+/i.test(sql);
    if (!hasCustomersJoin) {
      extraJoins += ` JOIN customers c ON ${tableRef}.customer_id = c.customer_id`;
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
 * Classifies a user's question into one of four memory modes:
 * - CONTEXTUAL_FOLLOWUP: Contains pronouns or follow-up phrases.
 * - AMBIGUOUS_SHORT_QUERY: Short query containing only metric keywords.
 * - FILTER_UPDATE: Short query containing only a known entity (State, Crop, Division, FY).
 * - INDEPENDENT: A complete new analytical request.
 */
async function classifyMemoryMode(question, sessionContext) {
  const qClean = question.trim().toLowerCase();
  const words = qClean.split(/\s+/).filter(Boolean);

  // 1. Contextual Follow-up
  const followUpPatterns = [
    /\b(it|its|that|those|them|this)\b/i,
    /\bwhat about\b/i,
    /\bhow about\b/i,
    /\band in\b/i,
    /\bfor that\b/i,
    /\bcompare with\b/i,
    /\bsame crop\b/i,
    /\bsame state\b/i,
    /\bagain\b/i,
    /\balso\b/i
  ];
  if (followUpPatterns.some(pattern => pattern.test(qClean))) {
    return 'contextual_followup';
  }

  // 2. Ambiguous Short Query
  const metricKeywords = ['revenue', 'sales', 'profit', 'quantity', 'growth', 'contribution', 'trend', 'how much', 'sales value', 'returns value', 'cancelled value'];
  const hasMetricKeyword = metricKeywords.some(kw => qClean.includes(kw));
  if (words.length <= 4 && hasMetricKeyword) {
    return 'ambiguous_short_query';
  }

  // 3. Filter Update
  if (words.length <= 3) {
    let entityCandidate = qClean;
    const prepMatch = qClean.match(/^(in|for|under|at|to|on)\s+(.+)$/);
    if (prepMatch) {
      entityCandidate = prepMatch[2];
    }

    // Check Division
    const divUpper = entityCandidate.toUpperCase();
    if (['VG', 'FC', 'CM', 'VEGETABLES', 'FIELD CROPS', 'COMMON'].includes(divUpper)) {
      return 'filter_update';
    }

    // Check Financial Year
    if (/^fy\s*\d{4}$/i.test(entityCandidate) || /^fy\s*\d{2}-\d{2}$/i.test(entityCandidate)) {
      return 'filter_update';
    }

    // Check State in DB
    try {
      const stateRow = await dbGet("SELECT 1 FROM territories WHERE state ILIKE $1 LIMIT 1", [entityCandidate]);
      if (stateRow) return 'filter_update';
    } catch (e) {
      console.error("Error checking state in DB:", e);
    }

    // Check Crop in DB
    try {
      const cropRow = await dbGet("SELECT 1 FROM materials WHERE crop ILIKE $1 LIMIT 1", [entityCandidate]);
      if (cropRow) return 'filter_update';
    } catch (e) {
      console.error("Error checking crop in DB:", e);
    }
  }

  return 'independent';
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
  if (!sessionContext.memory) {
    sessionContext.memory = {
      lastIntent: null,
      lastMetric: null,
      lastResolvedQuestion: null,
      lastFilters: {},
      lastEntity: null
    };
  }

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

  // 4. Classify Memory Mode
  const memoryMode = await classifyMemoryMode(question, sessionContext);
  console.log(`[Memory Mode Classifier] Classified question "${question}" as: ${memoryMode}`);

  let history = [];
  let resolvedQuestion = question;
  
  // 5. Merge incoming filter contexts
  const incomingFilters = filters || {};
  const dashboardFilters = {
    datasetId,
    fy: incomingFilters.fy_code || incomingFilters.financialYear || null,
    crop: incomingFilters.crop || null,
    state: incomingFilters.state || null,
    division: incomingFilters.division || null,
    distributionChannel: incomingFilters.dist_channel || incomingFilters.distributionChannel || null
  };

  // Clean nulls
  Object.keys(dashboardFilters).forEach(key => {
    if (dashboardFilters[key] === null) {
      delete dashboardFilters[key];
    }
  });

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

  let activeFiltersForQuery = { ...mergedFilters };

  if (memoryMode === 'contextual_followup') {
    // Contextual Follow-up: Pass the last 4 messages of history to the LLM
    if (session.id !== '00000000-0000-0000-0000-000000000000') {
      try {
        history = await dbAll(
          "SELECT role, content FROM copilot_messages WHERE session_id = $1 AND id != $2 ORDER BY created_at ASC LIMIT 4",
          [session.id, userMsgId || '00000000-0000-0000-0000-000000000000']
        );
      } catch (e) {
        console.error('Failed to load chat history:', e);
      }
    }
    activeFiltersForQuery = {
      ...sessionContext.memory.lastFilters,
      ...mergedFilters
    };
  } else if (memoryMode === 'filter_update') {
    // Filter Update: Reuse previous intent and metric, replace specific filter
    let entityCandidate = question.trim().toLowerCase();
    const prepMatch = entityCandidate.match(/^(in|for|under|at|to|on)\s+(.+)$/i);
    if (prepMatch) {
      entityCandidate = prepMatch[2];
    }

    const divUpper = entityCandidate.toUpperCase();
    let detectedFilter = {};
    if (['VG', 'FC', 'CM', 'VEGETABLES', 'FIELD CROPS', 'COMMON'].includes(divUpper)) {
      let mappedDiv = 'VG';
      if (divUpper.startsWith('FC') || divUpper.includes('FIELD')) mappedDiv = 'FC';
      if (divUpper.startsWith('CM') || divUpper.includes('COMMON')) mappedDiv = 'CM';
      detectedFilter = { division: mappedDiv };
    } else if (/^fy\s*\d{4}$/i.test(entityCandidate) || /^fy\s*\d{2}-\d{2}$/i.test(entityCandidate)) {
      let fyClean = entityCandidate.replace(/[^0-9]/g, '');
      if (fyClean.length === 4) fyClean = 'FY' + fyClean;
      detectedFilter = { fy: fyClean };
    } else {
      const stateRow = await dbGet("SELECT state FROM territories WHERE state ILIKE $1 LIMIT 1", [entityCandidate]);
      if (stateRow) {
        detectedFilter = { state: stateRow.state };
      } else {
        const cropRow = await dbGet("SELECT crop FROM materials WHERE crop ILIKE $1 LIMIT 1", [entityCandidate]);
        if (cropRow) {
          detectedFilter = { crop: cropRow.crop };
        }
      }
    }

    // Merge into lastFilters
    sessionContext.memory.lastFilters = {
      ...sessionContext.memory.lastFilters,
      ...detectedFilter
    };

    // Reconstruct the question using lastResolvedQuestion
    if (sessionContext.memory.lastResolvedQuestion) {
      resolvedQuestion = `${sessionContext.memory.lastResolvedQuestion} (focused on ${Object.values(detectedFilter)[0] || entityCandidate})`;
    }
    
    activeFiltersForQuery = {
      ...sessionContext.memory.lastFilters
    };
  } else if (memoryMode === 'ambiguous_short_query') {
    // Ambiguous Short Query: Keep previous intent and filters, update metric
    activeFiltersForQuery = {
      ...sessionContext.memory.lastFilters
    };
    if (sessionContext.memory.lastResolvedQuestion) {
      resolvedQuestion = `${question} of the ${sessionContext.memory.lastResolvedQuestion}`;
    }
  } else {
    // INDEPENDENT
    history = [];
    // Clear ephemeral navigation/drill-down filters (crop, state) but keep persistent dropdown filters (fy, division, channel)
    activeFiltersForQuery = {
      datasetId: dashboardFilters.datasetId,
      fy: dashboardFilters.fy || null,
      division: dashboardFilters.division || null,
      distributionChannel: dashboardFilters.distributionChannel || null
    };
    
    // Clean nulls
    Object.keys(activeFiltersForQuery).forEach(key => {
      if (activeFiltersForQuery[key] === null) {
        delete activeFiltersForQuery[key];
      }
    });
    console.log('[Copilot] Cleared ephemeral navigation filters for independent query');
  }

  // Debug logging
  console.log('[Copilot] Memory Mode:', memoryMode);
  console.log('[Copilot] Dashboard Filters:', dashboardFilters);
  console.log('[Copilot] Memory Filters:', sessionContext.memory ? sessionContext.memory.lastFilters : null);
  console.log('[Copilot] Effective Filters:', activeFiltersForQuery);

  // 6. Invoke LLM Translator (exclude datasetId to prevent SQL translation errors)
  const filtersForLLM = { ...activeFiltersForQuery };
  delete filtersForLLM.datasetId;
  if (activeFiltersForQuery.datasetId && activeFiltersForQuery.datasetId !== 'all') {
    filtersForLLM.financialYear = activeFiltersForQuery.datasetId;
  }
  
  // Clean nulls/undefineds
  Object.keys(filtersForLLM).forEach(key => {
    if (filtersForLLM[key] === null || filtersForLLM[key] === undefined) {
      delete filtersForLLM[key];
    }
  });

  console.log(`Translating question statefully: "${resolvedQuestion}" with context filters for LLM:`, filtersForLLM);
  const queryPlan = await translateQuestionToPlan(resolvedQuestion, filtersForLLM, history);
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

  // 9. Deterministic filter injection & 10. Execute SQL Query
  const queryStartTime = Date.now();
  let resultRows = [];
  let queryError = null;

  try {
    if (queryPlan.queries && Array.isArray(queryPlan.queries) && queryPlan.queries.length > 0) {
      console.log(`[Copilot] Executing multi-query plan (${queryPlan.queries.length} sub-queries)...`);
      const multiResults = [];
      for (const subQuery of queryPlan.queries) {
        let subSql = subQuery.sql;
        subSql = injectMissingFilters(subSql, mergedFilters);
        
        console.log(`[Copilot] Executing sub-query "${subQuery.description}":`, subSql);
        const subPlan = { ...queryPlan, sql: subSql };
        const rows = await executeQueryPlan(null, subPlan, datasetId);
        
        multiResults.push({
          description: subQuery.description,
          sql: subSql,
          rows: rows
        });
      }
      
      resultRows = {
        isMultiQuery: true,
        results: multiResults
      };
      console.log(`[Copilot] All sub-queries completed successfully.`);
    } else {
      // Single query execution
      queryPlan.sql = injectMissingFilters(queryPlan.sql, mergedFilters);
      console.log("Executing SQL:", queryPlan.sql);
      resultRows = await executeQueryPlan(null, queryPlan, datasetId);
      console.log(`Query completed successfully, returned ${resultRows.length} records.`);
    }
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

  // 10.5 Determine metric type, billing types, and Scope metadata
  const qLower = question.toLowerCase();
  let metricType = 'net_sales';
  if (qLower.includes('gross') || qLower.includes('gross sales')) {
    metricType = 'gross_sales';
  } else if (qLower.includes('return') || qLower.includes('refund') || qLower.includes('returned')) {
    metricType = 'returns';
  } else if (qLower.includes('cancel') || qLower.includes('cancelled')) {
    metricType = 'cancelled';
  } else if (qLower.includes('cogm') || qLower.includes('cost of goods')) {
    metricType = 'cogm';
  } else if (qLower.includes('quantity') || qLower.includes('kg') || qLower.includes('volume') || qLower.includes('weight') || qLower.includes('packet')) {
    metricType = 'quantity';
  }

  let billingTypes = [];
  let calculationBasis = '';

  if (metricType === 'net_sales') {
    billingTypes = [
      { code: 'ZF2', description: 'Acsen Invoice', status: 'Included' },
      { code: 'ZSTO', description: 'Stock Transfer', status: 'Included' },
      { code: 'ZIF2', description: 'Inter-Company Invoice', status: 'Included' },
      { code: 'ZRE', description: 'Acsen Returns', status: 'Yes (deducted)' },
      { code: 'ZS1', description: 'Acsen Cancel Invoice', status: 'Yes (deducted)' },
      { code: 'ZIRE', description: 'Inter-Company Returns', status: 'Yes (deducted)' }
    ];
    calculationBasis = 'Net Revenue = ZF2 + ZSTO + ZIF2 − ZRE − ZS1 − ZIRE';
  } else if (metricType === 'gross_sales') {
    billingTypes = [
      { code: 'ZF2', description: 'Acsen Invoice', status: 'Included' },
      { code: 'ZSTO', description: 'Stock Transfer', status: 'Included' },
      { code: 'ZIF2', description: 'Inter-Company Invoice', status: 'Included' },
      { code: 'ZRE', description: 'Acsen Returns', status: 'Excluded' },
      { code: 'ZS1', description: 'Acsen Cancel Invoice', status: 'Excluded' },
      { code: 'ZIRE', description: 'Inter-Company Returns', status: 'Excluded' }
    ];
    calculationBasis = 'Gross Sales = ZF2 + ZSTO + ZIF2';
  } else if (metricType === 'returns') {
    billingTypes = [
      { code: 'ZF2', description: 'Acsen Invoice', status: 'Excluded' },
      { code: 'ZSTO', description: 'Stock Transfer', status: 'Excluded' },
      { code: 'ZIF2', description: 'Inter-Company Invoice', status: 'Excluded' },
      { code: 'ZRE', description: 'Acsen Returns', status: 'Included' },
      { code: 'ZS1', description: 'Acsen Cancel Invoice', status: 'Excluded' },
      { code: 'ZIRE', description: 'Inter-Company Returns', status: 'Included' }
    ];
    calculationBasis = 'Returns = ZRE + ZIRE';
  } else if (metricType === 'cancelled') {
    billingTypes = [
      { code: 'ZF2', description: 'Acsen Invoice', status: 'Excluded' },
      { code: 'ZSTO', description: 'Stock Transfer', status: 'Excluded' },
      { code: 'ZIF2', description: 'Inter-Company Invoice', status: 'Excluded' },
      { code: 'ZRE', description: 'Acsen Returns', status: 'Excluded' },
      { code: 'ZS1', description: 'Acsen Cancel Invoice', status: 'Included' },
      { code: 'ZIRE', description: 'Inter-Company Returns', status: 'Excluded' }
    ];
    calculationBasis = 'Cancelled Sales = ZS1';
  } else {
    billingTypes = [
      { code: 'ZF2', description: 'Acsen Invoice', status: 'Included' },
      { code: 'ZSTO', description: 'Stock Transfer', status: 'Included' },
      { code: 'ZIF2', description: 'Inter-Company Invoice', status: 'Included' },
      { code: 'ZRE', description: 'Acsen Returns', status: 'Yes (deducted)' },
      { code: 'ZS1', description: 'Acsen Cancel Invoice', status: 'Yes (deducted)' },
      { code: 'ZIRE', description: 'Inter-Company Returns', status: 'Yes (deducted)' }
    ];
    calculationBasis = 'Net Revenue = ZF2 + ZSTO + ZIF2 − ZRE − ZS1 − ZIRE';
  }

  let filesUsed = [];
  let recordCount = 0;
  let uploadYears = [];
  try {
    const activeBatches = await dbAll("SELECT file_name, fy_code, record_count FROM upload_batches WHERE deleted_at IS NULL AND is_active = true");
    filesUsed = activeBatches.map(b => b.file_name);
    uploadYears = [...new Set(activeBatches.map(b => b.fy_code))];
    
    const countRes = await dbGet("SELECT COUNT(*) AS count FROM sales_data_raw");
    recordCount = parseInt(countRes?.count || 0, 10);
  } catch (e) {
    console.error("Failed to query upload_batches metadata:", e);
  }

  const responseContext = {
    scope: {
      filesUsed,
      financialYears: uploadYears,
      recordCount,
      generatedAt: new Date().toLocaleString('en-IN')
    },
    filters: {
      crop: mergedFilters.crop || 'All',
      state: mergedFilters.state || 'All',
      division: mergedFilters.division || 'All',
      territory: mergedFilters.territory || 'All',
      customer: mergedFilters.customer || 'All',
      material: mergedFilters.material || 'All',
      dateRange: mergedFilters.startDate && mergedFilters.endDate ? `${mergedFilters.startDate} to ${mergedFilters.endDate}` : 'Full FY',
      dataset: mergedFilters.datasetId && mergedFilters.datasetId !== 'all' ? mergedFilters.datasetId : 'Combined'
    },
    metricType,
    billingTypes,
    calculationBasis
  };

  // 11. Synthesize Answer
  const synthesized = await synthesizeAnswer(question, queryPlan, resultRows, mergedFilters, responseContext);
  const answer = (synthesized && typeof synthesized === 'object') ? (synthesized.answer || '') : (synthesized || '');
  const insights = (synthesized && typeof synthesized === 'object') ? (synthesized.insights || '') : '';

  // 12. Stateful Context merging & Visualization Preference updates
  if (!queryPlan.navigation) {
    queryPlan.navigation = {};
  }
  const planNav = queryPlan.navigation;
  
  // ── Navigation Registry: intent → { tab, section } ──────────────────────
  // Add new intent keys here as the dashboard grows. Never touch resolveNavigation.
  const navigationRegistry = {
    gross_sales:         { tab: 'summary',      section: 'gross-sales-card' },
    net_sales:           { tab: 'summary',      section: 'net-sales-card' },
    sales_returns:       { tab: 'summary',      section: 'sales-returns-card' },
    cancelled_invoices:  { tab: 'summary',      section: 'cancelled-invoices-card' },
    cogm:                { tab: 'summary',      section: 'cogm-card' },
    sales_trend:         { tab: 'summary',      section: 'sales-overview' },
    division:            { tab: 'summary',      section: 'division-contribution' },
    state:               { tab: 'summary',      section: 'top-states' },
    crop:                { tab: 'summary',      section: 'top-crops' },
    dealer:              { tab: 'summary',      section: 'top-dealers' },
    distribution_channel:{ tab: 'sales',        section: 'distribution-channels' },
    monthly_sales:       { tab: 'sales',        section: 'monthly-trend' },
    season:              { tab: 'sales',        section: 'season-contribution' },
    geography:           { tab: 'geography',    section: 'geographic-performance' },
    hierarchy:           { tab: 'geography',    section: 'territory-hierarchy' },
    territory:           { tab: 'geography',    section: 'territories-list' },
    crop_performance:    { tab: 'product',      section: 'crops-revenue' },
    own_trade:           { tab: 'product',      section: 'own-vs-trade' },
    returns:             { tab: 'returns',      section: 'returns-pattern' },
    returns_channel:     { tab: 'returns',      section: 'returns-by-channel' },
    returns_state:       { tab: 'returns',      section: 'returns-by-state' },
    returns_crop:        { tab: 'returns',      section: 'returns-by-crop' },
    invoice:             { tab: 'transactions', section: 'transaction-drilldown' }
  };

  // ── Entity-aware result-row → navigation map ──────────────────────────────
  // Each entry maps a dimension type to: which SQL columns identify it, where it
  // should navigate, and which frontend filter key to populate.
  // Add new dimensions here only — no resolver logic changes needed.
  const entityNavigationMap = [
    { entity: 'division',  fields: ['division'],                                                     tab: 'summary',      section: 'division-contribution',  filterKey: 'division' },
    { entity: 'crop',      fields: ['crop', 'crop_name', 'material_desc', 'material_name', 'product'], tab: 'summary',     section: 'top-crops',              filterKey: 'crop' },
    { entity: 'state',     fields: ['state', 'territory_name', 'state_name'],                         tab: 'summary',      section: 'top-states',             filterKey: 'state' },
    { entity: 'dealer',    fields: ['customer', 'customer_name', 'dealer', 'dealer_name'],            tab: 'summary',      section: 'top-dealers',            filterKey: 'customer' },
    { entity: 'channel',   fields: ['distribution_channel', 'channel', 'dist_channel'],              tab: 'sales',        section: 'distribution-channels',  filterKey: 'distributionChannel' },
    { entity: 'territory', fields: ['territory', 'territory_code'],                                   tab: 'geography',    section: 'territories-list',       filterKey: 'territory' },
    { entity: 'material',  fields: ['material', 'material_code', 'material_no'],                      tab: 'product',      section: 'crops-revenue',          filterKey: 'material' }
  ];

  /**
   * resolveNavigation — 5-priority deterministic resolver.
   *
   * Priority:
   *   1. Explicit LLM intent key in navigationRegistry
   *   2. Entity detected in actual SQL result rows (via entityNavigationMap)
   *   3. Question keyword heuristics
   *   4. Metric column name
   *   5. Default page
   *
   * If query confidence < 0.6, navigation is suppressed (skipNavigation=true).
   */
  function resolveNavigation(intent, question, qPlan, rows) {
    const qLower = (question || '').toLowerCase();
    const confidence = typeof qPlan?.confidence === 'number' ? qPlan.confidence : 0.95;

    // Suppress navigation for very low-confidence queries — stay in Copilot panel
    if (confidence < 0.6) {
      console.log('[Navigation Resolver] Confidence below threshold — navigation suppressed.');
      return { page: 'summary', section: 'sales-overview', skipNavigation: true };
    }

    // ── Priority 1: Direct intent registry lookup ─────────────────────────
    if (intent && navigationRegistry[intent]) {
      const match = navigationRegistry[intent];
      return { page: match.tab, section: match.section };
    }

    // ── Priority 2: Entity detected from SQL result rows ──────────────────
    // Flatten multi-query or single-query rows
    const flatResultRows = Array.isArray(rows)
      ? rows
      : (rows?.results?.[0]?.rows || []);
    if (flatResultRows.length > 0) {
      const topRowKeys = Object.keys(flatResultRows[0]).map(k => k.toLowerCase());
      for (const entityDef of entityNavigationMap) {
        for (const field of entityDef.fields) {
          if (topRowKeys.includes(field.toLowerCase())) {
            return { page: entityDef.tab, section: entityDef.section };
          }
        }
      }
    }

    // ── Priority 3: Question keyword heuristics ───────────────────────────
    if (qLower.includes('gross') && (qLower.includes('sale') || qLower.includes('revenue') || qLower.includes('value'))) {
      return { page: 'summary', section: 'gross-sales-card' };
    }
    if (qLower.includes('net') && (qLower.includes('sale') || qLower.includes('revenue') || qLower.includes('value'))) {
      return { page: 'summary', section: 'net-sales-card' };
    }
    if (qLower.includes('cancel') || qLower.includes('cancelled')) {
      return { page: 'summary', section: 'cancelled-invoices-card' };
    }
    if (qLower.includes('cogm') || qLower.includes('production cost') || qLower.includes('cost of production')) {
      return { page: 'summary', section: 'cogm-card' };
    }
    if (qLower.includes('sales trend') || qLower.includes('overall trend') || qLower.includes('overall sales')) {
      return { page: 'summary', section: 'sales-overview' };
    }
    if (qLower.includes('return') || qLower.includes('refund') || qLower.includes('returned')) {
      if (qLower.includes('channel'))                         return { page: 'returns', section: 'returns-by-channel' };
      if (qLower.includes('state') || qLower.includes('where')) return { page: 'returns', section: 'returns-by-state' };
      if (qLower.includes('crop') || qLower.includes('product')) return { page: 'returns', section: 'returns-by-crop' };
      return { page: 'returns', section: 'returns-pattern' };
    }
    if (qLower.includes('division') || qLower.includes('divisional') || qLower.includes('vg') || qLower.includes('fc') || qLower.includes('cm') || qLower.includes('vegetable') || qLower.includes('field crop') || qLower.includes('crop management')) {
      return { page: 'summary', section: 'division-contribution' };
    }
    if (qLower.includes('dealer') || qLower.includes('customer') || qLower.includes('retailer')) {
      return { page: 'summary', section: 'top-dealers' };
    }
    if (qLower.includes('channel') || qLower.includes('distributor') || qLower.includes('distribution')) {
      return { page: 'sales', section: 'distribution-channels' };
    }
    if (qLower.includes('monthly') || qLower.includes('month') || qLower.includes('trend')) {
      return { page: 'sales', section: 'monthly-trend' };
    }
    if (qLower.includes('season') || qLower.includes('kharif') || qLower.includes('rabi')) {
      return { page: 'sales', section: 'season-contribution' };
    }
    if (qLower.includes('hierarchy') || qLower.includes('structure')) {
      return { page: 'geography', section: 'territory-hierarchy' };
    }
    if (qLower.includes('territory') || qLower.includes('territories')) {
      return { page: 'geography', section: 'territories-list' };
    }
    if (qLower.includes('state') || qLower.includes('geography') || qLower.includes('region')) {
      return { page: 'geography', section: 'geographic-performance' };
    }
    if (qLower.includes('crop') || qLower.includes('product') || qLower.includes('variety') || qLower.includes('mustard') || qLower.includes('hotpepper') || qLower.includes('tomato') || qLower.includes('cotton') || qLower.includes('paddy') || qLower.includes('maize')) {
      if (qLower.includes('own') || qLower.includes('trade')) return { page: 'product', section: 'own-vs-trade' };
      return { page: 'product', section: 'crops-revenue' };
    }
    if (qLower.includes('invoice') || qLower.includes('transaction') || qLower.includes('batch') || qLower.includes('expiry') || qLower.includes('detail') || qLower.includes('list')) {
      return { page: 'transactions', section: 'transaction-drilldown' };
    }

    // ── Priority 4: Metric column name ─────────────────────────────────────
    const metricCol = (qPlan?.metric?.column || '').toLowerCase();
    if (metricCol.includes('cogm'))    return { page: 'summary',  section: 'cogm-card' };
    if (metricCol.includes('return'))  return { page: 'returns',  section: 'returns-pattern' };
    if (metricCol.includes('cancel'))  return { page: 'summary',  section: 'cancelled-invoices-card' };
    if (metricCol.includes('gross'))   return { page: 'summary',  section: 'gross-sales-card' };

    // ── Priority 5: Default ────────────────────────────────────────────────
    return { page: 'summary', section: 'sales-overview' };
  }

  // Resolve and validate routes (pass queryPlan + resultRows for priority-2 entity detection)
  const queryLower = question.toLowerCase();
  const resolvedNav = resolveNavigation(planNav.intent, question, queryPlan, resultRows);
  if (!resolvedNav.skipNavigation) {
    planNav.navigateTo = resolvedNav.page;
    planNav.section    = resolvedNav.section;
  }

  if (!planNav.intent || planNav.intent === 'none') {
    planNav.intent = 'show_sales_report';
  }
  console.log(`[Navigation Resolver] Resolved route to Tab: ${planNav.navigateTo}, Section: ${planNav.section}${resolvedNav.skipNavigation ? ' (suppressed — low confidence)' : ''}`);

  if (!planNav.filters) {
    planNav.filters = {};
  }
  const planFilters = planNav.filters;

  // ── Entity-aware filter injection ─────────────────────────────────────────
  // For top/ranking queries, read the top result row and inject the entity value
  // into navigation filters so the frontend filter bar updates automatically.
  // Uses entityNavigationMap so adding a new dimension requires only one edit.
  const isTopQuery = queryLower.includes('highest') || queryLower.includes('top') || queryLower.includes('best') || queryLower.includes('maximum') || queryLower.includes('most');

  if (isTopQuery) {
    const flatForFilters = Array.isArray(resultRows)
      ? resultRows
      : (resultRows?.results?.[0]?.rows || []);

    if (flatForFilters.length > 0) {
      const topRow = flatForFilters[0];
      for (const entityDef of entityNavigationMap) {
        for (const field of entityDef.fields) {
          const val = topRow[field];
          if (val !== null && val !== undefined && isNaN(Number(val))) {
            // Inject the string entity name into the filter (e.g. division='VG', crop='HYBRID HOTPEPPER')
            planFilters[entityDef.filterKey] = entityDef.entity === 'division'
              ? String(val).toUpperCase()
              : String(val);
            break; // one match per entity type is enough
          }
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

  // Update structured memory
  let detectedEntity = null;
  if (resultRows.length > 0) {
    const topRow = resultRows[0];
    for (const key of Object.keys(topRow)) {
      const val = topRow[key];
      if (val && isNaN(Number(val))) {
        const keyLower = key.toLowerCase();
        if (keyLower.includes('crop') || keyLower.includes('material_desc') || keyLower.includes('material_name')) {
          detectedEntity = { type: 'crop', value: String(val) };
          break;
        } else if (keyLower.includes('state')) {
          detectedEntity = { type: 'state', value: String(val) };
          break;
        } else if (keyLower.includes('division')) {
          detectedEntity = { type: 'division', value: String(val) };
          break;
        }
      }
    }
  }

  sessionContext.memory = {
    lastIntent: queryPlan.navigation?.intent || sessionContext.memory.lastIntent || 'show_sales_report',
    lastMetric: queryPlan.metric?.column || sessionContext.memory.lastMetric || 'sales_amount_inr',
    lastResolvedQuestion: resolvedQuestion,
    lastFilters: updatedContextFilters,
    lastEntity: detectedEntity || sessionContext.memory.lastEntity
  };

  const newContext = {
    filters: updatedContextFilters,
    chartPreferences: updatedChartPreferences,
    lastIntent: planNav.intent || sessionContext.lastIntent || "show_sales_report",
    lastTab: planNav.navigateTo || sessionContext.lastTab || "summary",
    lastSection: targetSection,
    lastQuestion: question,
    memory: sessionContext.memory,
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
