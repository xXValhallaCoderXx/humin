// CLI: match predictions to the gold set, compute metrics across confidence
// thresholds, and emit the Phase 0 report + verdict (mvp.md §5 step 4, §6, §7, §17).
//   pnpm run evaluate -- --pred data/predictions/predictions.v1.json
//   pnpm run evaluate -- --pred data/predictions/predictions.v1-mock.json --gold fixtures/gold_commitments.fixture.csv --mock
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnv, optNum, optStr, parseArgs } from "../src/cli.ts";
import { makeChatClient } from "../src/llm/openrouter.ts";
import { loadGold } from "../src/gold.ts";
import { loadCaptureEvents } from "../src/import/normalize.ts";
import { CAPTURE_EVENTS, GOLD_CSV, PREDICTIONS_DIR, REPORTS_DIR } from "../src/paths.ts";
import { matchAll } from "../src/evaluate/match.ts";
import { computeMetrics, type ThresholdResult } from "../src/evaluate/metrics.ts";
import { renderReport } from "../src/evaluate/report.ts";
import { renderMissesCsv } from "../src/evaluate/recall.ts";
import type { PredictionRun } from "../src/types.ts";

loadEnv();
const args = parseArgs(process.argv.slice(2));
const mock = args.mock === true;
const predPath = optStr(args, "pred") ?? `${PREDICTIONS_DIR}/predictions.v1.json`;
const goldPath = optStr(args, "gold") ?? GOLD_CSV;
const thresholds = (optStr(args, "thresholds") ?? "0,0.6,0.75,0.9")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));

for (const [label, path] of [
  ["predictions", predPath],
  ["gold", goldPath],
  ["capture events", CAPTURE_EVENTS],
] as const) {
  if (!existsSync(path)) {
    console.error(`Missing ${label} at ${path}.`);
    process.exit(1);
  }
}

const run = JSON.parse(readFileSync(predPath, "utf8")) as PredictionRun;
const gold = loadGold(goldPath);
const events = loadCaptureEvents(CAPTURE_EVENTS);

const concurrency = optNum(args, "concurrency", 6);
console.log(`Matching ${run.predictions.length} prediction(s) against ${gold.length} gold commitment(s)${mock ? " (MOCK judge)" : ""}…`);
const rawMatches = await matchAll(run.predictions, gold, events, {
  mock,
  client: mock ? undefined : makeChatClient(),
  concurrency,
  log: (m) => console.log(m),
});

const results: ThresholdResult[] = thresholds.map((t) => computeMetrics(run.predictions, rawMatches, gold, events, t));

const { markdown, verdict } = renderReport({
  results,
  predictions: run.predictions,
  gold,
  events,
  model: run.model,
  promptVersion: run.prompt_version,
  createdAt: new Date().toISOString(),
  costUsd: run.stats.usage.cost_usd,
  validJson: run.stats.valid_json,
  invalidJson: run.stats.invalid_json,
});

const outPath = optStr(args, "out") ?? `${REPORTS_DIR}/metrics.${run.prompt_version}.md`;
mkdirSync(REPORTS_DIR, { recursive: true });
writeFileSync(outPath, markdown);

// Recall-analysis export: one CSV row per gold commitment with outcome + segments.
if (args["dump-misses"]) {
  const r0 = results.find((r) => r.metrics.confidence_threshold === 0) ?? computeMetrics(run.predictions, rawMatches, gold, events, 0);
  const missesPath = optStr(args, "misses-out") ?? `${REPORTS_DIR}/misses.${run.prompt_version}.csv`;
  writeFileSync(missesPath, renderMissesCsv(r0, run.predictions, gold, events) + "\n");
  const notCaught = r0.goldVerdicts.filter((v) => v.outcome !== "caught").length;
  console.log(`Wrote ${missesPath} (${r0.goldVerdicts.length} gold rows; ${notCaught} not fully caught)`);
}

const best = results.reduce((a, b) => (b.metrics.outbound_coverage > a.metrics.outbound_coverage ? b : a)).metrics;
console.log(`\nVerdict: ${verdict}`);
console.log(
  `Best outbound: precision ${(best.outbound_precision * 100).toFixed(0)}% @ coverage ${(best.outbound_coverage * 100).toFixed(0)}% (conf ≥ ${best.confidence_threshold})`,
);
console.log(`Wrote ${outPath}`);
