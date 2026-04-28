# VerdictIQ — Document Classification Audit

## 1. Does any document classification logic exist?

**No.** A repo-wide search for keywords related to document type detection,
categorization, or content-based routing turns up only three matches, none of
which classify the input document:

| Match | File | What it actually is |
|---|---|---|
| "classifying a witness…" | `src/lib/user-role.ts:19` (`isOurWitness`) | Per-witness side detection (defense vs plaintiff witness) based on a free-text `role` string. Not document classification. |
| "Categories for wentWell: …" | `src/routes/api/analyze.process.ts:106` | Enum guidance baked into the `findings` Claude prompt for the `category` field on each finding card. Not document classification. |
| "Categories for wentPoorly: …" | `src/routes/api/analyze.process.ts:107` | Same as above. |

There is no function, prompt, regex, heuristic, or model call anywhere in
`src/` that decides "what kind of document is this?" before (or during)
analysis.

## 2. Document categories the system recognizes

**None.** The system does not enumerate document categories. The closest
constraints in the pipeline are:

- **Upload filter** (`src/components/verdict/UploadZone.tsx`): accepts files
  whose MIME is `application/pdf` or whose name ends in `.pdf`. Anything else
  is silently dropped. This is a file-format filter, not a content category.
- **Implicit assumption**: every prompt in `src/routes/api/analyze.process.ts`
  assumes the input is a **trial transcript** (mentions of "court reporter
  certificate", "witness", "objection", "jury charge conference", "directed
  verdict motions"). Depositions, motions, appellate opinions, complaints,
  contracts, etc. would still be accepted by the upload zone and pushed
  through the same pipeline — they would just produce poor results.

The only enums present anywhere in the pipeline are downstream of analysis,
not upstream of routing:

- `wentWell.category` ∈ { Cross-Examination, Impeachment, Evidence, Witness Testimony, Objection, Jury Charge, Strategy } (prompt-only, not enforced)
- `wentPoorly.category` ∈ { Cross-Examination, Witness Preparation, Evidence, Objection, Strategy, Damages } (prompt-only, not enforced)
- `Credibility` ∈ { "Strong", "Mixed", "Weak" } (`src/lib/analysis-types.ts`)
- `USER_ROLE` ∈ { "defense" } (`src/lib/user-role.ts`) — perspective, not document type

## 3. Downstream use of a classification result

**Not applicable** — there is no classification result to consume. Every
upload flows through identical stages with identical prompts and produces
the identical `AnalysisResult` shape (see `SCHEMA.md` §6):

```
PDF(s) → extractPdfText → cleanTranscript → combineAndCap (60k cap)
       → POST /api/analyze/submit  (insert analysis_jobs row)
       → POST /api/analyze/process (runJob)
            → Call 0: compression  (one prompt)
            → Call 1: snapshot     (same prompt every time)
            → Call 2: findings     (same prompt every time)
            → Call 3: witnesses    (same prompt every time)
            → Call 4: recommendations (same prompt every time)
       → insert into cases
       → render <Dashboard /> (same component for all results)
```

There is no template selection, no prompt branching, and no render-time
branching based on document content. The only "branch" anywhere in the
pipeline is the conditional Findings retry (`Call 2b` in `PROMPTS.md`),
which is triggered by **empty result arrays**, not by document type.

## 4. Natural place to add classification

If document-type classification is ever added, the natural insertion point
is **immediately before the compression call inside `runJob`** in
`src/routes/api/analyze.process.ts` (between line 226 — the first
`updateJob` call announcing "Reading the transcript…" — and line 233 — where
the compression call begins).

Recommended structure:

1. **Define the enum and types** in `src/lib/analysis-types.ts`:
   ```ts
   export type DocumentKind =
     | "trial-transcript"
     | "deposition"
     | "motion"
     | "appellate-opinion"
     | "other";
   ```
   …and add `kind: DocumentKind` to `AnalysisResult` (and its DB column on
   `cases`).

2. **Add a classifier call** as a new `SECTIONS[-1]` step (or a dedicated
   pre-step) in `src/routes/api/analyze.process.ts`. A small, fast Claude
   call returning `{ "kind": "<one of the enum values>", "confidence": 0..1 }`
   is the lowest-risk shape; alternatively a regex/keyword heuristic on the
   first ~5,000 chars of the cleaned transcript would avoid an extra LLM
   round-trip.

3. **Branch downstream behavior** in three places:
   - `SECTIONS` (or the prompts inside it) in `analyze.process.ts` — swap
     prompt instructions per kind (e.g. depositions have no "jury charge").
   - `normalizeResult` in `src/lib/normalize-result.ts` — relax the required
     array set per kind so missing-but-irrelevant sections don't get tagged
     as `missing`.
   - `Dashboard` in `src/components/verdict/Dashboard.tsx` — hide
     non-applicable panels (e.g. hide "Jury charge issues" when
     `kind !== "trial-transcript"`).

4. **Optionally surface the kind in the UI** in the snapshot block via a
   small chip next to the case name.

A simpler interim option (no schema change) is to add the classifier as a
read-only field on `cases` (`document_kind text`) used only for filtering on
the dashboard list, leaving the analysis pipeline unchanged. This isolates
the new logic to one column and one query and defers the harder downstream
branching work.
