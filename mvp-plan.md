# Humin MVP Plan

## Core Thesis

Humin is not an AI notes app and not a generic second brain. Humin is a private memory steward.

The MVP exists to test whether Humin can turn messy personal and work inputs into timely, trustworthy context for people, projects, and commitments, while actively deciding what to remember, what to expire, and what to mark stale.

The differentiator is not vector search. The differentiator is memory judgment.

## Positioning

Mem helps users remember their notes.

Humin governs memory:

- It captures messy inputs without asking the user to organize.
- It extracts memory atoms from those inputs.
- It classifies each atom by durability, importance, confidence, and expiry.
- It tracks provenance and stale/superseded context.
- It surfaces the right context before a person or project interaction.
- It gives the user lightweight correction controls: keep, forget, promote, resolve, mark stale.

The product promise:

> Dump the mess. Humin remembers what matters, forgets what should fade, and briefs you before it matters.

## MVP Question

Can Humin produce a person/project brief that feels more useful than searching notes?

The MVP succeeds if it reliably:

- Reminds the user of useful context they would have forgotten.
- Avoids surfacing old low-value noise.
- Cites sources enough to feel trustworthy.
- Lets the user correct memory with very little effort.
- Feels like an assistant with judgment, not a prettier notes database.

## Magic Moment

The first real demo should be:

```text
User: Brief me for Sam.

Humin:
- You promised Sam a pricing follow-up last Thursday.
- Sam dislikes surprise scope changes.
- Current project topic: OAuth rollout.
- Recent Slack summary says billing API is still blocked.
- An older launch-date note may be stale because a newer note contradicts it.
- Sources: Telegram capture, prior meeting note, Slack digest.

Actions:
[mark resolved] [keep] [forget] [wrong person] [stale]
```

This is the main product surface. The dashboard is secondary.

## MVP Scope

### 1. Zero-Friction Capture

Start with Telegram.

Requirements:

- Any freeform Telegram message can become a capture.
- Capture acknowledges immediately.
- Capture does not block on enrichment.
- No title, tag, folder, collection, or manual filing.
- Basic distinction between "save this" and "answer this" can start with a simple heuristic.

Initial capture examples:

```text
Sam said the billing API is still blocked.
Need to follow up with Priya on vendor pricing by Friday.
Idea: use memory expiry for Slack summaries so the brain does not rot.
Do not surprise Alex with agenda changes.
```

### 2. Memory Atom Extraction

A raw capture is not the primary long-term object. The primary long-term object is a memory atom.

A single raw capture can generate multiple atoms.

Atom types:

- `fact`
- `commitment`
- `preference`
- `decision`
- `open_loop`
- `project_context`
- `person_context`
- `idea`
- `question`

Extraction should produce:

- Atom type
- Subject entity, if any
- Clean summary
- Raw supporting text
- Relevant people
- Relevant projects
- Dates or deadlines
- Suggested durability
- Suggested expiry
- Confidence
- Reason retained

### 3. Memory Lifecycle

This is the MVP's unique feature.

Every atom gets a lifecycle decision:

- `durability`: `ephemeral | working | durable`
- `status`: `active | stale | superseded | resolved | forgotten`
- `importance`: 1-5
- `confidence`: 0-1
- `ttl`
- `expires_at`
- `reason_retained`

Default policy examples:

- Slack chatter: `ephemeral`, expires in 7 days.
- Project status update: `working`, expires in 14-30 days unless repeated.
- Commitment: `working`, active until resolved.
- Decision: `durable`, unless explicitly superseded.
- Person preference: `durable`.
- Random idea: `working`, expires or gets promoted based on reuse.

The goal is not to store less. The goal is to make memory states explicit.

### 4. Person and Project Briefs

The first useful retrieval surface should be briefs, not browsing.

Commands:

- `brief me for Sam`
- `brief project OAuth`
- `what should I follow up on?`
- `what changed since last time?`
- `what is stale?`
- `what did I promise?`

Brief contents:

- Current relevant context
- Open loops
- Commitments by the user
- Commitments by others
- Durable person preferences
- Recent working memory
- Stale or contradicted facts
- Source citations
- Suggested next actions

### 5. Review and Correction Loop

The user should not need to organize, but they should be able to correct memory.

Minimal actions:

- `keep`
- `forget`
- `make durable`
- `mark resolved`
- `mark stale`
- `wrong person`
- `wrong project`
- `merge with`

Corrections should become training data for future lifecycle decisions.

## Architecture

Use Mastra as the orchestration and agent layer.

Use Postgres with pgvector as Humin's source of truth.

Do not make Vectorize.io foundational in the MVP. It is a later experiment for reflection or agent-memory benchmarking.

```text
Sources
  Telegram
  Obsidian plugin later
  Later: Slack, Google Calendar, Gmail, Meet notes

Ingestion
  raw_events
  source metadata
  account scoping

Processing
  Mastra enrichment workflow
  memory atom extractor
  entity linker
  lifecycle classifier
  embedding generator
  stale/superseded detector

Storage
  Postgres
  pgvector
  JSONB metadata
  source/provenance tables

Recall
  hybrid search
  entity filters
  lifecycle filters
  recency weighting
  unresolved-commitment boost
  stale-context checks

Agent Tools
  capture
  recall_memory
  brief_person
  brief_project
  list_followups
  review_memory

Surfaces
  Telegram first
  Obsidian plugin as a trust/distribution surface
  Minimal web review later
```

## Tooling Decisions

### Mastra

Use Mastra for:

- Agent tools
- Enrichment workflows
- Brief generation
- Recall orchestration
- Evals
- Observability/tracing

Mastra should not own the product's memory model. Humin's memory tables own that.

### Postgres and pgvector

Use Postgres as the durable store and pgvector for semantic retrieval.

Start with exact search. Add HNSW later when the dataset is large enough to justify it.

### Embeddings

Start with `text-embedding-3-small` behind an `EmbeddingService` interface.

Keep the embedding provider swappable so local embeddings can be tested later.

### Vectorize.io / Hindsight

Do not use as core infrastructure for MVP.

Possible later experiments:

- Compare Hindsight memory recall against Humin's atom model.
- Use it as an optional `ReflectionService`.
- Benchmark whether it improves recurring-agent mistakes or pattern synthesis.

Decision rule:

Only adopt it if it makes Humin's briefs better without weakening ownership of lifecycle, provenance, and forgetting.

## Obsidian Plugin Strategy

Obsidian is a promising distribution wedge because its users already value local-first ownership, Markdown durability, plugins, and cross-device sync. Humin should not integrate directly with Obsidian Sync. Obsidian Sync does not expose a public third-party API, and Humin does not need one.

The right approach is to build an Obsidian community plugin that works with the local vault filesystem and writes normal Markdown files. Those files can then be synced by Obsidian Sync, Git, iCloud, Dropbox, Syncthing, or any other vault sync method the user already trusts.

### Plugin Positioning

The plugin should not compete with Smart Connections on semantic related-note search.

Smart Connections answers:

> What notes are semantically related to what I am writing?

Humin for Obsidian should answer:

> What context is still active, stale, unresolved, or worth remembering?

### Plugin MVP

Commands:

- `Capture selection to Humin`
- `Capture current note to Humin`
- `Brief current note`
- `Brief person/project`
- `Show active commitments`
- `Show stale context`

Vault output:

- `Humin/Memory/` for memory atoms
- `Humin/Briefs/` for generated briefs
- `Humin/Reviews/` for pending review prompts, if needed

Markdown frontmatter fields:

- `humin_id`
- `atom_type`
- `durability`
- `status`
- `expires_at`
- `source`
- `confidence`
- `people`
- `projects`
- `reason_retained`

Side panel:

- Active commitments
- Durable person/project context
- Recent working memory
- Stale or superseded context
- Suggested follow-ups

Review actions:

- `keep`
- `forget`
- `make durable`
- `mark resolved`
- `mark stale`
- `wrong person`
- `wrong project`

### Plugin Principles

- Use a visible folder like `Humin/`, not hidden `.humin`, because hidden folders are not a good fit for sync portability.
- Keep Markdown readable and useful even without the plugin.
- Treat the vault as a trust surface, not the canonical database.
- Keep Postgres as Humin's source of truth.
- Make export/import boring and reversible.
- Avoid building a full note editor.

### Plugin Timing

Do not build the full plugin before the memory atom and brief loop is proven. A small proof-of-concept is worthwhile after Milestone 3 or 4:

- If briefs are useful in Telegram, add Obsidian as a second surface.
- If briefs are weak, fix memory judgment before expanding surfaces.

## Data Model

### `raw_events`

One row per ingested source event.

Fields:

- `id`
- `account_id`
- `source`
- `source_ref`
- `raw_text`
- `occurred_at`
- `ingested_at`
- `metadata`
- `processing_status`

### `memory_atoms`

One row per extracted memory atom.

Fields:

- `id`
- `account_id`
- `raw_event_id`
- `atom_type`
- `subject_type`
- `subject_id`
- `content`
- `summary`
- `entities`
- `importance`
- `confidence`
- `durability`
- `status`
- `ttl`
- `expires_at`
- `reason_retained`
- `created_at`
- `updated_at`

### `memory_embeddings`

One embedding per atom or chunk.

Fields:

- `id`
- `memory_atom_id`
- `embedding`
- `model`
- `created_at`

### `entities`

People, projects, organizations, and topics.

Fields:

- `id`
- `account_id`
- `type`
- `name`
- `aliases`
- `metadata`
- `created_at`
- `updated_at`

### `memory_links`

Relationships between atoms.

Fields:

- `id`
- `from_atom_id`
- `to_atom_id`
- `relation`
- `confidence`
- `created_at`

Relation examples:

- `supports`
- `contradicts`
- `supersedes`
- `relates_to`
- `same_subject`

### `briefs`

Optional cache/history for generated briefs.

Fields:

- `id`
- `account_id`
- `subject_id`
- `generated_at`
- `content`
- `source_atom_ids`
- `metadata`

### `memory_feedback`

User corrections and lightweight review signals.

Fields:

- `id`
- `account_id`
- `memory_atom_id`
- `feedback_type`
- `previous_value`
- `new_value`
- `created_at`

## Core Workflows

### Capture Workflow

```text
Telegram message received
  -> save raw_event
  -> acknowledge immediately
  -> enqueue enrichment
```

### Enrichment Workflow

```text
raw_event pending
  -> extract memory atoms
  -> link entities
  -> classify lifecycle
  -> embed atoms
  -> save atoms and embeddings
  -> mark raw_event processed
```

### Brief Workflow

```text
brief request
  -> resolve person/project entity
  -> retrieve active durable memory
  -> retrieve recent working memory
  -> retrieve unresolved commitments
  -> detect stale/superseded candidates
  -> rank and synthesize
  -> cite sources
  -> offer correction actions
```

### Expiry Workflow

```text
scheduled job
  -> find expired atoms
  -> mark ephemeral atoms forgotten or inactive
  -> mark working atoms stale if not reinforced
  -> preserve provenance
```

### Staleness Workflow

```text
new atom created
  -> search same subject/topic
  -> detect contradiction or supersession
  -> create memory_links
  -> mark older atom superseded if confidence is high
  -> otherwise flag for review
```

## Retrieval Strategy

Briefs should use hybrid retrieval:

- Entity match
- Vector similarity
- Keyword match
- Lifecycle status
- Recency
- Importance
- Unresolved commitment boost
- Durability boost
- User feedback boost

Default retrieval filters:

- Exclude `forgotten`
- Deprioritize `stale`
- Include `superseded` only when explaining change history
- Prefer active commitments and durable preferences

## Evaluation Harness

Build evals early. This is how we avoid hand-wavy "it feels smart" development.

Seed dataset:

- 50-100 realistic captures
- Mix of people, projects, ideas, commitments, stale updates, and contradictions
- Add a few intentionally noisy Slack-style digests

Eval questions:

- `brief me for Sam`
- `what did I promise Priya?`
- `what changed on OAuth this week?`
- `what should I follow up on?`
- `what context is stale for Project Atlas?`

Metrics:

- Correct atom appears in top 5
- Brief includes unresolved commitments
- Brief excludes expired noise
- Brief cites sources
- Brief identifies stale or superseded context
- User correction rate

## Milestones

### Milestone 1: Memory Substrate

Goal: capture and store memory atoms.

Deliverables:

- Postgres schema
- pgvector extension
- `raw_events`
- `memory_atoms`
- `entities`
- `memory_embeddings`
- Telegram capture
- Async enrichment scaffold

### Milestone 2: Extraction and Lifecycle

Goal: raw captures become useful memory atoms.

Deliverables:

- LLM structured extraction
- Entity linker
- Lifecycle classifier
- Embedding service
- Basic exact vector search
- Source citations

### Milestone 3: Briefing

Goal: produce the first magic moment.

Deliverables:

- `brief_person`
- `brief_project`
- `list_followups`
- Unresolved commitment retrieval
- Durable preference retrieval
- Recent working memory retrieval

### Milestone 4: Memory Judgment

Goal: prove Humin is different from a notes app.

Deliverables:

- TTL expiry job
- Stale/superseded detection
- Memory links
- Correction actions
- Feedback table
- Basic eval harness

### Milestone 5: First Real Usage

Goal: compare against Mem and decide whether the wedge is real.

Deliverables:

- Use Humin daily for 2-3 weeks
- Sign up for Mem and compare against equivalent workflows
- Record failure cases
- Identify which features create unique value
- Decide whether to deepen the memory-steward direction

### Milestone 6: Obsidian Plugin Spike

Goal: test whether Obsidian can become a distribution and trust surface.

Deliverables:

- Minimal community plugin scaffold
- Command: `Capture selection to Humin`
- Command: `Brief current note`
- Write memory atoms to `Humin/Memory/` as Markdown/YAML
- Write briefs to `Humin/Briefs/`
- Side panel for active commitments and stale context
- Review actions wired back to Humin
- Confirm generated files sync naturally through normal Obsidian vault sync

## Explicit Non-Goals

Do not build these in the first MVP:

- Full dashboard
- Theme clustering
- Full Slack ingestion
- Calendar automation
- Mobile app
- Team/multi-user collaboration
- Complex graph UI
- Local embedding model
- Vectorize.io core integration
- Fancy note editor
- Direct Obsidian Sync API integration
- Full Obsidian replacement or custom sync service

These can come later if the brief and memory-lifecycle loop works.

## Slack Strategy

Slack should not become permanent memory by default.

Initial Slack approach:

- Ingest daily/channel summaries, not every message.
- Treat as `ephemeral` or `working` memory.
- Default expiry: 7-14 days.
- Promote only if repeated, tied to a commitment, or manually kept.
- Always preserve source pointers where possible.

This is a major distinction from "index everything forever."

## Calendar Strategy

Calendar is not required for the first capture flow, but it is important for the magic moment.

Minimum calendar fast-follow:

- Read upcoming events.
- Resolve attendees to entities.
- Trigger or suggest a person/project brief.
- Do not write to calendar in MVP.

## Open Product Questions

- Should every atom be visible, or only briefs and review prompts?
- How aggressive should expiry be by default?
- How much should Humin explain why a memory was retained?
- Should "forgotten" mean hard-delete, soft-delete, or encrypted tombstone?
- How often should the user be asked to review memory?
- Should person/project pages exist early, or should briefs remain the primary surface?

## Build Bias

Build the narrow magic trick first:

> Brief me for this person/project using only memory that is still relevant.

Everything else should serve that.
