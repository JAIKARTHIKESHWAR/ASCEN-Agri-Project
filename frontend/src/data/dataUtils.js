/**
 * Map raw distribution channel codes/names to human-readable categories.
 */
export function getMappedChannel(channelCode) {
  const code = (channelCode || '').toUpperCase().trim();
  if (code === 'DD' || code === 'DEALER' || code === 'DISTRIBUTOR' || code === 'DIRECT') {
    return 'Dealer & Distributor';
  }
  if (code === 'ST' || code === 'IS' || code === 'INSTITUTIONAL') {
    return 'Institutional Sales';
  }
  if (code === 'GS' || code === 'GOVERNMENT') {
    return 'Government Sales';
  }
  if (code === 'ES' || code === 'EO' || code === 'EXPORT') {
    return 'Export';
  }
  return channelCode || 'Dealer & Distributor';
}

/**
 * Filter data dynamically based on active filter selectors
 */
export function getFilteredData(data, filters) {
  return data.filter(item => {
    if (filters.fy && item.fy !== filters.fy) return false;
    if (filters.division && item.division !== filters.division) return false;
    if (filters.distributionChannel) {
      const mappedItemChannel = getMappedChannel(item.distributionChannel);
      if (mappedItemChannel !== filters.distributionChannel) return false;
    }
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
      returnsValue += item.salesAmountINR || 0;
    } else if (bt === 'S1' || bt === 'ZS1') {
      cancelledValue += item.salesAmountINR || 0;
    } else if (bt === 'IPT' || bt === 'ZSTO') {
      iptValue += item.salesAmountINR || 0;
    }
  });

  returnsValue = Math.abs(returnsValue);
  cancelledValue = Math.abs(cancelledValue);
  iptValue = Math.abs(iptValue);

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
