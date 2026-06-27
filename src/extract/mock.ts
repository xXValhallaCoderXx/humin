// Deterministic, offline stand-in for the LLM extractor. Used by `--mock` so the
// full pipeline (import → label → extract → evaluate) can be validated without an
// API key or real data. It is intentionally simple — a regex baseline, not the
// real extractor — but good enough to produce plausible predictions to evaluate.
import type { CaptureEvent, DueDateQuality, ExtractedCommitment } from "../types.ts";

function deriveName(s: string | undefined): string {
  if (!s) return "";
  const named = s.match(/^"?([^"<@]+?)"?\s*</); // "Name <addr>"
  if (named?.[1]) return named[1].trim();
  if (s.includes("@")) {
    const local = s.split("@")[0] ?? "";
    return local.replace(/[._]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  }
  return s.trim();
}

function dueDateQuality(t: string): DueDateQuality {
  if (/\bby (mon|tues?|wednes?|thurs?|fri|satur?|sun)\w*/i.test(t) || /\bon \w+ \d{1,2}/i.test(t)) return "explicit";
  if (/\b(today|tonight|tomorrow|this (week|afternoon|evening)|next (week|month))\b/i.test(t)) return "relative";
  if (/\b(soon|later|eventually|at some point|when i (get|have) a chance)\b/i.test(t)) return "vague";
  return "none";
}

const FIRST_PERSON = /\bI(?:'ll|’ll| will| can| am going to| 'm going to)\b/i;
const PROMISE_VERB = /\b(send|get|share|follow up|get back|review|draft|set up|make|check|prepare|put together|circle back)\b/i;

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function mockExtract(target: CaptureEvent): ExtractedCommitment[] {
  const out: ExtractedCommitment[] = [];
  const isUser = target.direction_hint === "outbound";
  for (const s of sentences(target.raw_text)) {
    if (s.startsWith("Subject:")) continue;
    if (!FIRST_PERSON.test(s) || !PROMISE_VERB.test(s)) continue;
    const direction = isUser ? "i_owe" : "owed_to_me";
    const person = isUser ? deriveName(target.recipients?.[0]) : deriveName(target.author);
    out.push({
      source_event_ids: [target.id],
      direction,
      statement: s,
      person,
      due_date: "",
      due_date_quality: dueDateQuality(s),
      confidence: 0.8,
      evidence_text: s,
      reason: "mock heuristic: first-person future + promise verb",
    });
  }
  return out;
}
