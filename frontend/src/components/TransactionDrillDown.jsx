import React, { useState, useMemo } from 'react';
import { formatCurrency } from './CustomCharts';

export default function TransactionDrillDown({ filteredData }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const itemsPerPage = 12;

  // Filter transactions by search query
  const searchedData = useMemo(() => {
    if (!search.trim()) return filteredData;
    const query = search.toLowerCase();
    return filteredData.filter(item => 
      item.invoiceId.toLowerCase().includes(query) ||
      item.customerName.toLowerCase().includes(query) ||
      item.crop.toLowerCase().includes(query) ||
      item.variety.toLowerCase().includes(query) ||
      item.materialCode.toLowerCase().includes(query) ||
      item.materialDescription.toLowerCase().includes(query) ||
      item.state.toLowerCase().includes(query) ||
      item.territory.toLowerCase().includes(query)
    );
  }, [filteredData, search]);

  // Reset page when search or data changes
  React.useEffect(() => {
    setPage(1);
  }, [search, filteredData]);

  // Calculate pagination
  const totalPages = Math.max(Math.ceil(searchedData.length / itemsPerPage), 1);
  const paginatedData = useMemo(() => {
    const startIdx = (page - 1) * itemsPerPage;
    return searchedData.slice(startIdx, startIdx + itemsPerPage);
  }, [searchedData, page]);

  // Real CSV Downloader
  const handleExportCSV = () => {
    if (searchedData.length === 0) {
      alert("No data available to export");
      return;
    }

    const headers = [
      'Invoice ID', 'Date', 'Billing Type', 'Billing Description',
      'Distribution Channel', 'Customer ID', 'Customer Name', 'Division',
      'Crop', 'Variety', 'Sales Unit', 'Own/Trade', 'Material Code',
      'Material Description', 'Season Code', 'State', 'Territory',
      'AM', 'RBM', 'DBM', 'Quantity', 'Sales Price', 'Amount INR', 'COGM'
    ];

    const rows = searchedData.map(item => [
      item.invoiceId,
      item.date,
      item.billingType,
      item.billingTypeDescription,
      item.distributionChannel,
      item.customerId,
      item.customerName.replace(/,/g, ' '), // sanitize comma
      item.division,
      item.crop,
      item.variety,
      item.salesUnit,
      item.ownTrade,
      item.materialCode,
      item.materialDescription.replace(/,/g, ' '),
      item.seasonCode,
      item.state,
      item.territory,
      item.am,
      item.rbm,
      item.dbm,
      item.qty,
      item.salesPrice,
      item.salesAmountINR,
      item.cogm
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Acsen_Sales_Transactions_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleMockExport = (format) => {
    alert(`Initiating export of ${searchedData.length} records in ${format} format...\nThis feature is fully scoped for production and runs locally on mockup transaction data for the POC.`);
  };

  return (
    <div className="page-container">
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Transaction Drill-Down</h3>
            <p className="card-subtitle">Invoice-line level details matching active filters</p>
          </div>
        </div>

        {/* Search & Export Panel */}
        <div className="table-actions">
          <input
            type="text"
            className="search-input"
            placeholder="Search by Invoice, Customer, Crop, Material..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-export" onClick={handleExportCSV}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Export CSV
            </button>
            <button className="btn-reset" onClick={() => handleMockExport('Excel')}>
              Export Excel
            </button>
            <button className="btn-reset" onClick={() => handleMockExport('PDF')}>
              Export PDF
            </button>
          </div>
        </div>

        {/* Data Table */}
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice ID</th>
                <th>Date</th>
                <th>Billing Type</th>
                <th>Customer</th>
                <th>Crop & Variety</th>
                <th>Qty (Unit)</th>
                <th>Amount (INR)</th>
                <th>COGM</th>
                <th>State & Territory</th>
              </tr>
            </thead>
            <tbody>
              {paginatedData.length > 0 ? (
                paginatedData.map(item => {
                  let pillClass = 'pill-sales';
                  if (item.billingType === 'RE') pillClass = 'pill-returns';
                  else if (item.billingType === 'S1') pillClass = 'pill-cancelled';
                  else if (item.billingType === 'IPT') pillClass = 'pill'; // Standard gray for IPT

                  return (
                    <tr key={item.invoiceId}>
                      <td style={{ fontWeight: '600', fontFamily: 'monospace' }}>{item.invoiceId}</td>
                      <td>{item.date}</td>
                      <td>
                        <span className={`pill ${pillClass}`}>
                          {item.billingTypeDescription}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.85rem', fontWeight: '500' }}>{item.customerName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Channel: {item.distributionChannel}</div>
                      </td>
                      <td>
                        <div>{item.crop}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.variety}</div>
                      </td>
                      <td>{item.qty} {item.salesUnit}</td>
                      <td style={{ fontWeight: '600' }}>{formatCurrency(item.salesAmountINR)}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{formatCurrency(item.cogm)}</td>
                      <td>
                        <div>{item.state}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.territory}</div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                    No transactions match the selected filters or search terms
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Pagination Footer */}
          <div className="table-footer">
            <span>
              Showing {searchedData.length > 0 ? (page - 1) * itemsPerPage + 1 : 0} to{' '}
              {Math.min(page * itemsPerPage, searchedData.length)} of {searchedData.length} records
            </span>
            <div className="pagination-controls">
              <button
                className="btn-page"
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
              >
                Previous
              </button>
              <span style={{ alignSelf: 'center', margin: '0 8px' }}>
                Page {page} of {totalPages}
              </span>
              <button
                className="btn-page"
                disabled={page === totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
