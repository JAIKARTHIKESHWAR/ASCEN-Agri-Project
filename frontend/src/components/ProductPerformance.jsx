import React, { useState } from 'react';
import { DonutChart, formatCurrency } from './CustomCharts';

export default function ProductPerformance({ filteredData }) {
  const [activeDiv, setActiveDiv] = useState('VG'); // 'VG' or 'FC'
  const [selectedCrop, setSelectedCrop] = useState(null);

  // Auto-detect and switch division if filteredData contains items of a different division
  React.useEffect(() => {
    if (filteredData && filteredData.length > 0) {
      const firstItem = filteredData[0];
      if (firstItem.division && firstItem.division !== activeDiv) {
        setActiveDiv(firstItem.division);
      }
    }
  }, [filteredData]);

  // Filter data by active division
  const divData = filteredData.filter(item => item.division === activeDiv);

  // Group by crop
  const cropMap = {};
  divData.forEach(item => {
    if (item.billingType !== 'F2') return;
    cropMap[item.crop] = (cropMap[item.crop] || 0) + item.salesAmountINR;
  });

  const crops = Object.keys(cropMap).map(cr => ({
    name: cr,
    value: cropMap[cr]
  })).sort((a, b) => b.value - a.value);

  const maxCropValue = crops.length > 0 ? Math.max(...crops.map(c => c.value)) : 1;

  // Derive top varieties, material codes, and states for the selected crop
  let varieties = [];
  let materialCodes = [];
  let cropStateContribution = [];

  const cropToQuery = selectedCrop || (crops.length > 0 ? crops[0].name : null);

  if (cropToQuery) {
    const cropInvoices = divData.filter(item => item.crop === cropToQuery && item.billingType === 'F2');
    
    // Group varieties
    const varMap = {};
    cropInvoices.forEach(item => {
      varMap[item.variety] = (varMap[item.variety] || 0) + item.salesAmountINR;
    });
    varieties = Object.keys(varMap).map(v => ({
      name: v,
      value: varMap[v]
    })).sort((a, b) => b.value - a.value);

    // Group materials
    const matMap = {};
    cropInvoices.forEach(item => {
      matMap[item.materialCode] = {
        desc: item.materialDescription,
        value: (matMap[item.materialCode]?.value || 0) + item.salesAmountINR
      };
    });
    materialCodes = Object.keys(matMap).map(code => ({
      code,
      desc: matMap[code].desc,
      value: matMap[code].value
    })).sort((a, b) => b.value - a.value).slice(0, 5);

    // Group states for crop contribution
    const stateContribMap = {};
    cropInvoices.forEach(item => {
      stateContribMap[item.state] = (stateContribMap[item.state] || 0) + item.salesAmountINR;
    });
    cropStateContribution = Object.keys(stateContribMap).map(st => ({
      label: st,
      value: stateContribMap[st]
    })).sort((a, b) => b.value - a.value);
  }

  // Own vs Trade split
  const ownTradeMap = { Own: 0, Trade: 0 };
  divData.forEach(item => {
    if (item.billingType === 'F2') {
      ownTradeMap[item.ownTrade] = (ownTradeMap[item.ownTrade] || 0) + item.salesAmountINR;
    }
  });
  const ownTradeData = [
    { label: 'Own Manufactured', value: ownTradeMap.Own },
    { label: 'Traded Goods', value: ownTradeMap.Trade }
  ];

  const handleDivChange = (div) => {
    setActiveDiv(div);
    setSelectedCrop(null); // Reset selected crop when switching division
  };

  return (
    <div className="page-container">
      {/* Division Toggle */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', gap: '16px' }}>
        <button
          className={`menu-item ${activeDiv === 'VG' ? 'active' : ''}`}
          style={{ paddingBottom: '12px', borderBottom: activeDiv === 'VG' ? '2px solid var(--color-sales-gross)' : 'none', borderRadius: 0 }}
          onClick={() => handleDivChange('VG')}
        >
          Vegetables (VG) Products
        </button>
        <button
          className={`menu-item ${activeDiv === 'FC' ? 'active' : ''}`}
          style={{ paddingBottom: '12px', borderBottom: activeDiv === 'FC' ? '2px solid var(--color-sales-gross)' : 'none', borderRadius: 0 }}
          onClick={() => handleDivChange('FC')}
        >
          Field Crops (FC) Products
        </button>
      </div>

      <div className="dashboard-grid">
        {/* Crops List */}
        <div id="crops-revenue" className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Crops Revenue</h3>
              <p className="card-subtitle">Select a crop to view varieties and material sales</p>
            </div>
          </div>
          <div className="ranked-list">
            {crops.map(c => (
              <div
                key={c.name}
                className="ranked-item"
                style={{
                  cursor: 'pointer',
                  padding: '12px 10px',
                  borderRadius: '6px',
                  backgroundColor: cropToQuery === c.name ? 'var(--bg-hover)' : 'transparent',
                  transition: 'background-color var(--transition-fast)'
                }}
                onClick={() => setSelectedCrop(c.name)}
              >
                <div className="ranked-info">
                  <span className="ranked-label">{c.name}</span>
                  <div className="ranked-progress-bar" style={{ width: '90%' }}>
                    <div
                      className="ranked-progress-fill"
                      style={{
                        width: `${(c.value / maxCropValue) * 100}%`,
                        backgroundColor: cropToQuery === c.name ? 'var(--color-sales-net)' : 'var(--color-sales-gross)'
                      }}
                    />
                  </div>
                </div>
                <span className="ranked-value">{formatCurrency(c.value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Own vs Trade Split Card */}
        <div id="own-vs-trade" className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Own vs Trade Splits</h3>
              <p className="card-subtitle">Revenue distribution by product manufacturing source</p>
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <DonutChart data={ownTradeData} />
          </div>
        </div>
      </div>

      {cropToQuery && (
        <section className="dashboard-grid" style={{ marginTop: '16px' }}>
          {/* Varieties & Materials breakdown */}
          <div id="varieties-performance" className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">{cropToQuery} Varieties</h3>
                <p className="card-subtitle">Sales by crop variety</p>
              </div>
            </div>
            <div className="ranked-list" style={{ marginBottom: '20px' }}>
              {varieties.map(v => (
                <div key={v.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{v.name}</span>
                  <span style={{ fontWeight: '600' }}>{formatCurrency(v.value)}</span>
                </div>
              ))}
            </div>

            <div className="card-header" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
              <div>
                <h4 style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>Top Material Codes for {cropToQuery}</h4>
              </div>
            </div>
            <div className="ranked-list">
              {materialCodes.map(m => (
                <div key={m.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                  <div>
                    <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{m.code}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>({m.desc})</span>
                  </div>
                  <span style={{ fontWeight: '600' }}>{formatCurrency(m.value)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Geographic Contribution for Selected Crop */}
          <div id="geographic-contribution" className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Geographic Contribution</h3>
                <p className="card-subtitle">Where {cropToQuery} sales are generated</p>
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              <DonutChart data={cropStateContribution} />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
