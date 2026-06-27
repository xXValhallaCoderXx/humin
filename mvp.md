
# Humin MVP Plan v2: Commitment Catch Loop

## 1. MVP objective

Build the smallest possible system to test whether Humin can become a trusted commitment-memory layer.

The core product promise remains:

> Humin makes sure you never drop something you told someone you would do, or something someone told you they would do.

The canonical plan defines Humin as a **commitment-memory layer**, not an AI second brain, Obsidian plugin, or meeting-prep tool. Its wedge is commitments because they have state, counterparty, clock, and felt consequence. 

## 2. Core theory

The MVP is testing this:

> If Humin can extract enough real commitments from existing communication, structure them without manual filing, and resurface them with source evidence, the value of the catch beats the capture-habit death that kills to-do apps.

The dangerous failure mode is not only false positives.

The deeper failure mode is:

> Humin is accurate on the few commitments it catches, but misses most of the real ones.

So v2 tests both sides:

```text
Precision = Of what Humin caught, how much was real?
Coverage = Of what was actually there, how much did Humin catch?
```

Precision is the trust floor. Coverage is the value floor.

## 3. MVP scope

### In scope

Ship only:

```text
1. One memory type: commitment
2. Two clean directions:
   - i_owe
   - owed_to_me
3. One state line:
   - open → kept / dropped
4. One surface:
   - daily brief
5. One correction loop:
   - done / still open / not a commitment / too private
6. One harvested outbound stream:
   - sent email or meeting transcripts
7. One inbound stream, scoped narrowly:
   - explicit promises made to the user
8. One optional blurt input:
   - Telegram or simple web form
```

The source plan already holds the line on “one of everything for v0”: one memory type, one state line, one surface, and one correction loop. 

### Out of scope

Do not build:

```text
- Ideas
- Open loops
- Decisions
- Recurring themes
- Calendar meeting prep
- Obsidian plugin
- Markdown export, unless needed for trust testing
- Team/shared workspace features
- Complex dashboard
- Mastra
- Separate vector DB
- Full mobile app
- Gamification
- Accepted-request inference as a shipped inbound feature
```

The fuller taxonomy and richer resurfacing triggers remain post-validation roadmap items. 

## 4. Phase 0: extraction gate, revised

Phase 0 is the most important part of the MVP. It happens before product engineering.

### Goal

Determine whether the extractor can catch **enough** real commitments at **high enough** precision to justify building the catch loop.

### Inputs

Use 2–4 weeks of real founder data:

```text
- Sent email
- Telegram messages
- Meeting transcripts
- One inbound channel if available
- Optional Slack / WhatsApp / Teams export
```

No OAuth. No product. No integrations. Exported data only.

The existing plan correctly says Test 0 should use real exported data and happen before architecture work. 

## 5. Phase 0 process

### Step 1: normalize raw messages

Create a local script:

```text
/scripts/import_raw_streams.ts
```

Normalize every message into:

```ts
type CaptureEvent = {
  id: string;
  source: "sent_email" | "transcript" | "telegram" | "inbound_export";
  direction_hint: "outbound" | "inbound";
  author: string;
  recipients?: string[];
  occurred_at: string;
  thread_id?: string;
  raw_text: string;
};
```

### Step 2: create a human gold set before running the extractor

This is the key change.

Do **not** only review what the model extracted.

First, independently label the raw stream.

For each real commitment in the raw data, create a gold label:

```ts
type GoldCommitment = {
  id: string;
  source_event_ids: string[];
  direction: "i_owe" | "owed_to_me";
  statement: string;
  person?: string;
  due_date?: string;
  due_date_quality: "explicit" | "relative" | "vague" | "none";
  commitment_strength: "hard" | "soft";
  should_surface: boolean;
  notes?: string;
};
```

This gives the base rate:

```text
How many real commitments existed in the data?
How many were hard commitments?
How many were soft commitments?
How many had dates?
How many had no dates?
```

Without this, the gate can falsely pass by being precise but barely useful.

### Step 3: run the extractor

Create:

```text
/scripts/extract_commitments.ts
```

The extractor outputs:

```json
{
  "source_event_ids": ["evt_123"],
  "direction": "i_owe",
  "statement": "Send Sam the pricing deck next week",
  "person": "Sam",
  "due_date": "2026-07-03",
  "due_date_quality": "relative",
  "confidence": 0.91,
  "evidence_text": "I'll send you the pricing deck next week.",
  "reason": "First-person commitment with a relative date."
}
```

### Step 4: match predictions to the gold set

Create:

```text
/scripts/evaluate_extraction.ts
```

Each prediction becomes:

```text
true positive
false positive
duplicate
partial match
```

Each gold commitment becomes:

```text
caught
missed
partially caught
```

This is where we measure coverage.

## 6. Phase 0 metrics

### Required metrics

| Metric                             | Definition                                          | Why it matters                                  |
| ---------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| Base rate                          | Real commitments per 100 messages / threads         | Tells us whether the stream is worth harvesting |
| Precision                          | Extracted commitments that are real                 | Trust floor                                     |
| Coverage / recall                  | Real commitments caught by extractor                | Value floor                                     |
| Soft-commitment coverage           | “I’ll take a look”, “let me get back to you” caught | Tests the product’s real difficulty             |
| Person accuracy                    | Correct counterparty                                | Prevents dumb reminders                         |
| Due-date accuracy                  | Correct when a date exists                          | Enables useful ordering                         |
| Dateless ratio                     | Commitments with no usable due date                 | Shapes brief behavior                           |
| Duplicate rate                     | Same promise extracted multiple times               | Predicts brief annoyance                        |
| Inbound explicit-promise precision | Inbound promises-to-user that are real              | Trust for “owed to me”                          |
| Inbound noise drop rate            | Inbound messages ignored correctly                  | Avoids tidy chaos                               |

The original plan already distinguishes outbound as a precision problem and inbound as a firehose/filtering problem.  This revised gate adds the missing coverage/base-rate layer.

## 7. Phase 0 pass / warning / stop thresholds

Use thresholds as decision aids, not fake certainty.

| Metric                             |  Pass | Warning |  Stop |
| ---------------------------------- | ----: | ------: | ----: |
| Outbound precision                 | ≥ 85% |  70–84% | < 70% |
| Outbound coverage                  | ≥ 60% |  40–59% | < 40% |
| Hard-commitment coverage           | ≥ 75% |  50–74% | < 50% |
| Soft-commitment coverage           | ≥ 40% |  20–39% | < 20% |
| Person accuracy                    | ≥ 85% |  70–84% | < 70% |
| Due-date accuracy when present     | ≥ 75% |  60–74% | < 60% |
| Duplicate rate                     | < 10% |  10–20% | > 20% |
| Inbound explicit-promise precision | ≥ 85% |  70–84% | < 70% |
| Inbound noise drop rate            | ≥ 80% |  60–79% | < 60% |

### Proceed only if

```text
- Outbound precision is high enough to trust.
- Outbound coverage is high enough to create value.
- Hard commitments are mostly caught.
- Inbound explicit promises-to-you are extractable.
- The stream has enough base rate to produce catches.
```

### Stop or fix extraction if

```text
- Precision passes only because the extractor catches obvious promises.
- Coverage is low enough that the brief would feel non-comprehensive.
- Soft commitments are almost always missed.
- Inbound produces tidy noise rather than useful commitments.
- Duplicate promises would clutter the brief.
```

## 8. Inbound v0 scope, narrowed

This is the second major change.

### Inbound v0 includes only explicit promises made to the user

Examples to extract:

```text
“I’ll send you the deck by Friday.”
“We’ll get you the revised numbers tomorrow.”
“I can share the intro after the call.”
“I’ll follow up with the contract.”
```

These become:

```text
direction: owed_to_me
```

### Inbound v0 excludes accepted-request inference

Do **not** ship extraction for:

```text
“Can you take a look?”
“Could you send me the doc?”
“Mind reviewing this later?”
“Any chance you can check the numbers?”
```

These are requests, not commitments.

They only become the user’s obligation if there is an acceptance pattern:

```text
Them: Can you take a look?
User: Sure, I’ll do it tomorrow.
```

In v0, the user’s reply is handled as an **outbound commitment**.

### Optional Phase 0 research-only label

During Phase 0, label accepted-request patterns, but do not surface them in the product yet.

```ts
type AcceptedRequestCandidate = {
  ask_event_id: string;
  acceptance_event_id?: string;
  requester: string;
  user_reply?: string;
  accepted: boolean | "unclear";
  notes?: string;
};
```

This lets us learn how common and important accepted-requests are without letting them pollute v0.

The existing plan notes that inbound obligations are slippery because the user may or may not have accepted a request, often outside the inbound message itself.  v2 resolves that by scoping inbound v0 to explicit promises-to-you only.

## 9. Dateless commitment behavior

This is the third major change.

Most natural commitments will not have clean dates. The product must not let dateless commitments sink forever.

### Add due-date quality

```ts
type DueDateQuality =
  | "explicit"   // “by Friday”, “on July 3”
  | "relative"   // “next week”, “tomorrow”
  | "vague"      // “soon”, “when I get a chance”
  | "none";
```

### Add resurfacing policy

```ts
type ResurfacePolicy = {
  first_seen_at: string;
  next_resurface_at: string;
  cadence: "daily" | "every_3_days" | "weekly" | "manual";
  snoozed_until?: string;
};
```

### Default behavior

| Commitment type                           | Brief behavior                                                     |
| ----------------------------------------- | ------------------------------------------------------------------ |
| Explicit due date                         | Surface before due date and when overdue                           |
| Relative due date                         | Normalize if possible, then treat like explicit                    |
| Vague date                                | Surface within 3 days, then weekly until resolved                  |
| No date                                   | Surface in “No date, still open” section after 7 days, then weekly |
| High-confidence, no date, person attached | Surface sooner than anonymous/no-person items                      |
| User marks “still open” repeatedly        | Reduce frequency unless overdue or high salience                   |

### Daily brief sections

```text
Today in Humin

Due / overdue
- Send Sam the pricing deck — due Friday.

Still open, no date
- Reply to Alex on the calendar-recall thread.
  First seen 8 days ago.

Owed to you
- Sarah said she’d send the Q3 numbers.
  First seen 5 days ago.
```

This keeps dateless promises alive without overwhelming the user.

## 10. Duplicate handling

The previous plan’s idempotency criterion is necessary but not sufficient.

There are two different problems:

```text
1. Import idempotency
Same source event imported twice should not create duplicate atoms.

2. Semantic duplicate detection
Same promise appears across multiple sources.
Example:
- meeting transcript: “I’ll send the deck”
- Slack: “as mentioned, I’ll send the deck”
- Telegram blurt: “remember to send Sam the deck”
```

### v0 requirement

Implement import idempotency.

```text
Same CaptureEvent + same extraction version = no duplicate atom.
```

### v0 limitation

Semantic cross-source dedup is not fully solved in v0.

Name it explicitly.

### Minimal mitigation

Before creating a new atom, check open commitments with:

```text
same user
same direction
same person
similar statement
same or nearby due date
status = open
```

If match confidence is high, attach the new source event to the existing atom instead of creating a new one.

```ts
type MemoryAtom = {
  id: string;
  source_event_ids: string[];
  duplicate_candidate_of?: string;
  dedupe_confidence?: number;
};
```

If uncertain, create the item but flag it for review:

```text
possible_duplicate: true
```

## 11. Phase 1: minimal product build

Build only after Phase 0 passes on precision **and** coverage.

### Product loop

```text
Existing stream
→ Extract commitment
→ Store MemoryAtom with source evidence
→ Include in daily brief
→ User corrects item
→ Correction becomes labeled eval data
→ Extractor and ranking improve
```

The source plan already says capture should lead with harvested streams the user already fills, with the blurt widget as input #2. 

## 12. Data model

### CaptureEvent

```ts
type CaptureEvent = {
  id: string;
  user_id: string;
  source: "sent_email" | "transcript" | "inbound_export" | "telegram";
  source_ref?: string;
  direction_hint: "outbound" | "inbound";
  author?: string;
  recipients?: string[];
  occurred_at: string;
  raw_text: string;
  thread_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};
```

### MemoryAtom

```ts
type MemoryAtom = {
  id: string;
  user_id: string;
  type: "commitment";
  direction: "i_owe" | "owed_to_me";
  statement: string;
  source_event_ids: string[];

  people: string[];
  projects?: string[];
  topics?: string[];

  status: "open" | "kept" | "dropped" | "not_commitment";
  due_date?: string;
  due_date_quality: "explicit" | "relative" | "vague" | "none";

  first_seen_at: string;
  last_resurfaced_at?: string;
  next_resurface_at?: string;
  resurface_cadence: "daily" | "every_3_days" | "weekly" | "manual";

  confidence: number;
  sensitivity: "normal" | "private" | "highly_private";

  possible_duplicate?: boolean;
  duplicate_candidate_of?: string;
  dedupe_confidence?: number;

  extraction_prompt_version: string;
  created_at: string;
  updated_at: string;
};
```

The canonical plan already defines `MemoryAtom` as the unit of meaning, state, and provenance, with commitments as the only v0 type and raw capture preserved as evidence. 

### CommitmentFeedback

```ts
type CommitmentFeedback = {
  id: string;
  user_id: string;
  atom_id: string;
  feedback:
    | "done"
    | "received"
    | "still_open"
    | "still_waiting"
    | "not_commitment"
    | "too_private"
    | "duplicate";
  previous_status: string;
  new_status?: string;
  created_at: string;
};
```

### ExtractionTrace

```ts
type ExtractionTrace = {
  id: string;
  capture_event_id: string;
  model: string;
  prompt_version: string;
  raw_output: unknown;
  parsed_successfully: boolean;
  atoms_created: string[];
  atoms_suppressed_as_duplicates?: string[];
  created_at: string;
};
```

### GoldCommitment

Used only for Phase 0 and evals.

```ts
type GoldCommitment = {
  id: string;
  source_event_ids: string[];
  direction: "i_owe" | "owed_to_me";
  statement: string;
  person?: string;
  due_date?: string;
  due_date_quality: "explicit" | "relative" | "vague" | "none";
  commitment_strength: "hard" | "soft";
  should_surface: boolean;
  created_by: "human";
};
```

## 13. Extractor contract

The extractor should be conservative, but not so conservative that it becomes useless.

### Extract

```text
- Clear promises the user made to someone else.
- Clear promises someone made to the user.
- Soft but real commitments, when the user is the actor or recipient.
- Commitments with no due date, if the action and counterparty are clear.
```

### Do not extract

```text
- Ideas
- Generic plans
- FYIs
- Suggestions
- Hopes
- Brainstorming
- Group obligations with no owner
- Requests the user has not accepted
- “Can you...” inbound asks unless the user’s own reply commits
- Vague interest without action
```

### Important nuance

The extractor can output a confidence score, but Phase 0 should test multiple thresholds.

Example:

```text
threshold 0.9 → high precision, low coverage
threshold 0.75 → balanced
threshold 0.6 → higher coverage, more false positives
```

The goal is to find a usable operating point, not just make the model look accurate.

## 14. Daily brief behavior

One surface only.

Preferred delivery:

```text
Telegram daily message
```

Fallback:

```text
Simple web page
```

### Brief structure

```text
Today in Humin

Due / overdue
1. Send Sam the pricing deck — due Friday.
   Source: sent email, Jun 26.
   [Done] [Still open] [Not a commitment] [Too private]

Still open, no date
2. Reply to Alex on the calendar-recall thread.
   First seen 8 days ago.
   Source: transcript, Jun 18.
   [Done] [Still open] [Not a commitment] [Too private]

Owed to you
3. Sarah said she'd send the Q3 numbers.
   First seen 5 days ago.
   Source: inbound email, Jun 21.
   [Received] [Still waiting] [Not a commitment] [Too private]
```

### Ranking logic v0

```text
1. Explicit due date overdue
2. Explicit due date soon
3. Relative due date normalized soon
4. Vague date older than 3 days
5. No-date commitment older than 7 days
6. High-confidence owed-to-me items
7. Recently created high-confidence commitments
8. Items not resurfaced recently
```

### Suppression rules

```text
- Do not show kept items.
- Do not show dropped items.
- Do not show not_commitment items.
- Do not show too_private items unless user explicitly asks.
- Do not show same item every day unless overdue.
- Do not show possible duplicates separately if merged.
```

## 15. Workstreams

### Workstream A: offline gate and eval

Deliverables:

```text
- Raw stream importer
- Human gold-label CSV
- Extraction script
- Prediction-to-gold matcher
- Metric report
- Threshold sweep
```

Acceptance criteria:

```text
- Can compute precision and coverage.
- Can compute base rate.
- Can identify missed soft commitments.
- Can identify dateless commitment ratio.
- Can identify duplicate rate.
```

### Workstream B: ingestion

Deliverables:

```text
- File/import-based ingestion
- CaptureEvent table
- Deduped imports
```

Acceptance criteria:

```text
- Can import at least 500 historical messages/events.
- Can rerun imports idempotently.
- Every extracted atom links to source evidence.
```

### Workstream C: extraction service

Deliverables:

```text
- Prompt versioning
- Extractor job
- JSON validation
- ExtractionTrace table
- Threshold setting
```

Acceptance criteria:

```text
- Valid JSON ≥ 99% of the time.
- No-commitment cases handled cleanly.
- Same CaptureEvent does not duplicate atoms.
- Duplicate candidates are flagged or merged.
```

### Workstream D: MemoryAtom state

Deliverables:

```text
- MemoryAtom table
- Status transitions
- Due-date quality
- Resurfacing policy
```

Acceptance criteria:

```text
- open → kept
- open → dropped
- open → not_commitment
- open → too_private
- no-date items resurface on defined cadence
```

### Workstream E: daily brief

Deliverables:

```text
- Daily Telegram or email brief
- Three sections: due/overdue, still-open/no-date, owed-to-you
- Source evidence
- Feedback buttons
```

Acceptance criteria:

```text
- Sends once daily.
- Includes only open commitments.
- Shows dateless commitments on cadence.
- Each item has correction buttons.
- Each correction is stored.
```

### Workstream F: metrics and review

Deliverables:

```text
- Weekly metric report
- Manual review view or CSV
- Prompt version comparison
```

Acceptance criteria:

```text
- Can compute precision, coverage, catch rate, correction rate, duplicate rate.
- Can inspect why an item appeared.
- Can inspect source evidence.
```

## 16. Build sequence

### Week 0: revised extraction gate

```text
- Import raw streams.
- Human-label the raw stream first.
- Run extractor.
- Match predictions to gold labels.
- Measure precision, coverage, base rate, inbound explicit-promise quality, dateless ratio, duplicate rate.
- Decide: proceed / fix extractor / stop.
```

### Week 1: data model and extractor service

```text
- Postgres schema.
- CaptureEvent.
- MemoryAtom.
- ExtractionTrace.
- Prompt versions.
- Idempotent extraction job.
```

### Week 2: harvest ingestion and review

```text
- Import one outbound stream.
- Import one scoped inbound stream.
- Admin review or CSV review.
- Manual edit/suppress/merge atoms.
```

### Week 3: daily brief and corrections

```text
- Daily brief.
- Done / received / still open / not commitment / too private.
- Dateless resurfacing cadence.
- Basic ranking.
```

### Week 4: dogfood hardening

```text
- Source evidence view.
- Duplicate candidate handling.
- Confidence threshold tuning.
- Weekly metrics report.
- Founder dogfood.
```

### Weeks 5–6: tiny beta

```text
- 3–5 users.
- Import instructions.
- Daily brief.
- Feedback collection.
- Proceed / fix / kill decision.
```

## 17. Weekly evaluation report

Generate every week.

```text
Humin MVP Metrics

Raw stream
- Messages processed
- Threads processed
- Human-labeled commitments
- Base rate: commitments per 100 messages
- Hard vs soft commitments
- Dateless ratio

Extraction
- Candidates extracted
- True positives
- False positives
- Missed commitments
- Partial matches
- Precision
- Coverage / recall
- Hard-commitment coverage
- Soft-commitment coverage
- Person accuracy
- Due-date accuracy
- Duplicate rate

Inbound v0
- Inbound messages processed
- Explicit promises-to-you found
- Explicit promises-to-you accepted
- Inbound precision
- Inbound noise drop rate
- Accepted-request candidates observed but not shipped

Brief quality
- Briefs sent
- Items surfaced
- Items marked done / received
- Items marked not commitment
- Items marked too private
- Items marked duplicate
- Dateless items resurfaced
- Genuine forgotten catches

User sentiment
- Would you be annoyed to lose this?
- What did Humin catch that you would have dropped?
- What felt noisy, wrong, or creepy?
- Did dateless items feel useful or naggy?
```

## 18. Success criteria

The MVP works if, after 2–3 weeks with founder + 3–5 users:

```text
- Outbound precision ≥ 85%.
- Outbound coverage ≥ 60%, or misses are mostly low-value.
- Hard commitments are mostly caught.
- Inbound explicit promises-to-you are clean enough to trust.
- Daily brief produces at least 1–2 genuine forgotten catches per user per week.
- Users say they would be annoyed to lose it.
- False positives do not erode trust.
- Dateless commitments resurface without feeling naggy.
```

The existing plan already defines genuine forgotten catches, brief usefulness, and “annoyed to lose it” as core success signals. 

## 19. Kill / pivot criteria

Stop or pivot if any of these persist after two extractor iterations:

```text
- Precision < 70%.
- Coverage < 40%.
- Hard-commitment coverage < 50%.
- Soft commitments are almost never caught.
- The stream base rate is too low to create regular catches.
- The brief mostly contains things users already remembered.
- Inbound cannot cleanly handle explicit promises-to-you.
- Inbound creates tidy chaos instead of useful reduction.
- Duplicate promises make the brief feel dumb.
- Dateless commitments either disappear or become annoying.
- Good precision requires too many clarifying questions.
```

## 20. Frozen decisions for MVP

Do not reopen these unless Phase 0 or dogfood data forces it:

```text
- Commitments only.
- Harvest-first.
- File/import before OAuth.
- Inbound v0 = explicit promises-to-you only.
- Accepted-request inference is research-only.
- One daily brief.
- One correction loop.
- Postgres as source of truth.
- pgvector only if simple retrieval needs it.
- No Mastra.
- No Obsidian plugin.
- No Markdown export unless trust requires it.
- No team workspace.
- No calendar-first meeting prep.
- No idea/open-loop tracking.
- No gamification.
```

## 21. The MVP in one sentence

> Build a harvest-first commitment extractor that measures precision **and coverage**, tracks only stateful commitments with source evidence, scopes inbound to explicit promises-to-you, handles dateless commitments intentionally, sends one daily brief, and uses one-tap correction to prove whether Humin catches real dropped promises without creating more noise.
