import OpenAI from 'openai';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '..', 'ai', '.env') });

const apiKey = process.env.OPENAI_API_KEY;
let openaiClient = null;

if (apiKey) {
  openaiClient = new OpenAI({ apiKey });
}

export async function synthesizeAnswer(question, queryPlan, resultRows, activeFilters = {}, responseContext = {}) {
  const isMultiQuery = resultRows?.isMultiQuery === true;
  const flatRows = isMultiQuery
    ? resultRows.results.flatMap(r => r.rows)
    : (resultRows || []);

  if (!openaiClient) {
    return {
      answer: `The query executed successfully and returned ${flatRows.length} records. (AI Synthesis warning: OPENAI_API_KEY is not configured)`,
      insights: ""
    };
  }

  // Derive business context from query plan, questions, active filters, and result rows
  const financialYears = [];
  if (activeFilters?.financialYear) {
    financialYears.push(activeFilters.financialYear);
  } else if (activeFilters?.datasetId && activeFilters.datasetId !== 'all') {
    financialYears.push(activeFilters.datasetId);
  }
  flatRows.forEach(r => {
    if (r.fy_code && !financialYears.includes(r.fy_code)) {
      financialYears.push(r.fy_code);
    }
  });
  if (financialYears.length === 0) {
    financialYears.push('FY2425', 'FY2627'); // Default if not found
  }

  // Derive Entity Type & Name
  let entityType = "General";
  let entityName = "All Segments";
  
  const matInRow = flatRows.find(r => r.material_name || r.product || r.material_desc);
  const cropInRow = flatRows.find(r => r.crop || r.crop_name);
  const stateInRow = flatRows.find(r => r.state || r.territory_name);
  const divInRow = flatRows.find(r => r.division);

  if (matInRow) {
    entityType = "Product";
    entityName = matInRow.material_name || matInRow.product || matInRow.material_desc;
  } else if (cropInRow) {
    entityType = "Crop";
    entityName = cropInRow.crop || cropInRow.crop_name;
  } else if (stateInRow) {
    entityType = "State";
    entityName = stateInRow.state || stateInRow.territory_name;
  } else if (divInRow) {
    entityType = "Division";
    entityName = divInRow.division;
  } else {
    const materialMatch = question.match(/(?:batches of|for)\s+([A-Za-z0-9\s\-]+(?:\d+\s*(?:GM|KG|ML|L))?\s*(?:PACKET|PACK|BAG|BOTTLE)?)/i);
    if (materialMatch && materialMatch[1]) {
      entityType = "Product";
      entityName = materialMatch[1].trim().toUpperCase();
    } else {
      const cropMatch = question.match(/(?:crop|crops)\s+([A-Za-z0-9]+)/i);
      if (cropMatch && cropMatch[1]) {
        entityType = "Crop";
        entityName = cropMatch[1].trim();
      }
    }
  }

  // Aggregate numeric metrics from flatRows
  let totalQuantity = null;
  let number_of_batches = null;
  let grossSales = 0;
  let returnsValue = 0;
  let cancelledValue = 0;

  flatRows.forEach(r => {
    if (r.total_quantity !== undefined) totalQuantity = (totalQuantity || 0) + Number(r.total_quantity);
    else if (r.total_kg !== undefined) totalQuantity = (totalQuantity || 0) + Number(r.total_kg);
    else if (r.qty !== undefined) totalQuantity = (totalQuantity || 0) + Number(r.qty);

    if (r.number_of_batches !== undefined) number_of_batches = (number_of_batches || 0) + Number(r.number_of_batches);
    else if (r.batch_count !== undefined) number_of_batches = (number_of_batches || 0) + Number(r.batch_count);

    if (r.gross_sales !== undefined) grossSales += Number(r.gross_sales);
    else if (r.sales_amount_inr !== undefined) grossSales += Number(r.sales_amount_inr);

    if (r.returns_value !== undefined) returnsValue += Number(r.returns_value);
    if (r.cancelled_value !== undefined) cancelledValue += Number(r.cancelled_value);
  });

  const rawUnit = flatRows[0]?.sales_unit || flatRows.find(x => x.sales_unit)?.sales_unit || 'KG';
  const displayUnit = String(rawUnit).trim().toUpperCase();

  const businessContext = {
    question,
    financialYears,
    entityType,
    entityName,
    metrics: {
      quantity: totalQuantity !== null ? `${totalQuantity.toLocaleString('en-IN')} ${displayUnit}` : null,
      batches: number_of_batches,
      grossSalesINR: grossSales > 0 ? grossSales : null,
      returnsValueINR: returnsValue > 0 ? returnsValue : null,
      cancelledValueINR: cancelledValue > 0 ? cancelledValue : null,
    }
  };

  // Fix 3 (Best Practice): Short-circuit/bypass for simple batch & quantity questions to prevent LLM hallucinations
  const hasQty = !isMultiQuery && flatRows.length === 1 && 
    (flatRows[0].total_kg !== undefined || flatRows[0].total_quantity !== undefined);
  const hasBatchCount = !isMultiQuery && flatRows.length === 1 && 
    (flatRows[0].number_of_batches !== undefined || flatRows[0].batch_count !== undefined);

  if (hasQty && hasBatchCount) {
    const totalQtyVal = flatRows[0].total_quantity !== undefined ? flatRows[0].total_quantity : flatRows[0].total_kg;
    const batchCountVal = flatRows[0].number_of_batches !== undefined ? flatRows[0].number_of_batches : flatRows[0].batch_count;

    const formattedQty    = Number(totalQtyVal).toLocaleString('en-IN');
    const formattedBatches = Number(batchCountVal).toLocaleString('en-IN');
    const fyLabel = financialYears.join(' + ');

    const answer =
`## Executive Summary

**${entityName.toUpperCase()}** recorded **${formattedBatches} batches** with a total quantity of **${formattedQty} ${displayUnit}** across **${fyLabel}**.

## Results

| Metric | Value |
|---|---|
| **Unique Batches** | **${formattedBatches}** |
| **Total Quantity** | **${formattedQty} ${displayUnit}** |

## Analysis

| Analysis | Value |
|---|---|
| **Financial Years** | ${fyLabel} |
| **Metric** | Sales Quantity |

## Key Insights

- **${entityName.toUpperCase()}** had **${formattedBatches} distinct batches**.
- Total quantity reached **${formattedQty} ${displayUnit}** across the analyzed period.

**Scope:** ${fyLabel} · **Sales Quantity** · All Divisions`;

    return {
      answer,
      insights: `${entityName}: ${formattedBatches} batches, ${formattedQty} ${displayUnit} across ${fyLabel}.`
    };
  }

  // Fix 1: Business Formatter - format all keys and values before sending to LLM
  let resultString = '';
  let normalizedRows = [];

  if (resultRows && resultRows.isMultiQuery) {
    const formattedResults = resultRows.results.map(subRes => {
      const formattedSubRows = subRes.rows.map(r => {
        const newRow = {};
        for (const [key, value] of Object.entries(r)) {
          let label = key;
          const keyLower = key.toLowerCase();
          if (keyLower === 'total_sales' || keyLower === 'gross_sales' || keyLower === 'sales_amount_inr' || keyLower === 'revenue') {
            label = 'Total Sales';
          } else if (keyLower === 'returns_value' || keyLower === 'returns_val') {
            label = 'Returns Value';
          } else if (keyLower === 'cancelled_value' || keyLower === 'cancelled_val') {
            label = 'Cancelled Value';
          } else if (keyLower === 'net_external_sales') {
            label = 'Net External Sales';
          } else if (keyLower === 'total_cogm' || keyLower === 'cogm') {
            label = 'Total COGM';
          } else if (keyLower === 'qty' || keyLower === 'total_quantity' || keyLower === 'total_kg') {
            label = 'Total Quantity';
          } else if (keyLower === 'number_of_batches' || keyLower === 'batch_count') {
            label = 'Unique Batches';
          } else if (keyLower === 'division') {
            label = 'Division';
          } else if (keyLower === 'crop' || keyLower === 'crop_name') {
            label = 'Crop';
          } else if (keyLower === 'state') {
            label = 'State';
          } else if (keyLower === 'sales_unit') {
            label = 'Sales Unit';
          } else {
            label = key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          }

          let formattedVal = value;
          if (['Total Sales', 'Returns Value', 'Cancelled Value', 'Net External Sales', 'Total COGM'].includes(label) && typeof value === 'number') {
            const num = Number(value);
            if (num >= 10000000) {
              formattedVal = `₹${(num / 10000000).toFixed(2)} Cr`;
            } else if (num >= 100000) {
              formattedVal = `₹${(num / 100000).toFixed(2)} Lakhs`;
            } else {
              formattedVal = `₹${num.toLocaleString('en-IN')}`;
            }
          } else if (label === 'Total Quantity' && typeof value === 'number') {
            const num = Number(value);
            const rawUnit = r.sales_unit || subRes.rows.find(x => x.sales_unit)?.sales_unit || 'KG';
            formattedVal = `${num.toLocaleString('en-IN')} ${String(rawUnit).trim().toUpperCase()}`;
          } else if (typeof value === 'number' && label !== 'Unique Batches' && label !== 'batch_no' && label !== 'invoice_id') {
            formattedVal = value.toLocaleString('en-IN');
          }

          newRow[label] = formattedVal;
        }
        return newRow;
      });

      return {
        description: subRes.description,
        sql: subRes.sql,
        data: formattedSubRows
      };
    });

    resultString = JSON.stringify(formattedResults, null, 2);
    normalizedRows = formattedResults[0]?.data || [];
  } else {
    // Single query formatting
    normalizedRows = resultRows.map(r => {
      const newRow = {};
      for (const [key, value] of Object.entries(r)) {
        let label = key;
        const keyLower = key.toLowerCase();
        if (keyLower === 'total_sales' || keyLower === 'gross_sales' || keyLower === 'sales_amount_inr' || keyLower === 'revenue') {
          label = 'Total Sales';
        } else if (keyLower === 'returns_value' || keyLower === 'returns_val') {
          label = 'Returns Value';
        } else if (keyLower === 'cancelled_value' || keyLower === 'cancelled_val') {
          label = 'Cancelled Value';
        } else if (keyLower === 'net_external_sales') {
          label = 'Net External Sales';
        } else if (keyLower === 'total_cogm' || keyLower === 'cogm') {
          label = 'Total COGM';
        } else if (keyLower === 'qty' || keyLower === 'total_quantity' || keyLower === 'total_kg') {
          label = 'Total Quantity';
        } else if (keyLower === 'number_of_batches' || keyLower === 'batch_count') {
          label = 'Unique Batches';
        } else if (keyLower === 'division') {
          label = 'Division';
        } else if (keyLower === 'crop' || keyLower === 'crop_name') {
          label = 'Crop';
        } else if (keyLower === 'state') {
          label = 'State';
        } else if (keyLower === 'sales_unit') {
          label = 'Sales Unit';
        } else {
          label = key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }

        let formattedVal = value;
        if (['Total Sales', 'Returns Value', 'Cancelled Value', 'Net External Sales', 'Total COGM'].includes(label) && typeof value === 'number') {
          const num = Number(value);
          if (num >= 10000000) {
            formattedVal = `₹${(num / 10000000).toFixed(2)} Cr`;
          } else if (num >= 100000) {
            formattedVal = `₹${(num / 100000).toFixed(2)} Lakhs`;
          } else {
            formattedVal = `₹${num.toLocaleString('en-IN')}`;
          }
        } else if (label === 'Total Quantity' && typeof value === 'number') {
          const num = Number(value);
          const rawUnit = r.sales_unit || resultRows.find(x => x.sales_unit)?.sales_unit || 'KG';
          formattedVal = `${num.toLocaleString('en-IN')} ${String(rawUnit).trim().toUpperCase()}`;
        } else if (typeof value === 'number' && label !== 'Unique Batches' && label !== 'batch_no' && label !== 'invoice_id') {
          formattedVal = value.toLocaleString('en-IN');
        }

        newRow[label] = formattedVal;
      }
      return newRow;
    });

    resultString = JSON.stringify(normalizedRows.slice(0, 15));
  }

  // ── Assemble Analysis context for the prompt ─────────────────────────────
  // Build a compact, relevant Analysis block: only include rows that make sense
  // for this specific question. Financial Years always included; other rows only
  // when their metric is relevant.
  const fyLabel = responseContext.scope?.financialYears?.length
    ? responseContext.scope.financialYears.join(queryPlan?.comparisonContext?.compareMode ? ' vs ' : ' + ')
    : 'N/A';

  const activeFilterEntries = responseContext.filters
    ? Object.entries(responseContext.filters).filter(([, v]) => v && v !== 'All' && v !== 'Full FY' && v !== 'Combined')
    : [];
  const activeFilterLine = activeFilterEntries.length
    ? activeFilterEntries.map(([k, v]) => `${k}: ${v}`).join(', ')
    : null;

  // Choose which Analysis rows to emit based on metricType
  const analysisRows = [];
  analysisRows.push(`| Financial Years | ${fyLabel} |`);
  if (['net_sales', 'gross_sales'].includes(responseContext.metricType)) {
    analysisRows.push(`| Revenue Basis | ${responseContext.calculationBasis || 'Net Revenue'} |`);
  }
  if (responseContext.metricType === 'returns') {
    analysisRows.push(`| Returns Basis | ZRE + ZIRE |`);
  }
  if (responseContext.metricType === 'cancelled') {
    analysisRows.push(`| Cancellation Basis | ZS1 |`);
  }
  if (responseContext.metricType === 'cogm') {
    analysisRows.push(`| Metric | Cost of Goods Manufactured (COGM) |`);
  }
  if (responseContext.metricType === 'quantity') {
    analysisRows.push(`| Metric | Sales Quantity |`);
  }
  if (activeFilterLine) {
    analysisRows.push(`| Active Filters | ${activeFilterLine} |`);
  }
  const analysisBlock = `| Analysis | Value |\n| --- | --- |\n${analysisRows.slice(0, 3).join('\n')}`;

  // Scope badge line (single compact line shown after Key Insights)
  const scopeDivision = responseContext.filters?.division && responseContext.filters.division !== 'All'
    ? `${responseContext.filters.division} Division`
    : 'All Divisions';
  const scopeBasisShort = responseContext.calculationBasis
    ? responseContext.calculationBasis.split('=')[0].trim()
    : 'Net Revenue';
  const scopeLine = `*Scope: ${fyLabel} · ${scopeBasisShort} · ${scopeDivision}*`;

  const systemPrompt = `You are Acsen Executive BI Copilot. Your audience is senior business leaders (CEO, Sales Director, Business Head).

====================================
RESPONSE STRUCTURE — exactly 4 sections
====================================
Return ONLY these 4 sections in this exact order. No other sections. No preamble.

## Executive Summary
One sentence, maximum 35 words. Directly answer the question. Include the winning entity name and the key figure.
✓ Good: **HYBRID HOTPEPPER** generated ₹114.66 Cr net revenue across FY2425+FY2627, the highest among all crops.
✗ Bad: "Based on the data provided, it can be observed that HYBRID HOTPEPPER..."

## Results
ONE table only. Choose the table structure that matches the question type:
- Ranking question  → | Rank | Entity | Revenue |
- Comparison question → | Metric | ${responseContext.scope?.financialYears?.[0] || 'Period 1'} | ${responseContext.scope?.financialYears?.[1] || 'Period 2'} |
- Trend question → | Month | Revenue |
- Distribution/Channel → | Segment | Revenue | Share % |
- Transaction/Invoice → | Invoice ID | Customer | Date | Amount |
- Single aggregate → | Metric | Value |
Bold entity names (crop, state, division names) and all data values inside table cells. Format currency as ₹X.XX Cr (>=1Cr) or ₹X.XX Lakhs (>=1L). Never show raw integers for money.

## Analysis
${analysisBlock}
(This table is pre-filled. Do not add extra rows. Do not replace it. Copy it verbatim into your answer.)

## Key Insights
Exactly 2 bullet points. Each must be under 20 words. Factual — computed from the data, not generic.
For comparisons: note leader change, growth gap, or period difference.
✓ Good: "Revenue leadership shifted from **HYBRID MUSTARD** (FY2425) to **HYBRID HOTPEPPER** (FY2627)."
✗ Bad: "Revenue shows an upward trend indicating positive business performance."

${scopeLine}

====================================
STRICT RULES
====================================
- NEVER add Recommendations unless the user explicitly asked for recommendations or suggestions.
- NEVER add "Data Used", "Scope of Analysis", "Query Metadata", "Billing Types", "Applied Filters" sections.
- NEVER use filler phrases: "Based on the analysis...", "It can be observed...", "The data indicates...", "Here is...", "The analysis shows..."
- NEVER use emojis.
- Bold ALL data values (numbers, currency amounts, FY labels, KG quantities, entity names). Never bold table headers.
- The entire response must be compact — suitable for a chat sidebar panel.
- The scope line must appear verbatim after Key Insights, formatted as: **Scope:** FY · Basis · Division

Return a raw JSON object only — no markdown code block wrapping:
{"answer": "full 4-section markdown answer", "insights": "one-line plain-text summary for logging"}
`;

  try {
    let completion;
    const userMsg = `Original User Question: "${question}"
Active Dashboard Filters: ${JSON.stringify(activeFilters)}
Business Context Metrics: ${JSON.stringify(businessContext)}
Resulting Data Rows:
${resultString}

Please synthesize the final answer:`;

    try {
      completion = await openaiClient.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg }
        ],
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.3
      });
    } catch (apiErr) {
      if (apiErr.status === 429 || String(apiErr.message).includes('limit') || String(apiErr.message).includes('Limit')) {
        console.warn('[AnswerSynthesizer] OpenAI 429 rate limit hit for gpt-4o-mini. Retrying with gpt-4o...');
        completion = await openaiClient.chat.completions.create({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg }
          ],
          model: 'gpt-4o',
          response_format: { type: 'json_object' },
          temperature: 0.2
        });
      } else {
        throw apiErr;
      }
    }

    const rawContent = completion.choices[0].message.content.trim();
    try {
      return JSON.parse(rawContent);
    } catch (e) {
      console.warn("Failed to parse synthesized answer as JSON, falling back to text:", rawContent);
      return {
        answer: rawContent,
        insights: ""
      };
    }
  } catch (error) {
    console.error('Answer synthesis failed:', error);
    return {
      answer: `The query executed successfully and returned ${resultRows.length} records. (AI Synthesis error: ${error.message})`,
      insights: ""
    };
  }
}
