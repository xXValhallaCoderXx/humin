// Versioned extraction prompt — the commitment contract from mvp.md §13.
// Bump PROMPT_VERSION on any wording change so runs/metrics stay comparable.
import type { CaptureEvent } from "../types.ts";

export const PROMPT_VERSION = "v1";

export const SYSTEM_PROMPT = `You extract COMMITMENTS from a person's messages for Humin, a commitment-memory layer.

A commitment is something the user said they would do for someone, or something someone explicitly said they would do for the user. Commitments have a counterparty and an implied clock.

DIRECTIONS
- "i_owe": the USER promised to do something for someone else.
- "owed_to_me": someone else EXPLICITLY promised to do something for the user.

EXTRACT
- Clear promises the user made to someone else ("I'll send the deck").
- Clear promises someone made to the user ("I'll get you the numbers tomorrow").
- Soft but real commitments where the user is the actor or recipient ("I'll take a look", "let me get back to you").
- Commitments with no due date, when the action and counterparty are clear.

DO NOT EXTRACT
- Ideas, generic plans, FYIs, suggestions, hopes, brainstorming.
- Group obligations with no clear owner.
- Requests the user has NOT accepted ("Can you take a look?", "Could you send me the doc?").
  A request only becomes the user's commitment if the user's OWN message accepts it
  ("Sure, I'll do it tomorrow") — in that case extract it as "i_owe" from the user's reply.
- Vague interest with no action.

INBOUND SCOPE (v0): For "owed_to_me", only extract EXPLICIT promises made to the user.
Do not infer that an inbound request became the user's obligation unless the TARGET
message is the user accepting it.

DUE DATE QUALITY
- "explicit": names a day or date ("by Friday", "on July 3"). Put the normalized ISO date in due_date.
- "relative": relative phrase ("tomorrow", "next week", "tonight"). Normalize to an ISO date in due_date when you can infer it from the message date; otherwise leave due_date "".
- "vague": "soon", "when I get a chance" — leave due_date "".
- "none": no time expressed — leave due_date "".

CONFIDENCE: 0..1, how sure you are this is a real, surface-worthy commitment. Be conservative
but not so conservative you miss soft commitments. (Phase 0 sweeps multiple thresholds, so it
is better to emit a real soft commitment at confidence 0.6 than to drop it.)

OUTPUT
- Extract only commitments STATED IN THE TARGET MESSAGE. Use the conversation context only to
  interpret references and to detect an accepted request.
- Set source_event_ids to the TARGET message's source event id.
- evidence_text must be a verbatim span copied from the TARGET message.
- person is the counterparty's name ("" if unknown). due_date is an ISO date or "".
- If the TARGET message contains no commitment, return {"commitments": []}.`;

function line(e: CaptureEvent): string {
  return `[${e.direction_hint === "outbound" ? "USER" : e.author ?? "other"}]: ${e.raw_text.replace(/\s+/g, " ").trim()}`;
}

export function buildUserPrompt(target: CaptureEvent, context: CaptureEvent[], founderLabel: string): string {
  const ctx = context.length
    ? `CONVERSATION CONTEXT (for interpretation only — do NOT extract from these):\n${context.map(line).join("\n")}\n\n`
    : "";
  return (
    `The user ("USER") is: ${founderLabel || "the account owner"}.\n\n` +
    ctx +
    `TARGET MESSAGE (extract commitments stated here):\n` +
    `${line(target)}\n\n` +
    `Source event id: ${target.id}\n` +
    `Channel: ${target.source}\n` +
    `Date: ${target.occurred_at}\n` +
    (target.recipients?.length ? `Recipients: ${target.recipients.join(", ")}\n` : "")
  );
}
