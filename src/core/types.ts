export type BondState = "bound" | "honored" | "breached" | "disputed" | "cancelled";

export interface Bond {
  id: number;
  principal: string;
  obligor: string;
  faceValue: bigint;
  premium: bigint;
  collateral: bigint;
  premiumBps: number;
  lossRateBps: number;
  riskMult: number;
  deadline: number;
  state: BondState;
  criteria: string;
  artifactUrl: string;
  verdictNote: string;
}

export interface AgentView {
  address: string;
  label: string;
  weightedFailures: number;
  weightedHonored: number;
  effectiveSettlements: number;
  bondsBound: number;
  faceBonded: bigint;
  collateralLost: bigint;
  liveExposure: bigint;
  lossRateBps: number;
  basePremiumBps: number;
  collateralBps: number;
  evidenced: boolean;
}

export interface PoolView {
  capital: bigint;
  allocated: bigint;
  free: bigint;
  utilisationBps: number;
  premiumsEarned: bigint;
  claimsPaid: bigint;
  openBonds: number;
}

export interface BindRequest {
  principal: string;
  obligor: string;
  faceValue: bigint;
  durationHours: number;
  criteria: string;
}

export interface Backend {
  readonly mode: "simulated" | "live";
  readonly account: string;
  pool(): Promise<PoolView>;
  agents(): Promise<AgentView[]>;
  agent(address: string): Promise<AgentView>;
  book(limit: number): Promise<Bond[]>;
  bind(request: BindRequest): Promise<{ bondId: number; riskMult: number; driver: string }>;
  submitDelivery(bondId: number, artifactUrl: string): Promise<void>;
  settle(bondId: number): Promise<{ state: BondState; note: string; nextPremiumBps: number }>;
  stake(amount: bigint): Promise<void>;
}
