import React, { useState, useEffect } from 'react';
import { DonutChart, LineChart, BarChart, AreaChart, HeatmapChart, WaterfallChart, TreemapChart, SunburstChart, formatCurrency } from './CustomCharts';
import { getMappedChannel } from '../data/dataUtils';

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
  filters,
  setActiveTab,
  chartPreferences = {},
  setChartPreferences = () => { },
  analyticsContext,
  comparisonMetrics
}) {
  const [localSelectedCrop, setLocalSelectedCrop] = useState('');
  const activeSalesChart = 'line';
  const activeDivisionView = 'donut';
  const [returnsChartType, setReturnsChartType] = useState('bar');

  useEffect(() => {
    setLocalSelectedCrop('');
  }, [filteredData]);
  const [statesLimit, setStatesLimit] = useState(5);
  const [cropsLimit, setCropsLimit] = useState(5);
  const [dealersLimit, setDealersLimit] = useState(5);
  const [expandedPanels, setExpandedPanels] = useState({
    states: false,
    crops: false,
    dealers: false,
    channelMix: false,
    returns: false,
    varietyBreakdown: false
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

  const isComparisonMode = analyticsContext.compareMode && analyticsContext.compareMode !== 'none' && analyticsContext.primaryYear && analyticsContext.comparisonYear;

  const divisionData = isComparisonMode && comparisonMetrics?.divisionContribution
    ? comparisonMetrics.divisionContribution.map(d => ({
      ...d,
      label: d.label === 'VG' ? 'Vegetables (VG)' : d.label === 'FC' ? 'Field Crops (FC)' : d.label === 'CM' ? 'Common (CM)' : d.label
    }))
    : Object.keys(divMap).map(key => ({
      label: key === 'VG' ? 'Vegetables (VG)' : key === 'FC' ? 'Field Crops (FC)' : key === 'CM' ? 'Common (CM)' : key,
      value: divMap[key]
    }));

  // Calculate division totals for dynamic state contribution calculations
  const divTotalVG = divMap.VG || 0;
  const divTotalFC = divMap.FC || 0;
  const divTotalCM = divMap.CM || 0;

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
  let cmNet = 0;
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
    if (item.division === 'CM') {
      if (isGross) cmNet += Math.abs(item.salesAmountINR || 0);
      else if (isDeduction) cmNet -= Math.abs(item.salesAmountINR || 0);
    }
  });

  const vgNetShare = totalNetSales > 0 ? (vgNet / totalNetSales) * 100 : 0;
  const fcNetShare = totalNetSales > 0 ? (fcNet / totalNetSales) * 100 : 0;
  const cmNetShare = totalNetSales > 0 ? (cmNet / totalNetSales) * 100 : 0;

  const divisionRankedData = [
    { label: 'Vegetables (VG)', share: vgNetShare, gross: divTotalVG, color: 'var(--color-sales-gross)', icon: 'tomato' },
    { label: 'Field Crops (FC)', share: fcNetShare, gross: divTotalFC, color: 'var(--color-sales-net)', icon: 'leaf' },
    { label: 'Common (CM)', share: cmNetShare, gross: divTotalCM, color: 'var(--color-returns)', icon: 'seedling' }
  ].filter(d => d.gross > 0).sort((a, b) => b.share - a.share);

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

  const topStatesBySales = isComparisonMode && comparisonMetrics?.topStates
    ? comparisonMetrics.topStates
    : Object.keys(stateGrossMap)
      .map(name => ({ label: name, value: stateGrossMap[name] }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

  const topCropsBySales = isComparisonMode && comparisonMetrics?.topCrops
    ? comparisonMetrics.topCrops
    : Object.keys(cropGrossMap)
      .map(name => ({ label: name, value: cropGrossMap[name] }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

  const topDealersBySales = isComparisonMode && comparisonMetrics?.topDealers
    ? comparisonMetrics.topDealers
    : Object.keys(dealerGrossMap)
      .map(name => ({ label: name, value: dealerGrossMap[name] }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

  const totalGrossSales = Object.values(stateGrossMap).reduce((sum, val) => sum + val, 0);

  const stateHeatmapData = isComparisonMode && comparisonMetrics?.topStates
    ? comparisonMetrics.topStates
    : Object.keys(stateGrossMap)
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

  const returnsTrendData = isComparisonMode && comparisonMetrics?.returnsByState
    ? comparisonMetrics.returnsByState
    : Object.keys(stateReturnsMap)
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

  // 1. Distribution Channel Mix Calculations
  const channelSalesMap = {
    'Dealer & Distributor': 0,
    'Institutional Sales': 0,
    'Government Sales': 0,
    'Export': 0
  };

  filteredData.forEach(item => {
    const bt = (item.billingType || '').toUpperCase();
    if (bt === 'F2' || bt === 'ZF2' || bt === 'ZIF2') {
      const mapped = getMappedChannel(item.distributionChannel);
      if (channelSalesMap[mapped] !== undefined) {
        channelSalesMap[mapped] += item.salesAmountINR || 0;
      } else {
        channelSalesMap['Dealer & Distributor'] += item.salesAmountINR || 0;
      }
    }
  });

  const totalChannelSales = Object.values(channelSalesMap).reduce((sum, val) => sum + val, 0);

  const channelMix = Object.keys(channelSalesMap).map(name => ({
    name,
    value: channelSalesMap[name],
    percentage: totalChannelSales > 0 ? (channelSalesMap[name] / totalChannelSales) * 100 : 0
  })).sort((a, b) => b.value - a.value);

  // 2. Variety under Crop Breakdown Calculations
  const selectedCrop = (filters && filters.crop) || localSelectedCrop || topCrop?.label || '';
  
  const cropInvoices = filteredData.filter(item => {
    const bt = (item.billingType || '').toUpperCase();
    return item.crop === selectedCrop && (bt === 'F2' || bt === 'ZF2' || bt === 'ZIF2');
  });

  const varietyMap = {};
  cropInvoices.forEach(item => {
    varietyMap[item.variety] = (varietyMap[item.variety] || 0) + item.salesAmountINR;
  });

  const totalCropSales = Object.values(varietyMap).reduce((sum, val) => sum + val, 0);

  const varieties = Object.keys(varietyMap).map(v => ({
    name: v,
    value: varietyMap[v]
  })).sort((a, b) => b.value - a.value);

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
        <div id="gross-sales-card" className="kpi-card gross-sales-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="kpi-title">Gross Invoice Sales</span>
            {comparisonMetrics && analyticsContext.compareMode !== 'none' && renderGrowthBadge(comparisonMetrics.growth?.grossSalesGrowth)}
          </div>
          <span className="kpi-value">
            {comparisonMetrics && analyticsContext.compareMode !== 'none' && comparisonMetrics.primaryKPIs
              ? formatCurrency(comparisonMetrics.primaryKPIs.grossSales)
              : formatCurrency(kpis.grossSales)}
          </span>
          {comparisonMetrics && analyticsContext.compareMode !== 'none' && comparisonMetrics.comparisonKPIs && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '-4px', display: 'block' }}>
              vs {formatCurrency(comparisonMetrics.comparisonKPIs.grossSales)}
            </span>
          )}
          <span className="kpi-subtitle">Standard invoices (F2)</span>
        </div>
        <div id="sales-returns-card" className="kpi-card sales-returns-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="kpi-title">Sales Returns</span>
            {comparisonMetrics && analyticsContext.compareMode !== 'none' && renderGrowthBadge(comparisonMetrics.growth?.returnsGrowth)}
          </div>
          <span className="kpi-value">
            {comparisonMetrics && analyticsContext.compareMode !== 'none' && comparisonMetrics.primaryKPIs
              ? formatCurrency(Math.abs(comparisonMetrics.primaryKPIs.returnsValue || 0))
              : formatCurrency(Math.abs(kpis.returnsValue || 0))}
          </span>
          {comparisonMetrics && analyticsContext.compareMode !== 'none' && comparisonMetrics.comparisonKPIs && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '-4px', display: 'block' }}>
              vs {formatCurrency(Math.abs(comparisonMetrics.comparisonKPIs.returnsValue || 0))}
            </span>
          )}
          <span className="kpi-subtitle">RE return transactions</span>
        </div>
        <div id="cancelled-invoices-card" className="kpi-card cancelled-invoices-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="kpi-title">Cancelled Invoices</span>
            {comparisonMetrics && analyticsContext.compareMode !== 'none' && renderGrowthBadge(comparisonMetrics.growth?.cancelledGrowth)}
          </div>
          <span className="kpi-value">
            {comparisonMetrics && analyticsContext.compareMode !== 'none' && comparisonMetrics.primaryKPIs
              ? formatCurrency(Math.abs(comparisonMetrics.primaryKPIs.cancelledValue || 0))
              : formatCurrency(Math.abs(kpis.cancelledValue || 0))}
          </span>
          {comparisonMetrics && analyticsContext.compareMode !== 'none' && comparisonMetrics.comparisonKPIs && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '-4px', display: 'block' }}>
              vs {formatCurrency(Math.abs(comparisonMetrics.comparisonKPIs.cancelledValue || 0))}
            </span>
          )}
          <span className="kpi-subtitle">Cancellation billing (S1)</span>
        </div>
        <div id="net-sales-card" className="kpi-card net-sales-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="kpi-title">Net External Sales</span>
            {comparisonMetrics && analyticsContext.compareMode !== 'none' && renderGrowthBadge(comparisonMetrics.growth?.netSalesGrowth)}
          </div>
          <span className="kpi-value">
            {comparisonMetrics && analyticsContext.compareMode !== 'none' && comparisonMetrics.primaryKPIs
              ? formatCurrency(comparisonMetrics.primaryKPIs.netSales)
              : formatCurrency(kpis.netExternalSales)}
          </span>
          {comparisonMetrics && analyticsContext.compareMode !== 'none' && comparisonMetrics.comparisonKPIs && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '-4px', display: 'block' }}>
              vs {formatCurrency(comparisonMetrics.comparisonKPIs.netSales)}
            </span>
          )}
          <span className="kpi-subtitle">Gross - Returns - Cancelled</span>
        </div>
        <div id="cogm-card" className="kpi-card cogm-card">
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
              <p className="card-subtitle">
                Aggregations for selected filters
                {comparisonMetrics && analyticsContext.compareMode !== 'none' && (
                  <span style={{ marginLeft: '12px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--color-sales-gross)', marginRight: '4px' }}>●</span>
                    {analyticsContext.primaryYear ? `FY 20${analyticsContext.primaryYear.substring(2, 4)}-20${analyticsContext.primaryYear.substring(4, 6)}` : 'Primary'}
                    <span style={{ color: 'var(--text-muted)', marginLeft: '12px', marginRight: '4px' }}>■</span>
                    {analyticsContext.comparisonYear ? `FY 20${analyticsContext.comparisonYear.substring(2, 4)}-20${analyticsContext.comparisonYear.substring(4, 6)}` : 'Comparison'}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="chart-container">
            <LineChart data={chartData} yKey={mainValKey} comparisonKey={compKey} />
          </div>
        </div>

        {/* Division Split Card */}
        <div id="division-contribution" className="card" style={{ overflow: 'hidden' }}>
          <div className="card-header">
            <div>
              <h3 className="card-title">Division Contribution</h3>
              <p className="card-subtitle">Revenue split by division</p>
            </div>
          </div>
          <div style={{ height: '240px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            <DonutChart data={divisionData} height={240} />
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
              const maxValue = topStatesBySales[0]?.primaryValue !== undefined ? topStatesBySales[0].primaryValue : (topStatesBySales[0]?.value || 1);
              const val = item.primaryValue !== undefined ? item.primaryValue : item.value;
              const compVal = item.comparisonValue;
              const percentage = totalGrossSales > 0 ? ((val / totalGrossSales) * 100).toFixed(1) : '0.0';
              return (
                <div
                  key={item.label}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    padding: '6px 8px',
                    borderRadius: '8px',
                    border: '1px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: '500', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }}>
                      {index + 1}. {item.label}
                    </span>
                    <span style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-primary)', flexShrink: 0 }}>
                      {formatCurrency(val)}
                      {compVal !== undefined && (
                        <span style={{ fontSize: '0.68rem', fontWeight: '400', color: 'var(--text-secondary)', marginLeft: '6px' }}>
                          vs {formatCurrency(compVal)}
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: `${(val / maxValue) * 100}%`, height: '100%', backgroundColor: 'var(--color-sales-gross)', borderRadius: '999px' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {compVal !== undefined && (
                      <span style={{ fontWeight: '600', color: val >= compVal ? 'var(--color-sales-net)' : '#ef4444' }}>
                        {val >= compVal ? '↑' : '↓'} {compVal ? Math.abs(((val - compVal) / compVal) * 100).toFixed(1) : 0}%
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto' }}>{percentage}%</span>
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
              const maxValue = topCropsBySales[0]?.primaryValue !== undefined ? topCropsBySales[0].primaryValue : (topCropsBySales[0]?.value || 1);
              const val = item.primaryValue !== undefined ? item.primaryValue : item.value;
              const compVal = item.comparisonValue;
              const percentage = totalGrossSales > 0 ? ((val / totalGrossSales) * 100).toFixed(1) : '0.0';
              return (
                <div
                  key={item.label}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    padding: '6px 8px',
                    borderRadius: '8px',
                    border: '1px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: '500', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }}>
                      {index + 1}. {item.label}
                    </span>
                    <span style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-primary)', flexShrink: 0 }}>
                      {formatCurrency(val)}
                      {compVal !== undefined && (
                        <span style={{ fontSize: '0.68rem', fontWeight: '400', color: 'var(--text-secondary)', marginLeft: '6px' }}>
                          vs {formatCurrency(compVal)}
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: `${(val / maxValue) * 100}%`, height: '100%', backgroundColor: 'var(--color-sales-net)', borderRadius: '999px' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {compVal !== undefined && (
                      <span style={{ fontWeight: '600', color: val >= compVal ? 'var(--color-sales-net)' : '#ef4444' }}>
                        {val >= compVal ? '↑' : '↓'} {compVal ? Math.abs(((val - compVal) / compVal) * 100).toFixed(1) : 0}%
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto' }}>{percentage}%</span>
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
              const maxValue = topDealersBySales[0]?.primaryValue !== undefined ? topDealersBySales[0].primaryValue : (topDealersBySales[0]?.value || 1);
              const val = item.primaryValue !== undefined ? item.primaryValue : item.value;
              const compVal = item.comparisonValue;
              const percentage = totalGrossSales > 0 ? ((val / totalGrossSales) * 100).toFixed(1) : '0.0';
              return (
                <div
                  key={item.label}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    padding: '6px 8px',
                    borderRadius: '8px',
                    border: '1px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: '500', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }}>
                      {index + 1}. {item.label}
                    </span>
                    <span style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-primary)', flexShrink: 0 }}>
                      {formatCurrency(val)}
                      {compVal !== undefined && (
                        <span style={{ fontSize: '0.68rem', fontWeight: '400', color: 'var(--text-secondary)', marginLeft: '6px' }}>
                          vs {formatCurrency(compVal)}
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: `${(val / maxValue) * 100}%`, height: '100%', backgroundColor: 'var(--color-ipt)', borderRadius: '999px' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {compVal !== undefined && (
                      <span style={{ fontWeight: '600', color: val >= compVal ? 'var(--color-sales-net)' : '#ef4444' }}>
                        {val >= compVal ? '↑' : '↓'} {compVal ? Math.abs(((val - compVal) / compVal) * 100).toFixed(1) : 0}%
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto' }}>{percentage}%</span>
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
        <div id="distribution-channel-mix" className="card" style={{ padding: '16px 18px', gap: '12px' }}>
          <div className="card-header">
            <div>
              <h3 className="card-title" style={{ fontSize: '0.8rem', fontWeight: '800' }}>Distribution Channel Mix</h3>
              <p className="card-subtitle">Revenue split across channels</p>
            </div>
            {renderExpandButton('channelMix')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '10px' }}>
            {(expandedPanels.channelMix ? channelMix : channelMix.slice(0, 4)).map((item, index) => {
              const maxVal = Math.max(...channelMix.map(c => c.value)) || 1;
              const intensity = item.value / maxVal;
              const gradients = [
                'linear-gradient(180deg, rgba(37,99,235,0.08), rgba(37,99,235,0.02))',
                'linear-gradient(180deg, rgba(16,185,129,0.08), rgba(16,185,129,0.02))',
                'linear-gradient(180deg, rgba(217,119,6,0.08), rgba(217,119,6,0.02))',
                'linear-gradient(180deg, rgba(225,29,72,0.08), rgba(225,29,72,0.02))'
              ];
              const progressColors = [
                'var(--color-sales-gross)',
                'var(--color-sales-net)',
                'var(--color-ipt)',
                'var(--color-cancelled)'
              ];
              const gradient = gradients[index % gradients.length];
              const progressColor = progressColors[index % progressColors.length];

              return (
                <div key={item.name} style={{ borderRadius: '12px', padding: '10px', background: gradient, border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '6px' }}>
                  <div style={{ fontSize: '0.74rem', fontWeight: '700', color: 'var(--text-primary)', minHeight: '32px' }}>{item.name}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 'auto' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: '800', color: 'var(--text-primary)' }}>{formatCurrency(item.value)}</span>
                    <span style={{ fontSize: '0.7rem', fontWeight: '700', color: progressColor }}>{item.percentage.toFixed(0)}%</span>
                  </div>
                  <div style={{ height: '3px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '999px', overflow: 'hidden', marginTop: '2px' }}>
                    <div style={{ width: `${intensity * 100}%`, height: '100%', backgroundColor: progressColor }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            <span>{expandedPanels.channelMix ? 'Showing all channels' : 'Top channels shown'}</span>
            <span>Total: {formatCurrency(totalChannelSales)}</span>
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

        <div id="variety-breakdown" className="card" style={{ padding: '16px 18px', gap: '12px' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 className="card-title" style={{ fontSize: '0.8rem', fontWeight: '800' }}>Variety Breakdown</h3>
              <p className="card-subtitle">Varieties under {selectedCrop || 'Top Crop'}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <select
                value={selectedCrop}
                onChange={(e) => setLocalSelectedCrop(e.target.value)}
                style={{
                  appearance: 'none',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '3px 20px 3px 8px',
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
                {topCropsBySales.map(c => (
                  <option key={c.label} value={c.label}>{c.label}</option>
                ))}
              </select>
              {renderExpandButton('varietyBreakdown')}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', maxHeight: expandedPanels.varietyBreakdown ? '350px' : '220px', flex: 1 }}>
            {varieties.length > 0 ? (
              (expandedPanels.varietyBreakdown ? varieties : varieties.slice(0, 4)).map((item, index) => {
                const maxVal = varieties[0]?.value || 1;
                const percentage = totalCropSales > 0 ? ((item.value / totalCropSales) * 100).toFixed(1) : '0.0';
                return (
                  <div key={item.name} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: '500', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }}>
                        {index + 1}. {item.name}
                      </span>
                      <span style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-primary)', flexShrink: 0 }}>
                        {formatCurrency(item.value)}
                      </span>
                    </div>
                    <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '999px', overflow: 'hidden' }}>
                      <div style={{ width: `${(item.value / maxVal) * 100}%`, height: '100%', backgroundColor: 'var(--color-sales-net)', borderRadius: '999px' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      <span style={{ marginLeft: 'auto' }}>{percentage}%</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0', fontSize: '0.8rem' }}>No variety data available</div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)', paddingTop: '6px' }}>
            <span>{expandedPanels.varietyBreakdown ? 'Full breakdown' : 'Top 4 varieties shown'}</span>
            {selectedCrop && <span style={{ fontWeight: '600' }}>Crop: {selectedCrop}</span>}
          </div>
        </div>
      </section>
    </div>
  );
}

export default React.memo(ExecutiveSummary);
