/**
 * Homepage market cards (legacy OpenNEXT-home-listings.js). Prices are dated observations, not
 * firm OpenNEXT stock. Source metadata is intentionally retained for maintenance, not rendered.
 * Model: official references or exact-SKU supplier quotes, labelled separately.
 * Rental: buyer targets, not seller asks.
 * Hardware: whole-card or whole-server prices; never divide servers into GPUs.
 */
import { MODEL_QUOTES, type ModelQuote } from './model-quotes';

const observedAt = '2026-10-13';

export interface OfficialModelReference {
  id: string;
  sku?: string;
  name: string;
  brand: string;
  input: number;
  output: number;
  context: string;
  note: string;
  sourceUrl: string | null;
  kind: 'model';
  priceKind: 'public_api_reference';
  sourceLabel: string;
  unit: 'USD / 1M tokens';
  observedAt: string;
}

/** A supplier quote presented as a model listing (takes precedence over an official reference). */
export type SupplierModelListing = ModelQuote & {
  id: string;
  kind: 'model';
  sourceUrl: null;
  observedAt: string;
};

export type ModelListing = OfficialModelReference | SupplierModelListing;

export interface RentalReference {
  id: string;
  kind: 'rental';
  model: string;
  name: string;
  nodes: string;
  count: string;
  region: string;
  months: number;
  price: number;
  note: string;
  gpusPerNode: 8;
  urgency: string;
  priceKind: 'buyer_target';
  unit: 'USD / GPU-hour';
  observedAt: string;
  sourceUrl: string;
}

export interface HardwareReference {
  id: string;
  name: string;
  model: string;
  memory: string;
  form: string;
  price: number;
  unit: string;
  minimum: string;
  note: string;
  condition?: string;
  status?: string;
  sourceUrl: string;
  kind: 'hardware';
  priceKind: 'reference_purchase';
  observedAt: string;
}

export type CatalogItem = ModelListing | RentalReference | HardwareReference;

type RentalRow = [string, string, string, string, string, number, number, string];

const officialRows = [
  {
    id: 'model-gpt-sol',
    name: 'GPT-6.1 Sol',
    brand: 'OpenAI',
    input: 2,
    output: 10,
    context: '272K price tier',
    note: 'Standard tier · input up to 272K tokens.',
    sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol',
  },
  {
    id: 'model-claude-sonnet',
    name: 'Claude Sonnet 5.5',
    brand: 'Anthropic',
    input: 2,
    output: 10,
    context: '1M context',
    note: 'Standard global routing · tools billed separately.',
    sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
  {
    id: 'model-gemini-flash',
    name: 'Gemini 3.8 Flash',
    brand: 'Google',
    input: 0.75,
    output: 3.75,
    context: 'Paid standard',
    note: 'Current rate through 31 Dec 2026 · thinking included.',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash',
  },
  {
    id: 'model-deepseek-flash',
    name: 'DeepSeek V4.1 Flash',
    brand: 'DeepSeek',
    input: 0.3,
    output: 1.2,
    context: '1M context',
    note: 'Peak-hour, non-cached rate · off-peak pricing varies.',
    sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing/',
  },
  {
    id: 'model-kimi',
    name: 'Kimi K2.6',
    brand: 'Kimi',
    input: 0.95,
    output: 4,
    context: '256K context',
    note: 'Non-cached input · taxes excluded.',
    sourceUrl: 'https://platform.kimi.ai/docs/pricing/chat',
  },
  {
    id: 'model-glm',
    name: 'GLM-5.3',
    brand: 'GLM',
    input: 1.4,
    output: 4.4,
    context: '1M context',
    note: 'Standard USD API rate · reasoning enabled.',
    sourceUrl: 'https://docs.z.ai/guides/overview/pricing',
  },
  {
    id: 'model-gpt-luna',
    name: 'GPT-6 Luna',
    brand: 'OpenAI',
    input: 0.1,
    output: 0.5,
    context: '272K price tier',
    note: 'Standard tier · input up to 272K tokens.',
    sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-6-luna',
  },
  {
    id: 'model-claude-opus',
    name: 'Claude Opus 5.5',
    brand: 'Anthropic',
    input: 4,
    output: 20,
    context: '1M context',
    note: 'Standard global routing · Fast mode not included.',
    sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
  {
    id: 'model-gemini-lite',
    sku: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite',
    brand: 'Google',
    input: 0.3,
    output: 2.5,
    context: 'Text API',
    note: 'Paid standard text · thinking included.',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite',
  },
  {
    id: 'model-deepseek-pro',
    name: 'DeepSeek V4 Pro',
    brand: 'DeepSeek',
    input: 1.32,
    output: 3.96,
    context: '1M context',
    note: 'V4-Pro-0813 · peak-hour, non-cached rate.',
    sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing/',
  },
  {
    id: 'model-gpt-astra',
    name: 'GPT-6 Astra',
    brand: 'OpenAI',
    input: 10,
    output: 50,
    context: '272K price tier',
    note: 'Standard tier · input up to 272K tokens.',
    sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-6-astra',
  },
  {
    id: 'model-claude-haiku',
    name: 'Claude Haiku 5.5',
    brand: 'Anthropic',
    input: 0.1,
    output: 0.5,
    context: '100K price tier',
    note: 'Input up to 100K · longer requests use a higher tier.',
    sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
].map(
  (item): OfficialModelReference => ({
    ...item,
    kind: 'model',
    priceKind: 'public_api_reference',
    sourceLabel: 'Official reference',
    unit: 'USD / 1M tokens',
    observedAt,
  }),
);

const supplierModels: SupplierModelListing[] = MODEL_QUOTES.map((quote) => {
  const reference = officialRows.find((item) => item.sku === quote.sku);
  return {
    ...quote,
    id: reference?.id || 'model-quote-' + quote.sku,
    kind: 'model',
    sourceUrl: null,
    observedAt: quote.recordedAt,
  };
});
const supplierSkus = new Set(supplierModels.map((item) => item.sku));
export const MODEL_LISTINGS: ModelListing[] = [
  ...supplierModels,
  ...officialRows.filter((item) => !supplierSkus.has(item.sku ?? '')),
];
export const OFFICIAL_MODELS: OfficialModelReference[] = officialRows;

const rentalRows = (
  [
    [
      'rental-h200-128',
      'H200',
      '128',
      '1,024+',
      'Worldwide',
      12,
      1.8,
      'Flexible specification · large-cluster requirement.',
    ],
    [
      'rental-b200-128',
      'B200',
      '128',
      '1,024+',
      'Europe',
      12,
      2.3,
      'Frankfurt, Amsterdam or Paris · annual commitment.',
    ],
    [
      'rental-h100-128',
      'H100',
      '128',
      '1,024+',
      'Worldwide',
      12,
      1.6,
      'HGX cluster · standard network and storage.',
    ],
    [
      'rental-b200-100',
      'B200',
      '100',
      '800+',
      'Worldwide',
      12,
      3.0,
      'B200 / H200 alternatives · dedicated InfiniBand.',
    ],
    [
      'rental-b200-64',
      'B200',
      '64',
      '512+',
      'California',
      12,
      2.8,
      'High-speed interconnect · dedicated bandwidth.',
    ],
    [
      'rental-b200-64-128',
      'B200',
      '64–128',
      '512+',
      'US · UK',
      12,
      2.8,
      '400 Gb/s InfiniBand or RoCEv2 · 12–24 months.',
    ],
    [
      'rental-h200-20',
      'H200',
      '20',
      '160+',
      'Flexible',
      12,
      1.4,
      'Annual commitment · flexible location.',
    ],
    [
      'rental-b300-16',
      'B300',
      '16',
      '128+',
      'United States',
      12,
      4.4,
      'Texas preferred · high-bandwidth network and storage.',
    ],
    [
      'rental-b200-16',
      'B200',
      '16',
      '128+',
      'United States',
      6,
      3.9,
      'Tier 3 data center · 6–12 month commitment.',
    ],
    [
      'rental-h100-10',
      'H100',
      '10',
      '80+',
      'Flexible',
      12,
      1.25,
      'Annual cluster requirement · open location.',
    ],
    [
      'rental-b200-4',
      'B200',
      '4',
      '32+',
      'Flexible',
      12,
      2.3,
      'Production inference and fine-tuning.',
    ],
    [
      'rental-h200-4',
      'H200',
      '4',
      '32+',
      'European Union',
      6,
      1.85,
      'Six-month commitment · HGX networking.',
    ],
    [
      'rental-h200-1',
      'H200',
      '1',
      '8+',
      'United States',
      12,
      2.0,
      'Confidential-compute requirements · dedicated IPv4.',
    ],
    [
      'rental-b200-1-2',
      'B200',
      '1–2',
      '8+',
      'United States',
      6,
      3.0,
      'Inference workload · local NVMe and 2 TB+ RAM.',
    ],
  ] as RentalRow[]
).map(
  ([id, model, nodes, count, region, months, price, note]): RentalReference => ({
    id,
    kind: 'rental',
    model,
    name: `${nodes} ${model} ${nodes === '1' ? 'node' : 'nodes'}`,
    nodes,
    count,
    region,
    months,
    price,
    note,
    gpusPerNode: 8,
    urgency: 'Medium urgency',
    priceKind: 'buyer_target',
    unit: 'USD / GPU-hour',
    observedAt,
    sourceUrl: 'https://packet.ai/demand',
  }),
);
export const RENTAL_REFERENCES: RentalReference[] = rentalRows;

const hardwareRows = [
  {
    id: 'hardware-h100',
    name: 'H100 PCIe',
    model: 'H100',
    memory: '80 GB HBM3',
    form: 'PCIe',
    price: 39500,
    unit: 'GPU',
    minimum: '1 GPU',
    note: 'Datacenter accelerator · new card.',
    condition: 'Brand new',
    sourceUrl: 'https://www.serversupply.com/GPU/HBM2E/80GB/NVIDIA/900-21010-0300-030_399240.htm',
  },
  {
    id: 'hardware-h200',
    name: 'H200 NVL',
    model: 'H200',
    memory: '141 GB HBM3e',
    form: 'PCIe Gen 5',
    price: 34500,
    unit: 'GPU',
    minimum: '20 GPUs',
    note: '20–49 GPU price tier · condition to be confirmed.',
    sourceUrl: 'https://gatewellusa.com/ai-compute/p/nvidia-h200-nvl',
  },
  {
    id: 'hardware-a100',
    name: 'A100 80 GB',
    model: 'A100',
    memory: '80 GB ECC',
    form: 'PCIe 4.0',
    price: 19789,
    unit: 'GPU',
    minimum: '1 GPU',
    note: 'Datacenter accelerator · kit configuration.',
    sourceUrl: 'https://www.newegg.com/p/N82E16814133879',
  },
  {
    id: 'hardware-l40s',
    name: 'L40S',
    model: 'L40S',
    memory: '48 GB GDDR6',
    form: 'PCIe 4.0',
    price: 8595,
    unit: 'GPU',
    minimum: '1 GPU',
    note: 'Inference and graphics · limit 1 per customer.',
    sourceUrl: 'https://www.newegg.com/p/N82E16888892001',
  },
  {
    id: 'hardware-5090',
    name: 'RTX 5090 TUF',
    model: 'RTX 5090',
    memory: '32 GB GDDR7',
    form: 'PCIe 5.0',
    price: 4799.99,
    unit: 'GPU',
    minimum: '1 GPU',
    note: 'ASUS TUF Gaming · availability to be confirmed.',
    status: 'Temporarily unavailable',
    sourceUrl:
      'https://www.bhphotovideo.com/c/product/1875530-REG/asus_tuf_rtx5090_32g_gaming_geforce_rtx_5090_tuf.html',
  },
  {
    id: 'hardware-pro-maxq',
    name: 'RTX PRO 6000 Max-Q',
    model: 'RTX PRO 6000',
    memory: '96 GB GDDR7',
    form: 'PCIe · 300 W',
    price: 17499,
    unit: 'GPU',
    minimum: '1 GPU',
    note: 'Blackwell Max-Q · OEM configuration.',
    sourceUrl:
      'https://www.bhphotovideo.com/c/product/1895189-REG/nvidia_900_5g153_2200_000_rtx_pro_6000_blackwell.html',
  },
  {
    id: 'hardware-pro-workstation',
    name: 'RTX PRO 6000 Workstation',
    model: 'RTX PRO 6000',
    memory: '96 GB GDDR7',
    form: 'PCIe · 600 W',
    price: 17999,
    unit: 'GPU',
    minimum: '1 GPU',
    note: 'Blackwell Workstation · OEM · limit 2 per customer.',
    sourceUrl: 'https://www.newegg.com/p/N82E16888892012',
  },
  {
    id: 'hardware-hgx-h100',
    name: '8× HGX H100 server',
    model: 'H100',
    memory: '8 × 80 GB',
    form: '8U · SXM5',
    price: 319924,
    unit: 'server',
    minimum: '1 server',
    note: 'Complete system · NVSwitch · dual EPYC.',
    sourceUrl: 'https://configurator.exxactcorp.com/configure/TS4-193475697',
  },
  {
    id: 'hardware-hgx-b200',
    name: '8× HGX B200 server',
    model: 'B200',
    memory: '8 × 180 GB',
    form: '10U · SXM',
    price: 402198.5,
    unit: 'server',
    minimum: '1 server',
    note: 'Complete system · NVSwitch · dual Xeon.',
    sourceUrl: 'https://configurator.exxactcorp.com/configure/TS4-169219634',
  },
  {
    id: 'hardware-hgx-b300',
    name: '8× HGX B300 server',
    model: 'B300',
    memory: '8 × 288 GB',
    form: '8U · SXM',
    price: 580199.4,
    unit: 'server',
    minimum: '1 server',
    note: 'Complete system · 3 TB DDR5 · NVSwitch.',
    sourceUrl: 'https://configurator.exxactcorp.com/configure/TS4-104366747',
  },
].map(
  (item): HardwareReference => ({
    ...item,
    kind: 'hardware',
    priceKind: 'reference_purchase',
    observedAt,
  }),
);
export const HARDWARE_REFERENCES: HardwareReference[] = hardwareRows;

export type MarketKind = 'rental' | 'model' | 'hardware';
export const MARKET_KINDS: MarketKind[] = ['rental', 'model', 'hardware'];

/** Dated catalog references per market, in tab order (GPU rental, Model capacity, Physical GPUs). */
export const CATALOG_GROUPS: Record<MarketKind, CatalogItem[]> = {
  rental: RENTAL_REFERENCES,
  model: MODEL_LISTINGS,
  hardware: HARDWARE_REFERENCES,
};

export const findCatalogItem = (id: string | null | undefined): CatalogItem | undefined =>
  id
    ? MARKET_KINDS.flatMap((kind) => CATALOG_GROUPS[kind]).find((item) => item.id === id)
    : undefined;
