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

export async function synthesizeAnswer(question, queryPlan, resultRows) {
  if (!groqClient) {
    return `The query executed successfully and returned ${resultRows.length} records. (AI Synthesis warning: GROQ_API_KEY is not configured)`;
  }

  const resultString = JSON.stringify(resultRows.slice(0, 10)); // Limit to first 10 rows for prompt token limit safety
  
  const systemPrompt = `You are Acsen Sales Analytics AI, a business intelligence analyst for Acsen Agriscience.
Explain the answer to the user's business question clearly and professionally based on the query result table.

Guidelines:
1. Provide a direct, professional, and clear answer paragraph (2-4 sentences max).
2. For money/currency values, write in Indian Rupees formatting (e.g. ₹4.25 Lakhs (L), ₹12.5 Crores (Cr) or direct figures like ₹90,000 where appropriate).
3. Do NOT mention database technical jargon like "PostgreSQL", "SQLite", "SELECT", "joins", "SQL query", "rows", or "table". Translate them into business terms (e.g. "sales amount", "standard invoice sales", "returns volume").
4. Highlight the most significant finding or the top totals.
`;

  try {
    const completion = await groqClient.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Original User Question: "${question}"
Data Operations SQL Applied: "${queryPlan.sql}"
Resulting Data Rows:
${resultString}

Please synthesize the final answer paragraph:` }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3
    });

    return completion.choices[0].message.content.trim();
  } catch (error) {
    console.error('Answer synthesis failed:', error);
    return `The query executed successfully and returned ${resultRows.length} records. (AI Synthesis error: ${error.message})`;
  }
}
