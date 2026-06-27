// Render the Phase 0 metrics report (mvp.md §17 format) with the §7 pass/warning/
// stop bands, a confidence-threshold sweep (§13), and a PROCEED/FIX/STOP verdict
// (§7, §18, §19).
import type { CaptureEvent, GateVerdict, GoldCommitment, Metrics, PredictionRecord } from "../types.ts";
import type { ThresholdResult } from "./metrics.ts";

type Band = "PASS" | "WARN" | "STOP";

const pctStr = (x: number) => `${(x * 100).toFixed(1)}%`;
const icon = (b: Band) => (b === "PASS" ? "✅" : b === "WARN" ? "⚠️ " : "🛑");
const gradeHi = (v: number, pass: number, warn: number): Band => (v >= pass ? "PASS" : v >= warn ? "WARN" : "STOP");
const gradeLo = (v: number, pass: number, warn: number): Band => (v <= pass ? "PASS" : v <= warn ? "WARN" : "STOP");

interface GateRow {
  label: string;
  value: string;
  band: Band;
  target: string;
}

function gateRows(m: Metrics): GateRow[] {
  return [
    { label: "Outbound precision", value: pctStr(m.outbound_precision), band: gradeHi(m.outbound_precision, 0.85, 0.7), target: "≥85% / 70–84 / <70" },
    { label: "Outbound coverage", value: pctStr(m.outbound_coverage), band: gradeHi(m.outbound_coverage, 0.6, 0.4), target: "≥60% / 40–59 / <40" },
    { label: "Hard-commitment coverage", value: pctStr(m.hard_coverage), band: gradeHi(m.hard_coverage, 0.75, 0.5), target: "≥75% / 50–74 / <50" },
    { label: "Soft-commitment coverage", value: pctStr(m.soft_coverage), band: gradeHi(m.soft_coverage, 0.4, 0.2), target: "≥40% / 20–39 / <20" },
    { label: "Person accuracy", value: pctStr(m.person_accuracy), band: gradeHi(m.person_accuracy, 0.85, 0.7), target: "≥85% / 70–84 / <70" },
    { label: "Due-date accuracy (when present)", value: pctStr(m.due_date_accuracy), band: gradeHi(m.due_date_accuracy, 0.75, 0.6), target: "≥75% / 60–74 / <60" },
    { label: "Duplicate rate", value: pctStr(m.duplicate_rate), band: gradeLo(m.duplicate_rate, 0.1, 0.2), target: "<10% / 10–20 / >20" },
    { label: "Inbound explicit-promise precision", value: pctStr(m.inbound_precision), band: gradeHi(m.inbound_precision, 0.85, 0.7), target: "≥85% / 70–84 / <70" },
    { label: "Inbound noise drop rate", value: pctStr(m.inbound_noise_drop_rate), band: gradeHi(m.inbound_noise_drop_rate, 0.8, 0.6), target: "≥80% / 60–79 / <60" },
  ];
}

/** Choose the operating point: highest outbound coverage among thresholds whose
 *  outbound precision clears 85%; if none clear it, the highest-precision point. */
function chooseOperating(results: ThresholdResult[]): ThresholdResult {
  const trustworthy = results.filter((r) => r.metrics.outbound_precision >= 0.85);
  const pool = trustworthy.length ? trustworthy : results;
  return [...pool].sort((a, b) =>
    trustworthy.length
      ? b.metrics.outbound_coverage - a.metrics.outbound_coverage
      : b.metrics.outbound_precision - a.metrics.outbound_precision,
  )[0]!;
}

export function computeVerdict(results: ThresholdResult[]): { verdict: GateVerdict; operating: Metrics; rationale: string } {
  const op = chooseOperating(results).metrics;
  const best = (sel: (m: Metrics) => number) => Math.max(...results.map((r) => sel(r.metrics)));

  // STOP if even the best achievable point sits in a kill band (§19).
  if (best((m) => m.outbound_precision) < 0.7) return { verdict: "STOP", operating: op, rationale: "Best outbound precision < 70% — trust floor cannot be met." };
  if (best((m) => m.outbound_coverage) < 0.4) return { verdict: "STOP", operating: op, rationale: "Best outbound coverage < 40% — the brief would feel non-comprehensive." };
  if (best((m) => m.hard_coverage) < 0.5) return { verdict: "STOP", operating: op, rationale: "Best hard-commitment coverage < 50% — misses the commitments that matter most." };
  if (best((m) => m.soft_coverage) < 0.2) return { verdict: "STOP", operating: op, rationale: "Best soft-commitment coverage < 20% — soft commitments are almost never caught." };

  // PROCEED if some operating point clears all proceed-if bars (§18).
  const proceed = results.some(
    (r) =>
      r.metrics.outbound_precision >= 0.85 &&
      r.metrics.outbound_coverage >= 0.6 &&
      r.metrics.hard_coverage >= 0.75 &&
      r.metrics.inbound_precision >= 0.85,
  );
  if (proceed) {
    return { verdict: "PROCEED", operating: op, rationale: `An operating point clears precision ≥85%, coverage ≥60%, hard coverage ≥75%, inbound precision ≥85% (best at confidence ≥${op.confidence_threshold}).` };
  }
  return { verdict: "FIX", operating: op, rationale: "Metrics are in the warning band — iterate on the extractor prompt/threshold before building the product." };
}

export function renderReport(args: {
  results: ThresholdResult[];
  predictions: PredictionRecord[];
  gold: GoldCommitment[];
  events: CaptureEvent[];
  model: string;
  promptVersion: string;
  createdAt: string;
  costUsd: number;
  validJson: number;
  invalidJson: number;
}): { markdown: string; verdict: GateVerdict } {
  const { results, predictions, gold, model, promptVersion, createdAt, costUsd, validJson, invalidJson } = args;
  const { verdict, operating, rationale } = computeVerdict(results);
  const opResult = results.find((r) => r.metrics.confidence_threshold === operating.confidence_threshold)!;
  const m0 = results[0]!.metrics; // base-rate facts are threshold-independent

  const predById = new Map(predictions.map((p) => [p.prediction_id, p]));
  const goldById = new Map(gold.map((g) => [g.id, g]));
  const totalJson = validJson + invalidJson;

  let md = `# Humin MVP — Phase 0 Metrics\n\n`;
  md += `Model: \`${model}\` · Prompt: \`${promptVersion}\` · Generated: ${createdAt}\n\n`;
  md += `## Verdict: ${icon(verdict === "PROCEED" ? "PASS" : verdict === "FIX" ? "WARN" : "STOP")} ${verdict}\n\n${rationale}\n\n`;
  md += `Operating point: confidence ≥ **${operating.confidence_threshold}**.\n\n`;

  md += `## Raw stream\n\n`;
  md += `- Events processed: ${m0.events_total}\n- Threads: ${m0.threads_total}\n`;
  md += `- Human-labeled commitments: ${m0.gold_total}\n`;
  md += `- Base rate: ${m0.base_rate_per_100_events.toFixed(1)} commitments / 100 events\n`;
  md += `- Hard / soft: ${m0.hard_total} / ${m0.soft_total}\n`;
  md += `- Dateless ratio: ${pctStr(m0.dateless_ratio)} (${m0.dateless_total} of ${m0.gold_total})\n\n`;

  md += `## Extraction (at operating point, confidence ≥ ${operating.confidence_threshold})\n\n`;
  md += `- Candidates extracted: ${operating.predictions_total}\n`;
  md += `- True positives: ${operating.true_positives}\n- False positives: ${operating.false_positives}\n`;
  md += `- Partial matches: ${operating.partials}\n- Duplicates: ${operating.duplicates}\n- Missed: ${operating.missed}\n`;
  md += `- Valid JSON: ${validJson}/${totalJson}${totalJson ? ` (${pctStr(validJson / totalJson)})` : ""} — target ≥99%\n`;
  md += `- Run cost: $${costUsd.toFixed(4)}\n\n`;

  md += `## Gate (mvp.md §7) at operating point\n\n`;
  md += `| Metric | Value | Band | Pass / Warn / Stop |\n|---|---:|:--:|---|\n`;
  for (const r of gateRows(operating)) md += `| ${r.label} | ${r.value} | ${icon(r.band)} | ${r.target} |\n`;
  md += `\n`;

  md += `## Confidence threshold sweep (§13)\n\n`;
  md += `| conf ≥ | preds | precision | coverage | out-prec | out-cov | hard-cov | soft-cov | dup-rate |\n`;
  md += `|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const r of results) {
    const m = r.metrics;
    md += `| ${m.confidence_threshold} | ${m.predictions_total} | ${pctStr(m.precision)} | ${pctStr(m.coverage)} | ${pctStr(m.outbound_precision)} | ${pctStr(m.outbound_coverage)} | ${pctStr(m.hard_coverage)} | ${pctStr(m.soft_coverage)} | ${pctStr(m.duplicate_rate)} |\n`;
  }
  md += `\n`;

  // Spot-check examples (§ verification step 5).
  const sample = (outcome: string, n: number) =>
    opResult.predictionVerdicts.filter((v) => v.outcome === outcome).slice(0, n);
  md += `## Spot-check (operating point)\n\n`;
  md += `**True positives**\n`;
  for (const v of sample("true_positive", 5)) md += `- "${predById.get(v.prediction_id)?.statement ?? "?"}" → gold "${goldById.get(v.matched_gold_id ?? "")?.statement ?? "?"}"\n`;
  md += `\n**False positives**\n`;
  const fps = sample("false_positive", 5);
  md += fps.length ? fps.map((v) => `- "${predById.get(v.prediction_id)?.statement ?? "?"}" (${v.judge_reason})\n`).join("") : "- none\n";
  md += `\n**Missed gold commitments**\n`;
  const missed = opResult.goldVerdicts.filter((v) => v.outcome === "missed").slice(0, 5);
  md += missed.length ? missed.map((v) => `- "${goldById.get(v.gold_id)?.statement ?? "?"}"\n`).join("") : "- none\n";
  md += `\n`;

  return { markdown: md, verdict };
}
