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

export async function translateQuestionToPlan(question, activeFilters = {}) {
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
  "sql": "SELECT ...",
  "groupby": ["column_name_as_returned_in_sql"],
  "metric": {
    "column": "column_name",
    "aggregation": "sum" | "avg" | "count"
  },
  "chart_recommendation": "bar" | "line" | "pie" | "none",
  "filters": [
    {"column": "column_name", "operator": "==" | "!=" | ">" | "<" | "in", "value": "value"}
  ]
}

Rules:
- Respond ONLY with the raw JSON object. Do not wrap in markdown block backticks (e.g. \`\`\`json) or include conversational text.
- Every generated SQL query MUST query FROM sales_data (aliased as sd) and explicitly include all required JOINs (billing_types as bt, materials as m, territories as t, customers as c) if columns or classifications from those tables are referenced anywhere in the SELECT, WHERE, or GROUP BY clauses.
- Formulate standard SQL that is fully executable in PostgreSQL. Use table aliases like 'sd', 'bt', 'm', 't', 'c' to prevent column name ambiguities.
- Ensure column names returned in the SELECT statement match the group-by parameters exactly (e.g. SELECT t.state AS state ... GROUP BY t.state maps to "groupby": ["state"]).
- Always use exact join key conditions: sd.billing_type = bt.billing_type, sd.material_code = m.material_code, sd.territory_id = t.territory_id, sd.customer_id = c.customer_id. Never join on c.customer_name.
- For names (crops, states, employees, channels) use native Postgres ILIKE matching, e.g. m.crop ILIKE 'tomato' or t.state ILIKE 'tamil nadu' or c.dist_channel ILIKE 'dealer'.
`;

  try {
    const completion = await groqClient.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question + filterContext }
      ],
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
