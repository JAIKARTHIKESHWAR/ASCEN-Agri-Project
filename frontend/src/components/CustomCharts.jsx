import React, { useState, useRef, useEffect, useMemo } from 'react';

// Format numbers in Indian numbering system (Lakhs/Crores)
export function formatCurrency(value) {
  if (value === 0) return '₹0';
  const val = Math.abs(value);
  if (val >= 10000000) {
    return `₹${(value / 10000000).toFixed(2)} Cr`;
  } else if (val >= 100000) {
    return `₹${(value / 100000).toFixed(2)} L`;
  } else {
    return `₹${value.toLocaleString('en-IN')}`;
  }
}

// Hook to measure container size dynamically
export function useContainerDimensions(ref) {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const getDimensions = () => ({
      width: ref.current ? ref.current.offsetWidth : 0,
      height: ref.current ? ref.current.offsetHeight : 0
    });

    const handleResize = () => {
      setDimensions(getDimensions());
    };

    if (ref.current) {
      setDimensions(getDimensions());
    }

    window.addEventListener('resize', handleResize);

    let resizeObserver;
    if (ref.current && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(ref.current);
    }

    // Force a re-measurement after a short delay to handle initial layout settling
    const timer = setTimeout(() => {
      handleResize();
    }, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      clearTimeout(timer);
    };
  }, [ref]);

  return dimensions;
}

// 1. Donut Chart Component
export const DonutChart = React.memo(function DonutChart({ data, title }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const total = data.reduce((sum, item) => sum + item.value, 0);

  const radius = 60;
  const strokeWidth = 18;
  const circumference = 2 * Math.PI * radius;
  const center = 90;

  let currentOffset = 0;

  // Curated color list for pie segments
  const colors = [
    'var(--color-sales-gross)',
    'var(--color-sales-net)',
    'var(--color-ipt)',
    'var(--color-cogm)',
    'var(--color-cancelled)',
    '#e11d48',
    '#059669',
    '#d97706'
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'center', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'center', position: 'relative', width: '100%', maxWidth: '140px' }}>
        <svg viewBox="0 0 180 180" style={{ width: '100%', height: 'auto', display: 'block' }}>
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="transparent"
            stroke="var(--bg-primary)"
            strokeWidth={strokeWidth}
          />
          {data.map((item, idx) => {
            if (item.value === 0) return null;
            const percentage = item.value / total;
            const strokeLength = percentage * circumference;
            const strokeOffset = circumference - currentOffset;
            currentOffset += strokeLength;

            const isHovered = hoveredIdx === idx;
            const color = colors[idx % colors.length];

            return (
              <circle
                key={item.label}
                cx={center}
                cy={center}
                r={radius}
                fill="transparent"
                stroke={color}
                strokeWidth={isHovered ? strokeWidth + 3 : strokeWidth}
                strokeDasharray={`${strokeLength} ${circumference - strokeLength}`}
                strokeDashoffset={strokeOffset}
                transform={`rotate(-90 ${center} ${center})`}
                style={{
                  transition: 'all var(--transition-normal)',
                  cursor: 'pointer',
                }}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
            );
          })}

          {/* Middle Text */}
          <text
            x={center}
            y={center - 5}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{
              fill: 'var(--text-primary)',
              fontSize: '11px',
              fontFamily: 'var(--font-heading)',
              fontWeight: '600'
            }}
          >
            {hoveredIdx !== null ? data[hoveredIdx].label : 'Total'}
          </text>
          <text
            x={center}
            y={center + 12}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{
              fill: hoveredIdx !== null ? colors[hoveredIdx % colors.length] : 'var(--text-primary)',
              fontSize: '13px',
              fontFamily: 'var(--font-heading)',
              fontWeight: '700'
            }}
          >
            {formatCurrency(hoveredIdx !== null ? data[hoveredIdx].value : total)}
          </text>
        </svg>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px', fontSize: '0.8rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
            <th style={{ padding: '6px 8px', fontWeight: '600', color: 'var(--text-secondary)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Division</th>
            <th style={{ padding: '6px 8px', fontWeight: '600', color: 'var(--text-secondary)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Per %</th>
            <th style={{ padding: '6px 8px', fontWeight: '600', color: 'var(--text-secondary)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Currency</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item, idx) => {
            if (item.value === 0) return null;
            const percentage = total > 0 ? ((item.value / total) * 100).toFixed(1) : 0;
            const color = colors[idx % colors.length];
            const isHovered = hoveredIdx === idx;

            return (
              <tr
                key={item.label}
                style={{
                  backgroundColor: isHovered ? 'var(--bg-hover)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background-color var(--transition-fast)',
                }}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                <td style={{ padding: '5px 8px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border-color)' }}>
                  <span className="legend-color" style={{ backgroundColor: color, display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', flexShrink: 0 }} />
                  <span style={{ color: 'var(--text-primary)', fontWeight: isHovered ? '600' : '400' }}>
                    {item.label}
                  </span>
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: '500', borderBottom: '1px solid var(--border-color)' }}>
                  {percentage}%
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: '600', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)' }}>
                  {formatCurrency(item.value)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

// 2. Line Chart Component
export const LineChart = React.memo(function LineChart({ data, xKey = 'label', yKey = 'value', comparisonKey = null, height = 240 }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, label: '', value: 0, compValue: 0 });
  const containerRef = useRef(null);
  const dimensions = useContainerDimensions(containerRef);

  const safeData = useMemo(() => {
    return Array.isArray(data)
      ? data.filter(d => d && d[xKey] && d[yKey] != null)
      : [];
  }, [data, xKey, yKey]);

  if (safeData.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '180px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
        No data available for selected filters
      </div>
    );
  }

  const width = dimensions.width || 800;
  const viewHeight = dimensions.height || height;

  const paddingLeft = 60;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = safeData.length > 3 ? 55 : 40;

  const xMax = Math.max(width - paddingLeft - paddingRight, 10);
  const yMax = Math.max(viewHeight - paddingTop - paddingBottom, 10);

  const yValues = [...safeData.map(d => d[yKey]), ...(comparisonKey ? safeData.map(d => d[comparisonKey]) : [])];
  const maxYVal = Math.max(...yValues, 1000) * 1.1; // Add 10% headroom
  const minYVal = 0;

  const points = safeData.map((d, index) => {
    const x = paddingLeft + (index / (safeData.length - 1 || 1)) * xMax;
    const yVal = d[yKey];
    const y = paddingTop + yMax - ((yVal - minYVal) / (maxYVal - minYVal)) * yMax;
    return { x, y, label: d[xKey], value: yVal };
  });

  const compPoints = comparisonKey ? safeData.map((d, index) => {
    const x = paddingLeft + (index / (safeData.length - 1 || 1)) * xMax;
    const yVal = d[comparisonKey] || 0;
    const y = paddingTop + yMax - ((yVal - minYVal) / (maxYVal - minYVal)) * yMax;
    return { x, y, value: yVal };
  }) : [];

  const pathD = points.reduce((acc, point, index) => {
    return index === 0 ? `M ${point.x} ${point.y}` : `${acc} L ${point.x} ${point.y}`;
  }, '');

  const compPathD = comparisonKey ? compPoints.reduce((acc, point, index) => {
    return index === 0 ? `M ${point.x} ${point.y}` : `${acc} L ${point.x} ${point.y}`;
  }, '') : '';


  // Handle tooltip sizing and positioning
  const handlePointHover = (event, point, index) => {
    setHoveredIdx(index);
    
    // Find container bounding rect to absolute position relative to it
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = point.x;
      const y = point.y;
      setTooltip({
        show: true,
        x,
        y,
        label: point.label,
        value: point.value,
        compValue: point.compValue
      });
    }
  };

  const handlePointLeave = () => {
    setHoveredIdx(null);
    setTooltip(prev => ({ ...prev, show: false }));
  };

  // Generate Y Grid lines
  const gridLines = [];
  const gridTicksCount = 4;
  for (let i = 0; i <= gridTicksCount; i++) {
    const val = minYVal + (i / gridTicksCount) * (maxYVal - minYVal);
    const y = paddingTop + yMax - (i / gridTicksCount) * yMax;
    gridLines.push({ y, val });
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', minHeight: `${height}px` }}>
      <svg viewBox={`0 0 ${width} ${viewHeight}`} style={{ width: '100%', height: '100%', display: 'block' }}>
        {/* Grid lines */}
        {gridLines.map((line, i) => (
          <g key={i}>
            <line
              x1={paddingLeft}
              y1={line.y}
              x2={width - paddingRight}
              y2={line.y}
              className="chart-grid-line"
            />
            <text
              x={paddingLeft - 10}
              y={line.y}
              textAnchor="end"
              dominantBaseline="middle"
              className="chart-text"
            >
              {formatCurrency(line.val)}
            </text>
          </g>
        ))}

        {points.map((pt, i) => {
          // Show every label if small dataset, or skip to avoid cluttering
          const skipLabel = points.length > 8 && i % 2 !== 0 && i !== points.length - 1;
          if (skipLabel) return null;

          const truncateLabel = (label) => typeof label === 'string' && label.length > 12 ? label.substring(0, 10) + '..' : label;

          return (
            <text
              key={i}
              x={pt.x}
              y={viewHeight - paddingBottom + 15}
              textAnchor={points.length > 3 ? 'end' : 'middle'}
              transform={points.length > 3 ? `rotate(-25, ${pt.x}, ${viewHeight - paddingBottom + 15})` : undefined}
              className="chart-text"
              style={{ fontSize: '9px' }}
            >
              {points.length > 3 ? truncateLabel(pt.label) : pt.label}
            </text>
          );
        })}

        {/* Line */}
        <path
          d={pathD}
          stroke="var(--color-sales-gross)"
          className="chart-line"
        />

        {/* Comparison Line */}
        {comparisonKey && (
          <path
            d={compPathD}
            stroke="var(--text-muted)"
            strokeDasharray="4,4"
            className="chart-line"
            style={{ opacity: 0.7 }}
          />
        )}

        {/* Interactive Points */}
        {points.map((pt, i) => (
          <circle
            key={i}
            cx={pt.x}
            cy={pt.y}
            r={hoveredIdx === i ? 6 : 4}
            fill="var(--bg-secondary)"
            stroke="var(--color-sales-gross)"
            strokeWidth={hoveredIdx === i ? 3 : 2}
            className="chart-point"
            onMouseEnter={(e) => handlePointHover(e, pt, i)}
            onMouseLeave={handlePointLeave}
            style={{ transition: 'all 0.15s ease' }}
          />
        ))}

        {/* Comparison Points */}
        {comparisonKey && compPoints.map((pt, i) => (
          <circle
            key={`comp-${i}`}
            cx={pt.x}
            cy={pt.y}
            r={hoveredIdx === i ? 5 : 3}
            fill="var(--bg-secondary)"
            stroke="var(--text-muted)"
            strokeWidth={hoveredIdx === i ? 2.5 : 1.5}
            className="chart-point"
            onMouseEnter={(e) => handlePointHover(e, { ...pt, label: points[i]?.label, value: points[i]?.value, compValue: pt.value }, i)}
            onMouseLeave={handlePointLeave}
            style={{ transition: 'all 0.15s ease' }}
          />
        ))}

        {/* Axis lines */}
        <line
          x1={paddingLeft}
          y1={paddingTop + yMax}
          x2={width - paddingRight}
          y2={paddingTop + yMax}
          className="chart-axis-line"
        />
        <line
          x1={paddingLeft}
          y1={paddingTop}
          x2={paddingLeft}
          y2={paddingTop + yMax}
          className="chart-axis-line"
        />
      </svg>

      {/* Tooltip */}
      {tooltip.show && (
        <div
          className="chart-tooltip"
          style={{
            display: 'block',
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            transform: 'translate(-50%, -100%)',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
            padding: '6px 10px',
            borderRadius: '4px',
            boxShadow: 'var(--shadow-md)',
            position: 'absolute',
            pointerEvents: 'none',
            fontSize: '0.75rem',
            zIndex: 100,
            whiteSpace: 'nowrap'
          }}
        >
          <div style={{ fontWeight: '600' }}>{tooltip.label}</div>
          <div style={{ color: 'var(--color-sales-gross)', fontWeight: '700' }}>
            {comparisonKey ? 'Current: ' : ''}{formatCurrency(tooltip.value)}
          </div>
          {comparisonKey && (
            <div style={{ color: 'var(--text-muted)', fontWeight: '700' }}>
              Compare: {formatCurrency(tooltip.compValue)}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// 3. Vertical Bar Chart Component
export const BarChart = React.memo(function BarChart({ data, xKey = 'label', yKey = 'value', comparisonKey = null, height = 240, barColor = 'var(--color-sales-gross)' }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, label: '', value: 0, compValue: 0 });
  const containerRef = useRef(null);
  const dimensions = useContainerDimensions(containerRef);

  const safeData = useMemo(() => {
    return Array.isArray(data)
      ? data.filter(d => d && d[xKey] && d[yKey] != null)
      : [];
  }, [data, xKey, yKey]);

  if (safeData.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '180px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
        No data available for selected filters
      </div>
    );
  }

  const width = dimensions.width || 800;
  const viewHeight = dimensions.height || height;

  const paddingLeft = 60;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = safeData.length > 3 ? 55 : 40;

  const xMax = Math.max(width - paddingLeft - paddingRight, 10);
  const yMax = Math.max(viewHeight - paddingTop - paddingBottom, 10);

  const yValues = [...safeData.map(d => d[yKey]), ...(comparisonKey ? safeData.map(d => d[comparisonKey]) : [])];
  const maxYVal = Math.max(...yValues, 100) * 1.1; // Add 10% headroom
  const minYVal = 0;

  const barCount = safeData.length;
  const gapFraction = 0.3; // 30% gap between bars
  const totalBarWidth = xMax / barCount;
  const barGap = totalBarWidth * gapFraction;
  const barWidth = totalBarWidth - barGap;

  const truncateLabel = (label) => typeof label === 'string' && label.length > 12 ? label.substring(0, 10) + '..' : label;

  const handleBarHover = (event, item, index, barX, barY) => {
    setHoveredIdx(index);
    setTooltip({
      show: true,
      x: barX + barWidth / 2,
      y: barY - 10,
      label: item[xKey],
      value: item[yKey],
      compValue: comparisonKey ? item[comparisonKey] : 0
    });
  };

  const handleBarLeave = () => {
    setHoveredIdx(null);
    setTooltip(prev => ({ ...prev, show: false }));
  };

  // Generate Y Grid lines
  const gridLines = [];
  const gridTicksCount = 4;
  for (let i = 0; i <= gridTicksCount; i++) {
    const val = minYVal + (i / gridTicksCount) * (maxYVal - minYVal);
    const y = paddingTop + yMax - (i / gridTicksCount) * yMax;
    gridLines.push({ y, val });
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', minHeight: `${height}px` }}>
      <svg viewBox={`0 0 ${width} ${viewHeight}`} style={{ width: '100%', height: '100%', display: 'block' }}>
        {/* Grid lines */}
        {gridLines.map((line, i) => (
          <g key={i}>
            <line
              x1={paddingLeft}
              y1={line.y}
              x2={width - paddingRight}
              y2={line.y}
              className="chart-grid-line"
            />
            <text
              x={paddingLeft - 10}
              y={line.y}
              textAnchor="end"
              dominantBaseline="middle"
              className="chart-text"
            >
              {formatCurrency(line.val)}
            </text>
          </g>
        ))}

        {/* Bars */}
        {safeData.map((item, i) => {
          const val = item[yKey];
          const barHeight = ((val - minYVal) / (maxYVal - minYVal)) * yMax;
          const compVal = comparisonKey ? item[comparisonKey] : 0;
          const compBarHeight = comparisonKey ? ((compVal - minYVal) / (maxYVal - minYVal)) * yMax : 0;

          if (comparisonKey) {
            const halfBarWidth = barWidth / 2 - 1;
            const x1 = paddingLeft + i * totalBarWidth + barGap / 2;
            const x2 = x1 + halfBarWidth + 2;
            const y1 = paddingTop + yMax - barHeight;
            const y2 = paddingTop + yMax - compBarHeight;
            
            return (
              <g key={i}>
                <rect
                  x={x1}
                  y={y1}
                  width={halfBarWidth}
                  height={Math.max(barHeight, 2)}
                  fill={hoveredIdx === i ? 'var(--bg-accent)' : barColor}
                  rx={2}
                  className="chart-bar"
                  onMouseEnter={(e) => handleBarHover(e, item, i, x1, y1)}
                  onMouseLeave={handleBarLeave}
                  style={{ cursor: 'pointer' }}
                />
                <rect
                  x={x2}
                  y={y2}
                  width={halfBarWidth}
                  height={Math.max(compBarHeight, 2)}
                  fill="var(--text-muted)"
                  rx={2}
                  className="chart-bar"
                  onMouseEnter={(e) => handleBarHover(e, item, i, x2, y2)}
                  onMouseLeave={handleBarLeave}
                  style={{ opacity: 0.6, cursor: 'pointer' }}
                />
                 <text
                  x={x1 + barWidth / 2}
                  y={viewHeight - paddingBottom + 15}
                  textAnchor={safeData.length > 3 ? 'end' : 'middle'}
                  transform={safeData.length > 3 ? `rotate(-25, ${x1 + barWidth / 2}, ${viewHeight - paddingBottom + 15})` : undefined}
                  className="chart-text"
                  style={{ fontSize: '9px' }}
                >
                  {safeData.length > 3 ? truncateLabel(item[xKey]) : item[xKey]}
                </text>
              </g>
            );
          }

          const x = paddingLeft + i * totalBarWidth + barGap / 2;
          const y = paddingTop + yMax - barHeight;

          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, 2)} // Minimum height of 2px for visual feedback
                fill={hoveredIdx === i ? 'var(--bg-accent)' : barColor}
                rx={3}
                className="chart-bar"
                onMouseEnter={(e) => handleBarHover(e, item, i, x, y)}
                onMouseLeave={handleBarLeave}
                style={{
                  transition: 'fill var(--transition-fast)',
                  cursor: 'pointer'
                }}
              />
               <text
                x={x + barWidth / 2}
                y={viewHeight - paddingBottom + 15}
                textAnchor={safeData.length > 3 ? 'end' : 'middle'}
                transform={safeData.length > 3 ? `rotate(-25, ${x + barWidth / 2}, ${viewHeight - paddingBottom + 15})` : undefined}
                className="chart-text"
                style={{ fontSize: '9px' }}
              >
                {safeData.length > 3 ? truncateLabel(item[xKey]) : item[xKey]}
              </text>
            </g>
          );
        })}

        {/* Axis lines */}
        <line
          x1={paddingLeft}
          y1={paddingTop + yMax}
          x2={width - paddingRight}
          y2={paddingTop + yMax}
          className="chart-axis-line"
        />
        <line
          x1={paddingLeft}
          y1={paddingTop}
          x2={paddingLeft}
          y2={paddingTop + yMax}
          className="chart-axis-line"
        />
      </svg>

      {/* Tooltip */}
      {tooltip.show && (
        <div
          className="chart-tooltip"
          style={{
            display: 'block',
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            transform: 'translate(-50%, -100%)',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
            padding: '6px 10px',
            borderRadius: '4px',
            boxShadow: 'var(--shadow-md)',
            position: 'absolute',
            pointerEvents: 'none',
            fontSize: '0.75rem',
            zIndex: 100,
            whiteSpace: 'nowrap'
          }}
        >
          <div style={{ fontWeight: '600' }}>{tooltip.label}</div>
          <div style={{ color: 'var(--color-sales-gross)', fontWeight: '700' }}>
            {comparisonKey ? 'Current: ' : ''}{formatCurrency(tooltip.value)}
          </div>
          {comparisonKey && (
            <div style={{ color: 'var(--text-muted)', fontWeight: '700' }}>
              Compare: {formatCurrency(tooltip.compValue)}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// 4. Area Chart Component
export const AreaChart = React.memo(function AreaChart({ data, xKey = 'label', yKey = 'value', comparisonKey = null, height = 240, fillColor = 'var(--color-sales-gross)' }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, label: '', value: 0, compValue: 0 });
  const containerRef = useRef(null);
  const dimensions = useContainerDimensions(containerRef);
  const gradientId = useMemo(() => "areaGradient_" + Math.random().toString(36).substr(2, 9), []);
  const compGradientId = useMemo(() => "compAreaGradient_" + Math.random().toString(36).substr(2, 9), []);

  if (!data || data.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '180px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
        No data available for selected filters
      </div>
    );
  }

  const width = dimensions.width || 800;
  const viewHeight = dimensions.height || height;

  const paddingLeft = 60;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 40;

  const xMax = Math.max(width - paddingLeft - paddingRight, 10);
  const yMax = Math.max(viewHeight - paddingTop - paddingBottom, 10);
  const yValues = [...data.map(d => d[yKey]), ...(comparisonKey ? data.map(d => d[comparisonKey]) : [])];
  const maxYVal = Math.max(...yValues, 1000) * 1.1;
  const minYVal = 0;

  const points = data.map((d, index) => {
    const x = paddingLeft + (index / (data.length - 1 || 1)) * xMax;
    const yVal = d[yKey];
    const y = paddingTop + yMax - ((yVal - minYVal) / (maxYVal - minYVal)) * yMax;
    return { x, y, label: d[xKey], value: yVal };
  });

  const compPoints = comparisonKey ? data.map((d, index) => {
    const x = paddingLeft + (index / (data.length - 1 || 1)) * xMax;
    const yVal = d[comparisonKey] || 0;
    const y = paddingTop + yMax - ((yVal - minYVal) / (maxYVal - minYVal)) * yMax;
    return { x, y, value: yVal };
  }) : [];

  const pathD = points.reduce((acc, point, index) => (index === 0 ? `M ${point.x} ${point.y}` : `${acc} L ${point.x} ${point.y}`), '');
  const areaD = points.length > 0
    ? `${pathD} L ${points[points.length - 1].x} ${paddingTop + yMax} L ${points[0].x} ${paddingTop + yMax} Z`
    : '';

  const compPathD = comparisonKey ? compPoints.reduce((acc, point, index) => (index === 0 ? `M ${point.x} ${point.y}` : `${acc} L ${point.x} ${point.y}`), '') : '';
  const compAreaD = comparisonKey && compPoints.length > 0
    ? `${compPathD} L ${compPoints[compPoints.length - 1].x} ${paddingTop + yMax} L ${compPoints[0].x} ${paddingTop + yMax} Z`
    : '';

  const gridLines = [];
  const gridTicksCount = 4;
  for (let i = 0; i <= gridTicksCount; i++) {
    const val = minYVal + (i / gridTicksCount) * (maxYVal - minYVal);
    const y = paddingTop + yMax - (i / gridTicksCount) * yMax;
    gridLines.push({ y, val });
  }

  const handlePointHover = (event, point, index) => {
    setHoveredIdx(index);
    setTooltip({
      show: true,
      x: point.x,
      y: point.y - 15,
      label: point.label,
      value: point.value,
      compValue: comparisonKey ? data[index][comparisonKey] : undefined
    });
  };

  const handlePointLeave = () => {
    setHoveredIdx(null);
    setTooltip(prev => ({ ...prev, show: false }));
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', minHeight: `${height}px` }}>
      <svg viewBox={`0 0 ${width} ${viewHeight}`} style={{ width: '100%', height: '100%', display: 'block' }}>
        {gridLines.map((line, i) => (
          <g key={i}>
            <line x1={paddingLeft} y1={line.y} x2={width - paddingRight} y2={line.y} className="chart-grid-line" />
            <text x={paddingLeft - 10} y={line.y} textAnchor="end" dominantBaseline="middle" className="chart-text">
              {formatCurrency(line.val)}
            </text>
          </g>
        ))}

        {points.map((pt, i) => {
          const skipLabel = points.length > 8 && i % 2 !== 0 && i !== points.length - 1;
          if (skipLabel) return null;

          return (
            <text
              key={i}
              x={pt.x}
              y={viewHeight - paddingBottom + 20}
              textAnchor="middle"
              className="chart-text"
              style={{ fontSize: '9px' }}
            >
              {pt.label}
            </text>
          );
        })}

        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={fillColor} stopOpacity="0.05" />
          </linearGradient>
          {comparisonKey && (
            <linearGradient id={compGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--text-muted)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="var(--text-muted)" stopOpacity="0.02" />
            </linearGradient>
          )}
        </defs>

        <path d={areaD} fill={`url(#${gradientId})`} className="chart-area" fillOpacity={0.25} style={{ opacity: 1 }} />
        <path d={pathD} stroke={fillColor} className="chart-line" fill="none" />

        {comparisonKey && (
          <>
            <path d={compAreaD} fill={`url(#${compGradientId})`} className="chart-area" fillOpacity={0.2} style={{ opacity: 1 }} />
            <path d={compPathD} stroke="var(--text-muted)" strokeDasharray="3 3" strokeWidth={2} fill="none" />
          </>
        )}

        {points.map((pt, i) => (
          <circle
            key={i}
            cx={pt.x}
            cy={pt.y}
            r={hoveredIdx === i ? 6 : 4}
            fill="var(--bg-secondary)"
            stroke={fillColor}
            strokeWidth={hoveredIdx === i ? 3 : 2}
            className="chart-point"
            onMouseEnter={(e) => handlePointHover(e, pt, i)}
            onMouseLeave={handlePointLeave}
            style={{ transition: 'all 0.15s ease' }}
          />
        ))}

        <line x1={paddingLeft} y1={paddingTop + yMax} x2={width - paddingRight} y2={paddingTop + yMax} className="chart-axis-line" />
        <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={paddingTop + yMax} className="chart-axis-line" />
      </svg>

      {tooltip.show && (
        <div
          className="chart-tooltip"
          style={{
            display: 'block',
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            transform: 'translate(-50%, -100%)',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
            padding: '6px 10px',
            borderRadius: '4px',
            boxShadow: 'var(--shadow-md)',
            position: 'absolute',
            pointerEvents: 'none',
            fontSize: '0.75rem',
            zIndex: 100,
            whiteSpace: 'nowrap'
          }}
        >
          <div style={{ fontWeight: '600' }}>{tooltip.label}</div>
          <div style={{ color: fillColor, fontWeight: '700' }}>
            {comparisonKey ? 'Current: ' : ''}{formatCurrency(tooltip.value)}
          </div>
          {comparisonKey && (
            <div style={{ color: 'var(--text-muted)', fontWeight: '700' }}>
              Compare: {formatCurrency(tooltip.compValue)}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// 5. Heatmap Chart Component
export function HeatmapChart({ data, xKey = 'label', yKey = 'value', comparisonKey = null, height = 240 }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '180px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
        No data available for selected filters
      </div>
    );
  }

  // If comparisonKey is active, we color by variance percentage!
  if (comparisonKey) {
    const items = data.map(item => {
      const primaryVal = item[yKey] || 0;
      const compVal = item[comparisonKey] || 0;
      const diff = primaryVal - compVal;
      const pct = compVal > 0 ? (diff / compVal) * 100 : (primaryVal > 0 ? 100 : 0);
      return { ...item, primaryVal, compVal, diff, pct };
    });

    const maxPct = Math.max(...items.map(d => Math.abs(d.pct)), 1);

    const getCompareHeatColor = (pct) => {
      const ratio = Math.min(Math.abs(pct) / maxPct, 1);
      if (pct < 0) {
        return `rgba(220, 38, 38, ${0.1 + ratio * 0.7})`; // decline (red/orange)
      } else {
        return `rgba(22, 163, 74, ${0.1 + ratio * 0.7})`; // growth (green)
      }
    };

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', minHeight: `${height}px`, alignContent: 'start' }}>
        {items.map((item) => {
          const formattedPct = item.pct > 0 ? `+${item.pct.toFixed(1)}%` : `${item.pct.toFixed(1)}%`;
          const fontColor = Math.abs(item.pct) / maxPct > 0.5 ? 'white' : 'var(--text-primary)';
          return (
            <div
              key={item[xKey]}
              style={{
                backgroundColor: getCompareHeatColor(item.pct),
                color: fontColor,
                borderRadius: '12px',
                padding: '12px 10px',
                minHeight: '84px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.05)',
                border: '1px solid var(--border-color)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: '700' }}>{item[xKey]}</span>
                <span style={{ fontSize: '0.7rem', fontWeight: '700', color: item.pct >= 0 ? 'var(--color-sales-net)' : 'var(--color-returns)' }}>{formattedPct}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.65rem', marginTop: '6px' }}>
                <span>Curr: {formatCurrency(item.primaryVal)}</span>
                <span style={{ opacity: 0.8 }}>Prev: {formatCurrency(item.compVal)}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Non-comparison mode
  const maxValue = Math.max(...data.map(d => d[yKey]), 1);
  const minValue = Math.min(...data.map(d => d[yKey]));
  const range = Math.max(maxValue - minValue, 1);

  const getHeatColor = (value) => {
    const ratio = (value - minValue) / range;
    const start = { r: 226, g: 232, b: 240 };
    const end = { r: 37, g: 99, b: 235 };
    const r = Math.round(start.r + (end.r - start.r) * ratio);
    const g = Math.round(start.g + (end.g - start.g) * ratio);
    const b = Math.round(start.b + (end.b - start.b) * ratio);
    return `rgb(${r}, ${g}, ${b})`;
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: '12px', minHeight: `${height}px`, alignContent: 'start' }}>
      {data.map((item) => (
        <div
          key={item[xKey]}
          style={{
            backgroundColor: getHeatColor(item[yKey]),
            color: item[yKey] > minValue + range * 0.6 ? 'white' : 'var(--text-primary)',
            borderRadius: '12px',
            padding: '14px 10px',
            minHeight: '74px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)'
          }}
        >
          <span style={{ fontSize: '0.75rem', fontWeight: '700', lineHeight: 1.2 }}>{item[xKey]}</span>
          <span style={{ fontSize: '0.75rem', fontWeight: '600', opacity: 0.9 }}>{formatCurrency(item[yKey])}</span>
        </div>
      ))}
    </div>
  );
}

// 6. Waterfall Chart Component
export function WaterfallChart({ data, xKey = 'label', yKey = 'value', comparisonKey = null, height = 240, accentColor = 'var(--color-sales-gross)' }) {
  const containerRef = useRef(null);
  const dimensions = useContainerDimensions(containerRef);

  if (!data || data.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '180px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
        No data available for selected filters
      </div>
    );
  }

  // Calculate items and values (variance if comparison mode is active)
  const items = data.map(item => {
    const val = item[yKey] || 0;
    const compVal = comparisonKey ? (item[comparisonKey] || 0) : null;
    const value = comparisonKey ? (val - compVal) : val;
    return { ...item, value, originalVal: val, compVal };
  });

  const width = dimensions.width || 800;
  const viewHeight = dimensions.height || height;

  const paddingLeft = 60;
  const paddingRight = 24;
  const paddingTop = 24;
  const paddingBottom = 44;
  const xMax = Math.max(width - paddingLeft - paddingRight, 10);
  const yMax = Math.max(viewHeight - paddingTop - paddingBottom, 10);

  const values = items.map(item => item.value);
  const total = values.reduce((sum, value) => sum + value, 0);

  let cumulative = 0;
  const bounds = [0, total];
  items.forEach(item => {
    cumulative += item.value;
    bounds.push(cumulative);
  });
  const maxBound = Math.max(...bounds, 1000) * 1.15;
  const minBound = Math.min(...bounds, 0) * 1.15;
  const valueRange = Math.max(maxBound - minBound, 1);

  const barCount = items.length + 1; // +1 for Net Diff / Total bar
  const totalBarWidth = xMax / barCount;
  const barWidth = totalBarWidth * 0.64;

  cumulative = 0;
  const bars = items.map((item, index) => {
    const value = item.value;
    const start = cumulative;
    cumulative += value;
    return {
      label: item[xKey],
      value,
      start,
      end: cumulative,
      x: paddingLeft + index * totalBarWidth + (totalBarWidth - barWidth) / 2
    };
  });

  // Add the final Total / Net Diff bar
  bars.push({
    label: comparisonKey ? 'Net Diff' : 'Total',
    value: total,
    start: 0,
    end: total,
    x: paddingLeft + items.length * totalBarWidth + (totalBarWidth - barWidth) / 2
  });

  const scaleY = (value) => paddingTop + yMax - ((value - minBound) / valueRange) * yMax;

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', minHeight: `${height}px` }}>
      <svg viewBox={`0 0 ${width} ${viewHeight}`} style={{ width: '100%', height: '100%', display: 'block' }}>
        <line x1={paddingLeft} y1={scaleY(0)} x2={width - paddingRight} y2={scaleY(0)} className="chart-grid-line" style={{ strokeDasharray: '3 3', opacity: 0.6 }} />
        <line x1={paddingLeft} y1={paddingTop + yMax} x2={width - paddingRight} y2={paddingTop + yMax} className="chart-axis-line" />
        <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={paddingTop + yMax} className="chart-axis-line" />

        {bars.map((bar, index) => {
          const y1 = scaleY(bar.start);
          const y2 = scaleY(bar.end);
          const barHeight = Math.max(Math.abs(y2 - y1), 2);
          const y = Math.min(y1, y2);
          
          let fill = 'var(--color-sales-net)'; // default green for increase
          if (index === bars.length - 1) {
            fill = accentColor; // total bar color
          } else if (bar.value < 0) {
            fill = 'var(--color-returns)'; // red for decrease
          }

          return (
            <g key={bar.label}>
              <rect
                x={bar.x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={4}
                fill={fill}
                opacity={index === bars.length - 1 ? 1 : 0.88}
              />
              <text x={bar.x + barWidth / 2} y={viewHeight - paddingBottom + 18} textAnchor="middle" className="chart-text" style={{ fontSize: '9px' }}>
                {bar.label}
              </text>
              <text x={bar.x + barWidth / 2} y={y - 6} textAnchor="middle" className="chart-text" style={{ fontSize: '9px', fontWeight: '600' }}>
                {formatCurrency(bar.end)}
              </text>
              {index < bars.length - 1 && (
                <line
                  x1={bar.x + barWidth}
                  y1={scaleY(bar.end)}
                  x2={bar.x + totalBarWidth}
                  y2={scaleY(bar.end)}
                  stroke="var(--border-color)"
                  strokeDasharray="4 3"
                  strokeWidth="1.2"
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// 7. Treemap Chart Component
export function TreemapChart({ data, height = 240 }) {
  if (!data || data.length === 0) {
    return <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>No division data for selected filters</div>;
  }

  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  const colors = ['var(--color-sales-gross)', 'var(--color-sales-net)', '#0f766e', '#f59e0b'];

  let offsetX = 0;
  const rects = data.map((item, index) => {
    const widthPct = item.value / total;
    const rect = {
      x: offsetX,
      width: widthPct,
      color: colors[index % colors.length]
    };
    offsetX += widthPct;
    return rect;
  });

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', gap: '10px', minHeight: `${height}px`, flex: 1, overflow: 'hidden', boxSizing: 'border-box', flexWrap: 'wrap' }}>
      {data.map((item, index) => {
        const rect = rects[index];
        const sharePct = (item.value / total) * 100;
        return (
          <div
            key={item.label}
            style={{
              flex: `${sharePct} ${sharePct} 130px`,
              background: rect.color,
              borderRadius: '14px',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              color: 'white',
              minWidth: '130px',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)'
            }}
          >
            <span style={{ fontSize: '0.8rem', fontWeight: '700' }}>{item.label}</span>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: '700' }}>{formatCurrency(item.value)}</div>
              <div style={{ fontSize: '0.72rem', opacity: 0.9 }}>{((item.value / total) * 100).toFixed(1)}%</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 8. Sunburst Chart Component
export function SunburstChart({ data, height = 240 }) {
  if (!data || data.length === 0) {
    return <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>No division data for selected filters</div>;
  }

  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  const radius = 72;
  const strokeWidth = 24;
  const circumference = 2 * Math.PI * radius;
  const center = 100;
  const colors = ['var(--color-sales-gross)', 'var(--color-sales-net)', '#0f766e', '#f59e0b'];

  let currentOffset = 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', gap: '16px', flexWrap: 'wrap' }}>
      <svg viewBox="0 0 200 200" style={{ width: '140px', height: '140px', display: 'block' }}>
        <circle cx={center} cy={center} r={radius} fill="transparent" stroke="var(--bg-tertiary)" strokeWidth={strokeWidth} />
        {data.map((item, index) => {
          const value = item.value || 0;
          const length = (value / total) * circumference;
          const strokeOffset = circumference - currentOffset;
          currentOffset += length;

          return (
            <circle
              key={item.label}
              cx={center}
              cy={center}
              r={radius}
              fill="transparent"
              stroke={colors[index % colors.length]}
              strokeWidth={strokeWidth}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={strokeOffset}
              transform={`rotate(-90 ${center} ${center})`}
            />
          );
        })}
        <circle cx={center} cy={center} r={radius - strokeWidth - 4} fill="var(--bg-card)" />
        <text x={center} y={center - 4} textAnchor="middle" dominantBaseline="middle" style={{ fill: 'var(--text-secondary)', fontSize: '11px', fontFamily: 'var(--font-heading)', fontWeight: 600 }}>Total</text>
        <text x={center} y={center + 14} textAnchor="middle" dominantBaseline="middle" style={{ fill: 'var(--text-primary)', fontSize: '14px', fontFamily: 'var(--font-heading)', fontWeight: 700 }}>{formatCurrency(total)}</text>
      </svg>

      <div style={{ display: 'grid', gap: '10px', minWidth: '180px' }}>
        {data.map((item, index) => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.8rem' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '999px', backgroundColor: colors[index % colors.length], flexShrink: 0 }} />
            <span style={{ color: 'var(--text-primary)', fontWeight: 600, flex: 1 }}>{item.label}</span>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{((item.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
