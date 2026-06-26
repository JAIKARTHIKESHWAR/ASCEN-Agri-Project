import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CSV_PATH = join(__dirname, '..', '..', 'sample_sap_sales.csv');

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

function generateCSV() {
  const rows = [];
  const headers = [
    'Invoice ID', 'Date', 'Billing Type', 'Billing Type Description', 'Distribution Channel',
    'Customer ID', 'Customer Name', 'Division', 'Crop', 'Variety', 'Sales Unit', 'Own/Trade',
    'Material Code', 'Material Description', 'Season Code', 'State', 'Territory', 'AM', 'RBM', 'DBM',
    'Quantity', 'Sales Price', 'Amount INR', 'COGM'
  ];
  rows.push(headers.join(','));

  let invoiceCounter = 10001;

  // FY 24-25
  generateForPeriod('2024-09-02', '2025-03-31', 'FY2425', 450);
  // FY 26-27
  generateForPeriod('2026-04-01', '2026-05-30', 'FY2627', 150);

  function generateForPeriod(startDateStr, endDateStr, fy, count) {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    const timeDiff = end.getTime() - start.getTime();

    for (let i = 0; i < count; i++) {
      const randomTime = start.getTime() + Math.random() * timeDiff;
      const date = new Date(randomTime);
      const dateStr = date.toISOString().split('T')[0];

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

      const channelRand = Math.random();
      let distributionChannel = 'Dealer';
      if (channelRand > 0.7) distributionChannel = 'Distributor';
      else if (channelRand > 0.9) distributionChannel = 'Direct';

      const customerId = Math.floor(100000 + Math.random() * 900000);
      const customerName = `"${distributionChannel} ${customerId}"`;

      const division = Math.random() > 0.4 ? 'VG' : 'FC';
      const divCrops = CROPS_DIVISIONS[division].crops;
      const cropList = Object.keys(divCrops);
      const crop = cropList[Math.floor(Math.random() * cropList.length)];
      
      const cropDetails = divCrops[crop];
      const variety = cropDetails.varieties[Math.floor(Math.random() * cropDetails.varieties.length)];
      const salesUnit = cropDetails.unit;
      const avgPrice = cropDetails.avgPrice;

      const stateList = Object.keys(STATES_DATA);
      const state = stateList[Math.floor(Math.random() * stateList.length)];
      const stateDetails = STATES_DATA[state];
      const territory = stateDetails.territories[Math.floor(Math.random() * stateDetails.territories.length)];
      const hierarchy = stateDetails.hierarchy;

      const ownTrade = Math.random() > 0.2 ? 'Own' : 'Trade';
      const materialCode = `MAT-${Math.floor(10000 + Math.random() * 90000)}`;
      const materialDescription = `"${crop} ${variety} Seed (${salesUnit})"`;

      let seasonCode = 'N/A';
      if (division === 'FC') {
        const month = date.getMonth();
        if (month >= 5 && month <= 9) seasonCode = 'Kharif';
        else if (month >= 10 || month <= 1) seasonCode = 'Rabi';
        else seasonCode = 'Summer';
      }

      let baseQty = Math.floor(10 + Math.random() * 100);
      if (distributionChannel === 'Distributor' || billingType === 'IPT') {
        baseQty = Math.floor(100 + Math.random() * 1000);
      }
      
      const qty = baseQty;
      const salesPrice = Math.round(avgPrice * (0.9 + Math.random() * 0.2));
      const salesAmountINR = qty * salesPrice;
      const cogm = Math.round(salesAmountINR * (0.6 + Math.random() * 0.15));

      const invoiceId = `INV-${fy}-${invoiceCounter++}`;

      const row = [
        invoiceId, dateStr, billingType, billingTypeDescription, distributionChannel,
        `CUST-${customerId}`, customerName, division, crop, variety, salesUnit, ownTrade,
        materialCode, materialDescription, seasonCode, state, territory, hierarchy.AM, hierarchy.RBM, hierarchy.DBM,
        qty, salesPrice, salesAmountINR, cogm
      ];
      rows.push(row.join(','));
    }
  }

  fs.writeFileSync(CSV_PATH, rows.join('\n'), 'utf-8');
  console.log(`Generated CSV data successfully with ${rows.length - 1} records written to ${CSV_PATH}`);
}

generateCSV();
