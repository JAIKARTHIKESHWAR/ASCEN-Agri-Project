import { translateQuestionToPlan } from '../ai/queryTranslator.js';
import { executeQueryPlan } from '../services/queryExecutor.js';
import { synthesizeAnswer } from '../ai/answerSynthesizer.js';
import { dbRun, dbGet, dbAll } from '../database.js';

export async function askQuestion(req, res) {
  const { question, filters } = req.body;
  const sessionId = req.body.session_id || req.body.sessionId;

  if (!question) {
    return res.status(400).json({ error: 'Question is required' });
  }

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

  // 2. Save user message to database
  let userMsgId = null;
  if (session.id !== '00000000-0000-0000-0000-000000000000') {
    try {
      const userMsg = await dbGet(
        "INSERT INTO copilot_messages (session_id, role, content) VALUES ($1, 'user', $2) RETURNING id",
        [session.id, question]
      );
      userMsgId = userMsg?.id;
    } catch (e) {
      console.error('Failed to log user message:', e);
    }
  }

  const defaultSuggestions = [
    "What are total sales and net sales?",
    "Which state generated the highest sales?",
    "Which crop performed best in Vegetable Division?",
    "Show sales returns by state"
  ];

  // 3. Pre-checks for timeline and budget limitations
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
    
    return res.json(responsePayload);
  }

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

    return res.json(responsePayload);
  }

  try {
    // 4. Load the last 5 exchanges (max 10 messages total)
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

    // 5. Merge incoming dashboard filters and session memory context
    const incomingFilters = filters || {};
    const mergedFilters = {
      fy: incomingFilters.fy_code || incomingFilters.financialYear || sessionContext.filters.financialYear || null,
      crop: incomingFilters.crop || sessionContext.filters.crop || null,
      state: incomingFilters.state || sessionContext.filters.state || null,
      division: incomingFilters.division || sessionContext.filters.division || null,
      distributionChannel: incomingFilters.dist_channel || incomingFilters.distributionChannel || sessionContext.filters.distributionChannel || null
    };

    // Remove null filters to pass a clean context object to Groq
    Object.keys(mergedFilters).forEach(key => {
      if (mergedFilters[key] === null) {
        delete mergedFilters[key];
      }
    });

    console.log(`Translating question statefully: "${question}" with context:`, mergedFilters);
    const queryPlan = await translateQuestionToPlan(question, mergedFilters, history);
    console.log("AI Query Plan:", queryPlan);

    // 6. Inspect Out of Scope flag
    if (queryPlan.out_of_scope) {
      const responsePayload = {
        answer: "Please ask questions related to Acsen Agriscience sales data, crops, states, variety performance, or return rates.",
        intent: "other",
        navigateTo: "summary",
        section: "sales-overview",
        filters: sessionContext.filters,
        insights: "Please ask questions related to Acsen Agriscience sales data, crops, states, variety performance, or return rates.",
        tableData: { headers: [], rows: [] },
        chartData: { type: "none", xAxis: "", series: [], data: [] },
        calculationBasis: "Query out of scope.",
        appliedFilters: filters || {},
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

      return res.json(responsePayload);
    }

    // 7. Inspect Confidence threshold
    if (typeof queryPlan.confidence === 'number' && queryPlan.confidence < 0.6) {
      const responsePayload = {
        answer: `I am not fully sure what you mean. Could you please clarify your question? For example: "What are total sales in Tamil Nadu?" or "Show returns for crop Tomato."`,
        intent: "other",
        navigateTo: "summary",
        section: "sales-overview",
        filters: sessionContext.filters,
        insights: "I am not fully sure what you mean. Could you please clarify your question?",
        tableData: { headers: [], rows: [] },
        chartData: { type: "none", xAxis: "", series: [], data: [] },
        calculationBasis: "Confidence below threshold.",
        appliedFilters: filters || {},
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

      return res.json(responsePayload);
    }

    // 8. Execute SQL query on PostgreSQL database
    console.log("Executing query plan SQL:", queryPlan.sql);
    const queryStartTime = Date.now();
    let resultRows = [];
    let queryError = null;

    try {
      resultRows = await executeQueryPlan(null, queryPlan);
      console.log(`Executed SQL query, returned ${resultRows.length} rows.`);
    } catch (e) {
      console.error('SQL query execution failed:', e);
      queryError = e.message;
    }
    const executionTime = Date.now() - queryStartTime;

    // Handle database error
    if (queryError) {
      const responsePayload = {
        answer: `I generated a query but ran into a database problem executing it: ${queryError}`,
        intent: "other",
        navigateTo: "summary",
        section: "sales-overview",
        filters: sessionContext.filters,
        insights: "Database execution error occurred.",
        tableData: { headers: [], rows: [] },
        chartData: { type: "none", xAxis: "", series: [], data: [] },
        calculationBasis: "Query execution failed.",
        appliedFilters: filters || {},
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

      return res.json(responsePayload);
    }

    // 9. Format outputs for UI charts and tables
    let tableHeaders = [];
    let tableRows = [];
    if (resultRows.length > 0) {
      const columns = Object.keys(resultRows[0]);
      tableHeaders = columns;
      tableRows = resultRows.map(row => columns.map(col => row[col] ?? 0));
    }

    // Determine value column for charting
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
          targetValCol = columns[columns.length - 1]; // Default fallback to the last column
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

    // Aggregation explanation basis
    const filtersDesc = (queryPlan.filters || []).map(f => `${f.column} ${f.operator} ${f.value}`).join(', ');
    let calcBasis = `Aggregated ${targetValCol} (${queryPlan.metric?.aggregation || 'sum'})`;
    if (groupbyCols.length > 0) {
      calcBasis += ` grouped by ${groupbyCols.join(', ')}`;
    }
    if (filtersDesc) {
      calcBasis += ` filtered by [${filtersDesc}]`;
    }

    // If query returns nothing
    if (resultRows.length === 0) {
      const responsePayload = {
        answer: "No sales or invoice data matches the specified filters or criteria.",
        intent: queryPlan.navigation?.intent || "other",
        navigateTo: queryPlan.navigation?.navigateTo || "summary",
        section: queryPlan.navigation?.section || "sales-overview",
        filters: sessionContext.filters,
        insights: "No matching database records found.",
        tableData: { headers: [], rows: [] },
        chartData: { type: "none", xAxis: "", series: [], data: [] },
        calculationBasis: "No records found.",
        appliedFilters: filters || {},
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
            [session.id, assistMsg.id, responsePayload.intent, JSON.stringify(queryPlan), JSON.stringify(sessionContext.filters), 'Empty result set returned', 'success', executionTime]
          );
        } catch (e) {
          console.error(e);
        }
      }

      return res.json(responsePayload);
    }

    // 10. Synthesize natural language answer from database results
    const answer = await synthesizeAnswer(question, queryPlan, resultRows);

    // 11. Stateful Memory logic - Merge newly extracted filters into session context
    const planNav = queryPlan.navigation || {};
    const planFilters = planNav.filters || {};

    const updatedContextFilters = {
      ...sessionContext.filters,
      ...planFilters
    };

    // Remove parameters that are explicitly null in queryPlan navigation
    Object.keys(planFilters).forEach(key => {
      if (planFilters[key] === null) {
        delete updatedContextFilters[key];
      }
    });

    const newContext = {
      filters: updatedContextFilters,
      lastIntent: planNav.intent || sessionContext.lastIntent || "show_sales_report",
      lastTab: planNav.navigateTo || sessionContext.lastTab || "summary",
      lastSection: planNav.section || sessionContext.lastSection || "sales-overview",
      lastQuestion: question,
      updatedAt: new Date().toISOString()
    };

    // 12. Persist assistant response and context updates
    if (session.id !== '00000000-0000-0000-0000-000000000000') {
      try {
        const assistMetadata = {
          intent: planNav.intent || "show_sales_report",
          navigateTo: planNav.navigateTo || "summary",
          section: planNav.section || "sales-overview",
          filters: planFilters
        };

        // Save assistant message
        const assistMsg = await dbGet(
          "INSERT INTO copilot_messages (session_id, role, content, metadata) VALUES ($1, 'assistant', $2, $3::jsonb) RETURNING id",
          [session.id, answer, JSON.stringify(assistMetadata)]
        );

        // Update session context filters & details
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
      } catch (dbErr) {
        console.error('Failed to log assistant state updates:', dbErr);
      }
    }

    // 13. Deliver complete stateful navigation and insights response
    res.json({
      answer,
      intent: planNav.intent || "show_sales_report",
      navigateTo: planNav.navigateTo || "summary",
      section: planNav.section || "sales-overview",
      filters: updatedContextFilters, // Return fully merged context filters
      insights: answer,
      tableData: {
        headers: tableHeaders,
        rows: tableRows
      },
      chartData,
      calculationBasis: calcBasis,
      appliedFilters: updatedContextFilters,
      limitationNote: null,
      sessionId: session.id,
      suggestions: defaultSuggestions
    });
  } catch (error) {
    console.error("Error in askQuestion controller:", error);
    res.status(500).json({ 
      error: "Internal Server Error", 
      details: error.message 
    });
  }
}
