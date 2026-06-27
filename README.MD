# Humin — Phase 0 extraction gate

Humin is a **commitment-memory layer**: it makes sure you never drop something you told
someone you'd do, or something someone told you they'd do.

This repo currently contains **Phase 0 only** — the offline gate that must pass *before* any
product is built (see [`mvp.md`](./mvp.md) §4, §11, §20). Phase 0 answers one question:

> Can an LLM extractor catch **enough** real commitments at **high enough** precision to
> justify building the catch loop?

It measures both **precision** (the trust floor) and **coverage** (the value floor) against a
human-labeled gold set, over real exported messages. No Postgres, no OAuth, no product — just
local scripts over exported files.

## Pipeline

```
export files ──▶ import ──▶ (human) label ──▶ extract ──▶ evaluate ──▶ PROCEED / FIX / STOP
                  │             │                │            │
        capture_events.json  gold CSV     predictions.json  metrics.md
```

## Prerequisites

- **Node 20+** and **pnpm** (`pnpm install`).
- **2–4 weeks of real exported data** — sent email, Telegram, meeting transcripts (mvp.md §4).
  This is a hard precondition; the gate can't run without it. Exports only — no integrations.
- A `.env` (copy `.env.example`):
  - `OPENROUTER_API_KEY` — chat gateway for the extractor and the LLM judge.
  - `HUMIN_EXTRACT_MODEL` / `HUMIN_JUDGE_MODEL` — OpenRouter model slugs per role (default
    `anthropic/claude-opus-4.8`; pick any from https://openrouter.ai/models).
  - `HUMIN_FOUNDER_IDENTITIES` — comma-separated emails / names / handles that are *you*, so
    imports can tell outbound (`i_owe`) from inbound (`owed_to_me`).
  - Embeddings (Phase 1 only) use a **direct provider**, not OpenRouter — see `HUMIN_EMBED_*`.

```bash
pnpm install
cp .env.example .env   # then edit
```

## Run it

> Use `pnpm run <script>` (not the `pnpm <script>` shortcut — `import` is a built-in pnpm
> command). Pass script args after `--`.

**1. Import** each exported stream into one normalized, de-duplicated store
(`data/normalized/capture_events.json`). Re-running is idempotent.

```bash
pnpm run import -- --source sent_email   --in path/to/sent.mbox
pnpm run import -- --source telegram     --in path/to/result.json
pnpm run import -- --source transcript   --in path/to/meeting.vtt --date 2026-06-04
# sources: sent_email | inbound_export | telegram | transcript
```

**2. Label** — generate the labeling workspace, then fill in the gold set **by hand, before
looking at the model's output** (this is the coverage ground truth, mvp.md §5 step 2).

```bash
pnpm run label
# → data/gold/stream.md            (readable, threaded — label from this)
# → data/gold/gold_commitments.csv (one row per REAL commitment you find)
```

**3. Extract** commitments via OpenRouter. Outputs all predictions with confidence scores;
thresholding happens in evaluation.

```bash
pnpm run extract                              # real run (needs OPENROUTER_API_KEY)
pnpm run extract -- --model openai/gpt-5      # override the model for this run
pnpm run extract -- --concurrency 8           # parallel requests (default 6)
pnpm run extract -- --limit 25                # cheap smoke test on the first 25 events
# → data/predictions/predictions.v1.json
```

**4. Evaluate** — match predictions to gold (LLM judge), compute the full §6 metric set across
confidence thresholds, and emit the report + verdict.

```bash
pnpm run evaluate -- --pred data/predictions/predictions.v1.json
# → data/reports/metrics.v1.md  (precision, coverage, hard/soft coverage, person & due-date
#   accuracy, duplicate rate, inbound precision/noise-drop, a threshold sweep, and a verdict)
```

The verdict is **PROCEED / FIX / STOP** per mvp.md §7/§18/§19. Build Phase 1 only on PROCEED.

## Try it with no data or API key (mock mode)

A deterministic offline path exercises the whole pipeline against the committed synthetic
fixtures in `fixtures/` — useful to see the shape of the outputs before real data lands:

```bash
export HUMIN_FOUNDER_IDENTITIES="you@example.com,Founder,@founder"
pnpm run import   -- --source sent_email --in fixtures/sample_sent.mbox
pnpm run import   -- --source telegram   --in fixtures/telegram.json
pnpm run import   -- --source transcript --in fixtures/transcript.vtt --date 2026-06-04
pnpm run label
pnpm run extract  -- --mock
pnpm run evaluate -- --pred data/predictions/predictions.v1-mock.json --gold fixtures/gold_commitments.fixture.csv --mock
```

`--mock` swaps the LLM extractor for a regex baseline and the LLM judge for token-overlap
matching (no API key needed). It's a baseline, not the real thing — notably it doesn't
normalize due dates.

## Layout

```
scripts/   import_raw_streams · make_gold_template · extract_commitments · evaluate_extraction
src/       types.ts · cli.ts · paths.ts
  llm/     openrouter (client + per-role models) · chat (json + retry + concurrency + cost) · embeddings (direct provider)
  import/  email · telegram · transcript · normalize
  extract/ prompt (versioned) · schema (structured output) · mock
  evaluate/match (judge) · metrics (§6) · report (§7 + sweep + verdict)
fixtures/  synthetic sample data (committed)
data/      real data + all generated artifacts (gitignored)
```

## Architecture decisions

A durable record of the API / orchestration choices and the reasoning — so they don't get
re-litigated later.

- **Chat goes through OpenRouter** (OpenAI-compatible API). One key, one client, any model — so we
  can route a different model per role/task without wiring a separate SDK per provider. Per-role
  model slugs are config (`HUMIN_EXTRACT_MODEL`, `HUMIN_JUDGE_MODEL`); optional `HUMIN_REASONING_EFFORT`.
- **Embeddings go direct to a provider** (`src/llm/embeddings.ts`, `HUMIN_EMBED_*`) — OpenRouter does
  not serve embeddings. Not used in Phase 0; it's the ready seam for Phase 1 (e.g. semantic
  cross-source dedup, mvp.md §10).
- **No Batch API on OpenRouter.** At Phase 0 scale, concurrent direct calls are fine; resilience
  comes from a resumable per-event checkpoint cache + `Retry-After`-aware retries + a concurrency
  knob (see [Scale & reliability](#scale--reliability)). When volume grows, the bulk pass can move
  to a provider-direct Batch API behind the same `src/llm/` seam — extraction is idempotent per
  event, so that swap is safe.
- **Structured output**: strict `json_schema`, with a `json_object` fallback for models that don't
  support strict schemas; every response is Zod-validated (this is the "valid JSON ≥99%" criterion).
- **Provider-agnostic core**: import, gold, metrics, and report logic depend on no model or
  provider, so re-running on a different model is just a config change.

## Notes

- The extraction prompt is versioned (`PROMPT_VERSION` in `src/extract/prompt.ts`); bump it on
  any wording change so runs stay comparable. Report/prediction filenames carry the version.
- Phase 1 (Postgres, daily brief, correction loop) is intentionally **not** built yet — the
  domain types in `src/types.ts` are authored to be reused there once the gate passes.

## Scale & reliability

OpenRouter has no Batch API, so the extractor and judge make concurrent direct calls. At Phase 0
scale (hundreds–thousands of events) that's a non-issue — a few thousand events finish in minutes —
and the design covers the rest:

- **Resumable.** Every event's result is checkpointed under `data/cache/extract/<model>/<prompt>/`
  the moment it validates. A crash, a Ctrl-C, or exhausting your rate limit loses nothing — re-run
  the same command and it skips everything already done. This is Batch's fire-and-forget property
  without a batch endpoint. `--refresh` recomputes; `--no-cache` disables.
- **Rate-limit aware.** 429 / 5xx are retried with exponential backoff, honoring the provider's
  `Retry-After` header.
- **Tunable throughput.** `--concurrency N` (default 6) — lower it if you hit limits, raise it on a
  funded account. Per-run cost comes from OpenRouter's usage accounting; cached events are free.

When volume genuinely grows (continuous ingestion, many users), the bulk extraction pass can move to
a **provider-direct Batch API** (Anthropic / OpenAI — ~50% cheaper, async, very high volume) while
OpenRouter stays for per-call model routing. The `src/llm/` layer isolates this: add a batch backend
behind the same interface. Extraction is already idempotent per event, so switching backends or
resuming a partial run is safe.
```
