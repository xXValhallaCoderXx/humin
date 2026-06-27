// CLI: normalize a raw exported stream into CaptureEvents (mvp.md §5 step 1).
//
//   pnpm import --source <sent_email|inbound_export|telegram|transcript> --in <path> [--out <json>] [--date YYYY-MM-DD]
//
// Re-running is idempotent: a message already in the store (by content hash) is
// skipped, so multiple sources accumulate into one capture_events.json (§10).
import { loadEnv, optStr, parseArgs, requireStr } from "../src/cli.ts";
import { parseEmail } from "../src/import/email.ts";
import { getFounderIdentities, mergeAndWrite } from "../src/import/normalize.ts";
import { parseTelegram } from "../src/import/telegram.ts";
import { parseTranscript } from "../src/import/transcript.ts";
import { CAPTURE_EVENTS } from "../src/paths.ts";
import type { CaptureEvent } from "../src/types.ts";

loadEnv();
const args = parseArgs(process.argv.slice(2));
const source = requireStr(args, "source");
const input = requireStr(args, "in");
const out = optStr(args, "out") ?? CAPTURE_EVENTS;
const founders = getFounderIdentities();

if (founders.length === 0) {
  console.warn(
    "⚠  HUMIN_FOUNDER_IDENTITIES is empty — every message will be classified as inbound.\n" +
      "   Set it in .env so outbound (i_owe) commitments are attributed to you.",
  );
}

const events: CaptureEvent[] = await (async (): Promise<CaptureEvent[]> => {
  switch (source) {
    case "email":
    case "sent_email":
      return parseEmail(input, "sent_email", founders);
    case "inbound_export":
      return parseEmail(input, "inbound_export", founders);
    case "telegram":
      return parseTelegram(input, founders);
    case "transcript":
      return parseTranscript(input, founders, optStr(args, "date"));
    default:
      console.error(`Unknown --source "${source}". Use: sent_email | inbound_export | telegram | transcript`);
      return process.exit(1);
  }
})();

const { added, skipped, total } = mergeAndWrite(out, events);
console.log(`Imported ${events.length} event(s) from "${source}": ${added} new, ${skipped} duplicate(s).`);
console.log(`Store now holds ${total} event(s) → ${out}`);
