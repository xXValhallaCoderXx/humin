// CLI: prepare the human gold-labeling workspace (mvp.md §5 step 2).
//   pnpm run label
// Produces:
//   - data/gold/stream.md  — readable, threaded rendering of the stream to label from
//   - data/gold/gold_commitments.csv — empty template (header only) if not present
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadCaptureEvents } from "../src/import/normalize.ts";
import { writeGoldTemplate } from "../src/gold.ts";
import { CAPTURE_EVENTS, GOLD_CSV, READABLE_STREAM } from "../src/paths.ts";
import type { CaptureEvent } from "../src/types.ts";

const events = loadCaptureEvents(CAPTURE_EVENTS);
if (events.length === 0) {
  console.error(`No capture events at ${CAPTURE_EVENTS}. Run "pnpm run import" first.`);
  process.exit(1);
}

const byThread = new Map<string, CaptureEvent[]>();
for (const e of events) {
  const key = e.thread_id ?? "(no thread)";
  let arr = byThread.get(key);
  if (!arr) {
    arr = [];
    byThread.set(key, arr);
  }
  arr.push(e);
}

let md =
  `# Stream for gold labeling\n\n` +
  `${events.length} events across ${byThread.size} threads.\n\n` +
  `For every REAL commitment you find, add one row to \`${GOLD_CSV}\`.\n` +
  `Copy the id in [brackets] into \`source_event_ids\` (separate multiple ids with \`;\`).\n` +
  `Label independently of the model — this is the coverage ground truth.\n`;

for (const [thread, evs] of byThread) {
  evs.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  md += `\n## ${thread}  (${evs[0]?.source ?? ""})\n\n`;
  for (const e of evs) {
    md += `- [${e.id}] ${e.occurred_at} — ${e.author ?? "?"} (${e.direction_hint})\n`;
    md += `  ${e.raw_text.replace(/\s+/g, " ").trim()}\n`;
  }
}

mkdirSync(dirname(READABLE_STREAM), { recursive: true });
writeFileSync(READABLE_STREAM, md);
const created = writeGoldTemplate(GOLD_CSV);

console.log(`Wrote readable stream → ${READABLE_STREAM}`);
console.log(
  created
    ? `Wrote empty gold template → ${GOLD_CSV}`
    : `Gold file already exists, left untouched → ${GOLD_CSV}`,
);
