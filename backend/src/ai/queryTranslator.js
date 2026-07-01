import OpenAI from 'openai';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { dbAll } from '../database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '..', 'ai', '.env') });

const apiKey = process.env.OPENAI_API_KEY;
let openaiClient = null;

if (apiKey) {
  openaiClient = new OpenAI({ apiKey });
} else {
  console.warn('Warning: OPENAI_API_KEY is not defined in environment variables or backend/ai/.env');
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
        AND table_name IN ('sales_data_raw', 'financial_years', 'billing_types', 'materials', 'employees', 'customers', 'territories', 'sales_data', 'ai_sales_records', 'dataset_aggregates')
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

    // Add active dataset schema fingerprint notes
    try {
      const activeBatches = await dbAll(
        'SELECT fy_code, schema_columns FROM upload_batches WHERE is_active = true ORDER BY uploaded_at DESC'
      );
      let schemaNote = '\nACTIVE DATASET SCHEMA NOTES:\n';
      activeBatches.forEach(b => {
        const cols = typeof b.schema_columns === 'string' ? JSON.parse(b.schema_columns) : (b.schema_columns || {});
        schemaNote += `- ${b.fy_code}: ${Object.entries(cols).filter(([, v]) => v).map(([k]) => k).join(', ')}\n`;
      });
      context += schemaNote;
    } catch (fingerprintErr) {
      console.warn("Failed to load schema fingerprint notes:", fingerprintErr);
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

Table/View: dataset_aggregates
- id (integer)
- batch_id (integer)
- fy_code (text)
- dimension_type (text)
- dimension_value (text)
- gross_sales (numeric)
- returns_value (numeric)
- cancelled_value (numeric)
- net_external_sales (numeric)
- total_cogm (numeric)
- transaction_count (integer)
- computed_at (timestamp)
    `;
  }
}

export async function translateQuestionToPlan(question, activeFilters = {}, history = []) {
  if (!openaiClient) {
    throw new Error('OpenAI AI Client is not configured. Please supply a valid OPENAI_API_KEY.');
  }

  let filterContext = '';
  if (activeFilters && Object.keys(activeFilters).length > 0) {
    filterContext = `\nActive Dashboard Filters (MANDATORY — you MUST apply ALL of these filters in the SQL WHERE clause. If division is provided, JOIN materials m ON sd.material_code = m.material_code and add m.division = '<value>' to WHERE. If state is provided, JOIN territories t ON sd.territory_id = t.territory_id and add t.state ILIKE '<value>' to WHERE. If crop is provided, JOIN materials m and add m.crop ILIKE '<value>'. These filters represent the user's current dashboard view and the query results MUST match what the dashboard shows): ${JSON.stringify(activeFilters)}\n`;
  }

  const dynamicSchema = await getSchemaContext();
  const systemPrompt = `You are Acsen Executive BI Copilot SQL Planner.
Your job is to convert natural language business questions into structured PostgreSQL queries on a sales database.

Database Schema:
${dynamicSchema}

Business Terms Mapping (Grounding Dictionary):
- crop -> crop_name (in ai_sales_records) or crop (in materials)
- product / material -> material_name (in ai_sales_records) or material_desc (in materials)
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
- net external sales -> (gross_sales - returns_value - cancelled_value) on dataset_aggregates or sales_amount_inr with billing_types classification filter on raw
- profit / margin -> (sales_amount_inr - cogm)
- return rate -> (returns_value / gross_sales) * 100 on dataset_aggregates

====================================
QUERY STRATEGY PRIORITY (follow in order):
====================================
1. AGGREGATES-FIRST (preferred for 90% of questions): For any question asking about totals, rankings, highest/lowest, comparisons, or trends across crops/states/divisions/months/financial years — query the "dataset_aggregates" table first. This table contains pre-verified, pre-computed stats computed at upload time and is immune to join fan-out, duplicate rows, or schema differences.
   Columns: fy_code, dimension_type ('overall','crop','state','division','month'), dimension_value, gross_sales, returns_value, cancelled_value, net_external_sales, total_cogm, transaction_count.

2. DETAIL/OPERATIONAL QUERIES: Use "ai_sales_records" (aliased as sd) when the user asks for individual invoice details, batch numbers, expiry dates, created-by fields, plant/storage location, or specific transaction-level data not available in dataset_aggregates. Always apply LIMIT 100.

3. NEVER use "sales_data" or "sales_data_raw" directly for aggregate questions.

====================================
SEMANTIC SQL PLANNING (ChatGPT-Style Internal Reasoning)
====================================
Before generating SQL, you must internally analyze:
- Intent (e.g., Ranking, Trend, Comparison, Details)
- Target Entity (e.g., Product, Crop, Customer, Area Manager, State)
- Metric & Aggregation (e.g., SUM(sales_amount_inr), COUNT(DISTINCT batch_no), SUM(qty))
- Grouping, Sorting, and Limits
- Filters (financial year, active filters, state/crop matching)

Examples of semantic SQL planning reasoning:

User: "Top 10 products by revenue"
Reasoning:
  Intent: Ranking
  Entity: Product
  Metric: Revenue -> SUM(sales_amount_inr)
  Sort: Descending
  Limit: 10
SQL:
SELECT material_name, SUM(sales_amount_inr) AS revenue FROM ai_sales_records GROUP BY material_name ORDER BY revenue DESC LIMIT 10;

User: "Which customer bought the widest variety of crops?"
Reasoning:
  Intent: Ranking
  Entity: Customer
  Metric: Distinct Crops -> COUNT(DISTINCT crop_name)
  Grouping: Customer
  Sort: Descending
  Limit: 1
SQL:
SELECT customer_name, COUNT(DISTINCT crop_name) AS distinct_crops FROM ai_sales_records GROUP BY customer_name ORDER BY distinct_crops DESC LIMIT 1;

User: "Which Area Manager has the highest gross sales?"
Reasoning:
  Intent: Ranking
  Entity: Area Manager
  Metric: Gross Sales -> SUM(sd.sales_amount_inr)
  Grouping: Area Manager
  Sort: Descending
  Limit: 1
SQL:
SELECT sd.am_name, SUM(sd.sales_amount_inr) AS gross_sales FROM ai_sales_records sd JOIN billing_types bt ON sd.billing_type = bt.billing_type WHERE bt.classification = 'GROSS_SALE' GROUP BY sd.am_name ORDER BY gross_sales DESC LIMIT 1;

====================================
UNIVERSAL REQUIREMENTS
====================================
Infer the SQL structure dynamically from the database schema, available dimensions, measures, and user intent.
Automatically support queries such as:
- Top revenue products
- Lowest selling crops
- Highest return state
- Largest distributor
- Fastest growing territory
- Highest gross margin (sales_amount_inr - cogm)
- Best performing customer
- Products with highest cancellations
- Revenue by month
- Revenue by quarter
- YOY comparison
- MOM comparison
- Batch analysis
- Customer purchase diversity
- Territory contribution
- Product mix
- Distribution analysis
without requiring hardcoded template matches.

====================================
SQL GENERATION & SAFETY RULES
====================================
- Use existing schema columns only. Never invent column names.
- SCHEMA CONSTRAINTS: When querying the pre-computed "dataset_aggregates" table, NEVER use column names like "crop_name", "crop", "state", or "division". You MUST use "dimension_value" for the values and "dimension_type" to filter by the type of dimension (e.g. dimension_type = 'crop' or dimension_type = 'state').
- Use correct joins automatically (e.g. JOIN billing_types bt ON sd.billing_type = bt.billing_type).
- Always include all non-aggregated SELECT columns in the GROUP BY clause.
- Only generate read-only SELECT queries.
- Limit raw detail queries to 100 rows.
- CRITICAL QUANTITY RULE: When the user asks for total quantity, total kg, total weight, total packets, or volume/unit metrics, ALWAYS use SUM(qty) AS total_quantity. NEVER multiply qty by price or divide by any conversion factor. The qty column already contains the correct numeric amount in the units it was sold (KG, PAK, etc.). Always select the "sales_unit" column if present to ensure the unit is known.

====================================
FINANCIAL YEAR RESOLUTION RULES
====================================
Determine the target financial year/dataset for the query using this strict priority list:
1. Explicit year/FY mentioned in the user's question (e.g., "for FY24-25" -> fy_code = 'FY2425').
2. Dashboard selected dataset/financialYear (passed in the Active Dashboard Filters context).
3. If no year is specified in the question or dashboard filter context, default to the latest uploaded dataset.
4. Only query ALL active financial years combined if the user explicitly asks for "all years", "overall trend", "cumulative sales", or "across all datasets".

Indian Financial Year Quarter mapping:
- Q1: Apr-Jun -> EXTRACT(MONTH FROM invoice_date) IN (4, 5, 6)
- Q2: Jul-Sep -> EXTRACT(MONTH FROM invoice_date) IN (7, 8, 9)
- Q3: Oct-Dec -> EXTRACT(MONTH FROM invoice_date) IN (10, 11, 12)
- Q4: Jan-Mar -> EXTRACT(MONTH FROM invoice_date) IN (1, 2, 3)

====================================
MULTI-QUERY & CROSS-DATASET REASONING RULES
====================================
- For any complex reasoning question (e.g. "Which crop generated the most revenue in one file but had the most returns in the other?", "Show top crop in FY2425 vs FY2627", or drop-off/time comparative analysis), do NOT attempt to write a single fragile SQL statement with complex JOINs/UNIONs.
- Instead, break down the execution into a series of simple, focused SQL queries in the "queries" array. The answer synthesizer will execute them and reason over the combined results.
- In the primary "sql" property, supply the first query from the list as a fallback, or a simple count/overall query.

Output a strict JSON object with this exact schema:
{
  "out_of_scope": false,
  "confidence": 0.95,
  "sql": "SELECT ... (Primary query or fallback sql)",
  "queries": [
    {
      "description": "Short explanation of what this sub-query retrieves",
      "sql": "SELECT ..."
    }
  ],
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

    let completion;
    try {
      completion = await openaiClient.chat.completions.create({
        messages: chatMessages,
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.0
      });
    } catch (apiErr) {
      if (apiErr.status === 429 || String(apiErr.message).includes('limit') || String(apiErr.message).includes('Limit')) {
        console.warn('[QueryTranslator] OpenAI 429 rate limit hit for gpt-4o-mini. Retrying with gpt-4o...');
        completion = await openaiClient.chat.completions.create({
          messages: chatMessages,
          model: 'gpt-4o',
          response_format: { type: 'json_object' },
          temperature: 0.0
        });
      } else {
        throw apiErr;
      }
    }

    const rawResponse = completion.choices[0].message.content.trim();
    console.log('Raw Query plan translation:', rawResponse);
    return JSON.parse(rawResponse);
  } catch (error) {
    console.error('OpenAI query translation failed:', error);
    throw new Error(`Failed to translate business question: ${error.message}`);
  }
}

/**
 * Auto-repairs a failed SQL query using the database error message.
 */
export async function repairSQLQuery(question, failedSql, errorMessage) {
  if (!openaiClient) {
    throw new Error('OpenAI AI Client is not configured.');
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
    const completion = await openaiClient.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Please repair the SQL query.` }
      ],
      model: 'gpt-4o-mini',
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
