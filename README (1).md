# Acsen AI-Enabled Sales Analytics — POC

> **Internal working document — Confidential**
> Built by **Kambaa** for **Acsen Agriscience**
> POC discussion date: 23 June 2026

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Business Context](#2-business-context)
3. [Problem Statement](#3-problem-statement)
4. [POC Objective](#4-poc-objective)
5. [POC Scope](#5-poc-scope)
6. [Out of Scope](#6-out-of-scope)
7. [Source Data](#7-source-data)
8. [Data Preparation Requirements](#8-data-preparation-requirements)
9. [Data Rules and Limitations](#9-data-rules-and-limitations)
10. [Architecture Overview](#10-architecture-overview)
11. [User Journey and Flow](#11-user-journey-and-flow)
12. [Dashboard Modules](#12-dashboard-modules)
13. [Filters and Analysis Dimensions](#13-filters-and-analysis-dimensions)
14. [POC Measures and KPI Definitions](#14-poc-measures-and-kpi-definitions)
15. [Ask AI — Requirements and Behaviour](#15-ask-ai--requirements-and-behaviour)
16. [Golden Questions for QA](#16-golden-questions-for-qa)
17. [Non-Functional Requirements](#17-non-functional-requirements)
18. [Delivery Plan and Phases](#18-delivery-plan-and-phases)
19. [Validation and Acceptance Criteria](#19-validation-and-acceptance-criteria)
20. [Management Demo Runbook](#20-management-demo-runbook)
21. [Risks, Constraints and Mitigations](#21-risks-constraints-and-mitigations)
22. [Future Phase Backlog](#22-future-phase-backlog)
23. [Key Decisions and Agreements](#23-key-decisions-and-agreements)
24. [Action Items](#24-action-items)
25. [Team Usage Guide](#25-team-usage-guide)

---

## 1. Project Overview

This repository contains the Proof of Concept (POC) build for an **AI-Enabled Sales Analytics Platform** commissioned by Acsen Agriscience and developed by Kambaa.

The platform converts raw SAP Excel sales extracts into an interactive management dashboard with a natural-language **Ask AI** interface. It is designed to be demonstrated to Acsen's senior leadership — including the Executive Director, CEO, and MD — to validate the technical approach before a full enterprise implementation.

| Item | Detail |
|---|---|
| Client | Acsen Agriscience |
| Builder | Kambaa |
| POC Discussion | 23 June 2026 (virtual meeting, ~31 minutes) |
| Participants | Sukin (Kambaa VP – AI), Gunasekaran & Ramesh (Acsen) |
| Demo Audience | Acsen IT team + Senior Management (ED, CEO, MD) |
| Demo Duration Target | 15–20 minutes |
| Document Status | Internal working document — do not share externally without approval |

---

## 2. Business Context

Acsen Agriscience has approximately **15 years of historical enterprise data** spanning sales, purchase, inventory, operations and quality functions. This data is distributed across two primary systems:

- **Microsoft Dynamics** — approximately 13 years of historical data
- **SAP** — the last approximately 2 years of data

The long-term goal is a **unified enterprise analytics and AI platform** that surfaces actionable insights from all enterprise data. However, the agreed POC is deliberately scoped narrower — it validates the approach using only the supplied SAP sales extracts for Indian operations.

---

## 3. Problem Statement

> Management needs a faster, easier and more consistent way to understand Indian sales performance from the supplied SAP data, without manually navigating large Excel extracts. The POC must show that users can view meaningful dashboards, ask business questions in natural language and validate answers against supporting transactions.

---

## 4. POC Objective

Demonstrate **technical capability, usability and business relevance** to the Acsen IT team and senior management through a stable sales-analytics experience that uses actual supplied POC data.

---

## 5. POC Scope

| Area | Approved POC Scope |
|---|---|
| **Data source** | Flat Excel extracts from SAP already supplied by the client; no live SAP API or direct database integration |
| **Business function** | Sales analytics only |
| **Geography** | Indian operations represented in the supplied dataset |
| **Time coverage** | SAP sales data from September 2024 onward, limited to the actual files received |
| **Dashboard** | Executive summary, sales performance, geography/region, crop/variety/product performance, returns and transaction drill-down |
| **Ask AI** | Natural-language questions over the supplied POC data, with concise answers and charts/supporting data where feasible |
| **Access** | Open demonstration access; detailed role-based access is not part of the POC |
| **Primary purpose** | Demonstrate capability, usefulness and business relevance — not reproduce the full future enterprise platform |

---

## 6. Out of Scope

The following are **explicitly excluded** from this POC. If any demo feature depends on these, the system must show a clear *"not available in the current POC"* message rather than fabricating data or silently expanding scope.

- Live integration with SAP, Microsoft Dynamics, PMS, HR or any other enterprise system
- Microsoft Dynamics historical data and non-SAP datasets
- Purchase, inventory, operations, quality, HR or any other business function
- Budget-versus-actual, planned-versus-actual COGM and forecast comparisons (datasets not supplied)
- External climate, weather, market or agricultural data integration
- Forecasting, prediction or correlation analysis
- Detailed role-, hierarchy-, function- or territory-based permissions
- Voice interaction, user-specific memory or conversation continuity
- Tanzania or other international operations
- Production-grade enterprise integration, security architecture or six-month rollout implementation

---

## 7. Source Data

### 7.1 Input Files

| File | Rows | Invoice Date Coverage | Note |
|---|---|---|---|
| `ACSEN-SalesData-FY2425.xlsx` | 30,996 data rows | 02 Sep 2024 – 31 Mar 2025 | Partial FY2024-25 extract |
| `ACSEN-SalesData-FY2627.xlsx` | 8,891 data rows | 01 Apr 2026 – 30 May 2026 | Partial FY2026-27 extract |
| FY2025-26 extract | ⚠️ **Not received** | Not available | Year-on-year questions spanning this period must be disabled or answered with a stated limitation until the file is received |

### 7.2 Important Source Fields

Each file contains invoice-line information across approximately **48 columns**. The POC should prioritise the following business fields:

**Transaction fields**
- Billing Type, Billing Type Description
- Invoice ID, Invoice Date
- Customer, Sales Order and supporting references

**Organisation fields**
- Division, Distribution Channel
- State, Territory, Territory In-charge
- AM (Area Manager), RBM (Regional Business Manager), DBM (District Business Manager)

**Product fields**
- Crop, Variety
- Own/Trade flag
- Material Code, Material Description
- Season Code

**Measure fields**
- Quantity, Sales Unit
- Sales Price
- Sales Amount, Sales Amount INR
- COGM (Cost of Goods Manufactured)

---

## 8. Data Preparation Requirements

| ID | Requirement | Definition of Done |
|---|---|---|
| DR-01 | Load every supplied row and retain all original source fields | Loaded row count equals the source workbook row count after excluding headers |
| DR-02 | Create a repeatable import process for multiple financial-year files with the same schema | A new file can be loaded without changing application code, unless the schema changes |
| DR-03 | Standardise dates, numeric fields, blank values and IDs | Filters and aggregations behave consistently across all files |
| DR-04 | Preserve transaction lineage | Every aggregated result can drill down to the original invoice-line records |
| DR-05 | Identify and report duplicates, missing keys and invalid values | A data-quality summary is available to the team before demo sign-off |
| DR-06 | Treat employee, customer, product and territory IDs as keys; use names as labels | Name truncation or spelling variation does not create false duplicate entities |
| DR-07 | Keep quantities separated by Sales Unit | KG, packets, pieces, litres and other units are never added into one misleading quantity total |
| DR-08 | Use Sales Amount INR for all revenue views | All displayed revenue uses one consistent currency field (unless the product owner approves another rule) |

---

## 9. Data Rules and Limitations

- **Vegetable Division (VG)** and **Field Crops Division (FC)** must have separate analysis views; a direct VG-versus-FC comparison is not required.
- **Season Code** is relevant primarily to Field Crops and should not be forced onto Vegetable Division analysis.
- **Stock-transfer and internal-transfer transactions** must be identifiable separately from external sales.
- **Year-on-year comparisons** must use matching periods and must not skip the missing FY2025-26 file.
- **COGM** may be displayed where available. **Gross margin** should be shown only after its treatment across invoices, returns and cancellations has been validated for the POC.

---

## 10. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT BROWSER                           │
│           Desktop-first React web application                   │
│   ┌─────────────────────────┐   ┌─────────────────────────┐    │
│   │    Dashboard Modules    │   │       Ask AI Panel       │    │
│   │  Executive / Sales /    │   │  Natural-language input  │    │
│   │  Geography / Product /  │   │  → Answer + Chart +      │    │
│   │  Returns / Transactions │   │    Supporting records    │    │
│   └────────────┬────────────┘   └────────────┬────────────┘    │
└────────────────┼────────────────────────────┼─────────────────-┘
                 │                            │
┌────────────────▼────────────────────────────▼──────────────────┐
│                        API / BACKEND                            │
│    Filter context management | Query execution | AI orchestration│
└────────────────────────────┬───────────────────────────────────┘
                             │
┌────────────────────────────▼───────────────────────────────────┐
│                      DATA LAYER                                 │
│   Curated dataset (cleaned, standardised, classified)           │
│   ┌─────────────────────────────────────────────────────┐      │
│   │  ACSEN-SalesData-FY2425.xlsx                        │      │
│   │  ACSEN-SalesData-FY2627.xlsx                        │      │
│   │  [FY2025-26 — PENDING RECEIPT]                      │      │
│   └─────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────┘
```

- **No live SAP or ERP integration** — all data comes from supplied flat files.
- **Read-only** — no POC action modifies source files or any client system.
- **Filter context** is preserved when navigating between dashboard views and Ask AI.

---

## 11. User Journey and Flow

The complete user flow is documented in `Acsen_user_flow.png`. The primary journey is:

```
User opens POC
       │
       ▼
Login / User Authentication
       │
       ▼
System identifies user role and data access
       │
       ▼
Executive Dashboard (default landing page)
       │
       ├── Apply Filters ──────────────────────────────────────────┐
       │   ├── Select Financial Year                               │
       │   ├── Select Date Range                                   │
       │   ├── Select Division / Channel                           │
       │   ├── Select State / Crop / Variety                       │
       │   └── Select Sales Hierarchy                              │
       │                                                           │
       ├── Explore Dashboard KPIs and Charts ◄─────────────────────┘
       │   ├── Net External Sales
       │   ├── Gross Invoice Sales
       │   ├── Sales Returns
       │   ├── Top Geography
       │   └── Top Crop and Variety
       │
       └── Ask AI ─────────────────────────────────────────────────┐
               │                                                   │
               ▼                                                   │
       Enter Business Question                                     │
               │                                                   │
               ▼                                                   │
       AI Understands User Intent                                  │
       Identify Metric, Dimension, Filters and Time Period         │
               │                                                   │
               ▼                                                   │
       Is the question clear and complete?                         │
       ├── NO → Ask Clarifying Question ──────────────────────────►│
       │        ├── Choose Performance Metric (Sales/Margin/Qty)   │
       │        └── Choose Region/Meaning (Scale/Territory/RBM)    │
       │                                                           │
       └── YES ──────────────────────────────────────────────────► │
               │                                                   │
               ▼                                                   │
       Is the required data available?                             │
       ├── NO ────────────────────────────────────────────────────►│
       │   ├── Show What is Missing                                │
       │   ├── Explain Why the Question Cannot be Answered         │
       │   ├── Suggest Available Alternative Analysis              │
       │   └── Add Item to POC Requirements backlog                │
       │                                                           │
       └── YES                                                     │
               │                                                   │
               ▼                                                   │
       Choose Comparison Period                                    │
       Map Question to Approved KPI Definition                     │
       Generate Read-Only Data Query                               │
       Apply User Access Rules                                     │
       Execute Query on Curated Sales Data                         │
               │                                                   │
               ▼                                                   │
       Did the query yield valid/usable results?                   │
       ├── NO → Correct Query or Request Clarification ───────────►│
       │                                                           │
       └── YES                                                     │
               │                                                   │
               ▼                                                   │
       Generate Business Answer                                    │
               │                                                   │
               ▼                                                   │
       Display AI Insight                                          │
       ├── Plain Language Answer                                   │
       ├── Supporting KPI value and unit                           │
       ├── Metric Definition                                       │
       ├── Chart or Table                                          │
       ├── Applied Filters summary                                 │
       └── Confidence and Data Scope note                          │
               │                                                   │
               ▼                                                   │
       What does the user want next?                              ◄┘
       ├── Ask Follow-up Question ──────────────────────────────► loop
       ├── Drill Down
       │   ├── View Supporting Metrics
       │   ├── View Trend
       │   ├── Open Detailed Breakdown
       │   ├── View Geography / Product Breakdown
       │   └── View Source Transactions
       ├── Export
       │   ├── Export as PDF
       │   ├── Export as Excel
       │   └── Export as CSV
       └── Return to Dashboard
```

---

## 12. Dashboard Modules

### 12.1 Executive Summary

**Purpose:** High-level overview for senior management on landing.

Minimum content:
- Headline sales measures (Gross Invoice Sales, Net External Sales, Returns)
- Sales contribution percentages
- Top geography
- Top crop and variety
- Trend view for the selected period

### 12.2 Sales Performance

**Purpose:** Deeper analysis of sales trends by division and channel.

Minimum content:
- Monthly/quarterly sales trend
- Division-specific performance (VG and FC separately)
- Distribution-channel analysis
- Contribution percentages by segment

### 12.3 Geography / Region

**Purpose:** Spatial performance breakdown.

Minimum content:
- State and region performance
- Territory performance
- Drill-down from state → territory → products → transactions
- Hierarchy available in the source data: State → Territory → Territory In-charge → AM → RBM → DBM

### 12.4 Crop / Variety / Product

**Purpose:** Product performance across dimensions.

Minimum content:
- Top revenue-generating crops and varieties
- Top material codes
- Geographic contribution of a selected crop/variety
- Own vs Trade split where useful
- **Vegetable Division (VG) and Field Crops Division (FC) analysed independently**

### 12.5 Returns

**Purpose:** Visibility of sales returns and return patterns.

Minimum content:
- Return value totals for the selected period
- Return patterns by date, state, crop, variety and channel
- Comparison of returns as a percentage of gross sales

### 12.6 Transaction Drill-Down

**Purpose:** Invoice-line level validation for any dashboard figure or AI answer.

Minimum content:
- Searchable and filterable invoice-line table
- All source fields visible (Invoice ID, Date, Customer, Crop, Variety, Qty, Unit, Sales Amount INR, COGM, Billing Type, etc.)
- Accessible from any dashboard chart and from Ask AI answers

---

## 13. Filters and Analysis Dimensions

| Category | Dimensions |
|---|---|
| **Time** | Financial year / date range / month |
| **Business** | Division, distribution channel, billing type |
| **Geography** | State, territory, sales hierarchy |
| **Product** | Crop, variety, material code, Own/Trade, Season Code (FC only) |
| **Sales organisation** | Territory In-charge, AM, RBM, DBM |
| **Transaction** | Invoice ID, customer, related reference fields |

**Filter behaviour rules:**
- Global filters persist when navigating between dashboard views and Ask AI (FR-04)
- A visible **Reset / Clear Filters** action must be available for stable demo resets (FR-05)
- The active data period and a **POC/demo-data notice** must always be visible (FR-02)

---

## 14. POC Measures and KPI Definitions

| Measure | POC Treatment | Status |
|---|---|---|
| **Gross Invoice Sales** | Sum of `Sales Amount INR` for normal invoice transactions within selected filters | Build |
| **Sales Returns** | Return value shown separately using return transaction types and signed source amounts; display absolute value for readability | Build |
| **Cancelled Invoice Value** | Shown separately or included only under a clearly labelled provisional net-sales rule | Build |
| **Stock Transfer / IPT Value** | Shown separately; must not be silently presented as external revenue | Build |
| **Net External Sales** | Transparent provisional rule for the POC; display included/excluded transaction types | Build with label |
| **Sales Contribution %** | Selected segment sales ÷ relevant total sales within the active filter context | Build |
| **COGM** | Aggregate source COGM where data is available | Build |
| **Gross Margin / Margin %** | Do not present as a confirmed KPI until transaction-sign treatment is validated | Conditional |
| **Budget / Forecast Variance** | Not available — required source data is outside the POC scope | Do not build |

> **Important:** The management demo must clearly distinguish a value calculated from supplied data from a client-approved enterprise KPI. Where a rule is provisional, the UI or answer must say so.

---

## 15. Ask AI — Requirements and Behaviour

Ask AI is a **grounded analytics interface** over the prepared POC dataset. It is **not a general-purpose chatbot**. Every numeric answer must be traceable to the loaded data and current filter context.

| ID | Behaviour |
|---|---|
| AI-01 | Accept natural-language questions about the sales data in scope |
| AI-02 | Identify the metric, dimension, time period and filters required by the question |
| AI-03 | Ask a clarification when a phrase such as "best performing" can mean more than one metric |
| AI-04 | Return a concise business answer with value, period and context |
| AI-05 | Add a chart or table where it improves understanding |
| AI-06 | Show supporting records or provide a "view transactions" action where feasible |
| AI-07 | Expose the calculation basis and applied filters in a simple expandable explanation |
| AI-08 | Refuse unsupported or unavailable analysis and state exactly which data is missing |
| AI-09 | Support follow-up questions that retain the previous context where feasible |
| AI-10 | Use read-only data access and never alter source data |

### Answer Format

Each answer must contain, where applicable:

1. **Direct answer** in one or two sentences
2. **Metric value and unit** (e.g. ₹12.4 Cr, Sales Amount INR)
3. **Selected period and active filters**
4. **Chart or ranked table**
5. **Calculation or transaction-treatment note**
6. **Link / action to supporting transactions**
7. **Clear limitation message** when data is missing

---

## 16. Golden Questions for QA

These questions form the primary test plan for Ask AI. All must return a correct answer, ask for clarification, or state a valid limitation. None may fabricate data.

| # | Question | Expected Behaviour |
|---|---|---|
| 1 | What are total sales and provisional net external sales for the selected period? | Returns gross and net figures with transaction-type breakdown |
| 2 | Which state or territory generated the highest sales for the selected period? | Returns ranked state/territory table with values |
| 3 | Which crops and varieties generated the highest revenue within Vegetable Division? | Returns top crops/varieties for VG only |
| 4 | Which crops and varieties generated the highest revenue within Field Crops Division? | Returns top crops/varieties for FC only |
| 5 | Show the geographic contribution for a selected crop or variety. | Returns geographic breakdown with contribution % |
| 6 | Which products or material codes generated the highest revenue? | Returns ranked product table |
| 7 | What is the sales contribution by distribution channel? | Returns channel-wise breakdown |
| 8 | Show sales returns by state, crop, variety or channel. | Returns return values by selected dimension |
| 9 | Show the monthly sales trend for a selected division, state or variety. | Returns time-series chart |
| 10 | How did a selected RBM, AM or territory perform in the chosen period? | Returns performance for that sales hierarchy member |
| 11 | Show the invoice-level records supporting this answer. | Drills down to transaction table |
| 12 | Which variety grew the most compared with FY2025-26? | States that the FY2025-26 file is missing; cannot answer |
| 13 | Compare budget with actual sales. | Explains that budget data is outside the POC |

---

## 17. Non-Functional Requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-01 | **Data accuracy** | Dashboard totals and AI answers reconcile to the prepared source dataset |
| NFR-02 | **Grounding** | No numeric claim without a query/result from the POC data |
| NFR-03 | **Response time** | Dashboard interactions feel immediate; common Ask AI questions target < 10 seconds in the demo environment |
| NFR-04 | **Explainability** | Users can see filters, data period and calculation basis at any point |
| NFR-05 | **Reliability** | The complete planned demo path works repeatedly without broken links or dead controls |
| NFR-06 | **Read-only safety** | No POC action changes the Excel files or any client source system |
| NFR-07 | **Confidentiality** | Use the supplied files only in the approved project environment; avoid exposing transaction data outside the team/client demo |
| NFR-08 | **Browser support** | Optimise for the browser and display setup used for the management demo |
| NFR-09 | **Auditability** | Log the question, interpreted filters/query and result for QA (at minimum in the development build) |

---

## 18. Delivery Plan and Phases

| Phase | Key Activities | Exit Criteria |
|---|---|---|
| **0. Scope freeze and setup** | Confirm this PRD, demo date options, repo, environments, roles and issue tracker | Team accepts scope and out-of-scope list |
| **1. Data inventory and profiling** | Inspect all files — row counts, periods, columns, billing types, nulls, duplicates, units and hierarchy values | Profiling report and data issues list completed |
| **2. Data preparation and metric layer** | Build repeatable import, cleaned tables, dimensions, transaction classification and provisional metric rules | Reconciled curated dataset available to UI and AI |
| **3. Dashboard build** | Implement navigation, filters, required dashboard modules, charts and transaction drill-down | All must-have views operate on prepared data |
| **4. Ask AI build** | Implement question interpretation, controlled data queries, answer generation, charts, explanations and limitations | Golden questions return grounded answers |
| **5. Validation and evaluation** | Reconcile totals, test filters, verify golden answers, test unsupported questions and regression-test demo flow | Critical defects closed; evaluation sheet signed internally |
| **6. Demo hardening** | Seed suggested questions, prepare fallback screenshots/data, reset state, rehearse and record known limitations | Demo run completes end-to-end at least three times |
| **7. Client demonstration and feedback** | Present to IT and management; capture KPI, usability and roadmap feedback | POC feedback and next-phase decisions documented |

> Phases 3 and 4 can run in parallel after Phase 2 (data model) is stable.

---

## 19. Validation and Acceptance Criteria

### 19.1 Internal Definition of Done

- [ ] All currently supplied Excel files are loaded through a repeatable process and row counts are reconciled
- [ ] The POC clearly identifies the date coverage and missing FY2025-26 data
- [ ] Executive, sales, geography, product, returns and transaction views are available and populated from prepared data
- [ ] Vegetable and Field Crops are analysed independently as agreed
- [ ] All primary filters work and are reflected consistently across KPIs, charts, tables and AI answers
- [ ] Every summary result can be validated using a supporting table or transaction drill-down
- [ ] All agreed golden questions return the correct answer, ask for clarification, or state a valid limitation — none fabricate data
- [ ] Budget, forecast, external climate data and unsupported functions are not presented as available POC features
- [ ] The POC is open for demonstration and does not require detailed role-based access
- [ ] The planned management demo can be completed without critical defects or manual code/data changes

### 19.2 POC Validation During Client Demonstration

| Validation Area | What the Client Should Be Able to Confirm |
|---|---|
| **Capability** | The platform can turn the supplied sales extract into useful dashboards and natural-language answers |
| **Accuracy** | Representative KPI and question outputs can be traced to supporting data |
| **Usability** | Management can understand and navigate the experience without technical assistance |
| **Business relevance** | The views and questions are meaningful enough to justify broader discovery |
| **Next-phase readiness** | The team can identify the additional data, KPI approvals, access rules and integrations needed for production |

---

## 20. Management Demo Runbook

**Total demonstration target: 15–20 minutes**, leaving time for client discussion.

| Step | Demonstration | Capability Proved |
|---|---|---|
| 1 | Open Executive Summary and explain the data coverage | Actual SAP extract is loaded and POC scope is transparent |
| 2 | Filter by one division and selected period | Consistent filters and division-specific analysis |
| 3 | Open a top crop or variety and show geographic contribution | Product and geography drill-down |
| 4 | Open returns view and inspect a supporting transaction | Traceability to invoice-line data |
| 5 | Ask: *"What is the top state by sales for this period?"* | Natural-language analytics with chart/table |
| 6 | Ask: *"Which is the best performing variety?"* | AI asks for the metric rather than guessing |
| 7 | Ask: *"How did varieties grow compared to FY2025-26?"* | AI handles missing data honestly |
| 8 | Ask: *"Compare budget with actual sales"* | AI handles out-of-scope questions honestly |
| 9 | Close with future roadmap areas captured from the MOM | Clear separation between POC validation and later enterprise implementation |

**Demo preparation checklist:**
- [ ] Seed at least 5 suggested/example questions in the Ask AI interface
- [ ] Prepare fallback screenshots for any question with higher response-time risk
- [ ] Confirm reset-filters button returns to a clean state
- [ ] Test demo on the exact browser and display to be used
- [ ] Complete at least 3 end-to-end rehearsals before the client session

---

## 21. Risks, Constraints and Mitigations

| Risk / Constraint | Impact | Mitigation |
|---|---|---|
| FY2025-26 file not in current input set | No valid adjacent-year growth comparison for FY2026-27 | Disable those calculations and show a transparent missing-data message |
| Final KPI definitions deferred until/post POC | A provisional result may differ from the final enterprise definition | Label provisional metrics and show included/excluded transaction types |
| Mixed transaction types in source data | Stock transfer or internal movement may be mistaken for external revenue | Classify billing types and expose separate values |
| Mixed quantity units | A combined quantity figure would be misleading | Aggregate quantity only within the same unit |
| Incomplete master data or inconsistent names | Fragmented product/employee/geography groupings | Use stable IDs where present; record unmapped values |
| Ask AI generates an incorrect query | Wrong or untrustworthy answer during demo | Use controlled schema, read-only queries, golden-question tests and result sanity checks |
| Demo connectivity or model latency | Poor management experience | Use a tested environment, cached/suggested questions where appropriate and a backup local/fallback presentation |
| Scope expansion toward future platform | POC delay and diluted success criteria | Use the out-of-scope list and capture requests in a future-phase backlog |

---

## 22. Future Phase Backlog

These capabilities were discussed in the MOM but are **explicitly not to be built in this POC**. They should be captured in a post-POC discovery and roadmap exercise.

| Capability | Future Discovery Requirement |
|---|---|
| **Live enterprise integration** | SAP, Microsoft Dynamics, PMS, HR and other approved sources |
| **External data** | Approved climate, market and agricultural datasets with ownership and quality checks |
| **Forecasting** | Historical data, internal budgets/forecasts and approved external variables |
| **Role-based access** | Function, region, territory, hierarchy and confidential-metric role matrix |
| **Expanded functions** | Purchase, inventory, operations, quality, HR and related business definitions |
| **Conversational enhancements** | Voice, user preferences, memory/continuity and governance |
| **Geographic expansion** | Tanzania and other operations after data supply and validation |
| **Enterprise roadmap** | Formal discovery and phased implementation plan, tentatively ~6 months, subject to scoping and approval |

---

## 23. Key Decisions and Agreements

Agreed during the POC discussion on 23 June 2026:

1. The initial POC approach and functional flow presented by Kambaa were **accepted as suitable** for demonstrating the platform capabilities.
2. The POC will remain focused on the currently supplied SAP sales data and will **not attempt to replicate** the full future production architecture.
3. Detailed role-based access design will be taken up **after POC validation**, as it requires inputs from multiple stakeholders.
4. Senior management, including the **Executive Director, CEO and MD**, is expected to participate in the POC demonstration, subject to availability.
5. Kambaa will provide **two alternative dates** for the demonstration so the client can coordinate the required stakeholders.
6. Following a successful POC review, both teams will define a broader roadmap for enterprise analytics and AI implementation, **tentatively spanning approximately six months**, subject to formal scoping and approval.

---

## 24. Action Items

| # | Action Item | Owner | Target |
|---|---|---|---|
| 1 | Share two alternate dates for the POC demonstration | Kambaa — Sukin / Project Team | By end of day (23 Jun 2026) |
| 2 | Build the POC using the supplied SAP Excel data and agreed sales scope | Kambaa Project Team | Before the confirmed demo |
| 3 | Include representative dashboards and Ask AI answers with charts/supporting data where feasible | Kambaa Project Team | Before the confirmed demo |
| 4 | Confirm availability of the IT team and senior management for one proposed date | Acsen Team | After receiving date options |
| 5 | Validate POC outputs, KPI logic and usability during the demonstration | Acsen Team | During the POC demo |
| 6 | Provide approved KPI definitions and additional data required for the next phase | Acsen Team | Post-POC scoping |
| 7 | Conduct discovery for integrations, security, access control, external data and expanded functions | Kambaa and Acsen Teams | Post-POC approval |
| 8 | Prepare the phased implementation roadmap, scope and timelines | Kambaa, with Acsen inputs | After discovery |

---

## 25. Team Usage Guide

This section defines how each team member should use this document.

| Role | How to Use This Document |
|---|---|
| **Product / AI Lead** | Use to prevent scope drift and approve product behaviour. All scope additions require product-owner approval. |
| **Data Team** | Use sections 7, 8 and 9 to prepare source files, metric rules and validation checks. Reconcile row counts against DR-01 before declaring data ready. |
| **Frontend / Full-Stack Team** | Use sections 11, 12, 13 and 14 to build required dashboard views, filters and drill-downs. Refer to section 20 for the demo path to ensure it works end-to-end. |
| **AI Team** | Use sections 15 and 16 to implement grounded natural-language questions, safe limitations and the answer format. All golden questions must pass before demo sign-off. |
| **QA / Business Analyst** | Use sections 16, 19 and 20 as the test plan. The golden questions and demo runbook are the acceptance baseline. |

### Decision Hierarchy

When there is ambiguity about what to build, apply decisions in this priority order:

| Priority | Decision Source | How to Apply |
|---|---|---|
| 1 | Signed-off client requirement / MOM | Mandatory. Do not alter without product-owner approval. |
| 2 | Validated source-data behaviour | Use when it does not conflict with the client-agreed scope. |
| 3 | This internal PRD | Default delivery direction for the POC. |
| 4 | Team implementation preference | Allowed only when user experience and acceptance criteria remain unchanged. |

### Scope-Control Rule

> If a requested demo feature depends on missing data, a future system or a capability listed in section 6 (Out of Scope), show a clear **"not available in the current POC"** message rather than fabricating data or silently expanding scope.

---

*Prepared by Kambaa. Internal working document — Confidential. Do not distribute externally without approval.*
*Source documents: MOM dated 23 June 2026 | PRD for POC Build | Acsen User Flow diagram*
