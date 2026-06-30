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
import CopilotWidget from './components/CopilotWidget';
import { getFilteredData, calculateKPIs } from './data/dataUtils';

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
  const [debouncedFilters, setDebouncedFilters] = useState(INITIAL_FILTERS);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
    }, 200);
    return () => clearTimeout(timer);
  }, [filters]);

  const [isDark, setIsDark] = useState(false); // Default to light monochrome (white UI)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [dataset, setDataset] = useState([]);
  const [datasetName, setDatasetName] = useState('Loading database...');
  const [showFilters, setShowFilters] = useState(false);
  const [activeSection, setActiveSection] = useState(null);
  const [chartPreferences, setChartPreferences] = useState({});
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [toast, setToast] = useState(null);

  const [datasetsList, setDatasetsList] = useState([]);
  const [activeDatasetId, setActiveDatasetId] = useState(() => {
    return localStorage.getItem('activeDatasetId') || '';
  });

  const [analyticsContext, setAnalyticsContext] = useState(() => {
    const saved = localStorage.getItem('analyticsContext');
    return saved ? JSON.parse(saved) : {
      primaryYear: '',
      comparisonYear: '',
      compareMode: 'none'
    };
  });

  const [comparisonMetrics, setComparisonMetrics] = useState(null);

  useEffect(() => {
    if (activeDatasetId) {
      localStorage.setItem('activeDatasetId', activeDatasetId);
    }
  }, [activeDatasetId]);

  useEffect(() => {
    localStorage.setItem('analyticsContext', JSON.stringify(analyticsContext));
  }, [analyticsContext]);


  const fileInputRef = useRef(null);

  const handleCopilotResponse = (data) => {
    if (!data) return;

    // 1. Map target tab
    const tabMap = {
      'dashboard': 'summary',
      'summary': 'summary',
      'sales-performance': 'sales',
      'sales': 'sales',
      'geography': 'geography',
      'product': 'product',
      'product-performance': 'product',
      'returns': 'returns',
      'returns-analysis': 'returns',
      'transactions': 'transactions'
    };

    const targetTab = data.navigateTo ? (tabMap[data.navigateTo.toLowerCase()] || data.navigateTo.toLowerCase()) : null;
    if (targetTab) {
      setActiveTab(targetTab);
    }

    // 2. Map and apply filters
    if (data.filters) {
      const newFilters = { ...INITIAL_FILTERS };
      const incoming = data.filters;

      if (incoming.crop) newFilters.crop = incoming.crop;
      if (incoming.state) newFilters.state = incoming.state;
      if (incoming.division) newFilters.division = incoming.division;
      if (incoming.distributionChannel) newFilters.distributionChannel = incoming.distributionChannel;
      if (incoming.startDate) newFilters.startDate = incoming.startDate;
      if (incoming.endDate) newFilters.endDate = incoming.endDate;

      // Sync Financial Year dropdown by fyCode (not batch_id)
      // datasetsList uses batch_id as the identifier but each entry has a fyCode/fy_code
      if (incoming.financialYear) {
        const matchedFY = datasetsList.find(
          d => d.batch_id === incoming.financialYear ||
            d.fyCode === incoming.financialYear ||
            d.fy_code === incoming.financialYear
        );
        if (matchedFY) {
          setActiveDatasetId(matchedFY.batch_id.toString());
        }
      }

      setFilters(prev => ({
        ...prev,
        ...newFilters
      }));
    }

    // 3. Set active section to trigger scroll
    if (data.section) {
      const sectionMap = {
        'sales-overview': 'sales-overview',
        'sales-trend': 'sales-overview',
        'division-contribution': 'division-contribution',
        'top-states': 'top-states',
        'top-crops': 'top-crops',
        'top-dealers': 'top-dealers',
        'sales-by-state': 'sales-by-state',
        'returns-summary': 'returns-summary',
        'ai-recommendations': 'ai-recommendations',
        'monthly-trend': 'monthly-trend',
        'distribution-channels': 'distribution-channels',
        'season-contribution': 'season-contribution',
        'geographic-performance': 'geographic-performance',
        'territory-hierarchy': 'territory-hierarchy',
        'territories-list': 'territories-list',
        'top-crops-state': 'top-crops-state',
        'crops-revenue': 'crops-revenue',
        'own-vs-trade': 'own-vs-trade',
        'varieties-performance': 'varieties-performance',
        'geographic-contribution': 'geographic-contribution',
        'returns-pattern': 'returns-pattern',
        'returns-by-channel': 'returns-by-channel',
        'returns-by-state': 'returns-by-state',
        'returns-by-crop': 'returns-by-crop',
        'transaction-drilldown': 'transaction-drilldown'
      };

      const targetSectionId = sectionMap[data.section.toLowerCase()] || data.section;
      setActiveSection(targetSectionId);
    }

    // 4. Update chart visualization preferences from database or user request
    if (data.chartPreferences) {
      setChartPreferences(data.chartPreferences);
    } else if (data.visualization && data.visualization.type && data.section) {
      setChartPreferences(prev => ({
        ...prev,
        [data.section]: data.visualization.type
      }));
    }

    if (data.intent === 'reset_visualization' && data.section) {
      setChartPreferences(prev => {
        const next = { ...prev };
        delete next[data.section];
        return next;
      });
    }

    // 5. Apply Time Intelligence comparison context from NLU
    // When the AI detects a comparative query (e.g. "compare Q2 this year vs last year"),
    // it returns a comparisonContext with FY codes and quarter/month numbers.
    // We apply that directly to the analyticsContext so the FilterBar dropdowns sync.
    if (data.comparisonContext && data.comparisonContext.compareMode) {
      const cc = data.comparisonContext;
      setAnalyticsContext(prev => ({
        ...prev,
        compareMode: cc.compareMode || 'none',
        primaryYear: cc.primaryYear || prev.primaryYear,
        primaryQuarter: cc.primaryQuarter ? String(cc.primaryQuarter) : '',
        primaryMonth: cc.primaryMonth ? String(cc.primaryMonth) : '',
        comparisonYear: cc.comparisonYear || prev.comparisonYear,
        comparisonQuarter: cc.comparisonQuarter ? String(cc.comparisonQuarter) : '',
        comparisonMonth: cc.comparisonMonth ? String(cc.comparisonMonth) : ''
      }));
    }
  };


  // Scroll to section and highlight
  useEffect(() => {
    if (activeSection) {
      const timer = setTimeout(() => {
        const element = document.getElementById(activeSection);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.classList.add('section-highlight');

          const clearTimer = setTimeout(() => {
            element.classList.remove('section-highlight');
            setActiveSection(null);
          }, 2200);

          return () => clearTimeout(clearTimer);
        }
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [activeSection, activeTab]);

  // Synchronize CSS class with dark/light mode state
  useEffect(() => {
    if (isDark) {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }, [isDark]);

  // Load datasets list and active dataset transactions on mount or activeDatasetId change
  useEffect(() => {
    async function loadDatasetsAndActive() {
      try {
        let savedId = localStorage.getItem('activeDatasetId') || '';

        // Parallelize datasets list and transactions fetching on mount
        const [dsRes, transRes] = await Promise.all([
          fetch('/api/data/datasets'),
          savedId ? fetch(`/api/transactions?limit=100000&datasetId=${savedId}`) : Promise.resolve(null)
        ]);

        let dsList = [];
        if (dsRes.ok) {
          dsList = await dsRes.json();
          setDatasetsList(dsList);
        }

        let targetId = savedId;
        if (!targetId && dsList.length > 0) {
          targetId = dsList[0].batch_id.toString();
          setActiveDatasetId(targetId);
        }

        if (transRes && transRes.ok) {
          const payload = await transRes.json();
          const items = payload.data || [];
          const mappedItems = items.map(item => ({
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
          const matched = dsList.find(d => d.batch_id.toString() === targetId);
          setDatasetName(matched ? matched.label : `Financial Year ${targetId}`);
        } else if (targetId) {
          await reloadDatasetFromBackend(targetId, dsList);
        } else {
          setDataset([]);
          setDatasetName('No Datasets Uploaded');
        }
      } catch (e) {
        console.error('Failed to load datasets list:', e);
      }
    }
    loadDatasetsAndActive();
  }, [activeDatasetId]);

  // Load comparison data when activeDatasetId, comparison parameters, or filters change
  useEffect(() => {
    async function loadComparison() {
      if (!activeDatasetId || analyticsContext.compareMode === 'none') {
        setComparisonMetrics(null);
        return;
      }

      const {
        primaryYear,
        comparisonYear,
        primaryQuarter,
        comparisonQuarter,
        primaryMonth,
        comparisonMonth,
        compareMode
      } = analyticsContext;

      if (!primaryYear || !comparisonYear) return;

      try {
        const queryParams = new URLSearchParams({
          datasetId: activeDatasetId,
          primaryYear,
          comparisonYear,
          mode: compareMode
        });
        if (primaryQuarter) queryParams.append('primaryQuarter', primaryQuarter);
        if (comparisonQuarter) queryParams.append('comparisonQuarter', comparisonQuarter);
        if (primaryMonth) queryParams.append('primaryMonth', primaryMonth);
        if (comparisonMonth) queryParams.append('comparisonMonth', comparisonMonth);

        // Append active dashboard filters
        Object.entries(debouncedFilters).forEach(([key, val]) => {
          if (val) {
            queryParams.append(key, val);
          }
        });

        const res = await fetch(`/api/dashboard/comparison?${queryParams.toString()}`);
        if (res.ok) {
          const metrics = await res.json();
          setComparisonMetrics(metrics);
        }
      } catch (err) {
        console.error('Failed to load comparison metrics:', err);
      }
    }
    loadComparison();
  }, [activeDatasetId, analyticsContext, debouncedFilters]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);



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
    if (debouncedFilters.fy === 'FY2526') {
      return [];
    }
    let data = getFilteredData(dataset, debouncedFilters);

    // Apply Time Intelligence Primary Period filtering if comparison is active
    if (analyticsContext.compareMode && analyticsContext.compareMode !== 'none' && analyticsContext.primaryYear) {
      data = data.filter(item => {
        // Match Year
        if (item.fy !== analyticsContext.primaryYear) return false;

        // Match Quarter
        if (analyticsContext.compareMode === 'qoq' && analyticsContext.primaryQuarter) {
          const dateObj = new Date(item.date);
          const month = dateObj.getMonth() + 1; // 1-12
          const q = parseInt(analyticsContext.primaryQuarter, 10);
          const qMonths = {
            1: [4, 5, 6],
            2: [7, 8, 9],
            3: [10, 11, 12],
            4: [1, 2, 3]
          };
          if (!qMonths[q]?.includes(month)) return false;
        }

        // Match Month
        if (analyticsContext.compareMode === 'mom' && analyticsContext.primaryMonth) {
          const dateObj = new Date(item.date);
          const month = dateObj.getMonth() + 1;
          if (month !== parseInt(analyticsContext.primaryMonth, 10)) return false;
        }

        return true;
      });
    }

    return data;
  }, [dataset, debouncedFilters, analyticsContext]);

  // Compute key metrics over the active dataset
  const kpis = useMemo(() => {
    return calculateKPIs(filteredData);
  }, [filteredData]);

  const handleResetFilters = () => {
    setFilters(INITIAL_FILTERS);
    setAnalyticsContext({
      primaryYear: '',
      comparisonYear: '',
      compareMode: 'none',
      primaryQuarter: '',
      comparisonQuarter: '',
      primaryMonth: '',
      comparisonMonth: ''
    });
  };

  const activeFiltersCount = useMemo(() => {
    return Object.keys(filters).filter(key => filters[key] !== '').length;
  }, [filters]);

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

  const handleCSVUpload = async (event) => {
    const files = Array.from(event.target.files);
    if (!files.length) return;

    // Reset input so the same file(s) can be re-selected after a reset
    event.target.value = '';

    const results = { imported: 0, rejected: 0, failed: [] };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const label = files.length > 1 ? `(${i + 1}/${files.length}) ${file.name}` : file.name;

      try {
        showToast(`Uploading ${label}...`, 'info');
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/data/upload', {
          method: 'POST',
          body: formData
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.details || result.error || 'Upload failed');
        }

        results.imported += result.rowsImported || 0;
        results.rejected += result.rowsRejected || 0;

        if (files.length > 1) {
          showToast(`✓ ${file.name} — ${(result.rowsImported || 0).toLocaleString('en-IN')} rows imported`, 'success');
        }
      } catch (err) {
        results.failed.push({ name: file.name, reason: err.message });
        showToast(`✗ ${file.name}: ${err.message}`, 'error');
      }
    }

    // Final summary toast for bulk uploads
    if (files.length > 1) {
      const failMsg = results.failed.length > 0 ? `, ${results.failed.length} failed` : '';
      showToast(
        `All dataset files uploaded successfully! Loaded ${results.imported.toLocaleString('en-IN')} records${failMsg}.`,
        results.failed.length > 0 ? 'error' : 'success'
      );
    } else if (results.failed.length === 0) {
      showToast(`Dataset file "${files[0].name}" uploaded successfully! Loaded ${results.imported.toLocaleString('en-IN')} records.`, 'success');
    }

    // Reload dataset list and switch to the first newly uploaded FY
    if (results.imported > 0) {
      const dsRes = await fetch('/api/data/datasets');
      if (dsRes.ok) {
        const dsList = await dsRes.json();
        setDatasetsList(dsList);
        const nextActiveId = dsList[0] ? dsList[0].batch_id.toString() : 'all';
        setActiveDatasetId(nextActiveId);
        await reloadDatasetFromBackend(nextActiveId, dsList);
      }
    }
  };

  const reloadDatasetFromBackend = async (datasetId, dsList = datasetsList) => {
    try {
      const { primaryYear, comparisonYear, compareMode } = analyticsContext;
      const compActive = compareMode !== 'none' && primaryYear && comparisonYear;

      const compQueryParams = new URLSearchParams({
        primaryYear,
        comparisonYear,
        mode: compareMode,
        division: filters.division || '',
        channel: filters.channel || '',
        state: filters.state || '',
        crop: filters.crop || ''
      });
      if (analyticsContext.primaryQuarter) compQueryParams.append('primaryQuarter', analyticsContext.primaryQuarter);
      if (analyticsContext.comparisonQuarter) compQueryParams.append('comparisonQuarter', analyticsContext.comparisonQuarter);
      if (analyticsContext.primaryMonth) compQueryParams.append('primaryMonth', analyticsContext.primaryMonth);
      if (analyticsContext.comparisonMonth) compQueryParams.append('comparisonMonth', analyticsContext.comparisonMonth);

      // Fetch transaction records and comparison stats concurrently
      const [transRes, compRes] = await Promise.all([
        fetch(`/api/transactions?limit=100000&datasetId=${datasetId}`),
        compActive ? fetch(`/api/dashboard/comparison?${compQueryParams.toString()}`) : Promise.resolve(null)
      ]);

      if (transRes.ok) {
        const payload = await transRes.json();
        const items = payload.data || [];
        const mappedItems = items.map(item => ({
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

        const matched = dsList.find(d => d.batch_id.toString() === datasetId.toString());
        setDatasetName(matched ? matched.label : `Financial Year ${datasetId}`);
        setFilters(INITIAL_FILTERS);
      }

      if (compRes && compRes.ok) {
        const metrics = await compRes.json();
        setComparisonMetrics(metrics);
      }
    } catch (err) {
      console.error("Failed to reload database records:", err);
    }
  };

  const executeSoftReset = async () => {
    try {
      const res = await fetch('/api/data/reset', { method: 'POST' });
      if (res.ok) {
        showToast("Done! All active metrics have been soft-reset to default zero.", 'success');
        setFilters(INITIAL_FILTERS);
        setAnalyticsContext({
          primaryYear: '',
          comparisonYear: '',
          compareMode: 'none',
          primaryQuarter: '',
          comparisonQuarter: '',
          primaryMonth: '',
          comparisonMonth: ''
        });
        setActiveDatasetId('all');

        // Refetch datasets list to clear stale dropdowns
        const dsRes = await fetch('/api/data/datasets');
        if (dsRes.ok) {
          const dsList = await dsRes.json();
          setDatasetsList(dsList);
        } else {
          setDatasetsList([]);
        }

        await reloadDatasetFromBackend('all');
      } else {
        const errorData = await res.json();
        showToast("Reset failed: " + (errorData.error || "Unknown error"), 'error');
      }
    } catch (err) {
      showToast("Reset failed: " + err.message, 'error');
    }
  };

  const handleResetToDefault = () => {
    setShowResetConfirm(true);
  };

  const availableFinancialYears = useMemo(() => {
    return datasetsList
      .map(ds => ds.fyCode || ds.batch_id)
      .filter(Boolean)
      .filter((value, index, self) => self.indexOf(value) === index && value !== 'all')
      .sort()
      .reverse();
  }, [datasetsList]);

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
              <button
                className="btn-reset"
                style={{ padding: '6px 12px', fontSize: '0.75rem', alignSelf: 'center', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                onClick={handleResetToDefault}
              >
                Reset Dashboard
              </button>

              {/* Upload SAP CSV or Excel */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleCSVUpload}
                style={{ display: 'none' }}
                accept=".csv,.xlsx,.xls"
                multiple
              />
              <button
                className="btn-export"
                style={{ padding: '6px 12px', fontSize: '0.75rem', gap: '4px', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
                onClick={() => fileInputRef.current.click()}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                </svg>
                Upload CSV / Excel
              </button>

              {/* Toggle Filters */}
              <button
                className="btn-export"
                style={{
                  padding: '6px 12px',
                  fontSize: '0.75rem',
                  gap: '4px',
                  backgroundColor: showFilters ? 'var(--text-primary)' : 'var(--bg-primary)',
                  color: showFilters ? 'var(--bg-primary)' : 'var(--text-primary)',
                  borderColor: showFilters ? 'var(--text-primary)' : 'var(--border-color)'
                }}
                onClick={() => setShowFilters(prev => !prev)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                Filter{activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ''}
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
          {showFilters && (
            <FilterBar
              filters={filters}
              setFilters={setFilters}
              onReset={handleResetFilters}
              uniqueStates={uniqueStates}
              uniqueCrops={uniqueCrops}
              cropsByDivision={cropsByDivision}
              analyticsContext={analyticsContext}
              setAnalyticsContext={setAnalyticsContext}
              datasetsList={datasetsList}
              activeDatasetId={activeDatasetId}
              setActiveDatasetId={setActiveDatasetId}
              availableYears={availableFinancialYears}
            />
          )}
        </header>

        {/* Tab Module Rendering */}
        {activeTab === 'summary' && (
          <ExecutiveSummary
            filteredData={filteredData}
            kpis={kpis}
            setActiveTab={setActiveTab}
            chartPreferences={chartPreferences}
            setChartPreferences={setChartPreferences}
            analyticsContext={analyticsContext}
            comparisonMetrics={comparisonMetrics}
          />
        )}

        {activeTab === 'sales' && (
          <SalesPerformance
            filteredData={filteredData}
            chartPreferences={chartPreferences}
            setChartPreferences={setChartPreferences}
          />
        )}

        {activeTab === 'geography' && (
          <GeographyRegion
            filteredData={filteredData}
            setFilters={setFilters}
            setActiveTab={setActiveTab}
            chartPreferences={chartPreferences}
            setChartPreferences={setChartPreferences}
          />
        )}

        {activeTab === 'product' && (
          <ProductPerformance
            filteredData={filteredData}
            chartPreferences={chartPreferences}
            setChartPreferences={setChartPreferences}
          />
        )}

        {activeTab === 'returns' && (
          <ReturnsAnalysis
            filteredData={filteredData}
            chartPreferences={chartPreferences}
            setChartPreferences={setChartPreferences}
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
        <CopilotWidget
          currentFilters={{ ...filters, datasetId: activeDatasetId }}
          onAIResponse={handleCopilotResponse}
        />

        {/* Soft Reset Confirmation Destructive Dialog Modal */}
        {showResetConfirm && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            backdropFilter: 'blur(6px)',
            transition: 'all 0.3s ease-in-out'
          }}>
            <div style={{
              backgroundColor: 'var(--bg-primary)',
              padding: '28px',
              borderRadius: '16px',
              border: '1px solid var(--border-color)',
              width: '90%',
              maxWidth: '420px',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
              boxShadow: '0 12px 40px rgba(0, 0, 0, 0.45)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.5rem' }}>⚠️</span>
                <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.2rem', fontWeight: '700' }}>Reset Sales Data</h3>
              </div>

              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                This action will reset all dashboard statistics and reports to zero.
                Uploaded sales files will be preserved in database logs and can be restored later.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Type <span style={{ color: '#ef4444', fontWeight: '800' }}>RESET</span> to continue:
                </label>
                <input
                  type="text"
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  placeholder="RESET"
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.95rem',
                    outline: 'none',
                    fontWeight: '600',
                    width: '100%',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '6px' }}>
                <button
                  onClick={() => {
                    setShowResetConfirm(false);
                    setResetConfirmText('');
                  }}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'transparent',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: '0.825rem',
                    fontWeight: '600',
                    transition: 'all 0.2s'
                  }}
                >
                  Cancel
                </button>
                <button
                  disabled={resetConfirmText !== 'RESET'}
                  onClick={async () => {
                    setShowResetConfirm(false);
                    setResetConfirmText('');
                    await executeSoftReset();
                  }}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: resetConfirmText === 'RESET' ? '#ef4444' : 'var(--bg-tertiary)',
                    color: resetConfirmText === 'RESET' ? 'white' : 'var(--text-muted)',
                    cursor: resetConfirmText === 'RESET' ? 'pointer' : 'not-allowed',
                    fontSize: '0.825rem',
                    fontWeight: '700',
                    transition: 'all 0.2s'
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Human-Designed Trending Glassmorphic Toast */}
        {toast && (
          <>
            <style>{`
              @keyframes slideUp {
                from {
                  transform: translateY(24px) scale(0.96);
                  opacity: 0;
                }
                to {
                  transform: translateY(0) scale(1);
                  opacity: 1;
                }
              }
            `}</style>
            <div style={{
              position: 'fixed',
              bottom: '28px',
              right: '28px',
              backgroundColor: toast.type === 'success' ? '#1c1c1e' : toast.type === 'error' ? '#7f1d1d' : '#27272a',
              color: toast.type === 'success' ? '#f4f4f5' : toast.type === 'error' ? '#fca5a5' : '#e4e4e7',
              padding: '14px 22px',
              borderRadius: '14px',
              boxShadow: '0 12px 36px rgba(0, 0, 0, 0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              zIndex: 999999,
              fontWeight: '600',
              fontSize: '0.85rem',
              letterSpacing: '0.15px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              animation: 'slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards',
              backdropFilter: 'blur(10px)',
              maxWidth: '380px'
            }}>
              <span style={{ fontSize: '1.1rem' }}>
                {toast.type === 'success' ? '⚡' : toast.type === 'error' ? '🚫' : '⏳'}
              </span>
              <div style={{ flex: 1, lineHeight: '1.4' }}>{toast.message}</div>
              <button
                onClick={() => setToast(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  opacity: 0.5,
                  fontSize: '0.9rem',
                  fontWeight: '700',
                  padding: '0 6px',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                ✕
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
