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

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Bootstrap session and restore history/filters on mount
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
                if (onAIResponse && ctx.filters) {
                  onAIResponse({
                    filters: ctx.filters,
                    navigateTo: ctx.lastTab,
                    section: ctx.lastSection
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
            section: 'sales-overview'
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
                            ⚡ {msg.navNotice}
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

              {/* Text Area Inputs */}
              <div className="copilot-input-area">
                <div className="copilot-input-inner">
                  <input
                    type="text"
                    className="copilot-textbox"
                    placeholder="Ask Copilot to analyze or navigate..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    disabled={isTyping}
                  />
                  <button
                    className="copilot-btn-send"
                    onClick={() => handleSend(input)}
                    disabled={!input.trim() || isTyping}
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
