export type Credibility = "Strong" | "Mixed" | "Weak";

export interface CaseSnapshot {
  caseName: string;
  court: string;
  posture: string;
  plaintiff: string;
  defendant: string;
  filed: string;
  outcome: string;
  bottomLine: string;
}

export interface FindingCard {
  category: string;
  title: string;
  detail: string;
  cite: string;
}

export interface ProblemCard extends FindingCard {
  fix: string;
}

export interface CriticalMoment {
  page: string;
  parties: string;
  what: string;
  why: string;
}

export interface WitnessCard {
  name: string;
  role: string;
  credibility: Credibility;
  bestMoment: string;
  worstMoment: string;
  strategicValue: string;
}

export interface ObjectionRow {
  party: string;
  grounds: string;
  ruling: string;
  significance: string;
}

export interface JuryChargeIssue {
  dispute: string;
  plaintiffArg: string;
  defenseArg: string;
  resolution: string;
  impact: string;
}

export interface AnalysisResult {
  caseSnapshot: CaseSnapshot;
  wentWell: FindingCard[];
  wentPoorly: ProblemCard[];
  criticalMoments: CriticalMoment[];
  witnesses: WitnessCard[];
  objections: ObjectionRow[];
  juryChargeIssues: JuryChargeIssue[];
  recommendations: string[];
}

export interface StoredCase {
  id: string;
  caseName: string;
  createdAt: number;
  truncated: boolean;
  result: AnalysisResult;
  missingSections?: string[];
}