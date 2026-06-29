import React, { useState } from 'react';
import { formatCurrency } from './CustomCharts';

export default function GeographyRegion({ filteredData, setFilters, setActiveTab }) {
  const [selectedState, setSelectedState] = useState(null);

  // Group by state
  const stateMap = {};
  filteredData.forEach(item => {
    const bt = (item.billingType || '').toUpperCase();
    if (bt !== 'F2' && bt !== 'ZF2' && bt !== 'ZIF2') return;
    if (!stateMap[item.state]) {
      stateMap[item.state] = { gross: 0, count: 0, rbm: item.rbm, am: item.am, dbm: item.dbm };
    }
    stateMap[item.state].gross += item.salesAmountINR;
    stateMap[item.state].count += 1;
  });

  const states = Object.keys(stateMap).map(st => ({
    name: st,
    gross: stateMap[st].gross,
    count: stateMap[st].count,
    rbm: stateMap[st].rbm,
    am: stateMap[st].am,
    dbm: stateMap[st].dbm
  })).sort((a, b) => b.gross - a.gross);

  // Auto-select state if the dataset is filtered down to a single state
  React.useEffect(() => {
    if (states && states.length === 1 && selectedState !== states[0].name) {
      setSelectedState(states[0].name);
    }
  }, [filteredData, states]);

  const maxGross = states.length > 0 ? Math.max(...states.map(s => s.gross)) : 1;

  // If a state is selected, get its territories
  let territories = [];
  let stateCrops = [];
  let selectedStateHierarchy = null;

  if (selectedState) {
    const stateInvoices = filteredData.filter(item => {
      const bt = (item.billingType || '').toUpperCase();
      return item.state === selectedState && (bt === 'F2' || bt === 'ZF2' || bt === 'ZIF2');
    });
    
    // Group by territory
    const terrMap = {};
    stateInvoices.forEach(item => {
      if (!terrMap[item.territory]) {
        terrMap[item.territory] = { gross: 0, incharge: item.territoryInCharge };
      }
      terrMap[item.territory].gross += item.salesAmountINR;
    });
    territories = Object.keys(terrMap).map(tr => ({
      name: tr,
      gross: terrMap[tr].gross,
      incharge: terrMap[tr].incharge
    })).sort((a, b) => b.gross - a.gross);

    // Group crops in selected state
    const cropMap = {};
    stateInvoices.forEach(item => {
      cropMap[item.crop] = (cropMap[item.crop] || 0) + item.salesAmountINR;
    });
    stateCrops = Object.keys(cropMap).map(cr => ({
      name: cr,
      gross: cropMap[cr]
    })).sort((a, b) => b.gross - a.gross).slice(0, 5);

    // Grab hierarchy info from first record
    if (stateInvoices.length > 0) {
      selectedStateHierarchy = {
        rbm: stateInvoices[0].rbm,
        am: stateInvoices[0].am,
        dbm: stateInvoices[0].dbm
      };
    }
  }

  const handleDrillToTransactions = (stateName) => {
    setFilters(prev => ({ ...prev, state: stateName }));
    setActiveTab('transactions');
  };

  return (
    <div className="page-container">
      <div className="dashboard-grid">
        {/* States List */}
        <div id="geographic-performance" className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Geographic Performance</h3>
              <p className="card-subtitle">Select a state to inspect sales hierarchy and territories</p>
            </div>
          </div>
          <div className="ranked-list">
            {states.map(st => (
              <div
                key={st.name}
                className={`ranked-item ${selectedState === st.name ? 'active-row' : ''}`}
                style={{
                  cursor: 'pointer',
                  padding: '14px 12px',
                  borderRadius: '8px',
                  backgroundColor: selectedState === st.name ? 'var(--bg-hover)' : 'transparent',
                  transition: 'background-color var(--transition-fast)'
                }}
                onClick={() => setSelectedState(st.name === selectedState ? null : st.name)}
              >
                <div className="ranked-info">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="ranked-label" style={{ fontWeight: '600' }}>{st.name}</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{st.count} Invoices</span>
                  </div>
                  <div className="ranked-progress-bar" style={{ width: '100%' }}>
                    <div
                      className="ranked-progress-fill"
                      style={{
                        width: `${(st.gross / maxGross) * 100}%`,
                        backgroundColor: selectedState === st.name ? 'var(--color-sales-net)' : 'var(--color-sales-gross)'
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginLeft: '24px' }}>
                  <span className="ranked-value">{formatCurrency(st.gross)}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Click to Drill Down</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Drill-down Area */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {selectedState ? (
            <>
              {/* Hierarchy Info */}
              <div id="territory-hierarchy" className="card">
                <div className="card-header">
                  <h3 className="card-title">Hierarchy: {selectedState}</h3>
                </div>
                {selectedStateHierarchy && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Regional Business Manager (RBM)</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>{selectedStateHierarchy.rbm}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Area Manager (AM)</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>{selectedStateHierarchy.am}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '4px' }}>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>District Business Manager (DBM)</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>{selectedStateHierarchy.dbm}</span>
                    </div>
                  </div>
                )}
                <button
                  className="btn-ai-drill"
                  style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
                  onClick={() => handleDrillToTransactions(selectedState)}
                >
                  View Invoices for {selectedState}
                </button>
              </div>

              {/* Territory Breakdown */}
              <div id="territories-list" className="card">
                <div className="card-header">
                  <h3 className="card-title">Territories in {selectedState}</h3>
                </div>
                <div className="ranked-list" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  {territories.map(tr => (
                    <div key={tr.name} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)', marginBottom: '8px' }}>
                      <div>
                        <div style={{ fontSize: '0.875rem', fontWeight: '600' }}>{tr.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>In-charge: {tr.incharge}</div>
                      </div>
                      <div style={{ fontWeight: '700', fontSize: '0.875rem' }}>{formatCurrency(tr.gross)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Crop Contribution in State */}
              <div id="top-crops-state" className="card">
                <div className="card-header">
                  <h3 className="card-title">Top Crops in {selectedState}</h3>
                </div>
                <div className="ranked-list">
                  {stateCrops.map(cr => (
                    <div key={cr.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{cr.name}</span>
                      <span style={{ fontWeight: '600' }}>{formatCurrency(cr.gross)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div
              className="card"
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                height: '10%',
                minHeight: '300px',
                color: 'var(--text-secondary)',
                borderStyle: 'dashed',
                borderWidth: '2px'
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 48, height: 48, marginBottom: 16, opacity: 0.5 }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span>Click a State card to inspect details</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
