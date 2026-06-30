import React, { useState } from 'react';
import { DonutChart, formatCurrency } from './CustomCharts';

export default function ProductPerformance({ filteredData }) {
  const [activeDiv, setActiveDiv] = useState('VG'); // 'VG', 'FC', or 'CM'
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
    const bt = (item.billingType || '').toUpperCase();
    if (bt !== 'F2' && bt !== 'ZF2' && bt !== 'ZIF2') return;
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

  if (selectedCrop) {
    const cropInvoices = divData.filter(item => {
      const bt = (item.billingType || '').toUpperCase();
      return item.crop === selectedCrop && (bt === 'F2' || bt === 'ZF2' || bt === 'ZIF2');
    });
    
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
  const ownTradeMap = {};
  divData.forEach(item => {
    const bt = (item.billingType || '').toUpperCase();
    if (bt === 'F2' || bt === 'ZF2' || bt === 'ZIF2') {
      ownTradeMap[item.ownTrade] = (ownTradeMap[item.ownTrade] || 0) + item.salesAmountINR;
    }
  });
  const ownTradeData = Object.keys(ownTradeMap).map(key => ({
    label: key === 'Own' ? 'Own Manufactured' : key === 'Trade' ? 'Traded Goods' : key,
    value: ownTradeMap[key]
  }));

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
        <button
          className={`menu-item ${activeDiv === 'CM' ? 'active' : ''}`}
          style={{ paddingBottom: '12px', borderBottom: activeDiv === 'CM' ? '2px solid var(--color-sales-gross)' : 'none', borderRadius: 0 }}
          onClick={() => handleDivChange('CM')}
        >
          Common (CM) Products
        </button>
      </div>

      <div className="dashboard-grid">
        {/* Left Column (Crops list) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Crops List */}
          <div id="crops-revenue" className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Crops Revenue</h3>
                <p className="card-subtitle">Click a crop to view varieties and sales details in a popup</p>
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
                    backgroundColor: selectedCrop === c.name ? 'var(--bg-hover)' : 'transparent',
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
                          backgroundColor: selectedCrop === c.name ? 'var(--color-sales-net)' : 'var(--color-sales-gross)'
                        }}
                      />
                    </div>
                  </div>
                  <span className="ranked-value">{formatCurrency(c.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column (Own vs Trade) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Own vs Trade Split Card */}
          <div id="own-vs-trade" className="card" style={{ height: 'fit-content' }}>
            <div className="card-header">
              <div>
                <h3 className="card-title">Own vs Trade Splits</h3>
                <p className="card-subtitle">Revenue distribution by product manufacturing source</p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 0' }}>
              <DonutChart data={ownTradeData} />
            </div>
          </div>
        </div>
      </div>

      {/* Crop Details Pop-up Modal */}
      {selectedCrop && (
        <>
          <style>{`
            @keyframes modalFadeIn {
              from {
                opacity: 0;
                transform: scale(0.97);
              }
              to {
                opacity: 1;
                transform: scale(1);
              }
            }
          `}</style>
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.65)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 99999,
              padding: '20px',
            }}
            onClick={() => setSelectedCrop(null)}
          >
            <div
              style={{
                backgroundColor: 'var(--bg-primary)',
                borderRadius: '16px',
                border: '1px solid var(--border-color)',
                width: '100%',
                maxWidth: '900px',
                maxHeight: '90vh',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 24px 48px rgba(0, 0, 0, 0.45)',
                animation: 'modalFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  borderBottom: '1px solid var(--border-color)',
                  padding: '24px 32px',
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                    {selectedCrop} Performance
                  </h2>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
                    Detailed varieties breakdown and geographic distribution
                  </p>
                </div>
                <button
                  onClick={() => setSelectedCrop(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    fontSize: '1.6rem',
                    cursor: 'pointer',
                    padding: '4px',
                    lineHeight: 1,
                    transition: 'color 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onMouseOver={(e) => e.target.style.color = 'var(--text-primary)'}
                  onMouseOut={(e) => e.target.style.color = 'var(--text-secondary)'}
                >
                  ✕
                </button>
              </div>

              {/* Modal Body */}
              <div style={{ padding: '32px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', overflowY: 'auto' }}>
                
                {/* Left Column (Varieties + Materials) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {/* Varieties */}
                  <div className="card" style={{ margin: 0, padding: '20px' }}>
                    <div className="card-header" style={{ padding: 0, marginBottom: '16px' }}>
                      <h3 className="card-title">{selectedCrop} Varieties</h3>
                      <p className="card-subtitle">Sales by crop variety</p>
                    </div>
                    <div className="ranked-list" style={{ maxHeight: '200px', overflowY: 'auto', paddingRight: '8px' }}>
                      {varieties.map(v => (
                        <div key={v.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{v.name}</span>
                          <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{formatCurrency(v.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Top Materials */}
                  <div className="card" style={{ margin: 0, padding: '20px' }}>
                    <div className="card-header" style={{ padding: 0, marginBottom: '16px' }}>
                      <h3 className="card-title">Top Materials</h3>
                      <p className="card-subtitle">Top material codes for {selectedCrop}</p>
                    </div>
                    <div className="ranked-list" style={{ maxHeight: '200px', overflowY: 'auto', paddingRight: '8px' }}>
                      {materialCodes.map(m => (
                        <div key={m.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                          <div>
                            <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{m.code}</span>
                            <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>({m.desc})</span>
                          </div>
                          <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{formatCurrency(m.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right Column (Geographic) */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div className="card" style={{ margin: 0, padding: '20px', height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <div className="card-header" style={{ padding: 0, marginBottom: '16px' }}>
                      <h3 className="card-title">Geographic Contribution</h3>
                      <p className="card-subtitle">Where {selectedCrop} sales are generated</p>
                    </div>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '260px' }}>
                      <DonutChart data={cropStateContribution} />
                    </div>
                  </div>
                </div>

              </div>

              {/* Modal Footer */}
              <div
                style={{
                  borderTop: '1px solid var(--border-color)',
                  padding: '16px 32px',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  backgroundColor: 'var(--bg-tertiary)',
                  borderBottomLeftRadius: '16px',
                  borderBottomRightRadius: '16px'
                }}
              >
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
