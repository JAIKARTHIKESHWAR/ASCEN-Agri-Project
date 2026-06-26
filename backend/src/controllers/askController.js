import { translateQuestionToPlan } from '../ai/queryTranslator.js';
import { executeQueryPlan } from '../services/queryExecutor.js';
import { synthesizeAnswer } from '../ai/answerSynthesizer.js';

export async function askQuestion(req, res) {
  const { question } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'Question is required' });
  }

  const questionLower = question.toLowerCase();

  // 1. Pre-checks for limitations
  if (
    questionLower.includes('2025-26') || 
    questionLower.includes('fy25-26') || 
    questionLower.includes('fy2526') || 
    (questionLower.includes('previous year') && questionLower.includes('growth'))
  ) {
    return res.json({
      answer: "I cannot calculate sales growth comparisons because the data file for FY2025-26 is missing.",
      warning: {
        title: "Data Limitation Notice",
        message: "The SAP sales extract file for FY2025-26 (ACSEN-SalesData-FY2526.xlsx) has not been received. Year-on-year calculations and comparisons spanning this period are disabled in this current system version."
      }
    });
  }

  if (
    questionLower.includes('budget') || 
    questionLower.includes('forecast') || 
    questionLower.includes('variance') || 
    questionLower.includes('target')
  ) {
    return res.json({
      answer: "I am unable to display budget comparisons because budget data is not part of the scope.",
      scopeWarning: {
        title: "Feature Out of Scope",
        message: "Budget-versus-actual analysis, COGM planned-versus-actuals, and forecasts are outside the scope of this sales POC."
      }
    });
  }

  try {
    // 2. Translate question to query plan
    console.log(`Translating question: "${question}"`);
    const queryPlan = await translateQuestionToPlan(question);
    console.log("Generated query plan:", JSON.stringify(queryPlan));

    // 3. Execute query on dataset
    const resultRows = executeQueryPlan(global.salesDataset, queryPlan);
    console.log(`Executed query plan, returned ${resultRows.length} rows.`);

    if (resultRows.length === 0) {
      return res.json({
        answer: "No data matches the selected filters or criteria.",
        tableData: { headers: [], rows: [] },
        chartData: { type: "none", xAxis: "", series: [], data: [] }
      });
    }

    // 4. Synthesize the text response
    const answer = await synthesizeAnswer(question, queryPlan, resultRows);

    // 5. Format payload details for the frontend
    const columns = Object.keys(resultRows[0]);
    const tableHeaders = columns;
    const tableRows = resultRows.map(row => columns.map(col => row[col] ?? 0));

    // Determine target value column for charting
    let targetValCol = "salesAmountINR";
    const metricColRaw = queryPlan.metric?.column || "";
    if (metricColRaw.trim().toLowerCase().includes("net external sales") || metricColRaw.trim().toLowerCase().includes("net sales") || metricColRaw.trim().toLowerCase().includes("net_external_sales")) {
      targetValCol = "Net External Sales";
    } else {
      // Find matching column from results (case insensitive)
      const foundCol = columns.find(c => c.toLowerCase() === metricColRaw.toLowerCase() || (c === 'salesAmountINR' && metricColRaw.toLowerCase().includes('amount')));
      if (foundCol) {
        targetValCol = foundCol;
      } else {
        targetValCol = columns[columns.length - 1]; // Fallback to last column
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

    // Calculate metadata basis description
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

    res.json({
      answer,
      tableData: {
        headers: tableHeaders,
        rows: tableRows
      },
      chartData,
      calculationBasis: calcBasis,
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
