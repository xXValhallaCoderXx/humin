# Data Recall Analysis — Plan

## Why this exists

**Recall (= coverage) is Humin's value floor.** `mvp.md` §2 names the deep failure mode: the
extractor is *precise on the few commitments it catches but misses most of the real ones*.
Precision is easy to feel good about; recall is where the product silently fails. Precision is the
trust floor; recall is the value floor — and the gate must clear **both** (§7, §18).

This document plans a rigorous recall analysis over real data: measure coverage, enumerate what was
missed, explain *why*, separate true misses from measurement error, and turn that into prioritized
fixes plus a defensible operating point. Scope = the Phase 0 extraction gate in this repo.

## Context bundle (what to hand the analyst / agent)

**Read first**
- `mvp.md` — definition of a commitment, in/out of scope, the §6 metric set, §7 pass/warn/stop
  thresholds, §18/§19 decision rules. This is the ground truth for "what *should* have been caught."
- `README.MD` — how the pipeline runs + architecture decisions.
- this file.

**Inputs (the data under analysis)**
- `data/normalized/capture_events.json` — the normalized message stream the extractor saw (the universe).
- The **gold set** = the recall denominator:
  - real data → `data/gold/gold_commitments.csv`
  - fixture demo → `fixtures/gold_commitments.fixture.csv`
- `data/gold/stream.md` — human-readable threaded stream, for eyeballing context around a miss.

**Outputs (what to analyze)**
- `data/predictions/predictions.v1.json` — extractor output (real model + usage/cost).
- `data/reports/metrics.v1.md` — computed metrics, confidence sweep, spot-check, verdict.
- `data/cache/extract/<model>/<prompt_version>/<event_id>.json` — per-event raw extractor result.
  Crucial for recall work: it shows exactly what (if anything) each event produced, including events
  that produced nothing.
- `data/predictions/predictions.v1-mock.json` (optional) — deterministic baseline for contrast.

**Code (to re-run / extend)**
- `scripts/` + `src/` — importer, extractor (`src/extract`), judge/matcher (`src/evaluate/match.ts`),
  metrics (`src/evaluate/metrics.ts`), report (`src/evaluate/report.ts`).

**Do NOT include** `.env` (contains the live API key) or `node_modules/`. Share `.env.example` instead.

## How recall is measured here

- Gold-anchored: every human gold commitment is classified `caught` / `partially_caught` / `missed`
  (`src/evaluate/metrics.ts`), matched by an **LLM judge** (`src/evaluate/match.ts`) that decides
  semantic equivalence — same action, same direction (who owes whom), same counterparty.
- `coverage = (caught + partially_caught) / gold_total`; `hard_coverage` / `soft_coverage` are the
  same over those subsets (mvp.md §6).
- A miss is one of two very different things, and they must be separated:
  - **true miss** — the extractor never produced a matching commitment.
  - **measurement miss** — the extractor produced it, but the judge didn't match it (a judge/threshold
    artifact, not an extractor failure).

## Method

1. **Lock the denominator — gold completeness.** Recall is only as trustworthy as the gold set; an
   incomplete gold inflates recall. Before analyzing, audit it: a second labeler (or a *different*
   model) re-scans a sample of raw events for commitments the gold missed. Record an estimated
   gold-completeness rate. (This is "recall of the gold itself" — the deepest blind spot.)
2. **Run + enumerate misses.** Real `extract` → `evaluate`. List **every** `missed` and
   `partially_caught` gold from `goldVerdicts` (not just the 5 shown in the report — see Tooling gap).
3. **Split judge error from extractor error.** For each miss, open the per-event cache: did the
   extractor emit a matching commitment the judge rejected? Yes → measurement error (fix
   judge/threshold; consider an independent `HUMIN_JUDGE_MODEL` to avoid self-grading bias). No →
   true miss (fix extraction).
4. **Build a miss taxonomy.** Tag every *true* miss by failure mode:
   - implicit / soft phrasing ("let me get back to you")
   - dateless / vague timing
   - multi-message / accepted-request (commitment spans turns)
   - thread-context loss (needed messages beyond the context window)
   - counterparty ambiguity / group ("the team")
   - channel-specific (transcript disfluency, email quoting, telegram brevity)
   - long / low-signal message
   - wrongly judged out-of-scope by the model
5. **Segment recall.** Compute coverage broken down by: source (email / telegram / transcript),
   strength (hard / soft), due-date quality (dated / vague / none), direction (i_owe / owed_to_me),
   and thread length. Rank segments by weakest recall — that is where to focus.
6. **Recall ↔ precision curve.** Use the confidence sweep: tabulate coverage and *which segments drop*
   at each threshold (soft commitments fall out first — already visible at conf ≥ 0.9 in the fixture
   run). Choose the operating point that meets §7 (coverage ≥ 60%, hard ≥ 75%, soft ≥ 40%) at
   acceptable precision.
7. **Tie to the decision.** Map results to §7 / §18 / §19. If recall fails, is the gap concentrated in
   a fixable segment (e.g. soft commitments → prompt change) or broad (→ model / approach change)?

## Deliverable (what the analysis produces)

A recall report containing:
- Estimated true base rate + gold-completeness.
- Overall / hard / soft / per-segment coverage tables.
- Recall@threshold curve + recommended operating point.
- Miss taxonomy with counts and 2–3 verbatim examples per category.
- Judge-error rate (measurement-miss vs true-miss split).
- Prioritized fixes, each tied to a miss category and a lever: prompt `vN+1` / confidence threshold /
  context-window size / multi-message handling / model choice.

## Iteration loop (cheap + comparable)

- Change **one lever at a time**. For prompt changes, bump `PROMPT_VERSION` (`src/extract/prompt.ts`)
  so the checkpoint cache invalidates and output filenames stay comparable across versions.
- Re-run `extract` (cache skips unchanged work) → `evaluate` → diff coverage vs the previous version.
  Keep a short changelog: (version, model, threshold) → (coverage, precision, soft-coverage).
- Model A/B: `pnpm run extract -- --model <slug> --out data/predictions/<tag>.json`, evaluate each
  against the same gold. Use a *different* `HUMIN_JUDGE_MODEL` than the extractor.

## Misses export (implemented — use this for steps 2–5)

Run evaluate with `--dump-misses` to write `data/reports/misses.<prompt_version>.csv` — **one row per
gold commitment**, with `outcome` (caught | partially_caught | missed) and the segment fields you slice
recall by: `direction, strength, due_date_quality, has_due_date, channels`, plus the matched
prediction, its confidence, and the judge's reason. It's computed at confidence ≥ 0 (the recall
ceiling). Pivot by any segment to find where recall is weakest; filter `outcome != caught` to read
every miss with the judge's explanation. This turns the manual reading in steps 2–5 into a spreadsheet pivot.

## Commands

```bash
pnpm run extract
pnpm run evaluate -- --pred data/predictions/predictions.v1.json --gold <gold.csv> --dump-misses
# → data/reports/metrics.v1.md   (metrics, sweep, verdict)
# → data/reports/misses.v1.csv   (per-gold outcome + segments — the recall worksheet)
```
