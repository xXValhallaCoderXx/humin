// Shared domain + evaluation types for Humin Phase 0.
// Domain types mirror mvp.md §12 verbatim so they can be reused unchanged in Phase 1.

export type Source = "sent_email" | "transcript" | "telegram" | "inbound_export";
export type DirectionHint = "outbound" | "inbound";
export type Direction = "i_owe" | "owed_to_me";
export type DueDateQuality = "explicit" | "relative" | "vague" | "none";
export type CommitmentStrength = "hard" | "soft";

/** Raw, normalized message — the unit of ingestion (mvp.md §5 step 1 / §12). */
export interface CaptureEvent {
  /** Stable content hash. Re-importing the same message is idempotent (§10). */
  id: string;
  source: Source;
  /** Provider-native id (Message-ID, telegram message id, …) when available. */
  source_ref?: string;
  direction_hint: DirectionHint;
  author?: string;
  recipients?: string[];
  /** ISO 8601. */
  occurred_at: string;
  thread_id?: string;
  raw_text: string;
  metadata?: Record<string, unknown>;
}

/** Human-created gold label — one per real commitment (mvp.md §12). Phase 0 + evals only. */
export interface GoldCommitment {
  id: string;
  source_event_ids: string[];
  direction: Direction;
  statement: string;
  person?: string;
  due_date?: string;
  due_date_quality: DueDateQuality;
  commitment_strength: CommitmentStrength;
  should_surface: boolean;
  created_by: "human";
  notes?: string;
}

/** Extractor output for one predicted commitment (mvp.md §5 step 3 / §13). */
export interface ExtractedCommitment {
  source_event_ids: string[];
  direction: Direction;
  statement: string;
  person?: string;
  /** ISO 8601 when normalizable from the source. */
  due_date?: string;
  due_date_quality: DueDateQuality;
  /** 0..1 — Phase 0 sweeps multiple thresholds over this (§13). */
  confidence: number;
  /** Verbatim span from the source message that justifies the extraction. */
  evidence_text: string;
  reason: string;
}

export interface PredictionRecord extends ExtractedCommitment {
  prediction_id: string;
  /** The event this prediction was extracted from (custom_id of the batch request). */
  primary_event_id: string;
}

export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

/** One full extractor run over the stream. */
export interface PredictionRun {
  prompt_version: string;
  model: string;
  created_at: string;
  predictions: PredictionRecord[];
  stats: {
    events_processed: number;
    valid_json: number;
    invalid_json: number;
    predictions_emitted: number;
    usage: UsageTotals;
  };
}

/** Accepted-request research candidate (mvp.md §8) — labeled, never surfaced in v0. */
export interface AcceptedRequestCandidate {
  ask_event_id: string;
  acceptance_event_id?: string;
  requester: string;
  user_reply?: string;
  accepted: boolean | "unclear";
  notes?: string;
}

// ---- Evaluation (mvp.md §5 step 4 / §6) ----

export type PredictionOutcome = "true_positive" | "false_positive" | "duplicate" | "partial";
export type GoldOutcome = "caught" | "missed" | "partially_caught";

export interface PredictionVerdict {
  prediction_id: string;
  outcome: PredictionOutcome;
  matched_gold_id?: string;
  person_correct?: boolean;
  due_date_correct?: boolean | "no_date_expected";
  judge_reason: string;
}

export interface GoldVerdict {
  gold_id: string;
  outcome: GoldOutcome;
  matched_prediction_ids: string[];
}

/** The full §6 metric set, computed at a given confidence threshold. */
export interface Metrics {
  confidence_threshold: number;
  // base rate
  events_total: number;
  threads_total: number;
  gold_total: number;
  base_rate_per_100_events: number;
  hard_total: number;
  soft_total: number;
  dateless_total: number;
  dateless_ratio: number;
  // extraction quality
  predictions_total: number;
  true_positives: number;
  false_positives: number;
  duplicates: number;
  partials: number;
  missed: number;
  precision: number;
  coverage: number;
  outbound_precision: number;
  outbound_coverage: number;
  hard_coverage: number;
  soft_coverage: number;
  person_accuracy: number;
  due_date_accuracy: number;
  duplicate_rate: number;
  // inbound (owed_to_me) firehose quality
  inbound_precision: number;
  inbound_noise_drop_rate: number;
}

export type GateVerdict = "PROCEED" | "FIX" | "STOP";

// ---- Phase 1 forward-declared types (mvp.md §12) — authored here for reuse; unused in Phase 0. ----

export type AtomStatus = "open" | "kept" | "dropped" | "not_commitment";
export type ResurfaceCadence = "daily" | "every_3_days" | "weekly" | "manual";
export type Sensitivity = "normal" | "private" | "highly_private";

export interface MemoryAtom {
  id: string;
  user_id: string;
  type: "commitment";
  direction: Direction;
  statement: string;
  source_event_ids: string[];
  people: string[];
  projects?: string[];
  topics?: string[];
  status: AtomStatus;
  due_date?: string;
  due_date_quality: DueDateQuality;
  first_seen_at: string;
  last_resurfaced_at?: string;
  next_resurface_at?: string;
  resurface_cadence: ResurfaceCadence;
  confidence: number;
  sensitivity: Sensitivity;
  possible_duplicate?: boolean;
  duplicate_candidate_of?: string;
  dedupe_confidence?: number;
  extraction_prompt_version: string;
  created_at: string;
  updated_at: string;
}

export interface CommitmentFeedback {
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
}

export interface ExtractionTrace {
  id: string;
  capture_event_id: string;
  model: string;
  prompt_version: string;
  raw_output: unknown;
  parsed_successfully: boolean;
  atoms_created: string[];
  atoms_suppressed_as_duplicates?: string[];
  created_at: string;
}
