# Acsen AI-Enabled Sales Analytics — Backend API & Database Specification

This document provides a comprehensive blueprint of the frontend modules, data rules, database schema, and backend REST APIs required to transition the **Acsen Sales Analytics platform** from a client-side mockup to a production database-backed application.

---

## 1. Frontend Structure & Components

The frontend is built as a single-page React application structured around a sidebar navigation layout with global filtering and interactive tabs.

### 1.1 Layout and Global Controls
*   **Main Container:** [App.jsx](file:///c:/Ascen-Kambaa/ASCEN-Agri-Project/src/App.jsx)
    *   Coordinates the active tab state (`activeTab`).
    *   Maintains the global filter state (`filters`).
    *   Manages dark/light theme classes (`dark-theme`).
    *   Provides CSV file upload triggering and reports export triggers.
*   **Sidebar Navigation:** [Sidebar.jsx](file:///c:/Ascen-Kambaa/ASCEN-Agri-Project/src/components/Sidebar.jsx)
    *   Tabs: Executive Summary, Sales Performance, Geography & Regions, Product Performance, Returns Analysis, Transactions, and Ask AI Assistant.
    *   Theme toggle switch.
*   **Global Filter Bar:** [FilterBar.jsx](file:///c:/Ascen-Kambaa/ASCEN-Agri-Project/src/components/FilterBar.jsx)
    *   Fields: Financial Year (FY2425, FY2627), Division (VG, FC), Distribution Channel, State, Crop, Start Date, and End Date.
    *   Action: **Reset Filters** button.

### 1.2 Dashboard Modules (Tabs)
1.  **Executive Summary:** [ExecutiveSummary.jsx](file:///c:/Ascen-Kambaa/ASCEN-Agri-Project/src/components/ExecutiveSummary.jsx)
    *   Five KPI cards (Gross Sales, Returns, Cancelled, Net Sales, COGM).
    *   Gross Sales Monthly Trend (Line, Bar, Area, Heatmap, Waterfall charts).
    *   Division Split (Donut, Treemap, Sunburst charts).
    *   Ranked top lists with variable limits (States, Crops, Dealers).
    *   Sales by State intensity grid, State returns rate list, AI recommendations, and Dataset Health indicators.
2.  **Sales Performance:** [SalesPerformance.jsx](file:///c:/Ascen-Kambaa/ASCEN-Agri-Project/src/components/SalesPerformance.jsx)
    *   Division toggle (VG vs FC).
    *   KPI cards specific to the selected division.
    *   Monthly trend and Distribution Channel split.
    *   Season-wise sales contribution (FC division only).
3.  **Geography & Regions:** [GeographyRegion.jsx](file:///c:/Ascen-Kambaa/ASCEN-Agri-Project/src/components/GeographyRegion.jsx)
    *   Ranked list of states (Invoice count and Gross Sales).
    *   Interactive State drill-down displaying:
        *   Organizational hierarchy (RBM, AM, DBM).
        *   Territory sales breakdown.
        *   Top crops sold in the selected state.
4.  **Product Performance:** [ProductPerformance.jsx](file:///c:/Ascen-Kambaa/ASCEN-Agri-Project/src/components/ProductPerformance.jsx)
    *   Division toggle (VG vs FC).
    *   Crop revenue rankings.
    *   Own vs Trade split.
    *   Crop detail drill-down (Varieties, Material Codes, and State-wise sales distribution).
5.  **Returns Analysis:** [ReturnsAnalysis.jsx](file:///c:/Ascen-Kambaa/ASCEN-Agri-Project/src/components/ReturnsAnalysis.jsx)
    *   Return KPIs (Gross reference, Returns total, Return rate %).
    *   Monthly return trends, Channel returns split, State returns value & rate %, and Crop returns ranking.
6.  **Transaction Drill-Down:** [TransactionDrillDown.jsx](file:///c:/Ascen-Kambaa/ASCEN-Agri-Project/src/components/TransactionDrillDown.jsx)
    *   Search input box (searches Invoice, Customer, Crop, Variety, State, Territory, Material).
    *   Paginated transaction table (12 records per page).
    *   Export buttons (CSV, Excel, PDF).
7.  **Ask AI Assistant:** [AskAI.jsx](file:///c:/Ascen-Kambaa/ASCEN-Agri-Project/src/components/AskAI.jsx)
    *   Chat container with conversation history.
    *   Grounded data response card (summary, dynamic charts, tables, metadata details).
    *   Golden/Suggested follow-up questions buttons.

---

## 2. Recommended Database Schema & Data Rules

To handle OLAP queries efficiently, a relational database (e.g., PostgreSQL) is recommended. The SAP Excel extract data maps to a single wide table design or a star schema. For simplicity and query speed in a POC environment, a single consolidated table is highly effective.

### 2.1 Table Schema: `sales_data`

| Column Name | SQL Data Type | Nullability | Description / Sample Value |
|---|---|---|---|
| `invoice_id` | `VARCHAR(50)` | `NOT NULL` (PK) | Unique invoice identifier, e.g. `INV-FY2425-10001` |
| `date` | `DATE` | `NOT NULL` | Invoice Billing Date, format `YYYY-MM-DD` |
| `fy` | `VARCHAR(10)` | `NOT NULL` | Financial Year code, e.g. `FY2425` or `FY2627` |
| `billing_type` | `VARCHAR(5)` | `NOT NULL` | Billing Type code, e.g. `F2`, `RE`, `S1`, `IPT` |
| `billing_desc` | `VARCHAR(100)` | `NOT NULL` | Billing Description, e.g. `Standard Invoice` |
| `dist_channel` | `VARCHAR(50)` | `NOT NULL` | Distribution Channel: `Dealer`, `Distributor`, `Direct` |
| `customer_id` | `VARCHAR(50)` | `NOT NULL` | Unique SAP Customer ID |
| `customer_name` | `VARCHAR(150)` | `NOT NULL` | Customer Name |
| `division` | `VARCHAR(5)` | `NOT NULL` | Division code: `VG` (Vegetables), `FC` (Field Crops) |
| `crop` | `VARCHAR(100)` | `NOT NULL` | Crop Name, e.g. `Tomato`, `Chilli`, `Maize` |
| `variety` | `VARCHAR(100)` | `NOT NULL` | Crop variety description |
| `sales_unit` | `VARCHAR(20)` | `NOT NULL` | Unit of measure: `Packets`, `KG` |
| `own_trade` | `VARCHAR(20)` | `NOT NULL` | Product source classification: `Own`, `Trade` |
| `material_code` | `VARCHAR(50)` | `NOT NULL` | Unique material SKU code |
| `material_desc` | `VARCHAR(200)` | `NOT NULL` | Material Description |
| `season_code` | `VARCHAR(20)` | `NOT NULL` | Season, e.g., `Kharif`, `Rabi`, `Summer`, `N/A` |
| `state` | `VARCHAR(100)` | `NOT NULL` | State, e.g. `Tamil Nadu`, `Karnataka`, `Gujarat` |
| `territory` | `VARCHAR(100)` | `NOT NULL` | Sales Territory |
| `territory_incharge`| `VARCHAR(150)`| `NULL` | Name of territory DBM or manager |
| `am` | `VARCHAR(150)` | `NULL` | Area Manager name |
| `rbm` | `VARCHAR(150)` | `NULL` | Regional Business Manager name |
| `dbm` | `VARCHAR(150)` | `NULL` | District Business Manager name |
| `qty` | `INTEGER` | `NOT NULL` | Invoice-line quantity |
| `sales_price` | `NUMERIC(12,2)`| `NOT NULL` | Sales price per unit |
| `sales_amount_inr`| `NUMERIC(15,2)`| `NOT NULL` | Net Amount in INR |
| `cogm` | `NUMERIC(15,2)`| `NOT NULL` | Cost of Goods Manufactured |

### 2.2 Table Indexes
For optimization of multi-dimension filtering and date searches:
```sql
CREATE INDEX idx_sales_data_date ON sales_data(date);
CREATE INDEX idx_sales_data_fy ON sales_data(fy);
CREATE INDEX idx_sales_data_filters ON sales_data(division, dist_channel, state, crop);
CREATE INDEX idx_sales_data_billing ON sales_data(billing_type);
```

### 2.3 Transaction Billing Type Rules
All aggregates must apply these transactional rules on `billing_type`:
*   **Gross Invoice Sales**: `billing_type = 'F2'`
*   **Sales Returns (RE)**: `billing_type = 'RE'` (represent returned values as absolute values in UI)
*   **Cancelled Invoices (S1)**: `billing_type = 'S1'`
*   **Stock Transfers (IPT)**: `billing_type = 'IPT'` (exclude from net/gross sales calculations)
*   **Net External Sales Formula**: `Gross Invoice Sales - Sales Returns - Cancelled Invoices`

---

## 3. REST API Specifications

The backend must provide REST endpoints to feed dashboard components, accepting a unified set of filter query parameters.

### 3.1 Common Query Parameters
All `GET` endpoints below accept the following filter parameters:
```json
{
  "fy": "string (optional)",
  "division": "string (optional, 'VG'|'FC')",
  "dist_channel": "string (optional)",
  "state": "string (optional)",
  "crop": "string (optional)",
  "variety": "string (optional)",
  "start_date": "string (optional, YYYY-MM-DD)",
  "end_date": "string (optional, YYYY-MM-DD)"
}
```

---

### 3.2 Endpoint: `GET /api/dashboard/summary`
Feeds the **Executive Summary** tab.

*   **SQL Computations:**
    ```sql
    -- 1. KPIs
    SELECT
      SUM(CASE WHEN billing_type = 'F2' THEN sales_amount_inr ELSE 0 END) as gross_sales,
      SUM(CASE WHEN billing_type = 'RE' THEN sales_amount_inr ELSE 0 END) as returns_value,
      SUM(CASE WHEN billing_type = 'S1' THEN sales_amount_inr ELSE 0 END) as cancelled_value,
      SUM(CASE WHEN billing_type = 'F2' THEN cogm ELSE 0 END) as total_cogm
    FROM sales_data
    WHERE [FILTERS];

    -- 2. Monthly Trend
    SELECT TO_CHAR(date, 'YYYY-MM') as sortKey, TO_CHAR(date, 'Mon YY') as label, SUM(sales_amount_inr) as value
    FROM sales_data
    WHERE billing_type = 'F2' AND [FILTERS]
    GROUP BY sortKey, label ORDER BY sortKey;

    -- 3. Division Split
    SELECT division, SUM(sales_amount_inr) as value
    FROM sales_data
    WHERE billing_type = 'F2' AND [FILTERS]
    GROUP BY division;

    -- 4. Top States, Crops, Dealers (Example Top States)
    SELECT state as label, SUM(sales_amount_inr) as value
    FROM sales_data
    WHERE billing_type = 'F2' AND [FILTERS]
    GROUP BY state ORDER BY value DESC LIMIT :limit;
    ```

*   **Response Payload Structure:**
    ```json
    {
      "kpis": {
        "grossSales": 54209930.00,
        "returnsValue": 4501200.00,
        "cancelledValue": 2100800.00,
        "netExternalSales": 47607930.00,
        "totalCOGM": 36100500.00
      },
      "monthlyTrend": [
        { "sortKey": "2024-09", "label": "Sep 24", "value": 8500200.00 },
        { "sortKey": "2024-10", "label": "Oct 24", "value": 9200400.00 }
      ],
      "divisionSplit": [
        { "label": "Vegetables (VG)", "value": 31200450.00 },
        { "label": "Field Crops (FC)", "value": 23009480.00 }
      ],
      "topStates": [
        { "label": "Tamil Nadu", "value": 15600300.00 },
        { "label": "Karnataka", "value": 12400200.00 }
      ],
      "topCrops": [
        { "label": "Tomato", "value": 14200100.00 },
        { "label": "Maize", "value": 9800400.00 }
      ],
      "topDealers": [
        { "label": "Dealer 847291", "value": 2400300.00 }
      ],
      "salesByStateIntensity": [
        { "label": "Tamil Nadu", "value": 15600300.00, "returns": 980000.00 }
      ],
      "datasetHealth": {
        "totalRows": 39887,
        "lastUpdated": "2026-05-30"
      }
    }
    ```

---

### 3.3 Endpoint: `GET /api/dashboard/sales`
Feeds the **Sales Performance** tab.

*   **Required Parameter:** `division` (default `VG`)
*   **SQL Computations:**
    ```sql
    -- Channel Split
    SELECT dist_channel as label, SUM(sales_amount_inr) as value
    FROM sales_data
    WHERE billing_type = 'F2' AND division = :division AND [FILTERS]
    GROUP BY dist_channel;

    -- Season Contribution (FC only)
    SELECT season_code as label, SUM(sales_amount_inr) as value
    FROM sales_data
    WHERE billing_type = 'F2' AND division = 'FC' AND season_code != 'N/A' AND [FILTERS]
    GROUP BY season_code;
    ```
*   **Response Payload Structure:**
    ```json
    {
      "kpis": {
        "grossSales": 31200450.00,
        "returnsValue": 2500100.00,
        "netExternalSales": 28700350.00
      },
      "monthlyTrend": [
        { "sortKey": "2024-09", "label": "Sep 24", "value": 4500100.00 }
      ],
      "channels": [
        { "label": "Dealer", "value": 18200300.00 },
        { "label": "Distributor", "value": 11000150.00 },
        { "label": "Direct", "value": 2000000.00 }
      ],
      "seasons": [
        { "label": "Kharif", "value": 12000000.00 },
        { "label": "Rabi", "value": 9000000.00 },
        { "label": "Summer", "value": 2009480.00 }
      ]
    }
    ```

---

### 3.4 Endpoint: `GET /api/dashboard/geography`
Feeds the **Geography & Regions** tab.

*   **Optional Parameter:** `selected_state` (fetches hierarchy, territories, and crops drill-down)
*   **SQL Computations:**
    ```sql
    -- State list overview
    SELECT state as name, SUM(sales_amount_inr) as gross, COUNT(*) as count
    FROM sales_data
    WHERE billing_type = 'F2' AND [FILTERS]
    Group by state ORDER BY gross DESC;

    -- Drill down: Territories for a selected state
    SELECT territory as name, SUM(sales_amount_inr) as gross, MAX(territory_incharge) as incharge
    FROM sales_data
    WHERE billing_type = 'F2' AND state = :selected_state AND [FILTERS]
    GROUP BY territory ORDER BY gross DESC;

    -- Drill down: Hierarchy for state
    SELECT rbm, am, dbm
    FROM sales_data
    WHERE state = :selected_state
    LIMIT 1;

    -- Drill down: Top Crops in selected state
    SELECT crop as name, SUM(sales_amount_inr) as gross
    FROM sales_data
    WHERE billing_type = 'F2' AND state = :selected_state AND [FILTERS]
    GROUP BY crop ORDER BY gross DESC LIMIT 5;
    ```
*   **Response Payload Structure:**
    ```json
    {
      "states": [
        { "name": "Tamil Nadu", "gross": 15600300.00, "count": 1840 }
      ],
      "selectedStateDetails": {
        "stateName": "Tamil Nadu",
        "hierarchy": {
          "rbm": "Ramesh Nair",
          "am": "M. Selvam",
          "dbm": "S. Kavin"
        },
        "territories": [
          { "name": "North TN", "gross": 5400100.00, "incharge": "S. Kavin (DBM)" }
        ],
        "crops": [
          { "name": "Tomato", "gross": 7800000.00 }
        ]
      }
    }
    ```

---

### 3.5 Endpoint: `GET /api/dashboard/product`
Feeds the **Product Performance** tab.

*   **Required Parameter:** `division` (default `VG`)
*   **Optional Parameter:** `selected_crop` (fetches varieties, materials, and geographics)
*   **SQL Computations:**
    ```sql
    -- Own vs Trade
    SELECT own_trade as label, SUM(sales_amount_inr) as value
    FROM sales_data
    WHERE billing_type = 'F2' AND division = :division AND [FILTERS]
    GROUP BY own_trade;

    -- Varieties breakdown
    SELECT variety as name, SUM(sales_amount_inr) as value
    FROM sales_data
    WHERE billing_type = 'F2' AND crop = :selected_crop AND [FILTERS]
    GROUP BY variety ORDER BY value DESC;

    -- Top Materials
    SELECT material_code as code, MAX(material_desc) as desc, SUM(sales_amount_inr) as value
    FROM sales_data
    WHERE billing_type = 'F2' AND crop = :selected_crop AND [FILTERS]
    GROUP BY material_code ORDER BY value DESC LIMIT 5;

    -- Geographic state contribution
    SELECT state as label, SUM(sales_amount_inr) as value
    FROM sales_data
    WHERE billing_type = 'F2' AND crop = :selected_crop AND [FILTERS]
    GROUP BY state ORDER BY value DESC;
    ```
*   **Response Payload Structure:**
    ```json
    {
      "crops": [
        { "name": "Tomato", "value": 14200100.00 }
      ],
      "ownTradeSplit": [
        { "label": "Own Manufactured", "value": 25000000.00 },
        { "label": "Traded Goods", "value": 6200450.00 }
      ],
      "selectedCropDetails": {
        "cropName": "Tomato",
        "varieties": [
          { "name": "Red Ruby", "value": 6200100.00 }
        ],
        "materials": [
          { "code": "MAT-84721", "desc": "Tomato Red Ruby Packets", "value": 6200100.00 }
        ],
        "geographicContribution": [
          { "label": "Tamil Nadu", "value": 7800000.00 }
        ]
      }
    }
    ```

---

### 3.6 Endpoint: `GET /api/dashboard/returns`
Feeds the **Returns Analysis** tab.

*   **SQL Computations:**
    ```sql
    -- State Returns showing rate (RE / F2)
    SELECT
      r.state as name,
      COALESCE(r.returns, 0) as returns,
      COALESCE(s.gross, 0) as gross,
      CASE WHEN COALESCE(s.gross, 0) > 0 THEN ROUND((r.returns / s.gross * 100), 2) ELSE 0 END as rate
    FROM
      (SELECT state, SUM(sales_amount_inr) as returns FROM sales_data WHERE billing_type = 'RE' GROUP BY state) r
      LEFT JOIN
      (SELECT state, SUM(sales_amount_inr) as gross FROM sales_data WHERE billing_type = 'F2' GROUP BY state) s
      ON r.state = s.state
    ORDER BY returns DESC;
    ```
*   **Response Payload Structure:**
    ```json
    {
      "kpis": {
        "grossSales": 54209930.00,
        "returnsValue": 4501200.00,
        "returnRate": 8.30
      },
      "returnsTrend": [
        { "sortKey": "2024-09", "label": "Sep 24", "value": 310200.00 }
      ],
      "channels": [
        { "label": "Dealer", "value": 3200100.00 }
      ],
      "states": [
        { "name": "Tamil Nadu", "returns": 980000.00, "rate": 6.28 }
      ],
      "crops": [
        { "name": "Tomato", "value": 1100500.00 }
      ]
    }
    ```

---

### 3.7 Endpoint: `GET /api/transactions`
Feeds the paginated **Transaction Drill-Down** table.

*   **Query Parameters:**
    *   Common filters +
    *   `search`: string (matches invoice ID, customer name, crop, variety, state, material code, or manager)
    *   `page`: integer (default `1`)
    *   `limit`: integer (default `12`)
*   **SQL Queries:**
    ```sql
    -- Fetch Paginated List
    SELECT
      invoice_id as "invoiceId",
      date,
      billing_desc as "billingTypeDescription",
      billing_type as "billingType",
      customer_name as "customerName",
      dist_channel as "distributionChannel",
      crop,
      variety,
      qty,
      sales_unit as "salesUnit",
      sales_amount_inr as "salesAmountINR",
      cogm,
      state,
      territory
    FROM sales_data
    WHERE [FILTERS]
      AND (
        invoice_id ILIKE :search
        OR customer_name ILIKE :search
        OR crop ILIKE :search
        OR variety ILIKE :search
        OR material_code ILIKE :search
        OR state ILIKE :search
        OR territory ILIKE :search
      )
    ORDER BY date DESC
    LIMIT :limit OFFSET :offset;

    -- Count total records for pagination headers
    SELECT COUNT(*) FROM sales_data WHERE [FILTERS] AND [SEARCH_CONDITIONS];
    ```
*   **Response Payload Structure:**
    ```json
    {
      "totalRecords": 3840,
      "page": 1,
      "limit": 12,
      "totalPages": 320,
      "data": [
        {
          "invoiceId": "INV-FY2425-10001",
          "date": "2024-09-02",
          "billingType": "F2",
          "billingTypeDescription": "Standard Invoice",
          "customerName": "Dealer 847291",
          "distributionChannel": "Dealer",
          "crop": "Tomato",
          "variety": "Red Ruby",
          "qty": 50,
          "salesUnit": "Packets",
          "salesAmountINR": 22500.00,
          "cogm": 14500.00,
          "state": "Tamil Nadu",
          "territory": "North TN"
        }
      ]
    }
    ```

---

### 3.8 Endpoint: `GET /api/transactions/export`
Generates full data exports.

*   **Query Parameters:** Common filters + `search` + `format` (`csv` or `xlsx`)
*   **Behavior:** Fetches all matching lines without pagination limits and yields download streams formatted as CSV or Excel binaries.

---

## 4. Ask AI Assistant API

### 4.1 Chat API Endpoint: `POST /api/ask`
A unified chat analytics query interface.

*   **Request Payload:**
    ```json
    {
      "question": "Show total sales and net sales in Vegetable Division"
    }
    ```
*   **Internal Processing Workflow:**
    1.  **AI Query Translation:** The model (e.g., Llama/Groq/OpenAI) receives the natural language question and translates it to a structured query plan or a safe PostgreSQL SQL statement.
    2.  **Validation Checks:** Pre-checks intercept requests that are out of scope (e.g., budgets/forecasts) or refer to unavailable timelines (missing FY25-26 data) and yield standard limitation notices.
    3.  **Database Execution:** The synthesized SQL query runs on the SQL database and pulls structured metrics.
    4.  **Answer Synthesis:** The raw database output table is fed back to the AI model alongside guidelines to generate a natural, professional response in Indian formatting context.
*   **Response Payload Structure:**
    ```json
    {
      "answer": "For the Vegetable Division, Gross Invoice Sales total ₹3.12 Cr. After accounting for sales returns of ₹25.00 L and cancels, Net External Sales stand at ₹2.87 Cr.",
      "tableData": {
        "headers": ["Division", "Gross Sales INR", "Returns INR", "Net External Sales INR"],
        "rows": [
          ["VG", 31200450.00, 2500100.00, 28700350.00]
        ]
      },
      "chartData": {
        "type": "bar",
        "xAxis": "Division",
        "series": ["Gross Sales INR", "Net External Sales INR"],
        "data": [
          { "Division": "VG", "Gross Sales INR": 31200450.00, "Net External Sales INR": 28700350.00 }
        ]
      },
      "calculationBasis": "Summed Amount INR grouped by division for Vegetable division invoices.",
      "suggestions": [
        "What was the highest selling crop in Vegetables?",
        "Compare returns for Vegetables across states"
      ]
    }
    ```

---

## 5. CSV Upload and Import API

### 5.1 Endpoint: `POST /api/data/upload`
Uploads a flat SAP Sales Excel extract translated to CSV format.

*   **Form Data:** `file` (the CSV file binary)
*   **Required Validation Rules:**
    1.  **Header Column Mapping:** Must check and map headers case-insensitively. The system must map common variants like `Invoice ID`, `Date`, `Billing Type`, `Quantity`, `Sales Price`, etc.
    2.  **Date Standardisation:** Convert varying date string representations to `YYYY-MM-DD`.
    3.  **Financial Year Extraction:** Determine the financial year group dynamically based on date ranges (e.g. `2024-04-01` to `2025-03-31` mapped to `FY2425`).
    4.  **Numeric Sanitisation:** Force empty values, text in numeric fields, or dashes to default `0` or `0.0`.
    5.  **Transaction Insertion:** Truncate/reset tables if doing a full restore, or insert/upsert using database operations with bulk batches to avoid query overheads.
*   **Response Payload Structure:**
    ```json
    {
      "status": "success",
      "message": "Successfully parsed and imported 39,887 records from ACSEN-SalesData-FY2425.csv.",
      "rowsImported": 39887,
      "financialYearsFound": ["FY2425"],
      "dataHealthSummary": {
        "duplicateInvoiceLines": 0,
        "missingCustomerIds": 0,
        "invalidNumericValuesCorrected": 42
      }
    }
    ```
