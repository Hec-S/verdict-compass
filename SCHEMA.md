# VerdictIQ — Case Analysis Schema

## 1. TypeScript schema

The case analysis object is defined as `AnalysisResult` in
`src/lib/analysis-types.ts`. Verbatim:

```ts
// src/lib/analysis-types.ts

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
  ruling: string;        // expected: "Sustained" | "Overruled" | brief description
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

// Wrapper used by the cases library
export interface StoredCase {
  id: string;
  caseName: string;
  createdAt: number;       // ms epoch
  truncated: boolean;
  result: AnalysisResult;
  missingSections?: string[];
}
```

## 2. Required vs optional

The `AnalysisResult` TypeScript type marks **every field as required**. In
practice, after passing through `normalizeResult`
(`src/lib/normalize-result.ts`), the runtime guarantees are:

| Top-level key | TS required | Runtime guarantee after normalize | Notes |
|---|---|---|---|
| `caseSnapshot` | yes | object always present, every string field present (possibly `""`) | tracked in `missing` if absent in raw |
| `wentWell` | yes | always an array (possibly empty) | tracked in `missing` if not array |
| `wentPoorly` | yes | always an array (possibly empty) | tracked in `missing` if not array |
| `criticalMoments` | yes | always an array (possibly empty) | tracked in `missing` if not array |
| `witnesses` | yes | always an array (possibly empty) | tracked in `missing` if not array |
| `objections` | yes | always an array (possibly empty) | tracked in `missing` if not array |
| `juryChargeIssues` | yes | always an array (possibly empty) | tracked in `missing` if not array |
| `recommendations` | yes | always an array (possibly empty) | tracked in `missing` if not array |

Per-item field requirements (e.g. each `WitnessCard.name`, each
`ProblemCard.fix`) are required at the type level but **not validated at
runtime** — they come straight out of Claude's JSON. Empty strings are
expected and handled by the renderer.

`StoredCase.missingSections` is optional; it is present only when the raw
result was missing or malformed for one or more sections.

## 3. Default values

Two layers apply defaults:

### 3a. Worker-side fallback (per Claude call)

If a section call fails (network error, JSON parse error, etc.), the worker
substitutes the section's `fallback` and adds the section key to
`failed_sections` in the `analysis_jobs` row. Defined in
`src/routes/api/analyze.process.ts` (the `SECTIONS` array, lines ~58–149):

```ts
// snapshot
fallback: {
  caseSnapshot: {
    caseName: "", court: "", posture: "",
    plaintiff: "", defendant: "",
    filed: "", outcome: "", bottomLine: "",
  },
  criticalMoments: [],
}

// findings
fallback: { wentWell: [], wentPoorly: [] }

// witnesses
fallback: { witnesses: [], objections: [] }

// recommendations
fallback: { juryChargeIssues: [], recommendations: [] }
```

### 3b. Read-side normalization (`normalizeResult`)

When a stored case is loaded for rendering, every field is coerced and
defaulted in `src/lib/normalize-result.ts`:

| Field | Default |
|---|---|
| `caseSnapshot` (whole) | `{}` (then each string field below filled) |
| `caseSnapshot.caseName` / `court` / `posture` / `plaintiff` / `defendant` / `filed` / `outcome` / `bottomLine` | `""` (via `String(snap.x ?? "")`) |
| `wentWell`, `wentPoorly`, `criticalMoments`, `witnesses`, `objections`, `juryChargeIssues`, `recommendations` | `[]` if not an array |
| `StoredCase.missingSections` | array of any of the above keys whose raw value was absent or non-array; omitted when nothing is missing |

Per-item fields inside the arrays (e.g. `WitnessCard.bestMoment`,
`ProblemCard.fix`) are **not** defaulted by `normalizeResult` — only top-level
shape is normalized. The Dashboard renderer treats missing per-item fields as
empty strings.

## 4. Where the schema is defined

| Concern | File |
|---|---|
| TypeScript types (`AnalysisResult`, `CaseSnapshot`, `FindingCard`, `ProblemCard`, `CriticalMoment`, `WitnessCard`, `ObjectionRow`, `JuryChargeIssue`, `StoredCase`, `Credibility`) | `src/lib/analysis-types.ts` |
| LLM-side JSON schema strings (the `schema` field on each entry of `SECTIONS`) and per-section `fallback` defaults | `src/routes/api/analyze.process.ts` (lines ~58–149) |
| Runtime normalization / default application | `src/lib/normalize-result.ts` (`normalizeResult`, `ARRAY_KEYS`) |
| Persistence shape (`cases.result jsonb`, denormalised `case_snapshot`/`outcome` columns) | `supabase/migrations/*` (table `public.cases`) |
| DB read helper that wraps `normalizeResult` | `src/lib/cases-db.ts` (`getCaseFromDb`) |

The supabase `cases` table stores the entire merged object under a single
`result` jsonb column, with `case_snapshot` and `outcome` denormalised out
for the dashboard list query.

## 5. Rendering components

The schema is rendered by a single component:

| Component | File | Responsibility |
|---|---|---|
| `Dashboard` | `src/components/verdict/Dashboard.tsx` | Renders the entire `AnalysisResult` — snapshot block, "What went well" (`wentWell`), "What didn't go well" (`wentPoorly`), "Critical moments" (`criticalMoments`), "Witness performance" (`witnesses`), "Objections & rulings" (`objections`), "Jury charge issues" (`juryChargeIssues`), and "Defense recommendations" (`recommendations`). Uses `missingSections` to show "section unavailable" affordances. |
| `Panel` | `src/components/verdict/Panel.tsx` | Section-card primitive used by `Dashboard` for each block (title, count, missing/empty states). |

`Dashboard` is mounted by the route `src/routes/case.$id.tsx` (`CasePage`),
which loads the `StoredCase` via `getCaseFromDb` and passes it through.

## 6. Variation by document type

**The schema does not vary by document type.** Every analysis returns
exactly one `AnalysisResult` shape with the same eight top-level keys, and
the renderer always tries to draw all eight sections.

Specifically:

- The upload zone (`src/components/verdict/UploadZone.tsx`) accepts only PDFs,
  with no per-file or per-volume tagging.
- The pipeline performs **no document-type classification**. Every upload is
  treated as a litigation transcript and run through the same compression +
  4 section calls (see `ARCHITECTURE.md` §5 and `PROMPTS.md`).
- The only "perspective" variant is `USER_ROLE` in `src/lib/user-role.ts`
  (currently hard-coded to `"defense"`). Switching it would change the
  *content* and tone of the same fields (e.g. `wentWell` would mean wins for
  the plaintiff), but the **shape** of `AnalysisResult` would be identical.
- The only place categorical variation surfaces inside the schema is in the
  free-form `category` strings of `FindingCard` / `ProblemCard`, which the
  Claude prompt constrains to a fixed enum (not enforced in code):
  - `wentWell.category` ∈ { `Cross-Examination`, `Impeachment`, `Evidence`, `Witness Testimony`, `Objection`, `Jury Charge`, `Strategy` }
  - `wentPoorly.category` ∈ { `Cross-Examination`, `Witness Preparation`, `Evidence`, `Objection`, `Strategy`, `Damages` }

If document-type-specific schemas (e.g. depositions, motions, appellate
briefs) are ever needed, the natural extension points are:
1. Add a discriminator field to `AnalysisResult` (e.g. `kind: "trial" | "deposition" | ...`).
2. Branch the `SECTIONS` array in `analyze.process.ts` on that discriminator.
3. Update `normalizeResult` and `Dashboard` to render conditionally per kind.
