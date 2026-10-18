'use strict';

// Read-only presentation data. Never insert these records into marketplace stores.
const {createDemoData} = require('./OpenNEXT-demo-fixtures.cjs');

function createReferenceCatalog(now = Date.now()) {
  const data = createDemoData(now);
  const base = (row, side, price) => ({
    id: 'REF-' + row.id, kind: 'rental', side, model: row.model,
    region: row.region, term: row.term, count: row.count, hours: row.hours,
    price: Math.round(Number(price) * 100) / 100,
    provider: side === 'demand' ? 'Buyer requirement' : data.kyb.find(k => k.ownerId === row.ownerId)?.company || row.provider,
    title: row.title || row.model + ' capacity', description: row.notes || '',
    referenceOnly: true, executable: false, provenance: 'demo-fixture-reference',
    biddingParties: null, bestMatch: false,
  });
  return {
    scope: 'reference-only', executable: false, asOf: new Date(now).toISOString(),
    notice: 'Illustrative reference listings. Availability and prices require confirmation. Activity is not verified settlement data.',
    supplies: data.supplies.map(row => base(row, 'supply', row.netPrice)),
    rfqs: data.rfqs.map(row => base(row, 'demand', row.budget)),
    recent: data.orders.map(row => ({...base(row, 'activity', row.unitPrice), provider: row.provider, timeBasis: 'illustrative'})),
  };
}

module.exports = {createReferenceCatalog};
