// Load + write the human gold set (mvp.md §5 step 2 / §12).
// The gold CSV is authored by a human BEFORE running the extractor, so it gives
// the true base rate and the hard/soft/dateless breakdown — the coverage anchor.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import Papa from "papaparse";
import { z } from "zod";
import type { GoldCommitment } from "./types.ts";

export const GOLD_HEADER = [
  "source_event_ids",
  "direction",
  "statement",
  "person",
  "due_date",
  "due_date_quality",
  "commitment_strength",
  "should_surface",
  "notes",
] as const;

const RowSchema = z.object({
  source_event_ids: z.string().min(1),
  direction: z.enum(["i_owe", "owed_to_me"]),
  statement: z.string().min(1),
  person: z.string().optional().default(""),
  due_date: z.string().optional().default(""),
  due_date_quality: z.enum(["explicit", "relative", "vague", "none"]),
  commitment_strength: z.enum(["hard", "soft"]),
  should_surface: z.string().optional().default("true"),
  notes: z.string().optional().default(""),
});

const truthy = (s: string) => /^(true|yes|1)$/i.test(s.trim());

/** Parse a filled gold CSV into GoldCommitment[]. Throws (with row context) on a malformed row. */
export function loadGold(path: string): GoldCommitment[] {
  const csv = readFileSync(path, "utf8");
  const parsed = Papa.parse<Record<string, string | undefined>>(csv, {
    header: true,
    skipEmptyLines: "greedy",
  });
  const gold: GoldCommitment[] = [];
  let n = 0;
  for (const raw of parsed.data) {
    const sids = raw.source_event_ids?.trim();
    if (!sids || sids.startsWith("#")) continue; // blank or comment row
    let r: z.infer<typeof RowSchema>;
    try {
      r = RowSchema.parse(raw);
    } catch (err) {
      throw new Error(`Gold row ${n + 1} is invalid (${sids}): ${(err as Error).message}`);
    }
    n++;
    gold.push({
      id: `gold-${n}`,
      source_event_ids: r.source_event_ids.split(/[;,]/).map((s) => s.trim()).filter(Boolean),
      direction: r.direction,
      statement: r.statement,
      person: r.person || undefined,
      due_date: r.due_date || undefined,
      due_date_quality: r.due_date_quality,
      commitment_strength: r.commitment_strength,
      should_surface: truthy(r.should_surface),
      created_by: "human",
      notes: r.notes || undefined,
    });
  }
  return gold;
}

/** Write an empty gold CSV (header only). Never clobbers an existing (possibly filled) file. */
export function writeGoldTemplate(path: string): boolean {
  if (existsSync(path)) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, GOLD_HEADER.join(",") + "\n");
  return true;
}
