// Recall-analysis export (see "data recall analysis.md"). Flattens the gold
// verdicts to a CSV — one row per gold commitment with its outcome and the
// segment fields you slice recall by (strength, due-date quality, direction,
// channel). This turns "what did we miss, and where" into a spreadsheet pivot.
import Papa from "papaparse";
import type { CaptureEvent, GoldCommitment, PredictionRecord } from "../types.ts";
import type { ThresholdResult } from "./metrics.ts";

export function renderMissesCsv(
  result: ThresholdResult,
  predictions: PredictionRecord[],
  gold: GoldCommitment[],
  events: CaptureEvent[],
): string {
  const predById = new Map(predictions.map((p) => [p.prediction_id, p]));
  const goldById = new Map(gold.map((g) => [g.id, g]));
  const sourceOf = new Map(events.map((e) => [e.id, e.source]));
  const verdictByPred = new Map(result.predictionVerdicts.map((v) => [v.prediction_id, v]));

  const rows = result.goldVerdicts.map((gv) => {
    const g = goldById.get(gv.gold_id)!;
    const matchedId = gv.matched_prediction_ids[0];
    const mp = matchedId ? predById.get(matchedId) : undefined;
    const mv = matchedId ? verdictByPred.get(matchedId) : undefined;
    const channels = [...new Set(g.source_event_ids.map((id) => sourceOf.get(id) ?? "?"))].join("|");
    return {
      gold_id: gv.gold_id,
      outcome: gv.outcome, // caught | partially_caught | missed
      direction: g.direction,
      strength: g.commitment_strength,
      due_date_quality: g.due_date_quality,
      has_due_date: g.due_date ? "yes" : "no",
      channels,
      statement: g.statement,
      matched_prediction_statement: mp?.statement ?? "",
      matched_confidence: mp ? mp.confidence : "",
      judge_reason: mv?.judge_reason ?? "",
    };
  });

  return Papa.unparse(rows);
}
