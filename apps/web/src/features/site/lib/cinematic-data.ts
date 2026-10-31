export const navigation = [
  ['The market', 'market'],
  ['Terminal', 'platform'],
  ['Agents', 'agents'],
  ['Our experience', 'experience'],
] as const;
export const productSteps = [
  [
    'Define your requirements',
    'Start with the GPU, location and rental terms your workload needs.',
  ],
  ['Compare your options', 'Bring capacity, configuration and quoted terms into one view.'],
  ['Start the conversation', 'Post an RFQ or request a quote to confirm the right fit.'],
] as const;
export const agentSteps = [
  {
    title: 'Always searching.',
    copy: 'Discover available GPU capacity across the market, around the clock.',
    label: 'Discover',
  },
  {
    title: 'Matching your requirements.',
    copy: 'Compare capacity against your workload, budget, location and rental terms.',
    label: 'Compare',
  },
  {
    title: 'Automatically routed.',
    copy: 'Route your request to matching resources, within the limits you set.',
    label: 'Route',
  },
];
