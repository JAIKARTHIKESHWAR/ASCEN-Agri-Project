import fs from 'fs';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load keys from backend/ai/.env
dotenv.config({ path: join(__dirname, '..', '..', 'ai', '.env') });

/**
 * Transcribes audio file into text using OpenAI, OpenRouter, or Groq (Whisper-large-v3) fallback.
 * @param {string} filePath Absolute path to the recorded audio file
 * @returns {Promise<string>} The transcribed text
 */
export async function transcribeAudio(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio file does not exist at path: ${filePath}`);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const fileBlob = new Blob([fileBuffer], { type: 'audio/wav' });

  // 1. Try OpenAI Whisper API
  const openAIKey = process.env.OPENAI_API_KEY;
  if (openAIKey) {
    try {
      console.log('Attempting audio transcription via OpenAI Whisper API...');
      const formData = new FormData();
      formData.append('file', fileBlob, 'speech.wav');
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAIKey}`
        },
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        if (data.text) {
          console.log('Transcription succeeded (OpenAI):', data.text);
          return data.text;
        }
      }
      console.error('OpenAI transcription failed. Status:', response.status);
    } catch (err) {
      console.error('OpenAI transcription exception:', err.message);
    }
  }

  // 2. Try OpenRouter Whisper API
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    try {
      console.log('Attempting audio transcription via OpenRouter Whisper API...');
      const formData = new FormData();
      formData.append('file', fileBlob, 'speech.wav');
      formData.append('model', 'openai/whisper-1');
      formData.append('language', 'en');

      const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'HTTP-Referer': 'https://acsen-agri-bi.com',
          'X-Title': 'Acsen Agri BI Analytics'
        },
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        if (data.text) {
          console.log('Transcription succeeded (OpenRouter):', data.text);
          return data.text;
        }
      }
      console.error('OpenRouter transcription failed. Status:', response.status);
    } catch (err) {
      console.error('OpenRouter transcription exception:', err.message);
    }
  }

  // 3. Fallback to Groq Whisper-large-v3 API
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      console.log('Attempting audio transcription via Groq Whisper API (whisper-large-v3)...');
      const formData = new FormData();
      formData.append('file', fileBlob, 'speech.wav');
      formData.append('model', 'whisper-large-v3');
      formData.append('language', 'en');

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqKey}`
        },
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        if (data.text) {
          console.log('Transcription succeeded (Groq):', data.text);
          return data.text;
        }
      }
      console.error('Groq transcription failed. Status:', response.status);
    } catch (err) {
      console.error('Groq transcription exception:', err.message);
    }
  }

  throw new Error('All transcription attempts (OpenAI, OpenRouter, Groq) failed. Please check your API keys.');
}
