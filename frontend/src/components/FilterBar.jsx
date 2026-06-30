import React from 'react';

function FilterBar({ 
  filters, 
  setFilters, 
  onReset, 
  uniqueStates, 
  uniqueCrops, 
  cropsByDivision,
  analyticsContext,
  setAnalyticsContext,
  datasetsList,
  activeDatasetId,
  setActiveDatasetId,
  availableYears = []
}) {
  // Determine crop options dynamically from dataset properties
  let cropOptions = [];
  if (filters.division) {
    cropOptions = cropsByDivision[filters.division] || [];
  } else {
    cropOptions = uniqueCrops;
  }

  const activeDataset = datasetsList.find(d => d.batch_id.toString() === activeDatasetId.toString());
  const datasetYears = activeDataset ? activeDataset.available_years || [] : [];

  const formatFYLabel = (fy) => {
    if (!fy) return '';
    const start = `20${fy.slice(2, 4)}`;
    const end = `20${fy.slice(4, 6)}`;
    return `FY ${start}-${end}`;
  };

  const handleChange = (key, value) => {
    setFilters(prev => {
      const updated = { ...prev, [key]: value };
      
      // If division changes, clear the crop if it's no longer valid
      if (key === 'division') {
        updated.crop = '';
      }
      
      return updated;
    });
  };

  return (
    <div className="filter-bar" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', width: '100%' }}>
        {/* Financial Year Selector */}
        <div className="filter-group">
          <label className="filter-label" style={{ color: 'var(--color-sales-gross)', fontWeight: '600' }}>Financial Year</label>
          <select
            className="filter-select"
            value={activeDatasetId}
            onChange={(e) => setActiveDatasetId(e.target.value)}
          >
            {datasetsList.map(ds => (
              <option key={ds.batch_id} value={ds.batch_id}>
                {ds.label || ds.file_name}
              </option>
            ))}
          </select>
        </div>

        {/* Division */}
        <div className="filter-group">
          <label className="filter-label">Division</label>
          <select
            className="filter-select"
            value={filters.division}
            onChange={(e) => handleChange('division', e.target.value)}
          >
            <option value="">All Divisions</option>
            <option value="VG">Vegetable Division (VG)</option>
            <option value="FC">Field Crops Division (FC)</option>
            <option value="CM">Common (CM)</option>
          </select>
        </div>

        {/* Distribution Channel */}
        <div className="filter-group">
          <label className="filter-label">Channel</label>
          <select
            className="filter-select"
            value={filters.distributionChannel}
            onChange={(e) => handleChange('distributionChannel', e.target.value)}
          >
            <option value="">All Channels</option>
            <option value="Dealer & Distributor">Dealer & Distributor</option>
            <option value="Institutional Sales">Institutional Sales</option>
            <option value="Government Sales">Government Sales</option>
            <option value="Export">Export</option>
          </select>
        </div>

        {/* Dynamic State List */}
        <div className="filter-group">
          <label className="filter-label">State</label>
          <select
            className="filter-select"
            value={filters.state}
            onChange={(e) => handleChange('state', e.target.value)}
          >
            <option value="">All States</option>
            {uniqueStates.map(st => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </div>

        {/* Dynamic Crop List */}
        <div className="filter-group">
          <label className="filter-label">Crop</label>
          <select
            className="filter-select"
            value={filters.crop}
            onChange={(e) => handleChange('crop', e.target.value)}
          >
            <option value="">All Crops</option>
            {cropOptions.map(cr => (
              <option key={cr} value={cr}>{cr}</option>
            ))}
          </select>
        </div>

        {/* Start Date */}
        <div className="filter-group">
          <label className="filter-label">Start Date</label>
          <input
            type="date"
            className="filter-select"
            style={{ minWidth: '130px' }}
            value={filters.startDate}
            onChange={(e) => handleChange('startDate', e.target.value)}
          />
        </div>

        {/* End Date */}
        <div className="filter-group">
          <label className="filter-label">End Date</label>
          <input
            type="date"
            className="filter-select"
            style={{ minWidth: '130px' }}
            value={filters.endDate}
            onChange={(e) => handleChange('endDate', e.target.value)}
          />
        </div>

        {/* Reset Button */}
        <button className="btn-reset" onClick={onReset} style={{ alignSelf: 'flex-end', height: '36px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12 }}>
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
          Reset
        </button>
      </div>

      {/* Time Intelligence Comparison Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '12px', width: '100%' }}>
        <div className="filter-group">
          <label className="filter-label" style={{ color: 'var(--color-sales-net)', fontWeight: '600' }}>Time Intel Mode</label>
          <select
            className="filter-select"
            value={analyticsContext.compareMode || 'none'}
            onChange={(e) => setAnalyticsContext(prev => ({ 
              ...prev, 
              compareMode: e.target.value,
              primaryQuarter: '',
              primaryMonth: '',
              comparisonQuarter: '',
              comparisonMonth: ''
            }))}
          >
            <option value="none">No Comparison</option>
            <option value="yoy">YoY (Year over Year)</option>
            <option value="qoq">QoQ (Quarter over Quarter)</option>
            <option value="mom">MoM (Month over Month)</option>
          </select>
        </div>

        {analyticsContext.compareMode !== 'none' && (
          <>
            {/* Primary Year */}
            <div className="filter-group">
              <label className="filter-label">Primary Year</label>
              <select
                className="filter-select"
                value={analyticsContext.primaryYear || ''}
                onChange={(e) => setAnalyticsContext(prev => ({ ...prev, primaryYear: e.target.value }))}
              >
                <option value="">Select Year</option>
                {availableYears.map(year => (
                  <option key={year} value={year}>{formatFYLabel(year)}</option>
                ))}
              </select>
            </div>

            {/* Primary Quarter (Only for QoQ) */}
            {analyticsContext.compareMode === 'qoq' && (
              <div className="filter-group">
                <label className="filter-label">Primary Quarter</label>
                <select
                  className="filter-select"
                  value={analyticsContext.primaryQuarter || ''}
                  onChange={(e) => setAnalyticsContext(prev => ({ ...prev, primaryQuarter: e.target.value }))}
                >
                  <option value="">Select Quarter</option>
                  <option value="1">Q1</option>
                  <option value="2">Q2</option>
                  <option value="3">Q3</option>
                  <option value="4">Q4</option>
                </select>
              </div>
            )}

            {/* Primary Month (Only for MoM) */}
            {analyticsContext.compareMode === 'mom' && (
              <div className="filter-group">
                <label className="filter-label">Primary Month</label>
                <select
                  className="filter-select"
                  value={analyticsContext.primaryMonth || ''}
                  onChange={(e) => setAnalyticsContext(prev => ({ ...prev, primaryMonth: e.target.value }))}
                >
                  <option value="">Select Month</option>
                  <option value="1">Jan</option>
                  <option value="2">Feb</option>
                  <option value="3">Mar</option>
                  <option value="4">Apr</option>
                  <option value="5">May</option>
                  <option value="6">Jun</option>
                  <option value="7">Jul</option>
                  <option value="8">Aug</option>
                  <option value="9">Sep</option>
                  <option value="10">Oct</option>
                  <option value="11">Nov</option>
                  <option value="12">Dec</option>
                </select>
              </div>
            )}

            {/* Comparison Year */}
            <div className="filter-group">
              <label className="filter-label">Compare With Year</label>
              <select
                className="filter-select"
                value={analyticsContext.comparisonYear || ''}
                onChange={(e) => setAnalyticsContext(prev => ({ ...prev, comparisonYear: e.target.value }))}
              >
                <option value="">Select Year</option>
                {availableYears.map(year => (
                  <option key={year} value={year}>{formatFYLabel(year)}</option>
                ))}
              </select>
            </div>

            {/* Comparison Quarter (Only for QoQ) */}
            {analyticsContext.compareMode === 'qoq' && (
              <div className="filter-group">
                <label className="filter-label">Compare Quarter</label>
                <select
                  className="filter-select"
                  value={analyticsContext.comparisonQuarter || ''}
                  onChange={(e) => setAnalyticsContext(prev => ({ ...prev, comparisonQuarter: e.target.value }))}
                >
                  <option value="">Select Quarter</option>
                  <option value="1">Q1</option>
                  <option value="2">Q2</option>
                  <option value="3">Q3</option>
                  <option value="4">Q4</option>
                </select>
              </div>
            )}

            {/* Comparison Month (Only for MoM) */}
            {analyticsContext.compareMode === 'mom' && (
              <div className="filter-group">
                <label className="filter-label">Compare Month</label>
                <select
                  className="filter-select"
                  value={analyticsContext.comparisonMonth || ''}
                  onChange={(e) => setAnalyticsContext(prev => ({ ...prev, comparisonMonth: e.target.value }))}
                >
                  <option value="">Select Month</option>
                  <option value="1">Jan</option>
                  <option value="2">Feb</option>
                  <option value="3">Mar</option>
                  <option value="4">Apr</option>
                  <option value="5">May</option>
                  <option value="6">Jun</option>
                  <option value="7">Jul</option>
                  <option value="8">Aug</option>
                  <option value="9">Sep</option>
                  <option value="10">Oct</option>
                  <option value="11">Nov</option>
                  <option value="12">Dec</option>
                </select>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default React.memo(FilterBar);
