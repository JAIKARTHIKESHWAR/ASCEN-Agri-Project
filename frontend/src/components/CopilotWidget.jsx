import React, { useState, useEffect, useRef } from 'react';
import { formatCurrencyINR } from '../utils/formatUtils';

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
  
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const audioRef = useRef(null);
  const activeTtsIdRef = useRef(0);

  const stopSpeaking = () => {
    activeTtsIdRef.current++;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setIsSpeaking(false);
    setSpeakingMessageId(null);
  };

  const startSpeaking = async (msgId, text) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    const requestId = ++activeTtsIdRef.current;

    setIsSpeaking(true);
    setSpeakingMessageId(msgId);

    try {
      const res = await fetch('/api/copilot/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text })
      });

      if (!res.ok) {
        throw new Error('TTS generation failed');
      }

      if (requestId !== activeTtsIdRef.current) {
        return;
      }

      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        if (requestId === activeTtsIdRef.current) {
          setIsSpeaking(false);
          setSpeakingMessageId(null);
        }
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        if (requestId === activeTtsIdRef.current) {
          setIsSpeaking(false);
          setSpeakingMessageId(null);
        }
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
    } catch (err) {
      console.error('Failed to play TTS:', err);
      if (requestId === activeTtsIdRef.current) {
        setIsSpeaking(false);
        setSpeakingMessageId(null);
      }
    }
  };

  // Voice recording logic
  const startRecording = async () => {
    try {
      setVoiceState('listening');
      setIsRecording(true);
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
        setIsRecording(false);
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
      setIsRecording(false);
      alert(`Could not start voice recording: ${err.message || 'Please check microphone permission.'}`);
      setTimeout(() => setVoiceState('idle'), 2000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  useEffect(() => {
    const handleBeforeUnload = () => {
      stopSpeaking();
      stopRecording();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

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
        if (currentFilters.fy) {
          requestFilters.fy_code = currentFilters.fy;
          requestFilters.datasetId = currentFilters.fy;
        } else {
          requestFilters.datasetId = 'all';
        }
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
      const textToSpeak = data.insights || data.answer;

      // Add AI reply and trigger auto TTS
      setMessages(prev => {
        const newMsgIndex = prev.length;
        setTimeout(() => startSpeaking(newMsgIndex, textToSpeak), 50);
        return [...prev, {
          sender: 'ai',
          text: textToSpeak,
          timestamp: aiTime,
          navNotice: data.navigateTo ? `Navigated to ${data.navigateTo} (${data.section})` : null
        }];
      });

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

  const sendAudioPayload = async (audioBlob) => {
    setVoiceState('uploading');
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'voice_query.wav');
      formData.append('session_id', sessionId || '');

      // Load current filters context
      const requestFilters = {};
      if (currentFilters) {
        if (currentFilters.fy) {
          requestFilters.fy_code = currentFilters.fy;
          requestFilters.datasetId = currentFilters.fy;
        } else {
          requestFilters.datasetId = 'all';
        }
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
      const textToSpeak = data.insights || data.answer;

      // Add user transcript, AI reply, and trigger auto TTS
      setMessages(prev => {
        const nextIndex = prev.length + 1;
        setTimeout(() => startSpeaking(nextIndex, textToSpeak), 50);
        return [...prev, {
          sender: 'user',
          text: data.transcript,
          timestamp: userTime
        }, {
          sender: 'ai',
          text: textToSpeak,
          timestamp: aiTime,
          navNotice: data.navigateTo ? `Navigated to ${data.navigateTo} (${data.section})` : null
        }];
      });

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

  const renderMessageContent = (text) => {
    if (!text) return '';
    
    // 1. Format raw rupee figures and escape HTML entities for safety
    let escaped = text.replace(/₹\s?(-?\d+(\.\d+)?)/g, (_, num) => formatCurrencyINR(num));
    escaped = escaped
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
      
    // 2. Parse Markdown Tables
    const tableRegex = /((?:\|.*\|(?:\r?\n)?)+)/g;
    escaped = escaped.replace(tableRegex, (match) => {
      const lines = match.trim().split('\n');
      if (lines.length < 2) return match;
      
      let htmlTable = '<table style="width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 0.85rem; border: 1px solid var(--border-color, #e2e8f0); border-radius: 4px; overflow: hidden;">';
      let hasHeader = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.includes('|-') || line.includes('| -') || line.match(/^\|?\s*:?-+:?\s*\|/)) {
          continue; // skip separator lines
        }
        
        const cells = line.split('|').map(c => c.trim()).filter((c, idx, arr) => {
          return idx > 0 && idx < arr.length - 1;
        });
        
        if (cells.length === 0) continue;
        
        if (!hasHeader) {
          htmlTable += '<thead style="background-color: var(--bg-secondary, #f8fafc); border-bottom: 2px solid var(--border-color, #e2e8f0);">';
          htmlTable += '<tr>';
          cells.forEach(cell => {
            htmlTable += `<th style="padding: 8px 10px; text-align: left; font-weight: bold; border: 1px solid var(--border-color, #e2e8f0);">${cell}</th>`;
          });
          htmlTable += '</tr></thead><tbody>';
          hasHeader = true;
        } else {
          htmlTable += '<tr style="border-bottom: 1px solid var(--border-color, #e2e8f0);">';
          cells.forEach(cell => {
            htmlTable += `<td style="padding: 8px 10px; border: 1px solid var(--border-color, #e2e8f0);">${cell}</td>`;
          });
          htmlTable += '</tr>';
        }
      }
      
      htmlTable += '</tbody></table>';
      return htmlTable;
    });

    // 3. Parse inline styles (headers, bold, italics, newlines) and clean unmatched hashes
    const html = escaped
      .replace(/^#{1,6}\s*(.*)$/gim, '<h5 style="margin-top:10px;margin-bottom:4px;font-weight:600;font-size:0.9rem;color:var(--text-primary);">$1</h5>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/#+/g, '')
      .replace(/\n/g, '<br/>');
      
    return <div style={{ display: 'inline-block', width: '100%' }} dangerouslySetInnerHTML={{ __html: html }} />;
  };

  return (
    <>
      {/* Floating Widget Toggle Trigger Button */}
      <button
        className={`copilot-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => {
          setIsOpen(!isOpen);
          setIsMinimized(false);
          if (isOpen) {
            stopSpeaking();
            stopRecording();
          }
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
                onClick={() => {
                  setIsOpen(false);
                  stopSpeaking();
                  stopRecording();
                }}
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
                  const isUser = msg.sender === 'user' || msg.role === 'user';
                  const contentText = msg.text || msg.content;
                  const displayTime = msg.timestamp || (msg.created_at ? new Date(msg.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');

                  // Support both metadata and raw navNotice string
                  const navNotice = msg.navNotice || (msg.metadata?.navigateTo ? `Navigated to ${msg.metadata.navigateTo} (${msg.metadata.section || 'sales-overview'})` : null);

                  return (
                    <div key={index} className={`copilot-msg ${isUser ? 'user' : 'ai'}`}>
                      <div className="copilot-bubble" style={{ position: 'relative', paddingBottom: !isUser ? '26px' : '12px' }}>
                        {renderMessageContent(contentText)}
                        {navNotice && (
                          <div style={{ marginTop: '8px', fontSize: '0.7rem', fontStyle: 'italic', color: 'var(--color-sales-net)', fontWeight: 'bold' }}>
                            {navNotice}
                          </div>
                        )}
                        {!isUser && (
                          <div className="copilot-tts-controls" style={{ position: 'absolute', bottom: '4px', right: '8px', display: 'flex', gap: '6px' }}>
                            {isSpeaking && speakingMessageId === index ? (
                              <button 
                                onClick={(e) => { e.stopPropagation(); stopSpeaking(); }}
                                title="Stop speaking"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', color: 'var(--color-sales-net, #3b82f6)' }}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                                  <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                                  <line x1="23" y1="9" x2="17" y2="15"></line>
                                  <line x1="17" y1="9" x2="23" y2="15"></line>
                                </svg>
                              </button>
                            ) : (
                              <button 
                                onClick={(e) => { e.stopPropagation(); startSpeaking(index, contentText); }}
                                title="Listen"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', color: 'var(--text-muted, #64748b)' }}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                                </svg>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <span className="copilot-metadata">{displayTime}</span>
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
                  {/* Microphone Button inside text field */}
                  <button
                    className={`copilot-btn-mic ${isRecording ? 'recording' : ''}`}
                    onClick={isRecording ? stopRecording : startRecording}
                    title={isRecording ? "Click to stop recording" : "Click to speak query"}
                    type="button"
                    style={{
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '8px',
                      color: isRecording ? '#ef4444' : 'var(--text-secondary)',
                      transition: 'all var(--transition-fast)',
                      borderRadius: '50%',
                      backgroundColor: isRecording ? 'var(--bg-tertiary)' : 'transparent',
                      marginRight: '6px'
                    }}
                  >
                    {isRecording ? (
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
                    placeholder={isRecording ? "Listening speech..." : "Ask Copilot to analyze or navigate..."}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    disabled={isTyping || isRecording}
                  />

                  {/* Status Indicator inside text field when transcribing/thinking */}
                  {voiceState !== 'idle' && voiceState !== 'listening' && (
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase', marginRight: '8px', whiteSpace: 'nowrap' }}>{voiceState}...</span>
                  )}

                  <button
                    className="copilot-btn-send"
                    onClick={() => handleSend(input)}
                    disabled={!input.trim() || isTyping || isRecording}
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
