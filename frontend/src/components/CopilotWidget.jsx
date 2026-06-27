import React, { useState, useEffect, useRef } from 'react';

const SUGGESTED_PROMPTS = [
  { label: 'Sales for FY2627', text: 'Show sales report for FY2627' },
  { label: 'Cotton in TN', text: 'Show cotton sales in Tamil Nadu' },
  { label: 'Returns for Q1', text: 'Display returns for Q1' },
  { label: 'Highest Sales Territory', text: 'Which territory has the highest sales?' },
];

export default function CopilotWidget({ currentFilters, onAIResponse }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [sessionId, setSessionId] = useState(localStorage.getItem('copilot_session_id') || null);
  const [messages, setMessages] = useState([
    {
      sender: 'ai',
      text: 'Hi! I am your Acsen BI Assistant. Ask me questions about sales, crops, states, or return rates, and I will navigate and show you the details!',
      timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    }
  ]);

  // Voice recording states
  const [voiceState, setVoiceState] = useState('idle'); // 'idle' | 'listening' | 'uploading' | 'transcribing' | 'thinking' | 'completed' | 'failed'
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Bootstrap session and restore history/filters/preferences on mount
  useEffect(() => {
    const initSession = async () => {
      const storedSessionId = localStorage.getItem('copilot_session_id');
      try {
        const res = await fetch('/api/copilot/session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ sessionId: storedSessionId })
        });
        if (res.ok) {
          const data = await res.json();
          setSessionId(data.sessionId);
          localStorage.setItem('copilot_session_id', data.sessionId);
          
          // Fetch history for the active session
          const histRes = await fetch(`/api/copilot/history/${data.sessionId}`);
          if (histRes.ok) {
            const histData = await histRes.json();
            if (histData.messages && histData.messages.length > 0) {
              setMessages(histData.messages);
              
              // Restore dashboard filters/views from historical context
              if (histData.session && histData.session.context) {
                const ctx = histData.session.context;
                if (onAIResponse) {
                  onAIResponse({
                    filters: ctx.filters || {},
                    navigateTo: ctx.lastTab || 'summary',
                    section: ctx.lastSection || 'sales-overview',
                    chartPreferences: ctx.chartPreferences || {}
                  });
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('Failed to initialize Copilot session:', err);
      }
    };

    initSession();
  }, []);

  useEffect(() => {
    if (isOpen && !isMinimized) {
      scrollToBottom();
    }
  }, [messages, isTyping, isOpen, isMinimized]);

  const handleSend = async (textToSend) => {
    if (!textToSend.trim()) return;

    // Add user message locally
    const userTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    setMessages(prev => [...prev, { sender: 'user', text: textToSend, timestamp: userTime }]);
    setInput('');
    setIsTyping(true);

    try {
      // Map filters for the ask request
      const requestFilters = {};
      if (currentFilters) {
        if (currentFilters.fy) requestFilters.fy_code = currentFilters.fy;
        if (currentFilters.division) requestFilters.division = currentFilters.division;
        if (currentFilters.distributionChannel) requestFilters.dist_channel = currentFilters.distributionChannel;
        if (currentFilters.state) requestFilters.state = currentFilters.state;
        if (currentFilters.crop) requestFilters.crop = currentFilters.crop;
        if (currentFilters.startDate) requestFilters.start_date = currentFilters.startDate;
        if (currentFilters.endDate) requestFilters.end_date = currentFilters.endDate;
      }

      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: textToSend,
          session_id: sessionId,
          filters: requestFilters,
        }),
      });

      if (!response.ok) {
        throw new Error(`API returned status code ${response.status}`);
      }

      const data = await response.json();
      const aiTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

      // Add AI reply
      setMessages(prev => [...prev, {
        sender: 'ai',
        text: data.insights || data.answer,
        timestamp: aiTime,
        navNotice: data.navigateTo ? `Navigated to ${data.navigateTo} (${data.section})` : null
      }]);

      // Propagate the navigation and filter updates to App.jsx
      if (onAIResponse) {
        onAIResponse(data);
      }
    } catch (err) {
      console.error('Error communicating with Copilot backend:', err);
      const errTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      setMessages(prev => [...prev, {
        sender: 'ai',
        text: `Sorry, I encountered an error checking that request: ${err.message}. Please verify the backend server is running.`,
        timestamp: errTime
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  // Voice recording logic
  const startRecording = async () => {
    try {
      setVoiceState('listening');
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        // Stop audio tracks to release microphone
        stream.getTracks().forEach(track => track.stop());

        if (audioBlob.size < 2000) {
          setVoiceState('failed');
          alert('Audio recording is too short or invalid. Please speak clearly.');
          setTimeout(() => setVoiceState('idle'), 2000);
          return;
        }

        await sendAudioPayload(audioBlob);
      };

      mediaRecorder.start();
    } catch (err) {
      console.error('Mic initialization or recording start error:', err);
      setVoiceState('failed');
      alert(`Could not start voice recording: ${err.message || 'Please check microphone permission.'}`);
      setTimeout(() => setVoiceState('idle'), 2000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const sendAudioPayload = async (audioBlob) => {
    setVoiceState('uploading');
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'voice_query.wav');
      formData.append('session_id', sessionId || '');
      
      // Load current filters context
      const requestFilters = {};
      if (currentFilters) {
        if (currentFilters.fy) requestFilters.fy_code = currentFilters.fy;
        if (currentFilters.division) requestFilters.division = currentFilters.division;
        if (currentFilters.distributionChannel) requestFilters.dist_channel = currentFilters.distributionChannel;
        if (currentFilters.state) requestFilters.state = currentFilters.state;
        if (currentFilters.crop) requestFilters.crop = currentFilters.crop;
        if (currentFilters.startDate) requestFilters.start_date = currentFilters.startDate;
        if (currentFilters.endDate) requestFilters.end_date = currentFilters.endDate;
      }
      formData.append('filters', JSON.stringify(requestFilters));

      setVoiceState('transcribing');
      const response = await fetch('/api/copilot/voice', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `Voice upload endpoint failed with status: ${response.status}`);
      }

      setVoiceState('thinking');
      const data = await response.json();

      const userTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const aiTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

      // Add user transcript message
      setMessages(prev => [...prev, {
        sender: 'user',
        text: data.transcript,
        timestamp: userTime
      }]);

      // Add AI reply message
      setMessages(prev => [...prev, {
        sender: 'ai',
        text: data.insights || data.answer,
        timestamp: aiTime,
        navNotice: data.navigateTo ? `Navigated to ${data.navigateTo} (${data.section})` : null
      }]);

      setVoiceState('completed');
      setTimeout(() => setVoiceState('idle'), 1000);

      // Trigger navigation, filters, and dynamic visualization preference updates
      if (onAIResponse) {
        onAIResponse(data);
      }
    } catch (err) {
      console.error('Error handling voice transcription / query pipeline:', err);
      setVoiceState('failed');
      const errTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      setMessages(prev => [...prev, {
        sender: 'ai',
        text: `Voice Processing Error: ${err.message}. Please speak clearly and check your connection.`,
        timestamp: errTime
      }]);
      setTimeout(() => setVoiceState('idle'), 3000);
    }
  };

  const handleNewChat = async () => {
    try {
      setIsTyping(true);
      const res = await fetch('/api/copilot/new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sessionId })
      });
      if (res.ok) {
        const data = await res.json();
        setSessionId(data.sessionId);
        localStorage.setItem('copilot_session_id', data.sessionId);
        
        // Clear chat list and set default greeting
        setMessages([
          {
            sender: 'ai',
            text: 'Hi! I am your Acsen BI Assistant. Ask me questions about sales, crops, states, or return rates, and I will navigate and show you the details!',
            timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
          }
        ]);

        // Reset active dashboard filters in parent App.jsx
        if (onAIResponse) {
          onAIResponse({
            filters: {},
            navigateTo: 'summary',
            section: 'sales-overview',
            chartPreferences: {}
          });
        }
      }
    } catch (e) {
      console.error('Failed to archive session and create a new chat:', e);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSend(input);
    }
  };

  return (
    <>
      {/* Floating Widget Toggle Trigger Button */}
      <button
        className={`copilot-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => {
          setIsOpen(!isOpen);
          setIsMinimized(false);
        }}
        title="Acsen Sales BI Copilot"
      >
        {isOpen ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        )}
      </button>

      {/* Slide-out Chat Drawer */}
      {isOpen && (
        <div className={`copilot-drawer ${isMinimized ? 'minimized' : ''}`}>
          {/* Header */}
          <div className="copilot-header">
            <div className="copilot-header-info">
              <div className="copilot-avatar">AI</div>
              <div>
                <h4 className="copilot-header-title">Acsen BI Copilot</h4>
                {!isMinimized && <p className="copilot-header-subtitle">Conversational Analytics Engine</p>}
              </div>
            </div>
            <div className="copilot-header-actions">
              {/* New Chat Action */}
              {!isMinimized && (
                <button
                  className="copilot-btn-action"
                  onClick={handleNewChat}
                  title="Start a new chat session"
                  style={{ marginRight: '6px' }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 14, height: 14 }}>
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                </button>
              )}
              {/* Minimize Action */}
              <button
                className="copilot-btn-action"
                onClick={() => setIsMinimized(!isMinimized)}
                title={isMinimized ? "Restore chat window" : "Minimize chat window"}
              >
                {isMinimized ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 14, height: 14 }}>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <polyline points="9 21 3 21 3 15"></polyline>
                    <line x1="21" y1="3" x2="14" y2="10"></line>
                    <line x1="3" y1="21" x2="10" y2="14"></line>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 14, height: 14 }}>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                )}
              </button>
              {/* Close Action */}
              <button
                className="copilot-btn-action"
                onClick={() => setIsOpen(false)}
                title="Close drawer"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 14, height: 14 }}>
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Messages viewport */}
              <div className="copilot-messages">
                {messages.map((msg, index) => {
                  const isUser = msg.sender === 'user';
                  return (
                    <div key={index} className={`copilot-msg ${isUser ? 'user' : 'ai'}`}>
                      <div className="copilot-bubble">
                        {msg.text}
                        {msg.navNotice && (
                          <div style={{ marginTop: '8px', fontSize: '0.7rem', fontStyle: 'italic', color: 'var(--color-sales-net)', fontWeight: 'bold' }}>

                          </div>
                        )}
                      </div>
                      <span className="copilot-metadata">{msg.timestamp}</span>
                    </div>
                  );
                })}
                {isTyping && (
                  <div className="copilot-msg ai">
                    <div className="copilot-bubble" style={{ width: 'fit-content' }}>
                      <div className="typing-dots">
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Suggested Prompts list */}
              <div className="copilot-suggested">
                <span className="copilot-suggested-label">Suggested Queries</span>
                <div className="copilot-suggested-row">
                  {SUGGESTED_PROMPTS.map((prompt, idx) => (
                    <button
                      key={idx}
                      className="copilot-btn-suggested"
                      onClick={() => handleSend(prompt.text)}
                    >
                      {prompt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Microphone & Voice Status Bar */}
              {voiceState !== 'idle' && (
                <div style={{ padding: '6px 14px', fontSize: '0.7rem', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: voiceState === 'failed' ? '#ef4444' : '#10b981', animation: voiceState === 'listening' || voiceState === 'transcribing' || voiceState === 'thinking' ? 'pulse 1s infinite' : 'none' }} />
                  <span style={{ fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{voiceState}...</span>
                </div>
              )}

              {/* Text Area Inputs */}
              <div className="copilot-input-area">
                <div className="copilot-input-inner">
                  {/* Microphone Button */}
                  <button
                    className={`copilot-btn-mic ${voiceState === 'listening' ? 'recording' : ''}`}
                    onClick={voiceState === 'listening' ? stopRecording : startRecording}
                    title={voiceState === 'listening' ? "Click to stop recording" : "Click to speak query"}
                    type="button"
                    style={{
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '8px',
                      color: voiceState === 'listening' ? '#ef4444' : 'var(--text-secondary)',
                      transition: 'all var(--transition-fast)',
                      borderRadius: '50%',
                      backgroundColor: voiceState === 'listening' ? 'var(--bg-tertiary)' : 'transparent',
                    }}
                  >
                    {voiceState === 'listening' ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15, animation: 'pulse 1s infinite' }}>
                        <circle cx="12" cy="12" r="10" fill="#ef4444" opacity="0.3"></circle>
                        <circle cx="12" cy="12" r="4" fill="#ef4444"></circle>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }}>
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                        <line x1="8" y1="23" x2="16" y2="23"></line>
                      </svg>
                    )}
                  </button>

                  <input
                    type="text"
                    className="copilot-textbox"
                    placeholder={voiceState === 'listening' ? "Listening speech..." : "Ask Copilot to analyze or navigate..."}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    disabled={isTyping || voiceState === 'listening'}
                  />
                  <button
                    className="copilot-btn-send"
                    onClick={() => handleSend(input)}
                    disabled={!input.trim() || isTyping || voiceState === 'listening'}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
