import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { dbAll } from '../database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '..', 'ai', '.env') });

const apiKey = process.env.GROQ_API_KEY;
let groqClient = null;

if (apiKey) {
  groqClient = new Groq({ apiKey });
} else {
  console.warn('Warning: GROQ_API_KEY is not defined in environment variables or backend/ai/.env');
}

/**
 * Dynamically queries the PostgreSQL schema for grounding.
 */
async function getSchemaContext() {
  try {
    const schema = await dbAll(`
      SELECT table_name,
             column_name,
             data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('sales_data_raw', 'financial_years', 'billing_types', 'materials', 'employees', 'customers', 'territories', 'sales_data', 'ai_sales_records')
      ORDER BY table_name, ordinal_position
    `);

    let context = '';
    let currentTable = '';

    for (const row of schema) {
      if (currentTable !== row.table_name) {
        currentTable = row.table_name;
        context += `\nTable/View: ${currentTable}\n`;
      }
      context += `- ${row.column_name} (${row.data_type})\n`;
    }

    return context;
  } catch (err) {
    console.error("Failed to load schema context dynamically:", err);
    // Static fallback schema description to ensure query translator always works
    return `
Table/View: sales_data
- id (bigint)
- invoice_id (text)
- invoice_date (date)
- billing_type (text)
- customer_id (text)
- material_code (text)
- territory_id (integer)
- qty (integer)
- sales_unit (text)
- sales_amount_inr (numeric)
- cogm (numeric)
- season_code (text)
- fy_code (text)
- batch_id (integer)

Table/View: ai_sales_records
- id (bigint)
- batch_id (integer)
- invoice_id (text)
- invoice_date (date)
- billing_type (text)
- customer_id (text)
- material_code (text)
- territory_id (integer)
- qty (integer)
- sales_unit (text)
- sales_amount_inr (numeric)
- cogm (numeric)
- season_code (text)
- fy_code (text)
- billing_type_desc (text)
- division (text)
- distribution_channel (text)
- state (text)
- plant (text)
- storage_location (text)
- sales_order_no (text)
- customer_reference (text)
- indent_no (text)
- ipt_sr_request_no (text)
- ipt_sr_request_date (date)
- accounting_doc_no (text)
- fiscal_year (integer)
- customer_no (text)
- customer_name (text)
- line_item_no (text)
- crop_name (text)
- variety_name (text)
- own_trade (text)
- material_name (text)
- batch_no (text)
- expiry_date (date)
- currency (text)
- sales_price (numeric)
- sales_amount (numeric)
- exchange_rate (numeric)
- base_currency_inr (text)
- sales_price_inr (numeric)
- territory_name (text)
- ti_id (text)
- ti_name (text)
- am_id (text)
- am_name (text)
- rbm_id (text)
- rbm_name (text)
- dbm_id (text)
- dbm_name (text)
- created_by (text)
- classification (text)
- fy_name (text)
    `;
  }
}

export async function translateQuestionToPlan(question, activeFilters = {}, history = []) {
  if (!groqClient) {
    throw new Error('Groq AI Client is not configured. Please supply a valid GROQ_API_KEY.');
  }

  let filterContext = '';
  if (activeFilters && Object.keys(activeFilters).length > 0) {
    filterContext = `\nActive Dashboard Filters (MANDATORY — you MUST apply ALL of these filters in the SQL WHERE clause. If division is provided, JOIN materials m ON sd.material_code = m.material_code and add m.division = '<value>' to WHERE. If state is provided, JOIN territories t ON sd.territory_id = t.territory_id and add t.state ILIKE '<value>' to WHERE. If crop is provided, JOIN materials m and add m.crop ILIKE '<value>'. These filters represent the user's current dashboard view and the query results MUST match what the dashboard shows): ${JSON.stringify(activeFilters)}\n`;
  }

  const dynamicSchema = await getSchemaContext();

  const systemPrompt = `You are a translation layer converting natural language business questions into structured PostgreSQL queries on a sales database.

Database Schema:
${dynamicSchema}

Business Terms Mapping (Grounding Dictionary):
- crop -> crop_name (in ai_sales_records) or crop (in materials)
- product -> material_name (in ai_sales_records) or material_desc (in materials)
- material -> material_name (in ai_sales_records) or material_desc (in materials)
- dealer / customer / client -> customer_name (in ai_sales_records / customers) or customer_no (in ai_sales_records)
- sales rep / territory manager -> ti_name
- area manager -> am_name
- regional manager -> rbm_name
- division manager -> dbm_name
- batch / batch number -> batch_no
- expiry / expiration -> expiry_date
- sales order -> sales_order_no
- storage / storage location -> storage_location
- invoice amount / gross sales / revenue / sales / billing amount -> sales_amount_inr
- net external sales -> (standardGrossSales - returns - cancelled)
- profit / margin -> (sales_amount_inr - cogm)

TABLE SELECTION RULES:
- Use "sales_data" (Analytical View) for any high-level KPI, trend, contribution, comparison, ranking, and performance queries (e.g. gross sales, net sales, revenue, top crops, state revenue, monthly trend, YoY growth).
- Use "ai_sales_records" (AI View) for any detailed, operational, or record-level queries (e.g. batch details, plant/storage locations, expiry dates, sales orders, created by, customer reference, line items).

FINANCIAL YEAR RESOLUTION RULES:
1. If the user explicitly mentions one or more financial years (e.g. "in FY26-27", "for FY24-25", "compare FY24-25 and FY26-27"), filter the query by those specific "fy_code" values in the WHERE clause.
2. If the user does not mention any financial year and multiple datasets are available, aggregate results across all active financial years (do NOT apply any "fy_code" filter in the SQL query).
3. If only one financial year dataset exists in the database, automatically use that dataset.
4. Never assume the currently selected dashboard financial year unless the user explicitly asks for "current view", "selected year", or "this dashboard".
5. Always mention the financial years used in the response.

CRITICAL SQL SAFETY RULES:
- Only generate read-only SELECT queries. Never generate UPDATE, DELETE, INSERT, ALTER, DROP, TRUNCATE, or CREATE statements.
- Always include LIMIT 100 for detail/transactional queries unless the user explicitly requests all records.
- Prefer aggregation queries (using SUM, COUNT, AVG) over returning thousands of raw rows.

CRITICAL GROUNDING RULES:
- Only use columns listed in the Database Schema above. Never invent column names.
- Always alias columns explicitly (e.g. SELECT m.crop AS crop, SUM(sd.sales_amount_inr) AS revenue). Never return unnamed expressions.
- Whenever the user asks about revenue, sales, value, or performance (e.g. "highest revenue", "top crop", "highest sales", "best performing crop", "highest value", "maximum sales", "crop with most sales"), you MUST filter the query using classification = 'GROSS_SALE' (or billing_type IN ('F2', 'ZF2', 'ZIF2')) unless they are explicitly asking about returns or cancelled invoices.
- The table "materials" contains "material_desc", NOT "material_name". Never use "m.material_name". Use "m.material_desc" when joining the materials table.
- The view "ai_sales_records" contains "material_name" directly. You do not need to join the materials table when querying ai_sales_records.
- The view "sales_data" contains "material_code", and if you need the description/name, you must join "materials" and use "m.material_desc".
- The column "classification" exists ONLY on the "billing_types" table, never on "sales_data" or "ai_sales_records" directly. Any query filtering or selecting by classification MUST include JOIN billing_types bt ON sd.billing_type = bt.billing_type and reference bt.classification, never sd.classification.
- When a question asks for two related but distinct metrics (e.g. "total sales AND top crop within it", "overall revenue AND which state drove it"), generate separate aggregations for each metric (using CTEs or subqueries) rather than computing only one and reusing its value for both. Never present a single GROUP BY ... LIMIT 1 result as if it answers a broader "total" question unless the question is asking exclusively about the top-ranked item.

MEMORY RULES:
1. Treat each question independently unless the user explicitly references prior context using pronouns (it, its, that, those) or follow-up phrases.
2. Never carry over crop, state, division, or financial year filters from previous questions unless explicitly referenced.
3. The history is passed ONLY for resolving pronouns and follow-up context. If history is empty, translate the question strictly as a new independent request.

FEW-SHOT EXAMPLES:
Question: Which crop generated highest revenue?
SQL: SELECT m.crop AS crop, SUM(sd.sales_amount_inr) AS revenue FROM sales_data sd JOIN billing_types bt ON sd.billing_type = bt.billing_type JOIN materials m ON sd.material_code = m.material_code WHERE bt.classification = 'GROSS_SALE' GROUP BY m.crop ORDER BY revenue DESC LIMIT 1;

Question: Which crop generated highest revenue? [Active Filters: {"division":"VG","datasetId":"FY2627"}]
SQL: SELECT m.crop AS crop, SUM(sd.sales_amount_inr) AS revenue FROM sales_data sd JOIN billing_types bt ON sd.billing_type = bt.billing_type JOIN materials m ON sd.material_code = m.material_code WHERE bt.classification = 'GROSS_SALE' AND sd.fy_code = 'FY2627' AND m.division = 'VG' GROUP BY m.crop ORDER BY revenue DESC LIMIT 1;

Question: What is the total gross invoice sales for FY2627, and which crop drove the highest revenue within it?
SQL: WITH total AS (SELECT SUM(sd.sales_amount_inr) AS total_gross_sales FROM sales_data sd JOIN billing_types bt ON sd.billing_type = bt.billing_type WHERE bt.classification = 'GROSS_SALE' AND sd.fy_code = 'FY2627'), top_crop AS (SELECT m.crop AS crop, SUM(sd.sales_amount_inr) AS crop_revenue FROM sales_data sd JOIN billing_types bt ON sd.billing_type = bt.billing_type JOIN materials m ON sd.material_code = m.material_code WHERE bt.classification = 'GROSS_SALE' AND sd.fy_code = 'FY2627' GROUP BY m.crop ORDER BY crop_revenue DESC LIMIT 1) SELECT t.total_gross_sales, tc.crop, tc.crop_revenue FROM total t, top_crop tc;

Question: Show all batches of Hybrid Mustard.
SQL: SELECT batch_no, material_name, qty, plant FROM ai_sales_records WHERE material_name ILIKE '%Mustard%' LIMIT 100;

Question: Show invoices created by admin in Plant 1001.
SQL: SELECT invoice_id, invoice_date, created_by, sales_amount_inr FROM ai_sales_records WHERE created_by ILIKE '%admin%' AND plant = '1001' LIMIT 100;

SELF-CHECKING:
Before outputting, review your generated SQL against these checks:
1. Are all columns present in the schema?
2. Are all joins correct?
3. Are all non-aggregated SELECT columns included in the GROUP BY clause?
4. Are all column names fully qualified with their table/view aliases (e.g. sd.invoice_id)?
5. Is the SQL executable in PostgreSQL?

Output a strict JSON object with this exact schema:
{
  "out_of_scope": false,
  "confidence": 0.95,
  "sql": "SELECT ...",
  "groupby": ["column_name_as_returned_in_sql"],
  "metric": {
    "column": "column_name",
    "aggregation": "sum" | "avg" | "count"
  },
  "chart_recommendation": "bar" | "line" | "pie" | "none",
  "visualization": {
    "type": "line" | "bar" | "pie" | "area" | "treemap" | "donut" | "scatter" | "stacked_bar" | "horizontal_bar" | null
  },
  "filters": [
    {"column": "column_name", "operator": "==" | "!=" | ">" | "<" | "in", "value": "value"}
  ],
  "navigation": {
    "intent": "show_sales_report" | "show_returns_report" | "find_highest_sales" | "change_visualization" | "reset_visualization" | "other",
    "navigateTo": "summary" | "sales" | "geography" | "product" | "returns" | "transactions",
    "section": "sales-overview" | "division-contribution" | "top-states" | "top-crops" | "top-dealers" | "sales-by-state" | "returns-summary" | "ai-recommendations" | "monthly-trend" | "distribution-channels" | "season-contribution" | "geographic-performance" | "territory-hierarchy" | "territories-list" | "top-crops-state" | "crops-revenue" | "own-vs-trade" | "varieties-performance" | "returns-pattern" | "returns-by-channel" | "returns-by-state" | "returns-by-crop" | "transaction-drilldown" | "crop-performance",
    "confidence": 0.0..1.0,
    "filters": {
      "financialYear": "FY2627" | "FY2425" | null,
      "crop": "Cotton" | "Tomato" | "Paddy" | "Maize" | ... | null,
      "state": "Tamil Nadu" | "Karnataka" | "Andhra Pradesh" | "Telangana" | ... | null,
      "division": "VG" | "FC" | null,
      "distributionChannel": "Dealer" | "Distributor" | "Direct" | null
    }
  },
  "comparisonContext": {
    "compareMode": "yoy" | "qoq" | "mom" | null,
    "primaryYear": "FY2627" | "FY2425" | null,
    "comparisonYear": "FY2627" | "FY2425" | null,
    "primaryQuarter": 1 | 2 | 3 | 4 | null,
    "comparisonQuarter": 1 | 2 | 3 | 4 | null,
    "primaryMonth": 1..12 | null,
    "comparisonMonth": 1..12 | null
  }
}

OR if the user question is completely unrelated to Acsen Agriscience sales, crops, states, or distribution channel statistics (e.g. general knowledge, programming, weather, generic chats, or data outside this database), output exactly this:
{
  "out_of_scope": true,
  "confidence": 1.0,
  "sql": "",
  "groupby": [],
  "metric": null,
  "chart_recommendation": "none",
  "visualization": null,
  "filters": [],
  "navigation": {
    "intent": "other",
    "navigateTo": "summary",
    "section": "sales-overview",
    "confidence": 1.0,
    "filters": {}
  }
}

Rules:
- Respond ONLY with the raw JSON object. Do not wrap in markdown block backticks (e.g. \`\`\`json) or include conversational text.
- If the user explicitly asks to view, format, or convert a chart/visualization (e.g., "convert to a pie chart", "show division contribution as horizontal bar", "visualize as area chart", "reset chart"), set "visualization" to {"type": "<type>"} with type being one of: "line", "bar", "pie", "area", "treemap", "donut", "scatter", "stacked_bar", "horizontal_bar" (or null if resetting/default), set navigation.intent to "change_visualization" (or "reset_visualization" if resetting), and set navigation.section to the target visual card being converted. Use standard SQL to query the data if needed.
- Determine a confidence score between 0.0 and 1.0. If the user's question is vague, contains spelling errors for crops/states that cannot be resolved, asks about non-existent metrics, or is otherwise ambiguous without prior context, assign a score below 0.6. Otherwise assign >= 0.8.
- Navigation must always be data-driven. Never assume a division, crop, state, or channel. Only emit filters in the navigation.filters object when they are explicitly requested by the user in their question.
- Revenue vs Sales Returns Interpretation Rules: If the user asks for "return value", "return values", "highest return values", "best returns", "maximum returns", "most profitable crop", or similar business phrases, interpret these as sales/revenue/profitability metrics, not product refunds. Use metrics such as standardGrossSales, netExternalSales, or revenue. Do NOT apply classification = 'RETURN' unless the user explicitly refers to: sales returns, returned items, returned quantity, refund, refund amount, customer returns, or return transactions. Business phrases such as 'highest return values', 'crop with best returns', 'state generating highest returns', or 'division with highest returns' should be interpreted as revenue or sales performance queries.
- If the user asks for "highest return values", "highest revenue", "top selling crop", "best performing crop", "most profitable crop", "top crop", or "best performing crop", always navigate to:
  {
     "navigateTo": "product",
     "section": "crops-revenue"
  }
  Do NOT hardcode a division filter (like "VG" or "FC") unless the user explicitly mentioned "Vegetables" or "Field Crops" in their question. Let the query results determine the filters dynamically.
- If the question is not about Acsen Agriscience sales data, crops, states, variety performance, or return rates (e.g. asking about general knowledge, programming, weather, generic chats, or agriculture statistics outside our database), you MUST set "out_of_scope" to true and return the empty JSON template above.
- Every generated SQL query MUST query FROM sales_data or ai_sales_records (aliased as sd) and explicitly include all required JOINs if columns or classifications from other tables are referenced anywhere in the SELECT, WHERE, or GROUP BY clauses.
- Formulate standard SQL that is fully executable in PostgreSQL. Use table aliases like 'sd', 'bt', 'm', 't', 'c' to prevent column name ambiguities.
- Ensure column names returned in the SELECT statement match the group-by parameters exactly (e.g. SELECT t.state AS state ... GROUP BY t.state maps to "groupby": ["state"]).
- CRITICAL: Whenever a non-aggregated column appears in the SELECT clause (for example, EXTRACT(YEAR FROM sd.invoice_date)), you MUST include that exact expression in the GROUP BY clause.
- Always use exact join key conditions: sd.billing_type = bt.billing_type, sd.material_code = m.material_code, sd.territory_id = t.territory_id, sd.customer_id = c.customer_id. Never join on c.customer_name.
- For names (crops, states, employees, channels) use native Postgres ILIKE matching, e.g. sd.crop_name ILIKE 'tomato' or sd.state ILIKE 'tamil nadu' or sd.customer_name ILIKE '%dealer%'.
- In the navigation object:
  1. Map navigateTo based on user's query topic (e.g., summary for overall stats, returns for return rates, product for crop-specific stats).
  2. Map section to the specific chart/card code corresponding to the visual card (e.g. sales-overview, top-states, crops-revenue, returns-by-state, crop-performance).
  3. Extract all explicit or strongly implied filters (financialYear, crop, state, division, distributionChannel). If a crop name like 'cotton' is asked, extract it. If a state like 'tamil nadu' is asked, extract it. If a year like 'FY2627' is asked, extract it. Translate year text to standard FY codes ONLY using these explicit patterns:
      - 'FY26-27' | 'FY 26-27' | 'FY2026-2027' | 'FY 2026-2027' | 'FY2627' → 'FY2627'
      - 'FY24-25' | 'FY 24-25' | 'FY2024-2025' | 'FY 2024-2025' | 'FY2425' → 'FY2425'
      - 'this year' | 'current year' | 'current FY' → use the most recent fy_code in the data (default 'FY2627')
      - 'last year' | 'previous year' | 'previous FY' → 'FY2425'
      - Do NOT map a plain year like '2026' or '2024' alone to an FY code — it is ambiguous.
  4. Ensure crop and state filter values are in proper case (e.g., 'Cotton', 'Tamil Nadu').
  5. Indian Financial Year Quarter mapping (CRITICAL — use these month ranges in SQL, NOT calendar quarters):
      - Q1 FY = Apr, May, Jun   → EXTRACT(MONTH ...) IN (4, 5, 6)
      - Q2 FY = Jul, Aug, Sep   → EXTRACT(MONTH ...) IN (7, 8, 9)
      - Q3 FY = Oct, Nov, Dec   → EXTRACT(MONTH ...) IN (10, 11, 12)
      - Q4 FY = Jan, Feb, Mar   → EXTRACT(MONTH ...) IN (1, 2, 3)
  6. If the user requests a specific time period (e.g. 'Q2 sales', 'April revenue', 'H1 performance'), apply it in the SQL WHERE clause using EXTRACT(YEAR ...) and the appropriate month IN (...) clause. Do NOT use EXTRACT(QUARTER ...) as PostgreSQL uses calendar quarters.
  7. If the user explicitly compares two periods (e.g. 'compare Q2 this year vs Q2 last year', 'YoY growth', 'FY2627 vs FY2425'), emit a comparisonContext object with FY code strings (NOT raw calendar year integers).
  `;

  try {
    const chatMessages = [
      { role: 'system', content: systemPrompt }
    ];

    // Append up to 5 rounds of user/assistant exchanges (last 10 messages)
    if (history && history.length > 0) {
      history.slice(-10).forEach(msg => {
        const role = msg.role === 'assistant' || msg.sender === 'ai' ? 'assistant' : 'user';
        chatMessages.push({ role, content: msg.content || msg.text });
      });
    }

    chatMessages.push({ role: 'user', content: question + filterContext });

    const completion = await groqClient.chat.completions.create({
      messages: chatMessages,
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
      temperature: 0.0
    });

    const rawResponse = completion.choices[0].message.content.trim();
    console.log('Raw Query plan translation:', rawResponse);
    return JSON.parse(rawResponse);
  } catch (error) {
    console.error('Groq query translation failed:', error);
    throw new Error(`Failed to translate business question: ${error.message}`);
  }
}

/**
 * Auto-repairs a failed SQL query using the database error message.
 */
export async function repairSQLQuery(question, failedSql, errorMessage) {
  if (!groqClient) {
    throw new Error('Groq AI Client is not configured.');
  }

  const dynamicSchema = await getSchemaContext();

  const systemPrompt = `You are an expert PostgreSQL DBA. A generated SQL query has failed with a database error.
Your job is to correct the SQL query so that it executes successfully on PostgreSQL.

Database Schema:
${dynamicSchema}

Failed SQL:
${failedSql}

Database Error:
${errorMessage}

Original Question:
${question}

Instructions:
1. Analyze the database error and the original question.
2. Correct the SQL query.
3. Ensure it uses only valid tables and columns from the Database Schema. Never invent columns.
4. Output a strict JSON object with this exact schema:
{
  "sql": "SELECT ...",
  "explanation": "Brief description of the fix"
}
5. CRITICAL: If the error is "column X does not exist" and X is a business-meaningful filter (such as classification, crop, state, division), do NOT simply remove the filter or column. Instead, identify the correct table that actually contains that column (see Database Schema above) and add the necessary JOIN to reference it correctly. Removing a classification filter changes the business meaning of the query and produces silently incorrect results, which is worse than failing outright.
Do not include any conversational text or markdown formatting. Only return the raw JSON.`;

  try {
    const completion = await groqClient.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Please repair the SQL query.` }
      ],
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
      temperature: 0.0
    });

    const rawResponse = completion.choices[0].message.content.trim();
    console.log('Raw SQL repair response:', rawResponse);
    const parsed = JSON.parse(rawResponse);
    return parsed.sql;
  } catch (err) {
    console.error("SQL repair failed:", err);
    return null;
  }
}
