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
    const bt = (item.billingType || '').toUpperCase();
    if (bt === 'F2' || bt === 'ZF2' || bt === 'ZIF2') {
      grossSales += item.salesAmountINR || 0;
      totalCOGM += item.cogm || 0;
    } else if (bt === 'RE' || bt === 'ZRE' || bt === 'ZIRE') {
      returnsValue += Math.abs(item.salesAmountINR || 0);
    } else if (bt === 'S1' || bt === 'ZS1') {
      cancelledValue += Math.abs(item.salesAmountINR || 0);
    } else if (bt === 'IPT' || bt === 'ZSTO') {
      iptValue += Math.abs(item.salesAmountINR || 0);
    }
  });

  // Net External Sales = Gross Sales - Returns - Cancelled
  const netExternalSales = Math.max(0, grossSales - returnsValue - cancelledValue);

  return {
    grossSales,
    returnsValue,
    cancelledValue,
    iptValue,
    netExternalSales,
    totalCOGM
  };
}
