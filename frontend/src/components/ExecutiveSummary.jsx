import React, { useState } from 'react';
import { DonutChart, LineChart, BarChart, AreaChart, HeatmapChart, WaterfallChart, TreemapChart, SunburstChart, formatCurrency } from './CustomCharts';

const trendModes = [
  { key: 'line', label: 'Line' },
  { key: 'bar', label: 'Bar' },
  { key: 'area', label: 'Area' },
  { key: 'heatmap', label: 'Heatmap' },
  { key: 'waterfall', label: 'Waterfall' }
];

const divisionModes = [
  { key: 'donut', label: 'Donut' },
  { key: 'bar', label: 'Bar' },
  { key: 'treemap', label: 'Treemap' },
  { key: 'sunburst', label: 'Sunburst' }
];

function ExecutiveSummary({ 
  filteredData, 
  kpis, 
  setActiveTab, 
  chartPreferences = {}, 
  setChartPreferences = () => {},
  analyticsContext,
  comparisonMetrics
}) {
  const [chartType, setChartType] = useState('line'); // 'line' or 'bar'
  const [divisionView, setDivisionView] = useState('donut');

  const activeSalesChart = chartPreferences['sales-overview'] || chartType;
  const activeDivisionView = chartPreferences['division-contribution'] || divisionView;
  const [returnsChartType, setReturnsChartType] = useState('bar');
  const [statesLimit, setStatesLimit] = useState(5);
  const [cropsLimit, setCropsLimit] = useState(5);
  const [dealersLimit, setDealersLimit] = useState(5);
  const [expandedPanels, setExpandedPanels] = useState({
    states: false,
    crops: false,
    dealers: false,
    salesByState: false,
    returns: false,
    recommendations: false
  });

  const renderGrowthBadge = (growthValue) => {
    if (growthValue === undefined) return null;
    // null = comparison data unavailable → show N/A in neutral grey
    if (growthValue === null) {
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '0.7rem',
          fontWeight: '700',
          backgroundColor: 'rgba(120,120,120,0.12)',
          color: 'var(--text-secondary)',
          marginLeft: '8px'
        }}>
          N/A
        </span>
      );
    }
    const isPositive = parseFloat(growthValue) >= 0;
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '0.7rem',
        fontWeight: '700',
        backgroundColor: isPositive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
        color: isPositive ? '#10b981' : '#ef4444',
        marginLeft: '8px'
      }}>
        {isPositive ? '↑' : '↓'} {Math.abs(parseFloat(growthValue))}%
      </span>
    );
  };

  // 1. Monthly sales trend calculations
  const monthlyMap = {};
  filteredData.forEach(item => {
    const bt = (item.billingType || '').toUpperCase();
    if (bt !== 'F2' && bt !== 'ZF2' && bt !== 'ZIF2') return; // Only count standard sales invoices
    const d = new Date(item.date);
    const key = item.date.substring(0, 7); // 'YYYY-MM'
    const label = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
    if (!monthlyMap[key]) {
      monthlyMap[key] = { sortKey: key, label, value: 0 };
    }
    monthlyMap[key].value += item.salesAmountINR;
  });

  const trendData = Object.keys(monthlyMap)
    .sort()
    .map(k => monthlyMap[k]);

  const chartData = (comparisonMetrics && comparisonMetrics.series) ? comparisonMetrics.series : trendData;
  const compKey = (comparisonMetrics && comparisonMetrics.series) ? 'comparisonValue' : null;
  const mainValKey = (comparisonMetrics && comparisonMetrics.series) ? 'primaryValue' : 'value';

  // 2. State performance calculations (ranked by Net External Sales)
  const stateMap = {};
  filteredData.forEach(item => {
    const bt = (item.billingType || '').toUpperCase();
    const isGross = bt === 'F2' || bt === 'ZF2' || bt === 'ZIF2';
    const isDeduction = bt === 'RE' || bt === 'ZRE' || bt === 'ZIRE' || bt === 'S1' || bt === 'ZS1';
    
    if (isGross) {
      stateMap[item.state] = (stateMap[item.state] || 0) + Math.abs(item.salesAmountINR || 0);
    } else if (isDeduction) {
      stateMap[item.state] = (stateMap[item.state] || 0) - Math.abs(item.salesAmountINR || 0);
    }
  });
  const rankedStates = Object.keys(stateMap)
    .map(st => ({ label: st, value: stateMap[st] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);



  // 4. Division split for Donut Chart
  const divMap = {};
  filteredData.forEach(item => {
    const bt = (item.billingType || '').toUpperCase();
    if (bt === 'F2' || bt === 'ZF2' || bt === 'ZIF2') {
      divMap[item.division] = (divMap[item.division] || 0) + item.salesAmountINR;
    }
  });
  const divisionData = Object.keys(divMap).map(key => ({
    label: key === 'VG' ? 'Vegetables (VG)' : key === 'FC' ? 'Field Crops (FC)' : key,
    value: divMap[key]
  }));

  // Calculate division totals for dynamic state contribution calculations
  const divTotalVG = divMap.VG || 0;
  const divTotalFC = divMap.FC || 0;

  const getStatePrimaryDivisionTotal = (stateName) => {
    let vgSales = 0;
    let fcSales = 0;
    filteredData.forEach(item => {
      const bt = (item.billingType || '').toUpperCase();
      if (item.state === stateName && (bt === 'F2' || bt === 'ZF2' || bt === 'ZIF2')) {
        if (item.division === 'VG') vgSales += item.salesAmountINR;
        if (item.division === 'FC') fcSales += item.salesAmountINR;
      }
    });
    // Return division total and a color class/accent
    if (vgSales >= fcSales) {
      return { total: divTotalVG, color: 'var(--color-sales-gross)', iconColor: '#2563eb' };
    } else {
      return { total: divTotalFC, color: 'var(--color-sales-net)', iconColor: '#10b981' };
    }
  };

  // Division calculations for Crops list
  const totalNetSales = kpis.netExternalSales;
  let vgNet = 0;
  let fcNet = 0;
  filteredData.forEach(item => {
    const bt = (item.billingType || '').toUpperCase();
    const isGross = bt === 'F2' || bt === 'ZF2' || bt === 'ZIF2';
    const isDeduction = bt === 'RE' || bt === 'ZRE' || bt === 'ZIRE' || bt === 'S1' || bt === 'ZS1';
    
    if (item.division === 'VG') {
      if (isGross) vgNet += Math.abs(item.salesAmountINR || 0);
      else if (isDeduction) vgNet -= Math.abs(item.salesAmountINR || 0);
    }
    if (item.division === 'FC') {
      if (isGross) fcNet += Math.abs(item.salesAmountINR || 0);
      else if (isDeduction) fcNet -= Math.abs(item.salesAmountINR || 0);
    }
  });

  const vgNetShare = totalNetSales > 0 ? (vgNet / totalNetSales) * 100 : 0;
  const fcNetShare = totalNetSales > 0 ? (fcNet / totalNetSales) * 100 : 0;

  const divisionRankedData = [
    { label: 'Vegetables (VG)', share: vgNetShare, gross: divTotalVG, color: 'var(--color-sales-gross)', icon: 'tomato' },
    { label: 'Field Crops (FC)', share: fcNetShare, gross: divTotalFC, color: 'var(--color-sales-net)', icon: 'leaf' }
  ].sort((a, b) => b.share - a.share);

  const stateGrossMap = {};
  const cropGrossMap = {};
  const dealerGrossMap = {};
  const stateReturnsMap = {};

  filteredData.forEach(item => {
    const bt = (item.billingType || '').toUpperCase();
    if (bt === 'F2' || bt === 'ZF2' || bt === 'ZIF2') {
      stateGrossMap[item.state] = (stateGrossMap[item.state] || 0) + (item.salesAmountINR || 0);
      cropGrossMap[item.crop] = (cropGrossMap[item.crop] || 0) + (item.salesAmountINR || 0);
      dealerGrossMap[item.customerName] = (dealerGrossMap[item.customerName] || 0) + (item.salesAmountINR || 0);
    } else if (bt === 'RE' || bt === 'ZRE' || bt === 'ZIRE') {
      stateReturnsMap[item.state] = (stateReturnsMap[item.state] || 0) + Math.abs(item.salesAmountINR || 0);
    }
  });

  const topStatesBySales = Object.keys(stateGrossMap)
    .map(name => ({ label: name, value: stateGrossMap[name] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const topCropsBySales = Object.keys(cropGrossMap)
    .map(name => ({ label: name, value: cropGrossMap[name] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const topDealersBySales = Object.keys(dealerGrossMap)
    .map(name => ({ label: name, value: dealerGrossMap[name] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const totalGrossSales = Object.values(stateGrossMap).reduce((sum, val) => sum + val, 0);

  const stateHeatmapData = Object.keys(stateGrossMap)
    .map(name => ({ label: name, value: stateGrossMap[name], returns: stateReturnsMap[name] || 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const topReturnStates = Object.keys(stateReturnsMap)
    .map(name => {
      const gross = stateGrossMap[name] || 0;
      const returns = stateReturnsMap[name] || 0;
      return {
        label: name,
        gross,
        returns,
        rate: gross > 0 ? (returns / gross) * 100 : 0
      };
    })
    .sort((a, b) => b.returns - a.returns)
    .slice(0, 4);

  const returnsTrendData = Object.keys(stateReturnsMap)
    .map(name => ({ label: name, value: stateReturnsMap[name] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const topState = topStatesBySales[0];
  const topCrop = topCropsBySales[0];
  const topDealer = topDealersBySales[0];
  const totalRows = filteredData.length;
  const lastUpdated = filteredData.length > 0
    ? filteredData.reduce((latest, item) => (item.date > latest ? item.date : latest), filteredData[0].date)
    : null;

  const recommendationCards = [];
  if (topCrop) {
    recommendationCards.push({
      tone: 'High impact',
      title: `Increase inventory for ${topCrop.label} in ${topState?.label || 'top states'}`,
      detail: 'Highest gross contributor is getting the strongest demand pull.'
    });
  }
  if (topReturnStates[0] && topReturnStates[0].rate >= 10) {
    recommendationCards.push({
      tone: 'Medium impact',
      title: `Investigate high returns in ${topReturnStates[0].label}`,
      detail: `Return rate is ${topReturnStates[0].rate.toFixed(1)}% against gross sales.`
    });
  }
  if (topDealer) {
    recommendationCards.push({
      tone: 'High impact',
      title: `Protect service levels for ${topDealer.label}`,
      detail: 'Largest dealer is driving a meaningful share of revenue.'
    });
  }
  if (recommendationCards.length < 3) {
    recommendationCards.push({
      tone: 'Low impact',
      title: 'Expand mix in underweighted states',
      detail: 'Use the sales-by-state panel to identify weaker regions.'
    });
  }

  const trendModes = [
    { key: 'line', label: 'Line' },
    { key: 'bar', label: 'Bar' },
    { key: 'area', label: 'Area' },
    { key: 'heatmap', label: 'Heatmap' },
    { key: 'waterfall', label: 'Waterfall' }
  ];

  const divisionModes = [
    { key: 'donut', label: 'Donut' },
    { key: 'treemap', label: 'Treemap' },
    { key: 'sunburst', label: 'Sunburst' }
  ];

  const togglePanel = (panelKey) => {
    setExpandedPanels(prev => ({
      ...prev,
      [panelKey]: !prev[panelKey]
    }));
  };

  const expandButtonStyle = (isExpanded) => ({
    width: '28px',
    height: '28px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '999px',
    border: '1px solid var(--border-color)',
    backgroundColor: isExpanded ? 'var(--text-primary)' : 'transparent',
    color: isExpanded ? 'var(--bg-primary)' : 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)'
  });

  const renderExpandButton = (panelKey) => (
    <button
      type="button"
      aria-label={expandedPanels[panelKey] ? 'Collapse details' : 'Expand details'}
      title={expandedPanels[panelKey] ? 'Collapse details' : 'Expand details'}
      style={expandButtonStyle(expandedPanels[panelKey])}
      onClick={() => togglePanel(panelKey)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ width: 14, height: 14, transform: expandedPanels[panelKey] ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition-fast)' }}>
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );

  const renderUtilityButton = (label, iconPath) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      style={{
        width: '28px',
        height: '28px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '999px',
        border: '1px solid var(--border-color)',
        backgroundColor: 'transparent',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        transition: 'all var(--transition-fast)'
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
        <path d={iconPath} />
      </svg>
    </button>
  );

  return (
    <div className="page-container">
      {/* KPI Cards Grid */}
      <section className="kpi-grid">
        <div className="kpi-card gross-sales-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="kpi-title">Gross Invoice Sales</span>
            {comparisonMetrics && renderGrowthBadge(comparisonMetrics.growth?.grossSalesGrowth)}
          </div>
          <span className="kpi-value">{formatCurrency(kpis.grossSales)}</span>
          <span className="kpi-subtitle">Standard invoices (F2)</span>
        </div>
        <div className="kpi-card sales-returns-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="kpi-title">Sales Returns</span>
            {comparisonMetrics && renderGrowthBadge(comparisonMetrics.growth?.returnsGrowth)}
          </div>
          <span className="kpi-value">{formatCurrency(Math.abs(kpis.returnsValue || 0))}</span>
          <span className="kpi-subtitle">RE return transactions</span>
        </div>
        <div className="kpi-card cancelled-invoices-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="kpi-title">Cancelled Invoices</span>
            {comparisonMetrics && renderGrowthBadge(comparisonMetrics.growth?.cancelledGrowth)}
          </div>
          <span className="kpi-value">{formatCurrency(Math.abs(kpis.cancelledValue || 0))}</span>
          <span className="kpi-subtitle">Cancellation billing (S1)</span>
        </div>
        <div className="kpi-card net-sales-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="kpi-title">Net External Sales</span>
            {comparisonMetrics && renderGrowthBadge(comparisonMetrics.growth?.netSalesGrowth)}
          </div>
          <span className="kpi-value">{formatCurrency(kpis.netExternalSales)}</span>
          <span className="kpi-subtitle">Gross - Returns - Cancelled</span>
        </div>
        <div className="kpi-card cogm-card">
          <span className="kpi-title">Cost of Production</span>
          <span className="kpi-value">{formatCurrency(kpis.totalCOGM)}</span>
          <span className="kpi-subtitle">Manufacturing COGM cost</span>
        </div>
      </section>

      {/* Charts / Ranking grid */}
      <section className="dashboard-grid">
        {/* Sales Trend Card */}
        <div id="sales-overview" className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Gross Sales Trend</h3>
              <p className="card-subtitle">Aggregations for selected filters</p>
            </div>
            
            {/* Chart Type Toggle Button Group */}
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
            {activeSalesChart === 'line' && <LineChart data={chartData} yKey={mainValKey} comparisonKey={compKey} />}
            {activeSalesChart === 'bar' && <BarChart data={chartData} yKey={mainValKey} comparisonKey={compKey} barColor="var(--color-sales-gross)" />}
            {activeSalesChart === 'area' && <AreaChart data={chartData} yKey={mainValKey} comparisonKey={compKey} fillColor="var(--color-sales-gross)" />}
            {activeSalesChart === 'heatmap' && <HeatmapChart data={chartData} yKey={mainValKey} comparisonKey={compKey} />}
            {activeSalesChart === 'waterfall' && <WaterfallChart data={chartData} yKey={mainValKey} comparisonKey={compKey} />}
          </div>
        </div>

        {/* Division Split Card */}
        <div id="division-contribution" className="card" style={{ overflow: 'hidden' }}>
          <div className="card-header">
            <div>
              <h3 className="card-title">Division Contribution</h3>
              <p className="card-subtitle">Revenue split by division</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ 
                display: 'flex', 
                gap: '6px', 
                backgroundColor: 'var(--bg-tertiary)', 
                padding: '4px', 
                borderRadius: '999px', 
                border: '1px solid var(--border-color)' 
              }}>
              {divisionModes.map((mode) => (
                <button
                  key={mode.key}
                  style={{
                    padding: '4px 12px',
                    fontSize: '0.75rem',
                    backgroundColor: divisionView === mode.key ? 'var(--text-primary)' : 'transparent',
                    color: divisionView === mode.key ? 'var(--bg-primary)' : 'var(--text-secondary)',
                    border: 'none',
                    borderRadius: '999px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)'
                  }}
                  onClick={() => setDivisionView(mode.key)}
                >
                  {mode.label}
                </button>
              ))}
              </div>
            </div>
          </div>
          <div style={{ height: '240px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            {activeDivisionView === 'donut' && <DonutChart data={divisionData} height={240} />}
            {activeDivisionView === 'pie' && <DonutChart data={divisionData} height={240} />}
            {activeDivisionView === 'treemap' && <TreemapChart data={divisionData} height={240} />}
            {activeDivisionView === 'sunburst' && <SunburstChart data={divisionData} height={240} />}
            {activeDivisionView === 'bar' && <BarChart data={divisionData.map(d => ({ label: d.label, value: d.value }))} height={240} barColor="var(--color-sales-gross)" />}
          </div>
        </div>
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '24px',
          marginTop: '18px'
        }}
      >
        <div id="top-states" className="card" style={{ padding: '16px 20px', gap: '12px' }}>
          <div className="card-header" style={{ borderBottom: 'none', paddingBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <h3 className="card-title" style={{ fontSize: '0.85rem', fontWeight: '700', margin: 0, fontFamily: 'var(--font-heading)' }}>Top States by Sales</h3>
            <div style={{ position: 'relative' }}>
              <select
                value={statesLimit}
                onChange={(e) => setStatesLimit(Number(e.target.value))}
                style={{
                  appearance: 'none',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '3px 20px 3px 6px',
                  fontSize: '0.7rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2357534e' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 6px center',
                  backgroundSize: '9px',
                  outline: 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                <option value={3}>Top 3</option>
                <option value={5}>Top 5</option>
                <option value={10}>Top 10</option>
              </select>
            </div>
          </div>
          <div className="ranked-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {topStatesBySales.slice(0, statesLimit).map((item, index) => {
              const maxValue = topStatesBySales[0]?.value || 1;
              const percentage = totalGrossSales > 0 ? ((item.value / totalGrossSales) * 100).toFixed(1) : '0.0';
              return (
                <div key={item.label} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: '500', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }}>
                      {index + 1}. {item.label}
                    </span>
                    <span style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-primary)', flexShrink: 0 }}>
                      {formatCurrency(item.value)}
                    </span>
                  </div>
                  <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: `${(item.value / maxValue) * 100}%`, height: '100%', backgroundColor: 'var(--color-sales-gross)', borderRadius: '999px' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                    <span>{percentage}%</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 'auto', paddingTop: '6px' }}>
            <span
              onClick={() => setActiveTab && setActiveTab('geography')}
              style={{
                color: 'var(--color-sales-gross)',
                fontSize: '0.75rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'opacity 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.opacity = '0.8'}
              onMouseLeave={(e) => e.target.style.opacity = '1'}
            >
              View All States →
            </span>
          </div>
        </div>

        <div id="top-crops" className="card" style={{ padding: '16px 20px', gap: '12px' }}>
          <div className="card-header" style={{ borderBottom: 'none', paddingBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <h3 className="card-title" style={{ fontSize: '0.85rem', fontWeight: '700', margin: 0, fontFamily: 'var(--font-heading)' }}>Top Crops by Sales</h3>
            <div style={{ position: 'relative' }}>
              <select
                value={cropsLimit}
                onChange={(e) => setCropsLimit(Number(e.target.value))}
                style={{
                  appearance: 'none',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '3px 20px 3px 6px',
                  fontSize: '0.7rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2357534e' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 6px center',
                  backgroundSize: '9px',
                  outline: 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                <option value={3}>Top 3</option>
                <option value={5}>Top 5</option>
                <option value={10}>Top 10</option>
              </select>
            </div>
          </div>
          <div className="ranked-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {topCropsBySales.slice(0, cropsLimit).map((item, index) => {
              const maxValue = topCropsBySales[0]?.value || 1;
              const percentage = totalGrossSales > 0 ? ((item.value / totalGrossSales) * 100).toFixed(1) : '0.0';
              return (
                <div key={item.label} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: '500', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }}>
                      {index + 1}. {item.label}
                    </span>
                    <span style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-primary)', flexShrink: 0 }}>
                      {formatCurrency(item.value)}
                    </span>
                  </div>
                  <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: `${(item.value / maxValue) * 100}%`, height: '100%', backgroundColor: 'var(--color-sales-net)', borderRadius: '999px' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                    <span>{percentage}%</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 'auto', paddingTop: '6px' }}>
            <span
              onClick={() => setActiveTab && setActiveTab('product')}
              style={{
                color: 'var(--color-sales-gross)',
                fontSize: '0.75rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'opacity 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.opacity = '0.8'}
              onMouseLeave={(e) => e.target.style.opacity = '1'}
            >
              View All Crops →
            </span>
          </div>
        </div>

        <div id="top-dealers" className="card" style={{ padding: '16px 20px', gap: '12px' }}>
          <div className="card-header" style={{ borderBottom: 'none', paddingBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <h3 className="card-title" style={{ fontSize: '0.85rem', fontWeight: '700', margin: 0, fontFamily: 'var(--font-heading)' }}>Top Dealers by Sales</h3>
            <div style={{ position: 'relative' }}>
              <select
                value={dealersLimit}
                onChange={(e) => setDealersLimit(Number(e.target.value))}
                style={{
                  appearance: 'none',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '3px 20px 3px 6px',
                  fontSize: '0.7rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2357534e' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 6px center',
                  backgroundSize: '9px',
                  outline: 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                <option value={3}>Top 3</option>
                <option value={5}>Top 5</option>
                <option value={10}>Top 10</option>
              </select>
            </div>
          </div>
          <div className="ranked-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {topDealersBySales.slice(0, dealersLimit).map((item, index) => {
              const maxValue = topDealersBySales[0]?.value || 1;
              const percentage = totalGrossSales > 0 ? ((item.value / totalGrossSales) * 100).toFixed(1) : '0.0';
              return (
                <div key={item.label} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: '500', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }}>
                      {index + 1}. {item.label}
                    </span>
                    <span style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-primary)', flexShrink: 0 }}>
                      {formatCurrency(item.value)}
                    </span>
                  </div>
                  <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: `${(item.value / maxValue) * 100}%`, height: '100%', backgroundColor: 'var(--color-ipt)', borderRadius: '999px' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                    <span>{percentage}%</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 'auto', paddingTop: '6px' }}>
            <span
              onClick={() => setActiveTab && setActiveTab('transactions')}
              style={{
                color: 'var(--color-sales-gross)',
                fontSize: '0.75rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'opacity 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.opacity = '0.8'}
              onMouseLeave={(e) => e.target.style.opacity = '1'}
            >
              View All Dealers →
            </span>
          </div>
        </div>
      </section>

      <section className="dashboard-grid" style={{ gridTemplateColumns: '1.2fr 1fr 1fr', marginTop: '18px' }}>
        <div id="sales-by-state" className="card" style={{ padding: '16px 18px', gap: '12px' }}>
          <div className="card-header">
            <div>
              <h3 className="card-title" style={{ fontSize: '0.8rem', fontWeight: '800' }}>Sales by State</h3>
              <p className="card-subtitle">State-wise revenue intensity</p>
            </div>
            {renderExpandButton('salesByState')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px' }}>
            {(expandedPanels.salesByState ? stateHeatmapData : stateHeatmapData.slice(0, 4)).map(item => {
              const maxValue = stateHeatmapData[0]?.value || 1;
              const intensity = item.value / maxValue;
              return (
                <div key={item.label} style={{ borderRadius: '12px', padding: '10px', background: `linear-gradient(180deg, rgba(37,99,235,${0.08 + intensity * 0.18}), rgba(16,185,129,${0.04 + intensity * 0.08}))`, border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-primary)' }}>{item.label}</div>
                  <div style={{ marginTop: '6px', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>{formatCurrency(item.value)}</div>
                  <div style={{ marginTop: '10px', height: '5px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: `${intensity * 100}%`, height: '100%', backgroundColor: 'var(--color-sales-gross)' }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            <span>{expandedPanels.salesByState ? 'Full state intensity view' : 'Top 4 states shown'}</span>
            <span>Low - High</span>
          </div>
        </div>

        <div id="returns-summary" className="card" style={{ padding: '16px 18px', gap: '12px' }}>
          <div className="card-header">
            <div>
              <h3 className="card-title" style={{ fontSize: '0.8rem', fontWeight: '800' }}>Returns Analysis</h3>
              <p className="card-subtitle">Return concentration by state</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {renderExpandButton('returns')}
              <div style={{ display: 'flex', gap: '4px' }}>
                <button onClick={() => setReturnsChartType('bar')} style={{ padding: '4px 10px', fontSize: '0.72rem', borderRadius: '999px', border: '1px solid var(--border-color)', backgroundColor: returnsChartType === 'bar' ? 'var(--text-primary)' : 'transparent', color: returnsChartType === 'bar' ? 'var(--bg-primary)' : 'var(--text-secondary)', fontWeight: 600 }}>Bar</button>
                <button onClick={() => setReturnsChartType('line')} style={{ padding: '4px 10px', fontSize: '0.72rem', borderRadius: '999px', border: '1px solid var(--border-color)', backgroundColor: returnsChartType === 'line' ? 'var(--text-primary)' : 'transparent', color: returnsChartType === 'line' ? 'var(--bg-primary)' : 'var(--text-secondary)', fontWeight: 600 }}>Line</button>
              </div>
            </div>
          </div>
          <div className="chart-container" style={{ height: expandedPanels.returns ? '280px' : '220px' }}>
            {returnsTrendData.length > 0 ? (
              returnsChartType === 'bar' ? <BarChart data={returnsTrendData} barColor="var(--color-returns)" height={expandedPanels.returns ? 280 : 220} /> : <LineChart data={returnsTrendData} height={expandedPanels.returns ? 280 : 220} />
            ) : (
              <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>No return data for current filters</div>
            )}
          </div>
          <div style={{ display: 'grid', gap: '6px' }}>
            {(expandedPanels.returns ? topReturnStates : topReturnStates.slice(0, 2)).map(item => (
              <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                <span>{item.label}</span>
                <span>{formatCurrency(Math.abs(item.returns))} | {item.rate.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>

        <div id="ai-recommendations" className="card" style={{ padding: '16px 18px', gap: '12px' }}>
          <div className="card-header">
            <div>
              <h3 className="card-title" style={{ fontSize: '0.8rem', fontWeight: '800' }}>AI Recommendations</h3>
              <p className="card-subtitle">Top actions for better performance</p>
            </div>
            {renderExpandButton('recommendations')}
          </div>
          <div style={{ display: 'grid', gap: '10px' }}>
            {(expandedPanels.recommendations ? recommendationCards : recommendationCards.slice(0, 1)).map((item, index) => (
              <div key={`${item.title}-${index}`} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', borderRadius: '12px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                <div style={{ width: 10, height: 10, borderRadius: '999px', backgroundColor: index === 0 ? 'var(--color-sales-gross)' : index === 1 ? 'var(--color-cancelled)' : 'var(--color-sales-net)', marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-primary)' }}>{item.title}</div>
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-sales-gross)', whiteSpace: 'nowrap' }}>{item.tone}</span>
                  </div>
                  <div style={{ marginTop: '4px', fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>{item.detail}</div>
                </div>
              </div>
            ))}
          </div>
          {!expandedPanels.recommendations && recommendationCards.length > 1 && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>+ {recommendationCards.length - 1} more recommendations hidden</div>
          )}
        </div>
      </section>

    </div>
  );
}

export default React.memo(ExecutiveSummary);
