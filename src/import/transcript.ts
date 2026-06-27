// Transcript importer: WebVTT, JSON (generic segment shapes), or plain text →
// one CaptureEvent per speaker turn (consecutive same-speaker lines coalesced).
import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import type { CaptureEvent } from "../types.ts";
import { isFounder, slug, stableId } from "./normalize.ts";

interface Turn {
  speaker: string;
  text: string;
}

const SPEAKER_LINE = /^(?:\[[^\]]*\]\s*)?([A-Za-z0-9 ._'-]{1,40}?):\s*(.*)$/; // "Name: text" (opt. [ts] prefix)
const VTT_VOICE = /<v\s+([^>]+)>(.*?)<\/v>/i; // "<v Speaker>text</v>"

function coalesce(segments: Turn[]): Turn[] {
  const turns: Turn[] = [];
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    const last = turns.at(-1);
    if (last && last.speaker === seg.speaker) last.text += " " + text;
    else turns.push({ speaker: seg.speaker, text });
  }
  return turns;
}

function parseVtt(raw: string): Turn[] {
  const segments: Turn[] = [];
  let speaker = "Unknown";
  for (const block of raw.replace(/^WEBVTT.*?\n/s, "").split(/\n\s*\n/)) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim() && !l.includes("-->") && !/^\d+$/.test(l.trim()));
    for (const line of lines) {
      const voice = line.match(VTT_VOICE);
      if (voice) {
        speaker = (voice[1] ?? speaker).trim();
        segments.push({ speaker, text: voice[2] ?? "" });
        continue;
      }
      const named = line.match(SPEAKER_LINE);
      if (named && named[1]) {
        speaker = named[1].trim();
        segments.push({ speaker, text: named[2] ?? "" });
      } else {
        segments.push({ speaker, text: line });
      }
    }
  }
  return coalesce(segments);
}

function parseJsonTranscript(raw: string): Turn[] {
  const data: unknown = JSON.parse(raw);
  const arr: unknown[] = Array.isArray(data)
    ? data
    : (() => {
        const o = data as Record<string, unknown>;
        for (const k of ["segments", "transcript", "results", "monologues", "utterances"]) {
          if (Array.isArray(o[k])) return o[k] as unknown[];
        }
        return [];
      })();
  const segments: Turn[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || !item) continue;
    const s = item as Record<string, unknown>;
    const speaker = String(s.speaker ?? s.speaker_name ?? s.name ?? s.speaker_label ?? "Unknown");
    let text = s.text ?? s.content ?? s.value;
    if (text == null && Array.isArray(s.words)) {
      text = (s.words as Record<string, unknown>[]).map((w) => String(w.word ?? w.text ?? "")).join(" ");
    }
    segments.push({ speaker, text: String(text ?? "") });
  }
  return coalesce(segments);
}

function parsePlainText(raw: string): Turn[] {
  const segments: Turn[] = [];
  let speaker = "Unknown";
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(SPEAKER_LINE);
    if (m && m[1]) {
      speaker = m[1].trim();
      segments.push({ speaker, text: m[2] ?? "" });
    } else {
      segments.push({ speaker, text: line });
    }
  }
  return coalesce(segments);
}

export function parseTranscript(filePath: string, founders: string[], meetingDate?: string): CaptureEvent[] {
  const raw = readFileSync(filePath, "utf8");
  const ext = extname(filePath).toLowerCase();
  const turns =
    ext === ".vtt" || /^WEBVTT/.test(raw)
      ? parseVtt(raw)
      : ext === ".json"
        ? parseJsonTranscript(raw)
        : parsePlainText(raw);

  const meeting = basename(filePath).replace(/\.[^.]+$/, "");
  const threadId = `transcript:${slug(meeting)}`;
  const occurredAt = meetingDate
    ? new Date(meetingDate).toISOString()
    : statSync(filePath).mtime.toISOString();

  return turns.map((turn, i) => ({
    id: stableId("transcript", meeting, String(i), turn.speaker, turn.text),
    source: "transcript",
    source_ref: `${meeting}#${i}`,
    direction_hint: isFounder(turn.speaker, founders) ? "outbound" : "inbound",
    author: turn.speaker,
    occurred_at: occurredAt,
    thread_id: threadId,
    raw_text: turn.text,
    metadata: { meeting, turn_index: i },
  }));
}
