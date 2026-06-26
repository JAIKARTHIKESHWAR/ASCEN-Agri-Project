import { translateQuestionToPlan } from '../ai/queryTranslator.js';
import { executeQueryPlan } from '../services/queryExecutor.js';
import { synthesizeAnswer } from '../ai/answerSynthesizer.js';
import { dbRun } from '../database.js';

export async function askQuestion(req, res) {
  const { question, session_id, filters } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'Question is required' });
  }

  const questionLower = question.toLowerCase();

  // 1. Pre-checks for timeline and budget limitations
  if (
    questionLower.includes('2025-26') || 
    questionLower.includes('fy25-26') || 
    questionLower.includes('fy2526') || 
    (questionLower.includes('previous year') && questionLower.includes('growth'))
  ) {
    const responsePayload = {
      answer: "I cannot calculate sales growth comparisons because the data file for FY2025-26 is missing.",
      warning: {
        title: "Data Limitation Notice",
        message: "The SAP sales extract file for FY2025-26 (ACSEN-SalesData-FY2526.xlsx) has not been received. Year-on-year calculations and comparisons spanning this period are disabled in this current system version."
      },
      limitationNote: "FY2025-26 data is currently missing from the system."
    };
    
    // Log query with limitation warning
    try {
      await dbRun(
        'INSERT INTO ai_query_log (question, session_id, sql_query, was_limitation_shown, timestamp) VALUES ($1, $2, $3, $4, $5)',
        [question, session_id || null, null, true, new Date().toISOString()]
      );
    } catch (e) {
      console.error(e);
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
      scopeWarning: {
        title: "Feature Out of Scope",
        message: "Budget-versus-actual analysis, COGM planned-versus-actuals, and forecasts are outside the scope of this sales POC."
      },
      limitationNote: "Budget/Forecast variance comparisons are outside the POC requirements."
    };
    
    // Log query with out of scope warning
    try {
      await dbRun(
        'INSERT INTO ai_query_log (question, session_id, sql_query, was_limitation_shown, timestamp) VALUES ($1, $2, $3, $4, $5)',
        [question, session_id || null, null, true, new Date().toISOString()]
      );
    } catch (e) {
      console.error(e);
    }

    return res.json(responsePayload);
  }

  try {
    // 2. Translate question to structured query plan using LLM
    console.log(`Translating question: "${question}"`);
    const queryPlan = await translateQuestionToPlan(question, filters || {});
    
    console.log("Generated SQL query:", queryPlan.sql);

    // 3. Execute SQL query on the SQLite database
    const resultRows = await executeQueryPlan(null, queryPlan);
    console.log(`Executed SQL query, returned ${resultRows.length} rows.`);

    if (resultRows.length === 0) {
      // Log empty query results
      try {
        await dbRun(
          'INSERT INTO ai_query_log (question, session_id, sql_query, was_limitation_shown, timestamp) VALUES ($1, $2, $3, $4, $5)',
          [question, session_id || null, queryPlan.sql, false, new Date().toISOString()]
        );
      } catch (e) {
        console.error(e);
      }

      return res.json({
        answer: "No data matches the selected filters or criteria.",
        tableData: { headers: [], rows: [] },
        chartData: { type: "none", xAxis: "", series: [], data: [] },
        calculationBasis: "No matching records found in the database.",
        appliedFilters: filters || {}
      });
    }

    // 4. Synthesize natural language answer from database results
    const answer = await synthesizeAnswer(question, queryPlan, resultRows);

    // 5. Format table headers and rows for Recharts/DataTables rendering
    const columns = Object.keys(resultRows[0]);
    const tableHeaders = columns;
    const tableRows = resultRows.map(row => columns.map(col => row[col] ?? 0));

    // Determine target value column for charting
    let targetValCol = "salesAmountINR";
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

    // Construct explanation of the aggregation basis
    const filtersDesc = (queryPlan.filters || []).map(f => `${f.column} ${f.operator} ${f.value}`).join(', ');
    let calcBasis = `Aggregated ${targetValCol} (${queryPlan.metric?.aggregation || 'sum'})`;
    if (groupbyCols.length > 0) {
      calcBasis += ` grouped by ${groupbyCols.join(', ')}`;
    }
    if (filtersDesc) {
      calcBasis += ` filtered by [${filtersDesc}]`;
    }

    const suggestions = [
      "What are total sales and net sales?",
      "Which state generated the highest sales?",
      "Which crop performed best in Vegetable Division?",
      "Show sales returns by state"
    ];

    // Log the successful query search
    try {
      await dbRun(
        'INSERT INTO ai_query_log (question, session_id, sql_query, was_limitation_shown, timestamp) VALUES ($1, $2, $3, $4, $5)',
        [question, session_id || null, queryPlan.sql, false, new Date().toISOString()]
      );
    } catch (e) {
      console.error(e);
    }

    res.json({
      answer,
      tableData: {
        headers: tableHeaders,
        rows: tableRows
      },
      chartData,
      calculationBasis: calcBasis,
      appliedFilters: filters || {},
      limitationNote: null,
      suggestions
    });
  } catch (error) {
    console.error("Error in askQuestion controller:", error);
    res.status(500).json({ 
      error: "Internal Server Error", 
      details: error.message 
    });
  }
}
