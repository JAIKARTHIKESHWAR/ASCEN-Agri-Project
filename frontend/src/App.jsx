import React, { useState, useMemo, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import FilterBar from './components/FilterBar';
import ExecutiveSummary from './components/ExecutiveSummary';
import SalesPerformance from './components/SalesPerformance';
import GeographyRegion from './components/GeographyRegion';
import ProductPerformance from './components/ProductPerformance';
import ReturnsAnalysis from './components/ReturnsAnalysis';
import TransactionDrillDown from './components/TransactionDrillDown';
import AskAI from './components/AskAI';
import { mockSalesData, getFilteredData, calculateKPIs } from './data/mockSalesData';

const INITIAL_FILTERS = {
  fy: '',
  division: '',
  distributionChannel: '',
  state: '',
  crop: '',
  startDate: '',
  endDate: ''
};

// Quote-aware CSV parser
function parseCSV(text) {
  const lines = [];
  let row = [""];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',') {
      if (inQuotes) {
        row[row.length - 1] += ',';
      } else {
        row.push("");
      }
    } else if (char === '\r' || char === '\n') {
      if (inQuotes) {
        row[row.length - 1] += char;
      } else {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        lines.push(row);
        row = [""];
      }
    } else {
      row[row.length - 1] += char;
    }
  }
  if (row.length > 1 || row[0] !== "") {
    lines.push(row);
  }
  return lines;
}

function App() {
  const [activeTab, setActiveTab] = useState('summary');
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [isDark, setIsDark] = useState(false); // Default to light monochrome (white UI)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [dataset, setDataset] = useState(mockSalesData);
  const [datasetName, setDatasetName] = useState('Default SAP Mock Data');

  const fileInputRef = useRef(null);

  // Synchronize CSS class with dark/light mode state
  useEffect(() => {
    if (isDark) {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }, [isDark]);

  // Load initial data from backend PostgreSQL database on mount
  useEffect(() => {
    async function fetchInitialDataset() {
      try {
        const res = await fetch('/api/transactions?limit=100000');
        if (res.ok) {
          const payload = await res.json();
          if (payload && payload.data && payload.data.length > 0) {
            const mappedItems = payload.data.map(item => ({
              ...item,
              fy: item.fy || 'FY2627',
              customerId: item.customerId || 'CUST-000',
              division: item.division || 'VG',
              ownTrade: item.ownTrade || 'Own',
              materialCode: item.materialCode || 'MAT-000',
              materialDescription: item.materialDescription || `${item.crop} ${item.variety}`,
              seasonCode: item.seasonCode || 'N/A',
              salesPrice: item.salesPrice || (item.qty ? Math.round(item.salesAmountINR / item.qty) : 0),
              salesAmountINR: item.salesAmountINR,
              cogm: item.cogm
            }));
            setDataset(mappedItems);
            setDatasetName('Production Database (PostgreSQL)');
          }
        }
      } catch (err) {
        console.warn("Backend database not connected, using default mock dataset:", err);
      }
    }
    fetchInitialDataset();
  }, []);

  const uploadFileToBackend = async (file) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/data/upload', {
        method: 'POST',
        body: formData
      });
      if (response.ok) {
        const result = await response.json();
        console.log('Successfully synced CSV with backend database:', result);
      }
    } catch (err) {
      console.error('Failed to sync CSV with backend database:', err);
    }
  };

  // Compute unique filters dynamically from active dataset
  const uniqueStates = useMemo(() => {
    return [...new Set(dataset.map(item => item.state).filter(Boolean))].sort();
  }, [dataset]);

  const uniqueCrops = useMemo(() => {
    return [...new Set(dataset.map(item => item.crop).filter(Boolean))].sort();
  }, [dataset]);

  const cropsByDivision = useMemo(() => {
    const vg = [...new Set(dataset.filter(item => item.division === 'VG').map(item => item.crop).filter(Boolean))].sort();
    const fc = [...new Set(dataset.filter(item => item.division === 'FC').map(item => item.crop).filter(Boolean))].sort();
    return { VG: vg, FC: fc };
  }, [dataset]);

  // Compute filtered dataset dynamically based on filters
  const filteredData = useMemo(() => {
    if (filters.fy === 'FY2526') {
      return [];
    }
    return getFilteredData(dataset, filters);
  }, [dataset, filters]);

  // Compute key metrics over the active dataset
  const kpis = useMemo(() => {
    return calculateKPIs(filteredData);
  }, [filteredData]);

  const handleResetFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  const getTabLabel = (tabId) => {
    switch (tabId) {
      case 'summary': return 'EXECUTIVE SUMMARY';
      case 'sales': return 'SALES PERFORMANCE';
      case 'geography': return 'GEOGRAPHY & REGIONS';
      case 'product': return 'PRODUCT PERFORMANCE';
      case 'returns': return 'RETURNS ANALYSIS';
      case 'transactions': return 'TRANSACTIONS';
      case 'ask-ai': return 'ASK AI ASSISTANT';
      default: return '';
    }
  };

  const handleCSVUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Sync file upload to the Express PostgreSQL backend
    uploadFileToBackend(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const parsedLines = parseCSV(text);
        if (parsedLines.length < 2) {
          alert("CSV file does not contain enough rows.");
          return;
        }

        const headers = parsedLines[0].map(h => h.trim().toLowerCase());
        const findIndex = (fields) => headers.findIndex(h => fields.includes(h));

        const idxInvoice = findIndex(['invoice id', 'invoice number', 'billing document', 'invoiceno', 'invoice_id', 'invoiceid']);
        const idxDate = findIndex(['date', 'invoice date', 'billing date', 'date']);
        const idxBillingType = findIndex(['billing type', 'type', 'billing_type', 'billingtype']);
        const idxBillingDesc = findIndex(['billing type description', 'type description', 'billing_type_description', 'billingtypedescription', 'description']);
        const idxChannel = findIndex(['distribution channel', 'channel', 'distribution_channel', 'distributionchannel']);
        const idxCustId = findIndex(['customer id', 'customer code', 'customer_id', 'customerid']);
        const idxCustName = findIndex(['customer name', 'customer', 'customer_name', 'customername']);
        const idxDivision = findIndex(['division', 'division']);
        const idxCrop = findIndex(['crop', 'crop']);
        const idxVariety = findIndex(['variety', 'variety']);
        const idxSalesUnit = findIndex(['sales unit', 'unit', 'sales_unit', 'salesunit']);
        const idxOwnTrade = findIndex(['own/trade', 'own / trade', 'own_trade', 'owntrade']);
        const idxMaterialCode = findIndex(['material code', 'material', 'material_code', 'materialcode']);
        const idxMaterialDesc = findIndex(['material description', 'material_description', 'materialdescription']);
        const idxSeason = findIndex(['season code', 'season', 'season_code', 'seasoncode']);
        const idxState = findIndex(['state', 'state']);
        const idxTerritory = findIndex(['territory', 'territory']);
        const idxAM = findIndex(['am', 'area manager', 'am']);
        const idxRBM = findIndex(['rbm', 'regional business manager', 'rbm']);
        const idxDBM = findIndex(['dbm', 'district business manager', 'dbm']);
        const idxQty = findIndex(['quantity', 'qty', 'quantity']);
        const idxPrice = findIndex(['sales price', 'price', 'sales_price', 'salesprice']);
        const idxAmount = findIndex(['amount inr', 'sales amount inr', 'amount', 'revenue', 'sales_amount_inr', 'salesamountinr']);
        const idxCOGM = findIndex(['cogm', 'cogm']);

        // Parse rows
        const items = [];
        for (let i = 1; i < parsedLines.length; i++) {
          const row = parsedLines[i];
          if (row.length < 2 || (row.length === 1 && row[0] === '')) continue; // skip blank rows

          // Parse numbers, fallback to defaults
          const qty = idxQty !== -1 ? parseInt(row[idxQty], 10) || 0 : 0;
          const salesPrice = idxPrice !== -1 ? parseFloat(row[idxPrice]) || 0 : 0;
          const salesAmountINR = idxAmount !== -1 ? parseFloat(row[idxAmount]) || (qty * salesPrice) : (qty * salesPrice);
          const cogm = idxCOGM !== -1 ? parseFloat(row[idxCOGM]) || Math.round(salesAmountINR * 0.7) : Math.round(salesAmountINR * 0.7);

          // Get dates and extract Financial Year
          const date = idxDate !== -1 ? row[idxDate].trim() : new Date().toISOString().split('T')[0];
          let fy = 'FY2627';
          if (date) {
            const yr = new Date(date).getFullYear();
            const mo = new Date(date).getMonth(); // 0-11
            if (yr === 2024 && mo >= 3 || yr === 2025 && mo < 3) fy = 'FY2425';
            else if (yr === 2025 && mo >= 3 || yr === 2026 && mo < 3) fy = 'FY2526';
          }

          items.push({
            invoiceId: idxInvoice !== -1 ? row[idxInvoice].trim() : `INV-${fy}-${10000 + i}`,
            date,
            fy,
            billingType: idxBillingType !== -1 ? row[idxBillingType].trim() : 'F2',
            billingTypeDescription: idxBillingDesc !== -1 ? row[idxBillingDesc].trim() : 'Standard Invoice',
            distributionChannel: idxChannel !== -1 ? row[idxChannel].trim() : 'Dealer',
            customerId: idxCustId !== -1 ? row[idxCustId].trim() : 'CUST-000000',
            customerName: idxCustName !== -1 ? row[idxCustName].trim() : 'Customer Name',
            division: idxDivision !== -1 ? row[idxDivision].trim().toUpperCase() : 'VG',
            crop: idxCrop !== -1 ? row[idxCrop].trim() : 'Crop',
            variety: idxVariety !== -1 ? row[idxVariety].trim() : 'Variety',
            salesUnit: idxSalesUnit !== -1 ? row[idxSalesUnit].trim() : 'Packets',
            ownTrade: idxOwnTrade !== -1 ? row[idxOwnTrade].trim() : 'Own',
            materialCode: idxMaterialCode !== -1 ? row[idxMaterialCode].trim() : 'MAT-00000',
            materialDescription: idxMaterialDesc !== -1 ? row[idxMaterialDesc].trim() : 'Seeds',
            seasonCode: idxSeason !== -1 ? row[idxSeason].trim() : 'N/A',
            state: idxState !== -1 ? row[idxState].trim() : 'State',
            territory: idxTerritory !== -1 ? row[idxTerritory].trim() : 'Territory',
            am: idxAM !== -1 ? row[idxAM].trim() : 'Area Manager',
            rbm: idxRBM !== -1 ? row[idxRBM].trim() : 'Regional Business Manager',
            dbm: idxDBM !== -1 ? row[idxDBM].trim() : 'District Business Manager',
            qty,
            salesPrice,
            salesAmountINR,
            cogm
          });
        }

        setDataset(items);
        setDatasetName(file.name);
        setFilters(INITIAL_FILTERS); // reset filters to fit the new dataset
        alert(`Successfully imported ${items.length} records from ${file.name}`);
      } catch (err) {
        alert("Error parsing CSV file: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  const handleResetToDefault = async () => {
    try {
      const res = await fetch('/api/transactions?limit=100000');
      if (res.ok) {
        const payload = await res.json();
        if (payload && payload.data && payload.data.length > 0) {
          const mappedItems = payload.data.map(item => ({
            ...item,
            fy: item.fy || 'FY2627',
            customerId: item.customerId || 'CUST-000',
            division: item.division || 'VG',
            ownTrade: item.ownTrade || 'Own',
            materialCode: item.materialCode || 'MAT-000',
            materialDescription: item.materialDescription || `${item.crop} ${item.variety}`,
            seasonCode: item.seasonCode || 'N/A',
            salesPrice: item.salesPrice || (item.qty ? Math.round(item.salesAmountINR / item.qty) : 0),
            salesAmountINR: item.salesAmountINR,
            cogm: item.cogm
          }));
          setDataset(mappedItems);
          setDatasetName('Production Database (PostgreSQL)');
          setFilters(INITIAL_FILTERS);
          alert("Successfully reloaded default production records from database.");
        }
      }
    } catch (err) {
      alert("Failed to reload default database records: " + err.message);
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isDark={isDark}
        setIsDark={setIsDark}
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
      />

      {/* Main Panel */}
      <main className="main-content">
        {/* Minimal Monochrome Header */}
        <header className="header">
          <div className="header-top">
            <div className="header-title-area" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <h2>{getTabLabel(activeTab)}</h2>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
                DATA: {datasetName} ({dataset.length} Rows)
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Reset Dataset to Default */}
              {datasetName !== 'Default SAP Mock Data' && (
                <button 
                  className="btn-reset" 
                  style={{ padding: '6px 12px', fontSize: '0.75rem', alignSelf: 'center' }}
                  onClick={handleResetToDefault}
                >
                  Restore Default
                </button>
              )}

              {/* Upload SAP CSV */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleCSVUpload}
                style={{ display: 'none' }}
                accept=".csv"
              />
              <button 
                className="btn-export" 
                style={{ padding: '6px 12px', fontSize: '0.75rem', gap: '4px', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
                onClick={() => fileInputRef.current.click()}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                </svg>
                Upload CSV
              </button>

              {/* PDF Report Export Trigger */}
              <button 
                className="btn-export" 
                style={{ padding: '6px 12px', fontSize: '0.75rem', gap: '4px' }}
                onClick={() => window.print()}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
                  <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <polyline points="6 14 18 14 18 22 6 22 6 14" />
                </svg>
                Export Report
              </button>
            </div>
          </div>

          {/* Global Filter Bar */}
          <FilterBar
            filters={filters}
            setFilters={setFilters}
            onReset={handleResetFilters}
            uniqueStates={uniqueStates}
            uniqueCrops={uniqueCrops}
            cropsByDivision={cropsByDivision}
          />
        </header>

        {/* Tab Module Rendering */}
        {activeTab === 'summary' && (
          <ExecutiveSummary
            filteredData={filteredData}
            kpis={kpis}
            setActiveTab={setActiveTab}
          />
        )}

        {activeTab === 'sales' && (
          <SalesPerformance
            filteredData={filteredData}
          />
        )}

        {activeTab === 'geography' && (
          <GeographyRegion
            filteredData={filteredData}
            setFilters={setFilters}
            setActiveTab={setActiveTab}
          />
        )}

        {activeTab === 'product' && (
          <ProductPerformance
            filteredData={filteredData}
          />
        )}

        {activeTab === 'returns' && (
          <ReturnsAnalysis
            filteredData={filteredData}
          />
        )}

        {activeTab === 'transactions' && (
          <TransactionDrillDown
            filteredData={filteredData}
          />
        )}

        {activeTab === 'ask-ai' && (
          <AskAI
            filteredData={filteredData}
            filters={filters}
            setFilters={setFilters}
            setActiveTab={setActiveTab}
            kpis={kpis}
          />
        )}
      </main>
    </div>
  );
}

export default App;
