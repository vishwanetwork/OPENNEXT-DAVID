// Display examples supplied in the user's reference. Not a live inventory feed.
// Source: OPENNEXT-DAVID legacy/OpenNEXT-demo-fixtures.cjs, Reserved offers.
// Never pass fixture IDs into a real checkout. All cards open the Buyer Market.
export const capacityOffers = [
  {
    title: 'H200 dedicated capacity',
    region: 'United Kingdom',
    gpus: 128,
    hours: 2160,
    price: '2.60',
  },
  { title: 'H100 dedicated capacity', region: 'Germany', gpus: 128, hours: 2160, price: '1.98' },
  {
    title: 'H100 PCIe dedicated capacity',
    region: 'Canada',
    gpus: 128,
    hours: 2160,
    price: '1.80',
  },
  { title: 'H100 SXM dedicated capacity', region: 'Japan', gpus: 128, hours: 2160, price: '2.09' },
  {
    title: 'A100 80GB dedicated capacity',
    region: 'Germany',
    gpus: 128,
    hours: 2160,
    price: '1.14',
  },
  {
    title: 'B200 dedicated capacity',
    region: 'United States',
    gpus: 128,
    hours: 2160,
    price: '3.02',
  },
];

export type CapacityOffer = (typeof capacityOffers)[number];
