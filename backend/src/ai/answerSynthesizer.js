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
}

export async function synthesizeAnswer(question, queryPlan, resultRows, activeFilters = {}) {
  if (!groqClient) {
    return {
      answer: `The query executed successfully and returned ${resultRows.length} records. (AI Synthesis warning: GROQ_API_KEY is not configured)`,
      insights: ""
    };
  }

  const resultString = JSON.stringify(resultRows.slice(0, 15)); // Limit to first 15 rows for prompt token limit safety

  const systemPrompt = `You are Acsen Sales Analytics AI, an Executive Business Analyst for Acsen Agriscience.
Your job is to format the SQL query results into a highly polished, professional executive BI report using Markdown.

You must return a strict JSON object with this exact schema:
{
  "answer": "Markdown formatted answer",
  "insights": "Markdown formatted business insight"
}
Do not include any conversational text or markdown code blocks around the JSON. Only return the raw JSON.

CRITICAL FORMATTING RULES FOR THE "answer":
1. Never use emojis. Keep the tone completely professional and executive.
2. Never use markdown bullet spam. Use structured paragraphs and tables instead.
3. Bold only critical values:
   - Key KPIs
   - Revenue numbers (e.g. **₹39.49 Cr**)
   - Growth percentages (e.g. **+12.4%**)
   - Entity names (e.g. **HYBRID HOTPEPPER**, **Tamil Nadu**)
4. Maximum of 3 bold items per paragraph. Never bold every row or every value.
5. Use Markdown tables whenever ranking, list, or comparative data exists.
6. Always end the "## Summary" section with a sentence in this exact pattern: "This analysis covers <FY list or 'all available financial years'>." Never omit this sentence, and never vary its wording.
7. Structure the response using these exact sections:
   - ## Summary (A brief 1-2 sentence executive overview)
   - ### Key Findings (Use a table or a structured paragraph of the main facts)
   - ### Business Insight (1-2 sentences explaining the trend or business implication)
   - ### Recommendation (A strategic recommendation based on the data)

8. Do NOT mention database technical jargon like "PostgreSQL", "table", "rows", "SQL", or "query". Translate them into business terms (e.g. "sales records", "billing data").

CRITICAL CURRENCY FORMATTING RULES:
- 1 Crore (Cr) = 10,000,000 (1 followed by 7 zeros, i.e. 10^7)
- 1 Lakh (L) = 100,000 (10^5)
- To convert raw INR to Crores: divide by 10000000 (NOT by 1000000)
- Example: 394917166.46 = ₹39.49 Cr (394917166.46 / 10000000 = 39.49)
- Example: 57708000.00 = ₹5.77 Cr (57708000.00 / 10000000 = 5.77)
- Example: 901495987.64 = ₹90.15 Cr (901495987.64 / 10000000 = 90.15)
- Always round to 2 decimal places
- NEVER divide by 1000000 (that gives Millions, not Crores)
- For values less than 1 Crore, use Lakhs: e.g. 693516.00 = ₹6.94 Lakhs
- ALWAYS show the raw number as ₹X.XX Cr or ₹X.XX Lakhs — never show raw integers in the answer

CRITICAL RULES FOR THE "insights":
1. Provide a concise, professional business insight (1-2 sentences) summarizing the key takeaway.
2. This will be read aloud via Text-to-Speech, so keep it conversational, professional, and do NOT include markdown syntax (like ** or ##) or emojis in this field.`;

  try {
    const completion = await groqClient.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user', content: `Original User Question: "${question}"
Active Dashboard Filters: ${JSON.stringify(activeFilters)}
Data Operations SQL Applied: "${queryPlan.sql}"
Resulting Data Rows:
${resultString}

Please synthesize the final answer:` }
      ],
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
      temperature: 0.2
    });

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
