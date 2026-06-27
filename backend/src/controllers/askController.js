import { processQuestion } from '../services/copilotService.js';

/**
 * Controller endpoint: POST /api/ask
 */
export async function askQuestion(req, res) {
  const { question, filters } = req.body;
  const sessionId = req.body.session_id || req.body.sessionId;

  if (!question) {
    return res.status(400).json({ error: 'Question is required' });
  }

  try {
    const responsePayload = await processQuestion({ question, sessionId, filters });
    res.json(responsePayload);
  } catch (error) {
    console.error("Error in askQuestion controller:", error);
    res.status(500).json({ 
      error: "Internal Server Error", 
      details: error.message 
    });
  }
}
