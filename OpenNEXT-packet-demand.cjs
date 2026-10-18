'use strict';

// Factual snapshot of the public demand board, not a native buyer account or executable order.
// Adapter keys are stable local identifiers: the public board does not expose individual request IDs.
const SOURCE_URL = 'https://packet.ai/demand';
const OBSERVED_AT = '2026-10-18T15:29:31.000Z';

const PACKET_APPROVED_BATCH = Object.freeze({
  id: 'packet-demand-approved-2026-10-18',
  sourceId: 'packet-ai',
  sourceName: 'Packet.ai',
  observedAt: OBSERVED_AT,
  approvedAt: OBSERVED_AT,
  approvalReference: 'User explicitly approved the current 14 Packet.ai public demands for the production Terminal.',
  approvalReason: 'User explicitly approved the current 14 Packet.ai public demands for the production Terminal.',
  expectedCount: 14,
});

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function demand(externalId, model, nodes, regionLabel, regionScope, targetPrice, rentalMonths, description, extra = {}) {
  const range = Array.isArray(nodes);
  return {
    externalId,
    externalIdKind: 'adapter-key',
    sourceUrl: SOURCE_URL,
    observedAt: OBSERVED_AT,
    model,
    modelOptions: [model],
    modelBudgets: {[model]: targetPrice},
    title: `${range ? nodes.join('-') : nodes} ${model} ${nodes === 1 ? 'node' : 'nodes'}`,
    regionLabel,
    regionScope,
    quantity: {
      ...(range ? {minNodes: nodes[0], maxNodes: nodes[1]} : {nodes}),
      gpusPerNode: 8,
      totalGpusMin: (range ? nodes[0] : nodes) * 8,
      sourceMinimum: true,
    },
    rentalMonths,
    targetPrice,
    currency: 'USD',
    priceUnit: 'GPU-hour',
    urgency: 'Standard',
    sourcedUrgency: 'Medium urgency',
    description,
    ...extra,
  };
}

const ANNUAL = {min: 12, preferred: 12};
const PACKET_DEMANDS = freeze([
  demand('h200-128-worldwide', 'H200', 128, 'Worldwide', {type: 'worldwide'}, 1.80,
    {...ANNUAL, notes: 'The board lists a 12-month minimum but also mentions a short-term requirement. Confirm the term with operations.'},
    'Large H200 deployment for a Middle East customer; minor configuration changes may be considered.'),
  demand('b200-128-europe', 'B200', 128, 'Europe', {type: 'europe'}, 2.30, ANNUAL,
    'European B200 cluster. Frankfurt, Amsterdam and Paris are acceptable locations.'),
  demand('h100-128-worldwide', 'H100', 128, 'Worldwide', {type: 'worldwide'}, 1.60, ANNUAL,
    'H100 deployment with standard HGX connectivity and storage.'),
  demand('b200-h200-100-worldwide', 'B200', 100, 'Worldwide', {type: 'worldwide'}, 3.00, ANNUAL,
    'B200 or H200 training cluster with dedicated InfiniBand. The target rate depends on the selected GPU.', {
      title: '100 B200 / H200 nodes',
      modelOptions: ['B200', 'H200'],
      modelBudgets: {B200: 3.00, H200: 1.70},
    }),
  demand('b200-64-california', 'B200', 64, 'California, United States', {type: 'countries', countries: ['US']}, 2.80, ANNUAL,
    'California preferred. Requires fast interconnects, dedicated bandwidth and round-the-clock technical support.'),
  demand('b200-64-128-us-uk', 'B200', [64, 128], 'United States / United Kingdom', {type: 'countries', countries: ['US', 'GB']}, 2.80,
    {min: 12, max: 24, options: [12, 24], preferred: 24},
    'Training and fine-tuning cluster in a US Tier 3 facility or the UK. Requires 400 Gb/s Quantum-2 InfiniBand or RoCEv2, 1.8 TB/s NVLink/NVSwitch, 1.5 TB HBM3e per node and local NVMe.'),
  demand('h200-20-flexible', 'H200', 20, 'Flexible location', {type: 'flexible'}, 1.40, ANNUAL,
    'H200 cluster with flexibility on location and detailed configuration.'),
  demand('b300-16-us', 'B300', 16, 'United States', {type: 'countries', countries: ['US']}, 4.40, ANNUAL,
    'Texas preferred; Tier 3 equivalent facility. Requires 6.4 Tbps InfiniBand, dual 400 Gbps Spectrum links, dedicated 100 Gbps internet per node and 2 PB hot storage.'),
  demand('b200-16-us', 'B200', 16, 'United States', {type: 'countries', countries: ['US']}, 3.90,
    {min: 6, max: 12, preferred: 12},
    'US Tier 3 B200 deployment with standard storage and interconnects.'),
  demand('h100-10-flexible', 'H100', 10, 'Flexible location', {type: 'flexible'}, 1.25, ANNUAL,
    'H100 capacity with location flexibility and a competitive target rate.'),
  demand('b200-4-flexible', 'B200', 4, 'Flexible location', {type: 'flexible'}, 2.30, ANNUAL,
    'B200 capacity for production inference and model fine-tuning.'),
  demand('h200-4-eu', 'H200', 4, 'European Union', {type: 'europe', unionOnly: true}, 1.85,
    {min: 6, preferred: 6},
    'EU-based H200 deployment; standard HGX networking is acceptable.'),
  demand('h200-1-us', 'H200', 1, 'United States', {type: 'countries', countries: ['US']}, 2.00, ANNUAL,
    'Requires BIOS-enabled Intel TDX, HGX Hopper firmware 1.7.0+, SEV/SNP compatibility, NVLink/NVSwitch, dedicated public IPv4 without CGNAT, OS firewall control and Ubuntu 25.10. RoCEv2 is acceptable.'),
  demand('b200-1-2-us', 'B200', [1, 2], 'United States', {type: 'countries', countries: ['US']}, 3.00,
    {min: 6, preferred: 6, notes: 'Longer commitments may be considered.'},
    'US preferred for inference. Requires fast local NVMe and at least 2 TB system RAM; standard HGX networking is sufficient.'),
]);

function listPacketDemands() { return PACKET_DEMANDS; }

module.exports = {SOURCE_URL, OBSERVED_AT, PACKET_APPROVED_BATCH, PACKET_DEMANDS, listPacketDemands};
