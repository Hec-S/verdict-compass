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
  /** Per-stage server trace (additive — present when the worker recorded it). */
  serverTrace?: Array<{ ts: string; stage: string; data: Record<string, unknown> }>;
}

// ============= Matter Synthesis types =============

export interface DepositionCard {
  caseId: string;
  deponentName: string;
  /** "Plaintiff" | "Defendant" | "Treating physician" | "Retained expert" | "Fact witness" | "Third party" | other free-text */
  deponentRole: string;
  dateTaken: string;
  keyAdmissions: Array<{
    topic: string;
    admission: string;
    cite: string;
    impeachmentValue: "high" | "medium" | "low";
  }>;
  vulnerabilities: Array<{ issue: string; detail: string; cite: string }>;
  methodologyIssues: string[];
  biasIndicators: Array<{ type: string; detail: string; cite: string }>;
  contradictionsWithOtherWitnesses: string[];
  priorConditionsDisclosed: string[];
  unresolvedQuestions: string[];
  dangerToDefense: "high" | "medium" | "low";
  dangerRationale: string;
}

export interface CaseSynthesis {
  matterId: string;
  execSummary: {
    defenseTheory: string;
    caseStrength: "strong" | "favorable" | "mixed" | "unfavorable" | "weak";
    strengthRationale: string;
    topThreats: string[];
    topOpportunities: string[];
    recommendedPosture:
      | "trial"
      | "settle_low"
      | "settle_midrange"
      | "settle_high"
      | "more_discovery";
    postureRationale: string;
  };
  witnessThreatRanking: Array<{
    caseId: string;
    deponentName: string;
    rank: number;
    threatLevel: "high" | "medium" | "low";
    summary: string;
    crossPriorities: string[];
  }>;
  contradictionMatrix: Array<{
    topic: string;
    witnesses: Array<{
      caseId: string;
      deponentName: string;
      position: string;
      cite: string;
    }>;
    exploitability: "high" | "medium" | "low";
    defenseUse: string;
  }>;
  unifiedAdmissionsInventory: Array<{
    topic: string;
    admissions: Array<{
      caseId: string;
      deponentName: string;
      admission: string;
      cite: string;
    }>;
    trialUse: string;
  }>;
  causationAnalysis: {
    baselineConditions: string[];
    priorAccidentSequelae: string[];
    accidentMechanism: string;
    apportionmentArguments: string[];
    weakestCausationLink: string;
  };
  methodologyChallenges: Array<{
    targetWitness: string;
    caseId: string;
    basis: string;
    motionType: "Daubert" | "motion_in_limine" | "limit_testimony" | "exclude";
    supportingCites: string[];
  }>;
  biasNarrative: {
    pipelineMap: string;
    financialRelationships: string[];
    repeatPlayerPatterns: string[];
    trialNarrative: string;
  };
  motionsInLimine: Array<{
    motion: string;
    basis: string;
    supportingCites: string[];
    priority: "must_file" | "should_file" | "consider";
  }>;
  discoveryGaps: Array<{
    gap: string;
    impact: string;
    recommendedAction: string;
    priority: "high" | "medium" | "low";
  }>;
  trialThemes: Array<{
    theme: string;
    supportingWitnesses: string[];
    supportingFacts: string[];
    voirDireAngle: string;
  }>;
  whatWeMessedUp: Array<{
    deposition: string;
    caseId: string;
    missedOpportunity: string;
    wouldHaveHelped: string;
    canStillFix: boolean;
    fixAction: string;
  }>;
  whatToDoNext: Array<{
    action: string;
    priority: "this_week" | "before_trial" | "consider";
    rationale: string;
  }>;
}

export interface MatterSynthesisRow {
  id: string;
  matterId: string;
  result: CaseSynthesis | null;
  caseIds: string[];
  createdAt: number;
  status:
    | "pending"
    | "processing"
    | "complete"
    | "complete_with_errors"
    | "error";
  progress: number;
  progressMessage: string | null;
  error: string | null;
  failedSections: string[];
}