import { dbGet, dbAll, dbRun } from '../database.js';

/**
 * Bootstraps or returns the active Copilot session
 * POST /api/copilot/session
 */
export async function bootstrapSession(req, res) {
  const { sessionId } = req.body;

  try {
    if (sessionId) {
      // Validate session is active
      const session = await dbGet(
        "SELECT id, context, status FROM copilot_sessions WHERE id = $1 AND status = 'active'",
        [sessionId]
      );
      if (session) {
        return res.json({
          sessionId: session.id,
          context: typeof session.context === 'string' ? JSON.parse(session.context) : session.context,
          isNew: false
        });
      }
    }

    // Create a new session
    const title = `Chat on ${new Date().toLocaleDateString('en-IN')}`;
    const newSession = await dbGet(
      "INSERT INTO copilot_sessions (title, status, context) VALUES ($1, 'active', '{}'::jsonb) RETURNING id, context",
      [title]
    );

    res.json({
      sessionId: newSession.id,
      context: typeof newSession.context === 'string' ? JSON.parse(newSession.context) : newSession.context,
      isNew: true
    });
  } catch (error) {
    console.error('Error bootstrapping copilot session:', error);
    res.status(500).json({ error: 'Failed to bootstrap copilot session', details: error.message });
  }
}

/**
 * Archives current session and spins up a new one
 * POST /api/copilot/new
 */
export async function newSession(req, res) {
  const { sessionId } = req.body;

  try {
    if (sessionId) {
      // Archive the old session
      await dbRun(
        "UPDATE copilot_sessions SET status = 'archived', updated_at = NOW() WHERE id = $1",
        [sessionId]
      );
    }

    // Create a new session
    const title = `Chat on ${new Date().toLocaleDateString('en-IN')}`;
    const newSession = await dbGet(
      "INSERT INTO copilot_sessions (title, status, context) VALUES ($1, 'active', '{}'::jsonb) RETURNING id, context",
      [title]
    );

    res.json({
      sessionId: newSession.id,
      context: typeof newSession.context === 'string' ? JSON.parse(newSession.context) : newSession.context
    });
  } catch (error) {
    console.error('Error starting new copilot session:', error);
    res.status(500).json({ error: 'Failed to start new copilot session', details: error.message });
  }
}

/**
 * Returns complete message list and context for a session
 * GET /api/copilot/history/:sessionId
 */
export async function getSessionHistory(req, res) {
  const { sessionId } = req.params;

  try {
    const session = await dbGet(
      "SELECT id, context, status, title FROM copilot_sessions WHERE id = $1",
      [sessionId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const messagesRows = await dbAll(
      "SELECT role, content, metadata, created_at FROM copilot_messages WHERE session_id = $1 ORDER BY created_at ASC",
      [sessionId]
    );

    const messages = messagesRows.map(msg => ({
      sender: msg.role === 'user' ? 'user' : 'ai',
      text: msg.content,
      timestamp: new Date(msg.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      metadata: typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata,
      navNotice: msg.metadata && (typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata).navigateTo
        ? `Navigated to ${(typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata).navigateTo}`
        : null
    }));

    res.json({
      session: {
        id: session.id,
        context: typeof session.context === 'string' ? JSON.parse(session.context) : session.context,
        status: session.status,
        title: session.title
      },
      messages
    });
  } catch (error) {
    console.error('Error fetching session history:', error);
    res.status(500).json({ error: 'Failed to fetch session history', details: error.message });
  }
}

/**
 * Generates speech using OpenAI TTS API and streams it back to the frontend
 * POST /api/copilot/tts
 */
export async function handleTTS(req, res) {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text content is required for TTS generation.' });
  }

  const openAIKey = process.env.OPENAI_API_KEY;
  if (!openAIKey) {
    console.error('OpenAI API key is missing. Cannot perform TTS.');
    return res.status(500).json({ error: 'OpenAI TTS is not configured on the server.' });
  }

  try {
    console.log('Generating TTS via OpenAI API...');
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: 'alloy',
        response_format: 'mp3'
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI TTS API returned error:', response.status, errText);
      return res.status(response.status).json({ error: 'OpenAI TTS generation failed', details: errText });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (error) {
    console.error('TTS generation exception:', error);
    res.status(500).json({ error: 'Failed to generate speech', details: error.message });
  }
}

