import React from 'react';

export default function FilterBar({ filters, setFilters, onReset, uniqueStates, uniqueCrops, cropsByDivision }) {
  // Determine crop options dynamically from dataset properties
  let cropOptions = [];
  if (filters.division) {
    cropOptions = cropsByDivision[filters.division] || [];
  } else {
    cropOptions = uniqueCrops;
  }

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
    <div className="filter-bar">
      {/* Financial Year */}
      <div className="filter-group">
        <label className="filter-label">Financial Year</label>
        <select
          className="filter-select"
          value={filters.fy}
          onChange={(e) => handleChange('fy', e.target.value)}
        >
          <option value="">All Years (In Scope)</option>
          <option value="FY2425">FY 2024-25 (SAP)</option>
          {/* <option value="FY2526">FY 2025-26 (Missing File)</option> */}
          <option value="FY2627">FY 2026-27 (SAP)</option>
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
          <option value="Dealer">Dealer</option>
          <option value="Distributor">Distributor</option>
          <option value="Direct">Direct</option>
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
      <button className="btn-reset" onClick={onReset}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12 }}>
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
        </svg>
        Reset
      </button>
    </div>
  );
}
