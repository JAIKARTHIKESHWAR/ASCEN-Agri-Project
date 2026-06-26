// Core selectors and data filtering helpers for Acsen Sales Analytics.
// Hardcoded mock data arrays have been deleted. Real-time data is loaded dynamically from the PostgreSQL backend.

export const mockSalesData = []; // Default empty fallback

/**
 * Filter data dynamically based on active filter selectors
 */
export function getFilteredData(data, filters) {
  return data.filter(item => {
    if (filters.fy && item.fy !== filters.fy) return false;
    if (filters.division && item.division !== filters.division) return false;
    if (filters.distributionChannel && item.distributionChannel !== filters.distributionChannel) return false;
    if (filters.state && item.state !== filters.state) return false;
    if (filters.crop && item.crop !== filters.crop) return false;
    if (filters.variety && item.variety !== filters.variety) return false;
    if (filters.startDate && item.date < filters.startDate) return false;
    if (filters.endDate && item.date > filters.endDate) return false;
    return true;
  });
}

/**
 * Aggregate core metrics over the active dataset
 */
export function calculateKPIs(filteredData) {
  let grossSales = 0;
  let returnsValue = 0;
  let cancelledValue = 0;
  let iptValue = 0;
  let totalCOGM = 0;

  filteredData.forEach(item => {
    if (item.billingType === 'F2') {
      grossSales += item.salesAmountINR;
      totalCOGM += item.cogm;
    } else if (item.billingType === 'RE') {
      returnsValue += item.salesAmountINR;
    } else if (item.billingType === 'S1') {
      cancelledValue += item.salesAmountINR;
    } else if (item.billingType === 'IPT') {
      iptValue += item.salesAmountINR;
    }
  });

  // Net External Sales = Gross Sales - Returns - Cancelled
  const netExternalSales = grossSales - returnsValue - cancelledValue;

  return {
    grossSales,
    returnsValue,
    cancelledValue,
    iptValue,
    netExternalSales,
    totalCOGM
  };
}
