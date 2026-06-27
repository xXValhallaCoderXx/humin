// Email importer: mbox (Gmail/Takeout) or single .eml → CaptureEvent[].
import { readFileSync } from "node:fs";
import { type AddressObject, simpleParser } from "mailparser";
import type { CaptureEvent, Source } from "../types.ts";
import { isFounder, slug, stableId } from "./normalize.ts";

type EmailSource = Extract<Source, "sent_email" | "inbound_export">;

/** Split an mbox file into individual raw RFC822 messages. mbox delimits messages
 *  with a line beginning "From " (the envelope/"From_" line). A .eml file has no
 *  such delimiter and is returned as a single message. */
function splitMessages(raw: string): string[] {
  if (!/^From .*\n/m.test(raw)) return [raw]; // single .eml
  return raw
    .split(/\n(?=From )/g)
    .map((m) => m.replace(/^From .*\n/, "")) // drop the envelope "From_" line
    .filter((m) => m.trim().length > 0);
}

/** Strip the quoted previous message / signature so raw_text is just the new content. */
function stripQuotedReply(text: string): string {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (/^On\b.*\bwrote:$/.test(t)) break; // "On <date>, <name> wrote:"
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(t)) break;
    if (/^_{5,}$/.test(t)) break; // Outlook divider
    if (out.length > 0 && /^(From|Sent|To|Subject):\s/.test(t)) break; // quoted header block
    out.push(line);
  }
  return out
    .filter((l) => !/^\s*>/.test(l)) // drop ">" quoted lines
    .join("\n")
    .trim();
}

function normalizeSubject(subject: string): string {
  return subject.replace(/^\s*((re|fwd|fw)\s*:\s*)+/i, "").trim();
}

function addresses(a: AddressObject | AddressObject[] | undefined): string[] {
  if (!a) return [];
  const arr = Array.isArray(a) ? a : [a];
  return arr.flatMap((o) => o.value.map((v) => v.address ?? v.name ?? "")).filter(Boolean);
}

export async function parseEmail(
  filePath: string,
  sourceLabel: EmailSource,
  founders: string[],
): Promise<CaptureEvent[]> {
  const raw = readFileSync(filePath, "utf8");
  const events: CaptureEvent[] = [];

  for (const rawMessage of splitMessages(raw)) {
    const parsed = await simpleParser(rawMessage);
    const author = parsed.from?.text ?? "";
    const fromAddrs = addresses(parsed.from);
    const recipients = addresses(parsed.to);
    const subject = parsed.subject ?? "";
    const body = stripQuotedReply(parsed.text ?? "");
    const rawText = [subject ? `Subject: ${subject}` : "", body].filter(Boolean).join("\n\n").trim();
    if (!rawText) continue;

    const occurredAt = parsed.date?.toISOString() ?? new Date(0).toISOString();
    const refs = Array.isArray(parsed.references) ? parsed.references[0] : parsed.references;
    const threadId = refs ?? parsed.inReplyTo ?? `subj:${slug(normalizeSubject(subject))}`;
    // direction by who sent it; founder-authored mail is outbound regardless of folder.
    const outbound = fromAddrs.some((a) => isFounder(a, founders)) || isFounder(author, founders);

    events.push({
      id: stableId("email", parsed.messageId, author, occurredAt, rawText),
      source: outbound ? "sent_email" : sourceLabel === "sent_email" ? "sent_email" : "inbound_export",
      source_ref: parsed.messageId,
      direction_hint: outbound ? "outbound" : "inbound",
      author,
      recipients,
      occurred_at: occurredAt,
      thread_id: threadId,
      raw_text: rawText,
      metadata: { subject, message_id: parsed.messageId, in_reply_to: parsed.inReplyTo },
    });
  }
  return events;
}
