// Compute the mvp.md §6 metric set from raw matches, at a given confidence
// threshold. Matching is fixed; only the considered-prediction set changes with
// the threshold, so the report can sweep thresholds cheaply over one match pass.
import type {
  CaptureEvent,
  GoldCommitment,
  GoldVerdict,
  Metrics,
  PredictionRecord,
  PredictionVerdict,
} from "../types.ts";
import type { RawMatch } from "./match.ts";

export interface ThresholdResult {
  metrics: Metrics;
  predictionVerdicts: PredictionVerdict[];
  goldVerdicts: GoldVerdict[];
}

const ratio = (n: number, d: number): number => (d === 0 ? 0 : n / d);
const dateOk = (r: RawMatch): boolean => r.due_date_correct === true || r.due_date_correct === "no_date";
const matchScore = (r: RawMatch): number => (r.person_correct ? 2 : 0) + (dateOk(r) ? 1 : 0);

export function computeMetrics(
  predictions: PredictionRecord[],
  rawMatches: RawMatch[],
  gold: GoldCommitment[],
  events: CaptureEvent[],
  threshold: number,
): ThresholdResult {
  const rawById = new Map(rawMatches.map((r) => [r.prediction_id, r]));
  const predById = new Map(predictions.map((p) => [p.prediction_id, p]));
  const goldById = new Map(gold.map((g) => [g.id, g]));
  const considered = predictions.filter((p) => p.confidence >= threshold);

  const predVerdicts: PredictionVerdict[] = [];
  const byGold = new Map<string, PredictionRecord[]>();

  // 1. Partition considered predictions: unmatched → false positive; matched → grouped by gold.
  for (const p of considered) {
    const r = rawById.get(p.prediction_id);
    if (!r || !r.matched_gold_id) {
      predVerdicts.push({ prediction_id: p.prediction_id, outcome: "false_positive", judge_reason: r?.reason ?? "no match" });
      continue;
    }
    let arr = byGold.get(r.matched_gold_id);
    if (!arr) {
      arr = [];
      byGold.set(r.matched_gold_id, arr);
    }
    arr.push(p);
  }

  // 2. For each matched gold, the best prediction is primary (TP or partial); the rest are duplicates.
  let truePositives = 0;
  let partials = 0;
  let duplicates = 0;
  let personEligible = 0;
  let personCorrect = 0;
  let dateEligible = 0;
  let dateCorrect = 0;
  const goldOutcome = new Map<string, "caught" | "partially_caught">();
  const goldMatchedPreds = new Map<string, string[]>();

  const verdict = (p: PredictionRecord, outcome: PredictionVerdict["outcome"], r: RawMatch, goldId: string): PredictionVerdict => ({
    prediction_id: p.prediction_id,
    outcome,
    matched_gold_id: goldId,
    person_correct: r.person_correct,
    due_date_correct: r.due_date_correct === "no_date" ? "no_date_expected" : r.due_date_correct,
    judge_reason: r.reason,
  });

  for (const [goldId, preds] of byGold) {
    goldMatchedPreds.set(goldId, preds.map((p) => p.prediction_id));
    const ranked = [...preds].sort((a, b) => matchScore(rawById.get(b.prediction_id)!) - matchScore(rawById.get(a.prediction_id)!));
    const primary = ranked[0]!;
    const pr = rawById.get(primary.prediction_id)!;
    const full = pr.person_correct && dateOk(pr);
    if (full) {
      truePositives++;
      goldOutcome.set(goldId, "caught");
      predVerdicts.push(verdict(primary, "true_positive", pr, goldId));
    } else {
      partials++;
      goldOutcome.set(goldId, "partially_caught");
      predVerdicts.push(verdict(primary, "partial", pr, goldId));
    }
    const g = goldById.get(goldId);
    if (g?.person) {
      personEligible++;
      if (pr.person_correct) personCorrect++;
    }
    if (g?.due_date) {
      dateEligible++;
      if (pr.due_date_correct === true) dateCorrect++;
    }
    for (const dup of ranked.slice(1)) {
      duplicates++;
      predVerdicts.push(verdict(dup, "duplicate", rawById.get(dup.prediction_id)!, goldId));
    }
  }

  const falsePositives = predVerdicts.filter((v) => v.outcome === "false_positive").length;

  // 3. Gold verdicts + coverage by strength.
  const goldVerdicts: GoldVerdict[] = gold.map((g) => ({
    gold_id: g.id,
    outcome: goldOutcome.get(g.id) ?? "missed",
    matched_prediction_ids: goldMatchedPreds.get(g.id) ?? [],
  }));
  const caughtAny = (g: GoldCommitment) => goldOutcome.has(g.id);
  const hard = gold.filter((g) => g.commitment_strength === "hard");
  const soft = gold.filter((g) => g.commitment_strength === "soft");
  const dateless = gold.filter((g) => !g.due_date);

  // 4. Per-direction precision/coverage. Outbound (i_owe) is the precision gate;
  //    inbound (owed_to_me) is the firehose/noise gate.
  const real = (v: PredictionVerdict) => v.outcome === "true_positive" || v.outcome === "partial";
  const outbound = predVerdicts.filter((v) => predById.get(v.prediction_id)?.direction === "i_owe");
  const outboundReal = outbound.filter(real).length;
  const outboundFp = outbound.filter((v) => v.outcome === "false_positive").length;
  const iOweGold = gold.filter((g) => g.direction === "i_owe");

  const inbound = predVerdicts.filter((v) => predById.get(v.prediction_id)?.direction === "owed_to_me");
  const inboundReal = inbound.filter(real).length;
  const inboundFp = inbound.filter((v) => v.outcome === "false_positive").length;

  const goldEventIds = new Set(gold.flatMap((g) => g.source_event_ids));
  const noiseInbound = events.filter((e) => e.direction_hint === "inbound" && !goldEventIds.has(e.id));
  const predictedEventIds = new Set(considered.flatMap((p) => [p.primary_event_id, ...p.source_event_ids]));
  const noiseDropped = noiseInbound.filter((e) => !predictedEventIds.has(e.id)).length;

  const metrics: Metrics = {
    confidence_threshold: threshold,
    events_total: events.length,
    threads_total: new Set(events.map((e) => e.thread_id ?? e.id)).size,
    gold_total: gold.length,
    base_rate_per_100_events: ratio(gold.length, events.length) * 100,
    hard_total: hard.length,
    soft_total: soft.length,
    dateless_total: dateless.length,
    dateless_ratio: ratio(dateless.length, gold.length),
    predictions_total: considered.length,
    true_positives: truePositives,
    false_positives: falsePositives,
    duplicates,
    partials,
    missed: goldVerdicts.filter((v) => v.outcome === "missed").length,
    precision: ratio(truePositives + partials, truePositives + partials + falsePositives),
    coverage: ratio(truePositives + partials, gold.length),
    outbound_precision: ratio(outboundReal, outboundReal + outboundFp),
    outbound_coverage: ratio(iOweGold.filter(caughtAny).length, iOweGold.length),
    hard_coverage: ratio(hard.filter(caughtAny).length, hard.length),
    soft_coverage: ratio(soft.filter(caughtAny).length, soft.length),
    person_accuracy: ratio(personCorrect, personEligible),
    due_date_accuracy: ratio(dateCorrect, dateEligible),
    duplicate_rate: ratio(duplicates, considered.length),
    inbound_precision: ratio(inboundReal, inboundReal + inboundFp),
    inbound_noise_drop_rate: ratio(noiseDropped, noiseInbound.length),
  };

  return { metrics, predictionVerdicts: predVerdicts, goldVerdicts };
}
