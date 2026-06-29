import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

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

export async function translateQuestionToPlan(question, activeFilters = {}, history = []) {
  if (!groqClient) {
    throw new Error('Groq AI Client is not configured. Please supply a valid GROQ_API_KEY.');
  }

  let filterContext = '';
  if (activeFilters && Object.keys(activeFilters).length > 0) {
    filterContext = `\nActive Screen Filters Context (You MUST apply these as filters in the WHERE clause where appropriate. For example, if division is 'VG', filter materials by division = 'VG'): ${JSON.stringify(activeFilters)}\n`;
  }

  const systemPrompt = `You are a translation layer converting natural language business questions into structured PostgreSQL queries on a normalized sales database.

Database Schema and Tables:
1. financial_years (fy_code TEXT PRIMARY KEY, fy_name TEXT NOT NULL)
   - Values: 'FY2425' (Financial Year 2024-25), 'FY2627' (Financial Year 2026-27)
2. billing_types (billing_type TEXT PRIMARY KEY, billing_desc TEXT NOT NULL, classification TEXT NOT NULL)
   - Classifications: 'GROSS_SALE' (F2 standard invoices), 'RETURN' (RE returns), 'CANCELLED' (S1 cancelled invoices), 'STOCK_TRANSFER' (IPT internal transfers)
3. materials (material_code TEXT PRIMARY KEY, material_desc TEXT NOT NULL, division TEXT NOT NULL, crop TEXT NOT NULL, variety TEXT NOT NULL, sales_unit TEXT NOT NULL, own_trade TEXT NOT NULL)
   - division: 'VG' (Vegetables), 'FC' (Field Crops)
   - own_trade: 'Own', 'Trade'
4. employees (employee_id TEXT PRIMARY KEY, employee_name TEXT NOT NULL, role TEXT NOT NULL)
   - roles: 'RBM', 'AM', 'DBM'
5. customers (customer_id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, dist_channel TEXT NOT NULL)
   - dist_channels: 'Dealer', 'Distributor', 'Direct'
6. territories (territory_id INTEGER PRIMARY KEY, state TEXT NOT NULL, territory TEXT NOT NULL, territory_incharge_id TEXT, am_id TEXT, rbm_id TEXT, dbm_id TEXT)
   - Manager IDs link to employees.employee_id
7. sales_data (invoice_id TEXT PRIMARY KEY, invoice_date DATE NOT NULL, billing_type TEXT NOT NULL, customer_id TEXT NOT NULL, material_code TEXT NOT NULL, territory_id INTEGER NOT NULL, qty INTEGER NOT NULL, sales_unit TEXT NOT NULL, sales_amount_inr NUMERIC(15, 2) NOT NULL, cogm NUMERIC(15, 2) NOT NULL, season_code TEXT NOT NULL, fy_code TEXT NOT NULL, batch_id INTEGER)

Important Business and Join Rules:
1. Standard Gross Sales: Filter sd.billing_type in (SELECT billing_type FROM billing_types WHERE classification='GROSS_SALE').
2. Returns Value: Filter classification='RETURN'.
3. Cancelled Invoices: Filter classification='CANCELLED'.
4. Stock Transfers (IPT): Filter classification='STOCK_TRANSFER' (normally EXCLUDED from gross sales/net sales unless specifically asked).
5. Net External Sales: Calculate as SUM(CASE WHEN bt.classification='GROSS_SALE' THEN sd.sales_amount_inr ELSE 0 END) - SUM(CASE WHEN bt.classification='RETURN' THEN sd.sales_amount_inr ELSE 0 END) - SUM(CASE WHEN bt.classification='CANCELLED' THEN sd.sales_amount_inr ELSE 0 END).
6. Season Code: Only relevant for Field Crops (FC).
7. Monthly Trend: Format sd.invoice_date using to_char(sd.invoice_date, 'YYYY-MM') AS sortkey.
8. All filters must resolve through standard SQL joins:
   - Join billing_types: sd.billing_type = bt.billing_type
   - Join materials: sd.material_code = m.material_code
   - Join territories: sd.territory_id = t.territory_id
   - Join customers: sd.customer_id = c.customer_id
   - Join employees for territory managers.

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
- If the user asks for "top crop", "highest selling crop", or "best performing crop", navigate to:
  {
     "navigateTo": "product",
     "section": "crop-performance"
  }
  Do NOT hardcode a division filter (like "VG" or "FC") unless the user explicitly mentioned "Vegetables" or "Field Crops" in their question. Let the query results determine the filters dynamically.
- If the question is not about Acsen Agriscience sales data, crops, states, variety performance, or return rates (e.g. asking about general knowledge, programming, weather, generic chats, or agriculture statistics outside our database), you MUST set "out_of_scope" to true and return the empty JSON template above.
- Every generated SQL query MUST query FROM sales_data (aliased as sd) and explicitly include all required JOINs (billing_types as bt, materials as m, territories as t, customers as c) if columns or classifications from those tables are referenced anywhere in the SELECT, WHERE, or GROUP BY clauses.
- Formulate standard SQL that is fully executable in PostgreSQL. Use table aliases like 'sd', 'bt', 'm', 't', 'c' to prevent column name ambiguities.
- Ensure column names returned in the SELECT statement match the group-by parameters exactly (e.g. SELECT t.state AS state ... GROUP BY t.state maps to "groupby": ["state"]).
- CRITICAL: Whenever a non-aggregated column appears in the SELECT clause (for example, EXTRACT(YEAR FROM sd.invoice_date)), you MUST include that exact expression in the GROUP BY clause.
- Always use exact join key conditions: sd.billing_type = bt.billing_type, sd.material_code = m.material_code, sd.territory_id = t.territory_id, sd.customer_id = c.customer_id. Never join on c.customer_name.
- For names (crops, states, employees, channels) use native Postgres ILIKE matching, e.g. m.crop ILIKE 'tomato' or t.state ILIKE 'tamil nadu' or c.dist_channel ILIKE 'dealer'.
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
