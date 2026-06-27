import React, { useState } from 'react';
import { DonutChart, LineChart, BarChart, AreaChart, HeatmapChart, WaterfallChart, TreemapChart, SunburstChart, formatCurrency } from './CustomCharts';

export default function SalesPerformance({ filteredData }) {
  const [activeDiv, setActiveDiv] = useState('VG'); // 'VG' or 'FC'
  const [chartType, setChartType] = useState('line'); // 'line' or 'bar'
  const [channelView, setChannelView] = useState('donut');

  const trendModes = [
    { key: 'line', label: 'Line' },
    { key: 'bar', label: 'Bar' },
    { key: 'area', label: 'Area' },
    { key: 'heatmap', label: 'Heatmap' },
    { key: 'waterfall', label: 'Waterfall' }
  ];

  const channelModes = [
    { key: 'donut', label: 'Donut' },
    { key: 'treemap', label: 'Treemap' },
    { key: 'sunburst', label: 'Sunburst' }
  ];

  // Filter data by active division
  const divData = filteredData.filter(item => item.division === activeDiv);

  // Group by channel
  const channelMap = { Dealer: 0, Distributor: 0, Direct: 0 };
  divData.forEach(item => {
    if (item.billingType === 'F2') {
      channelMap[item.distributionChannel] = (channelMap[item.distributionChannel] || 0) + item.salesAmountINR;
    }
  });

  const channelChartData = Object.keys(channelMap).map(ch => ({
    label: ch,
    value: channelMap[ch]
  }));

  // Group by season (FC only)
  const seasonMap = { Kharif: 0, Rabi: 0, Summer: 0 };
  divData.forEach(item => {
    if (item.billingType === 'F2' && item.seasonCode !== 'N/A') {
      seasonMap[item.seasonCode] = (seasonMap[item.seasonCode] || 0) + item.salesAmountINR;
    }
  });

  const seasonChartData = Object.keys(seasonMap).map(se => ({
    label: se,
    value: seasonMap[se]
  }));

  // Group by month
  const monthlyMap = {};
  divData.forEach(item => {
    if (item.billingType !== 'F2') return;
    const d = new Date(item.date);
    const key = item.date.substring(0, 7);
    const label = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
    if (!monthlyMap[key]) {
      monthlyMap[key] = { sortKey: key, label, value: 0 };
    }
    monthlyMap[key].value += item.salesAmountINR;
  });
  const trendData = Object.keys(monthlyMap)
    .sort()
    .map(k => monthlyMap[k]);

  // Aggregated KPIs for Division
  let grossSales = 0;
  let netSales = 0;
  let returns = 0;
  let cancelled = 0;

  divData.forEach(item => {
    if (item.billingType === 'F2') {
      grossSales += item.salesAmountINR;
    } else if (item.billingType === 'RE') {
      returns += item.salesAmountINR;
    } else if (item.billingType === 'S1') {
      cancelled += item.salesAmountINR;
    }
  });
  netSales = grossSales - returns - cancelled;

  return (
    <div className="page-container">
      {/* Division Tab Toggle */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', gap: '16px' }}>
        <button
          className={`menu-item ${activeDiv === 'VG' ? 'active' : ''}`}
          style={{ paddingBottom: '12px', borderBottom: activeDiv === 'VG' ? '2px solid var(--text-primary)' : 'none', borderRadius: 0 }}
          onClick={() => setActiveDiv('VG')}
        >
          Vegetable Division (VG)
        </button>
        <button
          className={`menu-item ${activeDiv === 'FC' ? 'active' : ''}`}
          style={{ paddingBottom: '12px', borderBottom: activeDiv === 'FC' ? '2px solid var(--text-primary)' : 'none', borderRadius: 0 }}
          onClick={() => setActiveDiv('FC')}
        >
          Field Crops Division (FC)
        </button>
      </div>

      {/* KPI stats for active division */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-title">Gross Division Revenue</span>
          <span className="kpi-value">{formatCurrency(grossSales)}</span>
          <span className="kpi-subtitle">Standard Invoices (F2)</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-title">Division Returns</span>
          <span className="kpi-value" style={{ color: 'var(--color-returns)' }}>{formatCurrency(returns)}</span>
          <span className="kpi-subtitle">Return Invoices (RE)</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-title">Net Division Sales</span>
          <span className="kpi-value" style={{ color: 'var(--color-sales-net)' }}>{formatCurrency(netSales)}</span>
          <span className="kpi-subtitle">Gross - Returns - Cancelled</span>
        </div>
      </section>

      {/* Charts section */}
      <section className="dashboard-grid">
        {/* Sales Trend Line */}
        <div id="monthly-trend" className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Monthly Revenue Trend</h3>
              <p className="card-subtitle">Gross sales trend for {activeDiv === 'VG' ? 'Vegetables' : 'Field Crops'}</p>
            </div>
            
            {/* Toggle Graph type */}
            <div style={{ 
              display: 'flex', 
              gap: '6px', 
              backgroundColor: 'var(--bg-tertiary)', 
              padding: '4px', 
              borderRadius: '999px', 
              border: '1px solid var(--border-color)' 
            }}>
              {trendModes.map((mode) => (
                <button 
                  key={mode.key}
                  style={{ 
                    padding: '4px 12px', 
                    fontSize: '0.75rem',
                    backgroundColor: chartType === mode.key ? 'var(--text-primary)' : 'transparent',
                    color: chartType === mode.key ? 'var(--bg-primary)' : 'var(--text-secondary)',
                    border: 'none',
                    borderRadius: '999px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)'
                  }}
                  onClick={() => setChartType(mode.key)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          <div className="chart-container">
            {chartType === 'line' && <LineChart data={trendData} />}
            {chartType === 'bar' && <BarChart data={trendData} barColor="var(--color-sales-gross)" />}
            {chartType === 'area' && <AreaChart data={trendData} fillColor="var(--color-sales-gross)" />}
            {chartType === 'heatmap' && <HeatmapChart data={trendData} />}
            {chartType === 'waterfall' && <WaterfallChart data={trendData} />}
          </div>
        </div>

        {/* Channel Contribution */}
        <div id="distribution-channels" className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Distribution Channels</h3>
              <p className="card-subtitle">Revenue contribution split</p>
            </div>
            
            {/* Toggle Graph type */}
            <div style={{ 
              display: 'flex', 
              gap: '6px', 
              backgroundColor: 'var(--bg-tertiary)', 
              padding: '4px', 
              borderRadius: '999px', 
              border: '1px solid var(--border-color)' 
            }}>
              {channelModes.map((mode) => (
                <button 
                  key={mode.key}
                  style={{ 
                    padding: '4px 12px', 
                    fontSize: '0.75rem',
                    backgroundColor: channelView === mode.key ? 'var(--text-primary)' : 'transparent',
                    color: channelView === mode.key ? 'var(--bg-primary)' : 'var(--text-secondary)',
                    border: 'none',
                    borderRadius: '999px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)'
                  }}
                  onClick={() => setChannelView(mode.key)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ height: '240px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            {channelView === 'donut' && <DonutChart data={channelChartData} />}
            {channelView === 'treemap' && <TreemapChart data={channelChartData} height={240} />}
            {channelView === 'sunburst' && <SunburstChart data={channelChartData} height={240} />}
          </div>
        </div>
      </section>

      {/* Season Code Breakdown - Only visible for FC (Field Crops) */}
      {activeDiv === 'FC' && (
        <section className="dashboard-grid">
          <div id="season-contribution" className="card" style={{ gridColumn: 'span 2' }}>
            <div className="card-header">
              <div>
                <h3 className="card-title">Season-wise Sales Contribution</h3>
                <p className="card-subtitle">Field Crops Division seasonal performance (Kharif, Rabi, Summer)</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              {seasonChartData.map((item, idx) => {
                const colors = ['var(--color-sales-gross)', 'var(--color-sales-net)', 'var(--color-cancelled)'];
                return (
                  <div
                    key={item.label}
                    className="kpi-card"
                    style={{
                      flex: '1 1 200px',
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="legend-color" style={{ backgroundColor: colors[idx % colors.length] }} />
                      <span className="kpi-title">{item.label} Season</span>
                    </div>
                    <span className="kpi-value" style={{ fontSize: '1.5rem', color: colors[idx % colors.length] }}>
                      {formatCurrency(item.value)}
                    </span>
                    <span className="kpi-subtitle">
                      {grossSales > 0 ? ((item.value / grossSales) * 100).toFixed(1) : 0}% of gross division sales
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
