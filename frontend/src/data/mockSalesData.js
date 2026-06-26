// Mock SAP sales data generator for Acsen Sales Analytics POC

const STATES_DATA = {
  'Tamil Nadu': {
    territories: ['North TN', 'South TN', 'West TN', 'East TN'],
    hierarchy: { RBM: 'Ramesh Nair', AM: 'M. Selvam', DBM: 'S. Kavin' }
  },
  'Karnataka': {
    territories: ['North Karnataka', 'South Karnataka', 'Coastal Karnataka'],
    hierarchy: { RBM: 'P. Joshi', AM: 'B. Gowda', DBM: 'H. Kumar' }
  },
  'Andhra Pradesh': {
    territories: ['Coastal AP', 'Rayalaseema', 'Telangana Border'],
    hierarchy: { RBM: 'K. Reddy', AM: 'V. Naidu', DBM: 'G. Rao' }
  },
  'Maharashtra': {
    territories: ['Vidarbha', 'Marathwada', 'Western Maharashtra'],
    hierarchy: { RBM: 'T. Singh', AM: 'S. Patil', DBM: 'A. Deshmukh' }
  },
  'Gujarat': {
    territories: ['Saurashtra', 'South Gujarat', 'North Gujarat'],
    hierarchy: { RBM: 'P. Joshi', AM: 'V. Patel', DBM: 'R. Shah' }
  }
};

const CROPS_DIVISIONS = {
  VG: {
    crops: {
      'Tomato': {
        varieties: ['Red Ruby', 'Gold Crest', 'Acsen Hybrid T1'],
        unit: 'Packets',
        avgPrice: 450
      },
      'Chilli': {
        varieties: ['Teja Hot', 'Acsen Guntur Special', 'Green Bullet'],
        unit: 'Packets',
        avgPrice: 320
      },
      'Okra': {
        varieties: ['Siri Green', 'Acsen Anamika', 'No. 10'],
        unit: 'KG',
        avgPrice: 180
      },
      'Cabbage': {
        varieties: ['Green Dome', 'Acsen Winner'],
        unit: 'Packets',
        avgPrice: 280
      }
    }
  },
  FC: {
    crops: {
      'Maize': {
        varieties: ['Super Gold 99', 'Acsen Star', 'Kaveri Pro'],
        unit: 'KG',
        avgPrice: 90
      },
      'Paddy': {
        varieties: ['Super Sona', 'Acsen Ponni', 'Samba Deluxe'],
        unit: 'KG',
        avgPrice: 75
      },
      'Cotton': {
        varieties: ['Acsen White Gold', 'Astra Bt2', 'Kalyan'],
        unit: 'Packets',
        avgPrice: 850
      },
      'Mustard': {
        varieties: ['Pusa Bold', 'Acsen Kanti'],
        unit: 'KG',
        avgPrice: 110
      }
    }
  }
};

const SEASONS = ['Kharif', 'Rabi', 'Summer'];

function generateMockData() {
  const data = [];
  let invoiceCounter = 10001;

  // Generate for FY 24-25 (02 Sep 2024 - 31 Mar 2025)
  // ~450 invoices
  generateForPeriod('2024-09-02', '2025-03-31', 'FY2425', 450);

  // Generate for FY 26-27 (01 Apr 2026 - 30 May 2026)
  // ~150 invoices
  generateForPeriod('2026-04-01', '2026-05-30', 'FY2627', 150);

  // Note: FY25-26 (01 Apr 2025 - 31 Mar 2026) is intentionally missing!

  function generateForPeriod(startDateStr, endDateStr, fy, count) {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    const timeDiff = end.getTime() - start.getTime();

    for (let i = 0; i < count; i++) {
      // Random date within range
      const randomTime = start.getTime() + Math.random() * timeDiff;
      const date = new Date(randomTime);
      const dateStr = date.toISOString().split('T')[0];

      // Billing Type distribution
      // F2 (Invoice): 82%, RE (Return): 8%, S1 (Cancelled): 5%, IPT (Stock Transfer): 5%
      const randType = Math.random();
      let billingType = 'F2';
      let billingTypeDescription = 'Standard Invoice';

      if (randType > 0.95) {
        billingType = 'IPT';
        billingTypeDescription = 'Stock Transfer (IPT)';
      } else if (randType > 0.90) {
        billingType = 'S1';
        billingTypeDescription = 'Cancelled Invoice';
      } else if (randType > 0.82) {
        billingType = 'RE';
        billingTypeDescription = 'Returns';
      }

      // Customer
      const channelRand = Math.random();
      let distributionChannel = 'Dealer';
      if (channelRand > 0.7) distributionChannel = 'Distributor';
      else if (channelRand > 0.9) distributionChannel = 'Direct';

      const customerId = Math.floor(100000 + Math.random() * 900000);
      const customerName = `${distributionChannel} ${customerId}`;

      // Division
      const division = Math.random() > 0.4 ? 'VG' : 'FC';
      const divCrops = CROPS_DIVISIONS[division].crops;
      const cropList = Object.keys(divCrops);
      const crop = cropList[Math.floor(Math.random() * cropList.length)];
      
      const cropDetails = divCrops[crop];
      const variety = cropDetails.varieties[Math.floor(Math.random() * cropDetails.varieties.length)];
      const salesUnit = cropDetails.unit;
      const avgPrice = cropDetails.avgPrice;

      // Geography
      const stateList = Object.keys(STATES_DATA);
      const state = stateList[Math.floor(Math.random() * stateList.length)];
      const stateDetails = STATES_DATA[state];
      const territory = stateDetails.territories[Math.floor(Math.random() * stateDetails.territories.length)];
      const hierarchy = stateDetails.hierarchy;

      const ownTrade = Math.random() > 0.2 ? 'Own' : 'Trade';
      const materialCode = `MAT-${Math.floor(10000 + Math.random() * 90000)}`;
      const materialDescription = `${crop} ${variety} Seed (${salesUnit})`;

      // Season (Field Crops only)
      let seasonCode = 'N/A';
      if (division === 'FC') {
        // Map month to season
        const month = date.getMonth(); // 0-11
        if (month >= 5 && month <= 9) seasonCode = 'Kharif'; // June-Oct
        else if (month >= 10 || month <= 1) seasonCode = 'Rabi'; // Nov-Feb
        else seasonCode = 'Summer'; // Mar-May
      }

      // Quantity & Price
      // IPT transactions or large distributors have higher quantity
      let baseQty = Math.floor(10 + Math.random() * 100);
      if (distributionChannel === 'Distributor' || billingType === 'IPT') {
        baseQty = Math.floor(100 + Math.random() * 1000);
      }
      
      const qty = baseQty;
      const salesPrice = Math.round(avgPrice * (0.9 + Math.random() * 0.2)); // +/- 10% fluctuation
      
      // Amount calculation
      let salesAmountINR = qty * salesPrice;
      let cogm = Math.round(salesAmountINR * (0.6 + Math.random() * 0.15)); // COGM is ~60-75% of sales

      // In real SAP sheets, returns or cancellations might be signed negative or positive.
      // The PRD says: "Sales Returns shown separately using return transaction types and signed source amounts; display absolute value for readability"
      // We will store all base amounts positive, and write helper selectors in the frontend to aggregate correctly.

      const invoiceId = `INV-${fy}-${invoiceCounter++}`;

      data.push({
        invoiceId,
        date: dateStr,
        fy,
        billingType,
        billingTypeDescription,
        distributionChannel,
        customerId: `CUST-${customerId}`,
        customerName,
        division,
        crop,
        variety,
        salesUnit,
        ownTrade,
        materialCode,
        materialDescription,
        seasonCode,
        state,
        territory,
        territoryInCharge: `${hierarchy.DBM} (DBM)`, // Territory In-charge in SAP is often the local DBM
        am: hierarchy.AM,
        rbm: hierarchy.RBM,
        dbm: hierarchy.DBM,
        qty,
        salesPrice,
        salesAmountINR,
        cogm
      });
    }
  }

  return data;
}

export const mockSalesData = generateMockData();

// Helper to filter data dynamically in React
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

// Aggregation selector helpers
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
