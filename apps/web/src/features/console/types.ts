/** Browser-local operations dataset (legacy `opennext.operations.v2`). Preview records only. */

export interface Offer {
  id: string;
  provider: string;
  model: string;
  memory: number;
  count: number;
  region: string;
  terms: string;
  rate: number;
  score: number;
  availability: string;
  source: string;
  updated: string;
  record: string;
}
export interface Dataset {
  id: DatasetId;
  name: string;
  count: number;
  file: string;
}
export type DatasetId = 'current' | 'history' | 'providers' | 'specs' | 'inventory';
export interface Schedule {
  id: string;
  name: string;
  provider: string;
  strategy: string;
  instruction: string;
  model: string;
  count: number;
  region: string;
  budget: number;
  interval: number;
  approval: boolean;
  status: 'Active' | 'Paused' | 'Draft' | string;
  last: string;
  next: string;
  runs: number;
}
export interface Run {
  id: string;
  schedule: string;
  name: string;
  status: string;
  trigger: string;
  time: string;
  duration: string;
  records: number;
  log: string[];
}
export interface Order {
  id: string;
  buyer: string;
  seller: string;
  model: string;
  count: number;
  region: string;
  total: number;
  period: string;
  stage: number;
  status: string;
  updated: string;
  events: [string, string][];
}
export interface Instance {
  id: string;
  name: string;
  source: string;
  owner: string;
  model: string;
  count: number;
  region: string;
  host: string;
  port: number;
  fingerprint: string;
  status: string;
  proof: string;
  verified: string;
}
export interface ReviewChecks {
  eligibility: string;
  kyb: string;
  rights: string;
  test: string;
}
export interface User {
  id: string;
  name: string;
  email: string;
  company: string;
  role: string;
  status: string;
  joined: string;
  review: ReviewChecks;
}
export interface Advice {
  id: string;
  title: string;
  desc: string;
  model: string;
  savings: number;
  confidence: number;
  records: number;
  status: string;
  type: string;
}
export interface AgentConfig {
  repo: string;
  publicKey: string;
  requireGPU: boolean;
  pinHost: boolean;
  readOnly: boolean;
  revision: number;
}
export interface Profile {
  name: string;
  email: string;
  company: string;
  timezone: string;
  notifications: boolean;
}
export interface AuditEntry {
  time: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
}
export interface ConsoleDb {
  offers: Offer[];
  datasets: Dataset[];
  schedules: Schedule[];
  runs: Run[];
  orders: Order[];
  instances: Instance[];
  users: User[];
  advisory: Advice[];
  config: AgentConfig;
  profile: Profile;
  audit: AuditEntry[];
  imported?: Partial<Record<DatasetId, Record<string, string>[]>>;
  spendLimit?: number;
}

export interface MarketFilters {
  dataset: DatasetId;
  provider: string;
  model: string;
  count: string;
  region: string;
  terms: string;
  availability: string;
  min: string;
  max: string;
  score: string;
}

export interface ScheduleDraft {
  step: 1 | 2 | 3;
  instruction: string;
  strategy: string;
  name: string;
  model: string;
  count: number;
  region: string;
  budget: number;
  interval: number;
  approval: boolean;
}
