'use strict';

// Customer-provided public requirements. These are not executable offers or settled orders.
// Server and rack counts are kept separate from GPU counts where the configuration is unspecified.
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const PAYMENT_TERMS = 'Flexible payment arrangements in accordance with the supplier\'s requirements.';
const COMMON = {
  kind: 'rental',
  side: 'demand',
  price: null,
  priceLabel: 'Price on request',
  paymentTerms: PAYMENT_TERMS,
  sourceKind: 'customer_requirement',
  publishedAt: '2026-10-18',
};

const CURATED_RFQS = deepFreeze([
  {
    ...COMMON,
    id: 'CURATED-RFQ-B300-32-NON-US',
    title: '32 B300 servers',
    model: 'B300',
    modelOptions: ['B300'],
    region: 'Outside the United States',
    description: '32 B300 servers outside the United States for a 6- or 12-month rental. Delivery as soon as possible, preferably before early December 2026.',
    quantityLabel: '32 servers',
    quantity: {alternatives: [{model: 'B300', count: 32, unit: 'servers'}]},
    termLabel: '6 or 12 months',
    termMonths: [6, 12],
    deliveryLabel: 'ASAP; preferably before early December 2026',
    specifications: [
      {label: 'Location', value: 'Any region outside the United States'},
      {label: 'Server model', value: 'B300'},
      {label: 'Quantity', value: '32 servers'},
      {label: 'Rental term', value: '6 months or 1 year'},
      {label: 'Deployment', value: 'As soon as possible; preferably before early December 2026'},
      {label: 'Payment', value: PAYMENT_TERMS},
    ],
  },
  {
    ...COMMON,
    id: 'CURATED-RFQ-B300-32-64-CLUSTER',
    title: '32 or 64 B300 servers',
    model: 'B300',
    modelOptions: ['B300'],
    region: 'Worldwide',
    description: '32 or 64 B300 servers operating as one unified cluster. Any region considered, with deployment expected in Q1 2027 and a 1-, 2- or 3-year rental term.',
    quantityLabel: '32 or 64 servers',
    quantity: {alternatives: [{model: 'B300', count: 32, unit: 'servers'}, {model: 'B300', count: 64, unit: 'servers'}]},
    termLabel: '1, 2 or 3 years',
    termMonths: [12, 24, 36],
    deliveryLabel: 'Deployment in Q1 2027',
    specifications: [
      {label: 'Location', value: 'Any region'},
      {label: 'Server model', value: 'B300'},
      {label: 'Quantity', value: '32 or 64 servers'},
      {label: 'Cluster', value: 'All servers must form one unified cluster'},
      {label: 'Rental term', value: '1 year, 2 years or 3 years'},
      {label: 'Deployment', value: 'Expected in Q1 2027'},
      {label: 'Payment', value: PAYMENT_TERMS},
    ],
  },
  {
    ...COMMON,
    id: 'CURATED-RFQ-B300-GB200-GB300-CLUSTER',
    title: 'B300 or GB200 / GB300 cluster',
    model: 'B300',
    modelOptions: ['B300', 'GB200', 'GB300'],
    region: 'Location to confirm',
    description: '8 B300 servers, or 1 rack of GB200 or GB300, operating as one unified cluster. A 6- to 12-month rental is required, with delivery as soon as possible.',
    quantityLabel: '8 B300 servers or 1 GB200 / GB300 rack',
    quantity: {alternatives: [{model: 'B300', count: 8, unit: 'servers'}, {model: 'GB200', count: 1, unit: 'rack'}, {model: 'GB300', count: 1, unit: 'rack'}]},
    termLabel: '6-12 months',
    termMonths: {minimum: 6, maximum: 12},
    deliveryLabel: 'As soon as possible',
    specifications: [
      {label: 'Location', value: 'To be confirmed'},
      {label: 'Hardware options', value: 'B300, GB200 or GB300'},
      {label: 'Quantity', value: '8 B300 servers, or 1 GB200 rack, or 1 GB300 rack'},
      {label: 'Cluster', value: 'The selected hardware must form one unified cluster'},
      {label: 'Rental term', value: '6 months to 1 year'},
      {label: 'Deployment', value: 'As soon as possible'},
      {label: 'Payment', value: PAYMENT_TERMS},
    ],
  },
  {
    ...COMMON,
    id: 'CURATED-RFQ-H200-SINGAPORE-BARE-METAL',
    title: 'H200 bare-metal server',
    model: 'H200',
    modelOptions: ['H200'],
    region: 'Singapore',
    description: '1 dedicated H200 bare-metal server in Singapore, with 8 fully NVSwitch-connected GPUs, exclusive CPU, memory and storage, full Linux root access and non-preemptible service.',
    quantityLabel: '1 server / 8 GPUs',
    quantity: {alternatives: [{model: 'H200', count: 1, unit: 'server', gpusPerServer: 8}]},
    termLabel: 'Term to confirm',
    termMonths: null,
    deliveryLabel: 'Deployment expected by 15 November 2026',
    specifications: [
      {label: 'Location', value: 'Singapore'},
      {label: 'Server model', value: 'H200'},
      {label: 'Quantity', value: '1 server with 8 GPUs'},
      {label: 'GPU interconnect', value: 'Full NVSwitch connectivity across all 8 GPUs'},
      {label: 'Deployment type', value: 'Dedicated bare metal; exclusive CPU, memory and storage resources'},
      {label: 'Access', value: 'Full Linux root access'},
      {label: 'Service', value: 'Non-preemptible'},
      {label: 'System memory', value: 'Approximately 2 TB ECC RAM per node'},
      {label: 'Local storage', value: '30 TB usable NVMe preferred; at least 15 TB usable storage if a lower-cost option is available'},
      {label: 'Rental term', value: 'To be confirmed'},
      {label: 'Deployment', value: 'Expected by 15 November 2026'},
      {label: 'Payment', value: PAYMENT_TERMS},
    ],
  },
]);

function listCuratedRfqs() {
  return CURATED_RFQS;
}

function getCuratedRfq(id) {
  return CURATED_RFQS.find(row => row.id === id) || null;
}

module.exports = {CURATED_RFQS, listCuratedRfqs, getCuratedRfq};
