import fs from 'fs';
import { transcribeAudio } from '../ai/whisperService.js';
import { processQuestion } from '../services/copilotService.js';

/**
 * Controller endpoint: POST /api/copilot/voice
 * Receives recorded audio, transcribes it, and routes it through the Copilot pipeline.
 */
export async function transcribeAndProcessVoice(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'Audio file is required.' });
  }

  const sessionId = req.body.session_id || req.body.sessionId;
  let filters = {};
  if (req.body.filters) {
    try {
      filters = typeof req.body.filters === 'string' ? JSON.parse(req.body.filters) : req.body.filters;
    } catch (e) {
      console.warn('Failed to parse filters in voice request:', e);
    }
  }

  const audioPath = req.file.path;
  let transcript = '';

  try {
    // 1. Transcribe audio with Whisper (OpenAI / OpenRouter / Groq cascade)
    transcript = await transcribeAudio(audioPath);

    if (!transcript || !transcript.trim()) {
      return res.status(422).json({ error: 'No speech could be recognized. Please try speaking clearly.' });
    }

    // 2. Feed transcription text into the stateful BI Copilot service
    const responsePayload = await processQuestion({
      question: transcript,
      sessionId,
      filters
    });

    // 3. Append the transcript back to the response so the frontend knows what was transcribed
    responsePayload.transcript = transcript;

    res.json(responsePayload);
  } catch (error) {
    console.error('Error processing voice query:', error);
    res.status(500).json({
      error: 'Failed to process voice query',
      details: error.message
    });
  } finally {
    // 4. Critical clean up of temporary audio file
    fs.unlink(audioPath, (err) => {
      if (err) {
        console.error('Warning: could not delete temporary audio file:', err.message);
      } else {
        console.log('Successfully cleaned up temporary audio file:', audioPath);
      }
    });
  }
}
