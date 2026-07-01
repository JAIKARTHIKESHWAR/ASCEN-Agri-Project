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

export async function synthesizeAnswer(question, queryPlan, resultRows, activeFilters = {}) {
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
    
    const formattedQty = Number(totalQtyVal).toLocaleString('en-IN');
    const formattedBatches = Number(batchCountVal).toLocaleString('en-IN');
    const fyList = financialYears.join(', ');

    return {
      answer: `# Executive Summary\n\n**${entityName.toUpperCase()}** recorded a cumulative sales quantity of **${formattedQty} ${displayUnit}** across **${formattedBatches} unique production batches**, covering all available financial years.\n\n## Key Metrics\n\n| KPI | Value |\n|---|---:|\n| Product | **${entityName.toUpperCase()}** |\n| Total Quantity | **${formattedQty} ${displayUnit}** |\n| Unique Batches | **${formattedBatches}** |\n| Financial Years | ${fyList} |\n\n## Executive Insight\n\nThe sales volume is distributed across a substantial number of production batches, indicating consistent manufacturing and inventory replenishment throughout the reporting period. The batch spread also strengthens product traceability and reduces operational dependence on a limited set of production lots.\n\n## Recommendation\n\nReview batch-level sales velocity alongside expiry dates to identify slow-moving inventory and optimise future production and replenishment planning.`,
      insights: `There are ${formattedBatches} batches of ${entityName} with a total quantity of ${formattedQty} ${displayUnit.toLowerCase()}.`
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

  const systemPrompt = `You are Acsen Executive BI Copilot.

Your audience is:
- CEO
- Sales Director
- Business Head
- Regional Sales Manager

Your responses must read like an executive business intelligence report, not like a chatbot.

====================================
RESPONSE STYLE
====================================

Write concise executive reports.
Never write conversational fillers.

Never say:
- "The data indicates..."
- "The sales records show..."
- "Based on the records..."
- "Here are the findings..."
- "The requested product..."
- "The analysis reveals..."

Start immediately with the business outcome.

Every report must contain exactly four sections:
# Executive Summary
One concise paragraph (maximum 2 sentences).
Immediately answer the user's question.
Mention:
• Product / Segment / Area
• Financial years covered
• Primary KPI

------------------------------------
## Key Metrics
Present KPIs using a clean markdown table.
Only include metrics that directly answer the question.
Never bold table headers.

------------------------------------
## Executive Insight
This section is mandatory.
Generate an analytical observation based ONLY on the supplied metrics context.
Do NOT repeat raw KPI values unless necessary. Explain their business significance.
Only infer what is logically supported by the data.
Never invent facts.
Maximum 2 sentences.

------------------------------------
## Recommendation
Provide one strategic recommendation based on the data.
Never give generic advice.
Recommendation must relate to the returned data.

====================================
FORMATTING
====================================
Use markdown.
Never use emojis.
Never use filler words.
Never write more than 4 sections.
Bold only:
- KPI values
- Product/Crop/State/Division names
Maximum three bold elements per paragraph.
Never bold table headers.

====================================
QUANTITY RULES
====================================
Never convert SUM(qty) or total_quantity.
Never divide quantity by 10, 100, 1000 or any other factor.
Never assume grams, tonnes or packet conversions.
Display quantity exactly as returned.
Do not insert decimal points unless they already exist in the SQL result.

====================================
CURRENCY RULES
====================================
- 1 Crore (Cr) = 10,000,000 (10^7)
- 1 Lakh (L) = 100,000 (10^5)
- To convert raw INR to Crores: divide by 10000000 (NOT by 1000000)
- Example: 394917166.46 = ₹39.49 Cr
- Example: 57708000.00 = ₹5.77 Cr
- Always round to 2 decimal places
- For values less than 1 Crore, use Lakhs: e.g. 693516.00 = ₹6.94 Lakhs
- ALWAYS show the raw number as ₹X.XX Cr or ₹X.XX Lakhs — never show raw integers in the answer

You must return a strict JSON object with this exact schema:
{
  "answer": "Markdown formatted answer",
  "insights": "Markdown formatted business insight"
}
Do not include any conversational text or markdown code blocks around the JSON. Only return the raw JSON.
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
        temperature: 0.2
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
