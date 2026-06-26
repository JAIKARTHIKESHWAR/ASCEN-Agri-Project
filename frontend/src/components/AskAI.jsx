import React, { useState, useRef, useEffect } from 'react';
import { formatCurrency } from './CustomCharts';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend as RechartsLegend
} from 'recharts';

// Helper to format values for charts and tables
const formatTableCell = (value, headerName) => {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'number') return String(value);
  
  const hLower = headerName.toLowerCase();
  if (
    hLower.includes('inr') || 
    hLower.includes('price') || 
    hLower.includes('amount') || 
    hLower.includes('revenue') || 
    hLower.includes('cogm') || 
    hLower.includes('sales')
  ) {
    return formatCurrency(value);
  }
  return value.toLocaleString('en-IN');
};

// Reusable Recharts charting component supporting Bar, Line, and Pie types dynamically
function DynamicRechartsChart({ chartData }) {
  if (!chartData || !chartData.data || chartData.data.length === 0 || chartData.type === 'none') {
    return null;
  }

  const { type, xAxis, series, data } = chartData;
  const colors = [
    'var(--color-sales-gross, #3b82f6)',
    'var(--color-sales-net, #10b981)',
    'var(--color-ipt, #8b5cf6)',
    'var(--color-cogm, #f59e0b)',
    'var(--color-cancelled, #ef4444)',
    '#14b8a6',
    '#ec4899',
    '#f43f5e'
  ];

  const formatChartVal = (value) => {
    if (typeof value !== 'number') return value;
    if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
    if (value >= 100000) return `₹${(value / 100000).toFixed(2)} L`;
    return `₹${value.toLocaleString('en-IN')}`;
  };

  const renderChart = () => {
    const valueKey = series && series.length > 0 ? series[0] : 'value';

    switch (type) {
      case 'bar':
        return (
          <BarChart data={data} margin={{ top: 20, right: 10, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" opacity={0.3} />
            <XAxis 
              dataKey={xAxis} 
              stroke="var(--text-secondary, #64748b)" 
              fontSize={10} 
              tickLine={false} 
            />
            <YAxis 
              stroke="var(--text-secondary, #64748b)" 
              fontSize={10} 
              tickLine={false}
              tickFormatter={(v) => typeof v === 'number' && v >= 100000 ? `${(v/100000).toFixed(0)}L` : v}
            />
            <RechartsTooltip 
              formatter={(value) => [formatChartVal(value), valueKey]}
              contentStyle={{ backgroundColor: 'var(--bg-card, #ffffff)', borderColor: 'var(--border-color, #e2e8f0)', borderRadius: '4px' }}
              labelStyle={{ color: 'var(--text-primary, #0f172a)', fontWeight: 'bold' }}
            />
            <Bar dataKey={valueKey} fill={colors[0]} radius={[4, 4, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
              ))}
            </Bar>
          </BarChart>
        );
      case 'line':
        return (
          <LineChart data={data} margin={{ top: 20, right: 10, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #e2e8f0)" opacity={0.3} />
            <XAxis 
              dataKey={xAxis} 
              stroke="var(--text-secondary, #64748b)" 
              fontSize={10} 
              tickLine={false} 
            />
            <YAxis 
              stroke="var(--text-secondary, #64748b)" 
              fontSize={10} 
              tickLine={false}
              tickFormatter={(v) => typeof v === 'number' && v >= 100000 ? `${(v/100000).toFixed(0)}L` : v}
            />
            <RechartsTooltip 
              formatter={(value) => [formatChartVal(value), valueKey]}
              contentStyle={{ backgroundColor: 'var(--bg-card, #ffffff)', borderColor: 'var(--border-color, #e2e8f0)', borderRadius: '4px' }}
              labelStyle={{ color: 'var(--text-primary, #0f172a)', fontWeight: 'bold' }}
            />
            <Line 
              type="monotone" 
              dataKey={valueKey} 
              stroke={colors[0]} 
              strokeWidth={2} 
              dot={{ r: 4 }} 
              activeDot={{ r: 6 }} 
            />
          </LineChart>
        );
      case 'pie':
        return (
          <PieChart margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
            <Pie
              data={data}
              dataKey={valueKey}
              nameKey={xAxis}
              cx="50%"
              cy="50%"
              outerRadius={80}
              label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
              labelLine={false}
              fontSize={9}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            <RechartsTooltip 
              formatter={(value) => [formatChartVal(value), valueKey]}
              contentStyle={{ backgroundColor: 'var(--bg-card, #ffffff)', borderColor: 'var(--border-color, #e2e8f0)', borderRadius: '4px' }}
            />
          </PieChart>
        );
      default:
        return null;
    }
  };

  return (
    <div 
      className="ai-chart-section" 
      style={{ 
        width: '100%', 
        height: '260px', 
        backgroundColor: 'var(--bg-card, #ffffff)', 
        border: '1px solid var(--border-color, #e2e8f0)', 
        borderRadius: '6px', 
        padding: '12px',
        marginTop: '12px' 
      }}
    >
      <div style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--text-secondary, #64748b)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        AI Generated Chart ({type})
      </div>
      <ResponsiveContainer width="100%" height="90%">
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
}

export default function AskAI({ filteredData, filters, setFilters, setActiveTab, kpis }) {
  const [messages, setMessages] = useState([
    {
      sender: 'ai',
      text: 'Hello! I am your Acsen Sales Analytics AI assistant. I can interpret business questions and query the loaded SAP sales dataset. How can I help you today?',
      suggestions: [
        'What are total sales and net sales?',
        'Which state generated the highest sales?',
        'Which crop performed best in Vegetable Division?',
        'Compare sales growth with FY2025-26',
        'Compare budget with actual sales'
      ]
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  // Suggested Golden Questions list
  const goldenQuestions = [
    { text: '1. What are total sales and net sales?', q: 'What are total sales and provisional net external sales for the selected period?' },
    { text: '2. Highest sales state/territory?', q: 'Which state or territory generated the highest sales for the selected period?' },
    { text: '3. Top Crops (Vegetable Division)?', q: 'Which crops and varieties generated the highest revenue within Vegetable Division?' },
    { text: '4. Top Crops (Field Crops)?', q: 'Which crops and varieties generated the highest revenue within Field Crops Division?' },
    { text: '5. Geographic contribution of Tomato?', q: 'Show the geographic contribution for Tomato seeds.' },
    { text: '6. Top Material Codes?', q: 'Which products or material codes generated the highest revenue?' },
    { text: '7. Sales contribution by Channel?', q: 'What is the sales contribution by distribution channel?' },
    { text: '8. Show Sales Returns by State?', q: 'Show sales returns by state.' },
    { text: '9. Monthly trend for Vegetables?', q: 'Show the monthly sales trend for Vegetable division.' },
    { text: '10. Performance of Ramesh Nair (RBM)?', q: 'How did Ramesh Nair perform in the chosen period?' },
    { text: '11. View supporting transactions?', q: 'Show the invoice-level records supporting this answer.' },
    { text: '12. Growth vs FY2025-26?', q: 'Which variety grew the most compared with FY2025-26?' },
    { text: '13. Compare budget with actuals?', q: 'Compare budget with actual sales.' }
  ];

  const handleSend = async (textToSend) => {
    if (!textToSend.trim()) return;

    // Add user message
    const newUserMsg = { sender: 'user', text: textToSend };
    setMessages(prev => [...prev, newUserMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const requestFilters = {};
      if (filters) {
        if (filters.fy) requestFilters.fy_code = filters.fy;
        if (filters.division) requestFilters.division = filters.division;
        if (filters.distributionChannel) requestFilters.dist_channel = filters.distributionChannel;
        if (filters.state) requestFilters.state = filters.state;
        if (filters.crop) requestFilters.crop = filters.crop;
        if (filters.startDate) requestFilters.start_date = filters.startDate;
        if (filters.endDate) requestFilters.end_date = filters.endDate;
      }

      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          question: textToSend,
          filters: requestFilters
        }),
      });

      if (!response.ok) {
        throw new Error(`API returned status code ${response.status}`);
      }

      const data = await response.json();
      
      setMessages(prev => [...prev, {
        sender: 'ai',
        text: data.answer,
        metric: data.metric,
        warning: data.warning,
        scopeWarning: data.scopeWarning,
        tableData: data.tableData,
        chartData: data.chartData,
        calculationBasis: data.calculationBasis,
        suggestions: data.suggestions
      }]);
    } catch (err) {
      console.error("Error communicating with AskAI backend:", err);
      
      // Fallback display warning to run FastAPI backend
      setMessages(prev => [...prev, {
        sender: 'ai',
        text: `Error connecting to the FastAPI backend. Please check that the server is running on http://127.0.0.1:8000.\n\nDetails: ${err.message}`,
        warning: {
          title: "Backend Connection Error",
          message: "Make sure you run the FastAPI backend using your virtual environment: venv/Scripts/python -m uvicorn main:app --reload inside the backend folder."
        }
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleActionClick = (action) => {
    if (action.type === 'tab') {
      setActiveTab(action.target);
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div className="ask-ai-container">
        {/* Chat Header */}
        <div className="ask-ai-header">
          <div className="ai-avatar">AI</div>
          <div>
            <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>Acsen Analytics Assistant</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Powered by Groq AI and Pandas query engine
            </p>
          </div>
        </div>

        {/* Chat History Panel */}
        <div className="ask-ai-messages">
          {messages.map((msg, index) => {
            const isUser = msg.sender === 'user';
            return (
              <div
                key={index}
                className={`message-bubble ${isUser ? 'message-user' : 'message-ai'}`}
              >
                {/* Text Response */}
                <div className="ai-direct-answer" style={{ whiteSpace: 'pre-line' }}>{msg.text}</div>

                {/* KPI Metric Display */}
                {msg.metric && (
                  <div className="ai-metric-display">
                    <span className="ai-metric-val">{msg.metric.value}</span>
                    <span className="ai-metric-lbl">{msg.metric.label}</span>
                  </div>
                )}

                {/* Warning Boxes */}
                {msg.warning && (
                  <div className="ai-warning-box">
                    <div className="ai-warning-title">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                      </svg>
                      {msg.warning.title}
                    </div>
                    <div>{msg.warning.message}</div>
                  </div>
                )}

                {msg.scopeWarning && (
                  <div className="ai-scope-box">
                    <div className="ai-scope-title">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      {msg.scopeWarning.title}
                    </div>
                    <div>{msg.scopeWarning.message}</div>
                  </div>
                )}

                {/* Visual Recharts Chart */}
                {msg.chartData && (
                  <DynamicRechartsChart chartData={msg.chartData} />
                )}

                {/* Visual Data Table */}
                {msg.tableData && msg.tableData.headers && msg.tableData.headers.length > 0 && (
                  <div className="ai-chart-section" style={{ width: '100%', marginTop: '12px' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--text-secondary, #64748b)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Query Results Table
                    </div>
                    <table className="data-table" style={{ fontSize: '0.8rem', backgroundColor: 'var(--bg-card)' }}>
                      <thead>
                        <tr>
                          {msg.tableData.headers.map((h, i) => (
                            <th key={i} style={{ padding: '8px 12px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {msg.tableData.rows.map((row, rIdx) => (
                          <tr key={rIdx}>
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} style={{ padding: '8px 12px' }}>
                                {formatTableCell(cell, msg.tableData.headers[cIdx])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Expandable Calculation Basis */}
                {msg.calculationBasis && (
                  <div className="ai-meta-info">
                    <details>
                      <summary style={{ cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-muted)', outline: 'none' }}>
                        Show query details and metadata
                      </summary>
                      <div style={{ padding: '8px 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        <div style={{ marginBottom: 4 }}>
                          <span className="meta-label">Aggregation Basis:</span> {msg.calculationBasis}
                        </div>
                        <div>
                          <span className="meta-label">Confidence:</span> <span style={{ color: 'var(--color-sales-net)' }}>100% Grounded</span>
                        </div>
                      </div>
                    </details>
                  </div>
                )}

                {/* Drill Actions */}
                {msg.action && (
                  <div className="ai-actions">
                    <button className="btn-ai-drill" onClick={() => handleActionClick(msg.action)}>
                      {msg.action.label}
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12 }}>
                        <path d="M5 12h14M12 5l7 7-7 7"/>
                      </svg>
                    </button>
                  </div>
                )}

                {/* Suggested replies for clarification bubbles */}
                {msg.suggestions && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-muted)' }}>Suggested Follow-up:</div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {msg.suggestions.map((sug, sIdx) => (
                        <button key={sIdx} className="btn-suggested-q" onClick={() => handleSend(sug)}>
                          {sug}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Typing indicator */}
          {isTyping && (
            <div className="message-bubble message-ai" style={{ width: 'fit-content', padding: '12px 20px' }}>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>AI is scanning transactions...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input box and Quick questions */}
        <div className="ask-ai-input-area">
          <div className="suggested-questions-row">
            {goldenQuestions.map((q, idx) => (
              <button
                key={idx}
                className="btn-suggested-q"
                onClick={() => handleSend(q.q)}
                title={q.q}
              >
                {q.text}
              </button>
            ))}
          </div>

          <div className="input-box-wrapper">
            <input
              type="text"
              className="chat-input"
              placeholder="Ask a question about sales metrics, state rankings, crops, channels, budget..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSend(input);
              }}
            />
            <button className="btn-send" onClick={() => handleSend(input)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18, color: 'white' }}>
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
