import os
import json
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
from dotenv import load_dotenv
from groq import Groq

# Resolve backend directories
BACKEND_DIR = Path(__file__).resolve().parent
BASE_DIR = BACKEND_DIR.parent
CSV_PATH = BASE_DIR / "sample_sap_sales.csv"

# Load environment variables explicitly from backend/.env
env_path = BACKEND_DIR / ".env"
load_dotenv(dotenv_path=env_path)

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("backend")

app = FastAPI(title="Acsen Agri Sales AI Backend")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global DataFrame reference
df = None

@app.on_event("startup")
def startup_event():
    global df
    # Log GROQ_API_KEY loading status
    api_key = os.environ.get("GROQ_API_KEY")
    if api_key:
        # Strip quotes if they were added (e.g. "key" -> key)
        if (api_key.startswith('"') and api_key.endswith('"')) or (api_key.startswith("'") and api_key.endswith("'")):
            api_key = api_key[1:-1]
            os.environ["GROQ_API_KEY"] = api_key
            
        masked_key = api_key[:6] + "..." + api_key[-4:] if len(api_key) > 10 else "short/invalid"
        logger.info(f"GROQ_API_KEY loaded successfully (length: {len(api_key)}, format: {masked_key})")
    else:
        logger.warning("GROQ_API_KEY is not configured in backend/.env!")

    if not CSV_PATH.exists():
        logger.error(f"Dataset not found at {CSV_PATH}. Creating an empty DataFrame.")
        df = pd.DataFrame()
        return
    try:
        df = pd.read_csv(CSV_PATH)
        # Standardize dates and numerical columns
        if "Date" in df.columns:
            df["Date"] = pd.to_datetime(df["Date"]).dt.strftime("%Y-%m-%d")
        if "Quantity" in df.columns:
            df["Quantity"] = pd.to_numeric(df["Quantity"], errors="coerce").fillna(0).astype(int)
        if "Sales Price" in df.columns:
            df["Sales Price"] = pd.to_numeric(df["Sales Price"], errors="coerce").fillna(0.0)
        if "Amount INR" in df.columns:
            df["Amount INR"] = pd.to_numeric(df["Amount INR"], errors="coerce").fillna(0.0)
        if "COGM" in df.columns:
            df["COGM"] = pd.to_numeric(df["COGM"], errors="coerce").fillna(0.0)
        
        logger.info(f"Loaded dataset from {CSV_PATH} with {len(df)} records.")
    except Exception as e:
        logger.error(f"Error loading dataset: {e}")
        df = pd.DataFrame()

class AskRequest(BaseModel):
    question: str

EXACT_COLUMNS = [
    "Invoice ID", "Date", "Billing Type", "Billing Type Description",
    "Distribution Channel", "Customer ID", "Customer Name", "Division",
    "Crop", "Variety", "Sales Unit", "Own/Trade", "Material Code",
    "Material Description", "Season Code", "State", "Territory",
    "AM", "RBM", "DBM", "Quantity", "Sales Price", "Amount INR", "COGM"
]

def resolve_column(col_name: str) -> Optional[str]:
    if not col_name:
        return None
    col_lower = col_name.strip().lower()
    for col in EXACT_COLUMNS:
        if col.lower() == col_lower:
            return col
    return None

def execute_pandas_query(query_plan: Dict[str, Any]) -> pd.DataFrame:
    global df
    if df is None or df.empty:
        return pd.DataFrame()

    filtered_df = df.copy()
    
    # 1. Apply filters
    filters = query_plan.get("filters", [])
    for f in filters:
        col = resolve_column(f.get("column", ""))
        if not col:
            continue
        op = f.get("operator", "==")
        val = f.get("value")
        
        # Safe comparison
        if op == "==":
            if filtered_df[col].dtype == 'object' and isinstance(val, str):
                filtered_df = filtered_df[filtered_df[col].str.lower() == val.lower()]
            else:
                filtered_df = filtered_df[filtered_df[col] == val]
        elif op == "!=":
            if filtered_df[col].dtype == 'object' and isinstance(val, str):
                filtered_df = filtered_df[filtered_df[col].str.lower() != val.lower()]
            else:
                filtered_df = filtered_df[filtered_df[col] != val]
        elif op == ">":
            filtered_df = filtered_df[filtered_df[col] > float(val)]
        elif op == "<":
            filtered_df = filtered_df[filtered_df[col] < float(val)]
        elif op == "in" and isinstance(val, list):
            if filtered_df[col].dtype == 'object':
                val_lower = [v.lower() if isinstance(v, str) else str(v).lower() for v in val]
                filtered_df = filtered_df[filtered_df[col].str.lower().isin(val_lower)]
            else:
                filtered_df = filtered_df[filtered_df[col].isin(val)]

    # 2. Extract metrics and groupings
    groupby_raw = query_plan.get("groupby", [])
    groupby_cols = [resolve_column(g) for g in groupby_raw if resolve_column(g)]
    
    metric_info = query_plan.get("metric", {})
    metric_col_raw = metric_info.get("column", "")
    metric_col = resolve_column(metric_col_raw)
    agg_method = metric_info.get("aggregation", "sum")
    
    # Handle "Net External Sales" custom metric (Gross sales F2 - Returns RE - Cancellations S1)
    is_net_external = False
    if metric_col_raw.strip().lower() in ["net external sales", "net sales", "net revenue", "net_external_sales"]:
        is_net_external = True

    # 3. Aggregate
    if is_net_external:
        if groupby_cols:
            # Group by group_cols + "Billing Type"
            grouped = filtered_df.groupby(groupby_cols + ["Billing Type"])["Amount INR"].sum().unstack(fill_value=0.0)
            
            # Ensure the necessary Billing Types are present
            for bt in ["F2", "RE", "S1"]:
                if bt not in grouped.columns:
                    grouped[bt] = 0.0
                    
            grouped["Net External Sales"] = grouped["F2"] - grouped["RE"] - grouped["S1"]
            result_df = grouped.reset_index()
            # Keep only groupby columns and result
            result_df = result_df[groupby_cols + ["Net External Sales"]]
            target_val_col = "Net External Sales"
        else:
            f2_sum = filtered_df[filtered_df["Billing Type"] == "F2"]["Amount INR"].sum()
            re_sum = filtered_df[filtered_df["Billing Type"] == "RE"]["Amount INR"].sum()
            s1_sum = filtered_df[filtered_df["Billing Type"] == "S1"]["Amount INR"].sum()
            net_val = f2_sum - re_sum - s1_sum
            result_df = pd.DataFrame([{"Net External Sales": net_val}])
            target_val_col = "Net External Sales"
    else:
        # Standard metric
        if not metric_col:
            metric_col = "Amount INR"  # Default fallback
            
        if groupby_cols:
            result_df = filtered_df.groupby(groupby_cols)[metric_col].agg(agg_method).reset_index()
            target_val_col = metric_col
        else:
            val = filtered_df[metric_col].agg(agg_method)
            # convert numpy types to standard python types
            if hasattr(val, "item"):
                val = val.item()
            result_df = pd.DataFrame([{metric_col: val}])
            target_val_col = metric_col

    # 4. Sort
    sort_dir = query_plan.get("sort")
    if sort_dir == "desc":
        result_df = result_df.sort_values(by=target_val_col, ascending=False)
    elif sort_dir == "asc":
        result_df = result_df.sort_values(by=target_val_col, ascending=True)

    # 5. Limit
    limit = query_plan.get("limit")
    if limit is not None:
        result_df = result_df.head(int(limit))
        
    return result_df

@app.post("/api/ask")
async def ask_question(req: AskRequest):
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return {
            "answer": "Groq API Key is not configured. Please add your `GROQ_API_KEY` to the `backend/.env` file.",
            "warning": {
                "title": "Configuration Missing",
                "message": "The backend server is missing the GROQ_API_KEY environment variable. Please edit backend/.env and restart the backend."
            }
        }

    question_lower = req.question.lower()

    # Pre-checks for limitations/scope
    if "2025-26" in question_lower or "fy25-26" in question_lower or "fy2526" in question_lower or ("previous year" in question_lower and "growth" in question_lower):
        return {
            "answer": "I cannot calculate sales growth comparisons because the data file for FY2025-26 is missing.",
            "warning": {
                "title": "Data Limitation Notice",
                "message": "The SAP sales extract file for FY2025-26 (ACSEN-SalesData-FY2526.xlsx) has not been received. Year-on-year calculations and comparisons spanning this period are disabled in this current system version."
            }
        }
        
    if "budget" in question_lower or "forecast" in question_lower or "variance" in question_lower or "target" in question_lower:
        return {
            "answer": "I am unable to display budget comparisons because budget data is not part of the scope.",
            "scopeWarning": {
                "title": "Feature Out of Scope",
                "message": "Budget-versus-actual analysis, COGM planned-versus-actuals, and forecasts are outside the scope of this sales POC."
            }
        }

    try:
        client = Groq(api_key=api_key)
    except Exception as e:
        logger.error(f"Failed to initialize Groq client: {e}")
        raise HTTPException(status_code=500, detail="Failed to initialize AI client.")

    # 1. Translate question to structured JSON query plan
    system_prompt = f"""You are a translation layer converting natural language business questions into structured Pandas DataFrame operations on a sales dataset.

The dataset columns and types are:
- Invoice ID (string)
- Date (string in YYYY-MM-DD format)
- Billing Type (string: 'F2' for standard invoices, 'RE' for returns, 'S1' for cancelled invoices, 'IPT' for stock transfers)
- Billing Type Description (string)
- Distribution Channel (string: 'Distributor', 'Dealer', 'Direct')
- Customer ID (string)
- Customer Name (string)
- Division (string: 'VG' for Vegetables division, 'FC' for Field Crops division)
- Crop (string: e.g. 'Tomato', 'Chilli', 'Maize', 'Paddy', 'Okra', 'Cotton', 'Mustard', 'Cabbage')
- Variety (string)
- Sales Unit (string: 'Packets' or 'KG')
- Own/Trade (string: 'Own' or 'Trade')
- Material Code (string)
- Material Description (string)
- Season Code (string: 'N/A', 'Kharif', 'Rabi', 'Summer')
- State (string: 'Tamil Nadu', 'Karnataka', 'Andhra Pradesh', 'Maharashtra', 'Gujarat')
- Territory (string)
- AM (string: Area Manager)
- RBM (string: Regional Business Manager)
- DBM (string: District Business Manager)
- Quantity (numeric)
- Sales Price (numeric)
- Amount INR (numeric)
- COGM (numeric: Cost of Goods Manufactured)

Important Business Rules:
1. For standard sales/revenue, aggregate 'Amount INR' where Billing Type is 'F2'.
2. For returns value, aggregate 'Amount INR' where Billing Type is 'RE'.
3. For cancelled value, aggregate 'Amount INR' where Billing Type is 'S1'.
4. For net external sales, set the metric column name to "Net External Sales" and aggregation to "sum". The query executor will automatically compute this as F2_sum - RE_sum - S1_sum. Do NOT aggregate 'Amount INR' directly for net external sales.
5. Stock Transfers (IPT) are Billing Type == 'IPT' and are excluded from net sales and normal revenue.

Output a strict JSON object with this exact schema:
{{
  "filters": [
    {{"column": "Column Name", "operator": "==" | "!=" | ">" | "<" | "in", "value": "value_or_list"}}
  ],
  "groupby": ["Column Name"],
  "metric": {{
    "column": "Quantity" | "Sales Price" | "Amount INR" | "COGM" | "Net External Sales",
    "aggregation": "sum" | "mean" | "count" | "min" | "max"
  }},
  "sort": "asc" | "desc" | null,
  "limit": number_or_null,
  "chart_recommendation": "bar" | "line" | "pie" | "none"
}}

Rules:
- Respond ONLY with the JSON object. Do not include markdown blocks, backticks (e.g. ```json), or conversational preamble.
- Filter column values carefully, e.g. state names, crop names, AM/RBM names. Case matches will be handled case-insensitively, but spellings should match standard values (e.g. 'Tamil Nadu', 'Ramesh Nair', 'Tomato', 'VG').
"""

    try:
        completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": req.question}
            ],
            model="llama-3.3-70b-versatile",
            response_format={"type": "json_object"},
            temperature=0.0
        )
        plan_text = completion.choices[0].message.content
        logger.info(f"Groq query plan output: {plan_text}")
        query_plan = json.loads(plan_text)
    except Exception as e:
        logger.error(f"Error calling Groq for query plan: {e}")
        return {
            "answer": "Failed to translate the question into a structured data plan. Please try rephrasing your question.",
            "error": str(e)
        }

    # 2. Execute Pandas Query
    try:
        result_df = execute_pandas_query(query_plan)
        logger.info(f"Query execution shape: {result_df.shape}")
    except Exception as e:
        logger.error(f"Error executing pandas query: {e}")
        return {
            "answer": f"Error executing data query: {e}. Please adjust the query terms.",
            "error": str(e)
        }

    if result_df.empty:
        return {
            "answer": "No data matches the selected filters or criteria.",
            "table": {"columns": [], "rows": []},
            "chart_data": {"type": "none", "xAxis": "", "series": [], "data": []}
        }

    # Format result table for JSON response and prompt
    columns = list(result_df.columns)
    # Fill NaN values with 0 and convert records
    rows = result_df.fillna(0).to_dict(orient="records")
    
    # Render readable markdown table for the synthesis prompt
    markdown_table = result_df.fillna(0).to_markdown(index=False)

    # 3. Send results to Groq for answer synthesis
    synthesis_prompt = f"""You are Acsen Sales Analytics AI, a business intelligence analyst for Acsen Agri.
Explain the answer to the user's question clearly and concisely based on the query result table.

Original User Question: "{req.question}"
Data Operations Applied: Grouped by {query_plan.get('groupby', 'None')}, filtered by {query_plan.get('filters', 'None')}.
Result Table:
{markdown_table}

Guidelines:
1. Provide a direct, professional, and clear answer paragraph (2-4 sentences max).
2. For money/currency, write in terms of Indian Rupees (e.g. ₹4.25 Lakhs (L), ₹12.5 Crores (Cr) or direct figures like ₹90,000). Use standard Indian formatting where appropriate.
3. Avoid technical jargon like "pandas", "dataframes", "JSON", "dataframe index", or "Billing Type F2". Translate them into business terms (e.g. "standard invoice sales", "returns value").
4. Highlight the most significant finding (e.g., the top item or the overall total).
"""

    try:
        completion_synth = client.chat.completions.create(
            messages=[
                {"role": "system", "content": synthesis_prompt},
                {"role": "user", "content": f"Please synthesize the summary paragraph for question: {req.question}"}
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.3
        )
        answer = completion_synth.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"Error calling Groq for synthesis: {e}")
        answer = f"The query executed successfully and returned {len(rows)} records. (Synthesis error: {e})"

    # 4. Package Response
    groupby_cols = [resolve_column(g) for g in query_plan.get("groupby", []) if resolve_column(g)]
    metric_info = query_plan.get("metric", {})
    metric_col_raw = metric_info.get("column", "")
    metric_col = resolve_column(metric_col_raw)
    
    if metric_col_raw.strip().lower() in ["net external sales", "net sales", "net revenue", "net_external_sales"]:
        target_val_col = "Net External Sales"
    else:
        target_val_col = metric_col if metric_col else "Amount INR"

    chart_type = query_plan.get("chart_recommendation", "bar")
    if not groupby_cols or chart_type == "none":
        chart_type = "none"

    chart_data = {
        "type": chart_type,
        "xAxis": groupby_cols[0] if groupby_cols else "Metric",
        "series": [target_val_col],
        "data": rows
    }

    # Format table for frontend (headers and rows lists)
    table_headers = columns
    table_rows = [[r.get(c, 0) for c in columns] for r in rows]

    # Quick follow-up suggestions
    suggestions = [
        "What are total sales and net sales?",
        "Which state generated the highest sales?",
        "Which crop performed best in Vegetable Division?",
        "Show sales returns by state"
    ]

    # Generate custom calculation basis details
    filters_desc = ", ".join([f"{f.get('column')} {f.get('operator')} {f.get('value')}" for f in query_plan.get('filters', [])])
    calc_basis = f"Aggregated {target_val_col} ({query_plan.get('metric', {}).get('aggregation', 'sum')})"
    if groupby_cols:
        calc_basis += f" grouped by {', '.join(groupby_cols)}"
    if filters_desc:
        calc_basis += f" filtered by [{filters_desc}]"

    response_payload = {
        "answer": answer,
        "tableData": {
            "headers": table_headers,
            "rows": table_rows
        },
        "chartData": chart_data,
        "calculationBasis": calc_basis,
        "suggestions": suggestions
    }

    return response_payload

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
