import React, { useState } from 'react';
import { DonutChart, LineChart, BarChart, AreaChart, HeatmapChart, WaterfallChart, TreemapChart, SunburstChart, formatCurrency } from './CustomCharts';

export default function ReturnsAnalysis({ filteredData, chartPreferences = {}, setChartPreferences = () => {} }) {
  const [chartType, setChartType] = useState('line'); // 'line' or 'bar'

  const activeReturnsChart = chartPreferences['returns-pattern'] || chartType;
  const activeChannelReturnsChart = chartPreferences['returns-by-channel'] || 'donut';

  // Aggregate Gross Sales and Returns
  let grossSales = 0;
  let returnsValue = 0;

  filteredData.forEach(item => {
    const bt = (item.billingType || '').toUpperCase();
    if (bt === 'F2' || bt === 'ZF2' || bt === 'ZIF2') {
      grossSales += Math.abs(item.salesAmountINR || 0);
    } else if (bt === 'RE' || bt === 'ZRE' || bt === 'ZIRE') {
      returnsValue += Math.abs(item.salesAmountINR || 0);
    }
  });

  const returnsPercentage = grossSales > 0 ? ((returnsValue / grossSales) * 100).toFixed(2) : '0.00';

  // 1. Group Returns by Month for LineChart
  const monthlyMap = {};
  filteredData.forEach(item => {
    const bt = (item.billingType || '').toUpperCase();
    if (bt !== 'RE' && bt !== 'ZRE' && bt !== 'ZIRE') return;
    const d = new Date(item.date);
    const key = item.date.substring(0, 7);
    const label = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
    if (!monthlyMap[key]) {
      monthlyMap[key] = { sortKey: key, label, value: 0 };
    }
    monthlyMap[key].value += Math.abs(item.salesAmountINR || 0);
  });
  const returnsTrendData = Object.keys(monthlyMap)
    .sort()
    .map(k => monthlyMap[k]);

  // 2. Returns by State (with State's Return Rate)
  const stateGrossMap = {};
  const stateReturnsMap = {};
  filteredData.forEach(item => {
    const bt = (item.billingType || '').toUpperCase();
    if (bt === 'F2' || bt === 'ZF2' || bt === 'ZIF2') {
      stateGrossMap[item.state] = (stateGrossMap[item.state] || 0) + Math.abs(item.salesAmountINR || 0);
    } else if (bt === 'RE' || bt === 'ZRE' || bt === 'ZIRE') {
      stateReturnsMap[item.state] = (stateReturnsMap[item.state] || 0) + Math.abs(item.salesAmountINR || 0);
    }
  });

  const stateReturnsList = Object.keys(stateReturnsMap).map(st => {
    const gross = stateGrossMap[st] || 0;
    const returns = stateReturnsMap[st] || 0;
    const rate = gross > 0 ? ((returns / gross) * 100).toFixed(1) : '0.0';
    return { name: st, returns, rate };
  }).sort((a, b) => b.returns - a.returns);

  const maxStateReturns = stateReturnsList.length > 0 ? Math.max(...stateReturnsList.map(s => s.returns)) : 1;

  // 3. Returns by Crop
  const cropReturnsMap = {};
  filteredData.forEach(item => {
    const bt = (item.billingType || '').toUpperCase();
    if (bt !== 'RE' && bt !== 'ZRE' && bt !== 'ZIRE') return;
    cropReturnsMap[item.crop] = (cropReturnsMap[item.crop] || 0) + Math.abs(item.salesAmountINR || 0);
  });

  const cropReturnsList = Object.keys(cropReturnsMap).map(cr => ({
    name: cr,
    value: cropReturnsMap[cr]
  })).sort((a, b) => b.value - a.value);

  // 4. Returns by Channel
  const channelReturnsMap = {};
  filteredData.forEach(item => {
    const bt = (item.billingType || '').toUpperCase();
    if (bt === 'RE' || bt === 'ZRE' || bt === 'ZIRE') {
      const channelKey = item.distributionChannel || item.dist_channel || 'Unknown';
      channelReturnsMap[channelKey] = (channelReturnsMap[channelKey] || 0) + Math.abs(item.salesAmountINR || 0);
    }
  });
  const channelReturnsData = Object.keys(channelReturnsMap).map(ch => ({
    label: ch,
    value: channelReturnsMap[ch]
  }));

  return (
    <div className="page-container">
      {/* Cards stats */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-title">Gross Sales Reference</span>
          <span className="kpi-value">{formatCurrency(grossSales)}</span>
          <span className="kpi-subtitle">F2 invoices only</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-title">Total Returns Value</span>
          <span className="kpi-value" style={{ color: 'var(--color-returns)' }}>{formatCurrency(returnsValue)}</span>
          <span className="kpi-subtitle">RE returned billing</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-title">Return Rate</span>
          <span className="kpi-value" style={{ color: 'var(--color-returns)' }}>{returnsPercentage}%</span>
          <span className="kpi-subtitle">Returns / gross sales ratio</span>
        </div>
      </section>

      {/* Trends & Channels */}
      <section className="dashboard-grid">
        {/* Returns Trend Line */}
        <div id="returns-pattern" className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Returns Pattern (Date)</h3>
              <p className="card-subtitle">Monthly return value timeline</p>
            </div>
            
            {/* Toggle Graph type */}
            <div style={{ display: 'flex', gap: '4px' }}>
              <button 
                className="btn-page" 
                style={{ 
                  padding: '4px 8px', 
                  fontSize: '0.7rem', 
                  backgroundColor: chartType === 'line' ? 'var(--text-primary)' : 'transparent',
                  color: chartType === 'line' ? 'var(--bg-primary)' : 'var(--text-primary)',
                  borderColor: 'var(--border-color)',
                  fontWeight: '600'
                }}
                onClick={() => setChartType('line')}
              >
                Line
              </button>
              <button 
                className="btn-page" 
                style={{ 
                  padding: '4px 8px', 
                  fontSize: '0.7rem',
                  backgroundColor: chartType === 'bar' ? 'var(--text-primary)' : 'transparent',
                  color: chartType === 'bar' ? 'var(--bg-primary)' : 'var(--text-primary)',
                  borderColor: 'var(--border-color)',
                  fontWeight: '600'
                }}
                onClick={() => setChartType('bar')}
              >
                Bar
              </button>
            </div>
          </div>
          <div className="chart-container">
            {returnsTrendData.length > 0 ? (
              <>
                {activeReturnsChart === 'line' && <LineChart data={returnsTrendData} />}
                {activeReturnsChart === 'bar' && <BarChart data={returnsTrendData} barColor="var(--color-returns)" />}
                {activeReturnsChart === 'area' && <AreaChart data={returnsTrendData} fillColor="var(--color-returns)" />}
                {activeReturnsChart === 'heatmap' && <HeatmapChart data={returnsTrendData} />}
                {activeReturnsChart === 'waterfall' && <WaterfallChart data={returnsTrendData} />}
              </>
            ) : (
              <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>No returns in the selected timeframe</div>
            )}
          </div>
        </div>

        {/* Returns by Channel */}
        <div id="returns-by-channel" className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Returns by Distribution Channel</h3>
              <p className="card-subtitle">Return value share by channel</p>
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: '240px' }}>
            {(activeChannelReturnsChart === 'donut' || activeChannelReturnsChart === 'pie') && <DonutChart data={channelReturnsData} />}
            {activeChannelReturnsChart === 'treemap' && <TreemapChart data={channelReturnsData} height={240} />}
            {activeChannelReturnsChart === 'sunburst' && <SunburstChart data={channelReturnsData} height={240} />}
            {activeChannelReturnsChart === 'bar' && <BarChart data={channelReturnsData.map(d => ({ label: d.label, value: d.value }))} height={240} barColor="var(--color-returns)" />}
          </div>
        </div>
      </section>

      <section className="dashboard-grid" style={{ alignItems: 'start' }}>
        {/* Returns by State */}
        <div id="returns-by-state" className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Returns by State</h3>
              <p className="card-subtitle">Shows absolute return values and state-level return rates</p>
            </div>
          </div>
          <div className="ranked-list">
            {stateReturnsList.length > 0 ? (
              stateReturnsList.map(st => (
                <div key={st.name} className="ranked-item">
                  <div className="ranked-info">
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="ranked-label">{st.name}</span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-returns)', fontWeight: '600' }}>Rate: {st.rate}%</span>
                    </div>
                    <div className="ranked-progress-bar" style={{ width: '100%' }}>
                      <div
                        className="ranked-progress-fill"
                        style={{
                          width: `${(st.returns / maxStateReturns) * 100}%`,
                          backgroundColor: 'var(--text-primary)'
                        }}
                      />
                    </div>
                  </div>
                  <span className="ranked-value" style={{ marginLeft: '24px' }}>{formatCurrency(st.returns)}</span>
                </div>
              ))
            ) : (
              <div style={{ color: 'var(--text-secondary)' }}>No state returns match selected filters</div>
            )}
          </div>
        </div>

        {/* Returns by Crop */}
        <div id="returns-by-crop" className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Returns by Crop</h3>
              <p className="card-subtitle">Crops ranked by total returned amount</p>
            </div>
          </div>
          <div className="ranked-list">
            {cropReturnsList.length > 0 ? (
              cropReturnsList.map((cr, idx) => {
                const maxCropReturns = Math.max(...cropReturnsList.map(c => c.value));
                return (
                  <div key={cr.name} className="ranked-item">
                    <div className="ranked-info">
                      <span className="ranked-label">{cr.name}</span>
                      <div className="ranked-progress-bar" style={{ width: '90%' }}>
                        <div
                          className="ranked-progress-fill"
                          style={{
                            width: `${(cr.value / maxCropReturns) * 100}%`,
                            backgroundColor: 'var(--text-primary)'
                          }}
                        />
                      </div>
                    </div>
                    <span className="ranked-value">{formatCurrency(cr.value)}</span>
                  </div>
                );
              })
            ) : (
              <div style={{ color: 'var(--text-secondary)' }}>No crop returns match selected filters</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
