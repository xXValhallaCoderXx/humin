// Telegram importer: Telegram Desktop JSON export (result.json) → CaptureEvent[].
// Handles both a single-chat export ({ messages: [...] }) and a full export
// ({ chats: { list: [ { messages: [...] }, ... ] } }).
import { readFileSync } from "node:fs";
import type { CaptureEvent } from "../types.ts";
import { isFounder, slug, stableId } from "./normalize.ts";

interface TgMessage {
  id?: number;
  type?: string; // "message" | "service"
  date?: string; // "2026-06-01T15:04:05"
  date_unixtime?: string;
  from?: string;
  from_id?: string;
  text?: unknown; // string | array of (string | { type, text })
  reply_to_message_id?: number;
}
interface TgChat {
  name?: string;
  type?: string;
  id?: number;
  messages?: TgMessage[];
}

/** Telegram `text` is a string or an array of strings / entity objects. Flatten it. */
function flattenText(t: unknown): string {
  if (typeof t === "string") return t;
  if (Array.isArray(t)) {
    return t
      .map((p) => (typeof p === "string" ? p : typeof p === "object" && p && "text" in p ? String((p as { text: unknown }).text ?? "") : ""))
      .join("");
  }
  return "";
}

function isoDate(m: TgMessage): string {
  if (m.date_unixtime) return new Date(Number(m.date_unixtime) * 1000).toISOString();
  if (m.date) {
    const d = new Date(m.date);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date(0).toISOString();
}

export function parseTelegram(filePath: string, founders: string[]): CaptureEvent[] {
  const root = JSON.parse(readFileSync(filePath, "utf8")) as
    | (TgChat & { chats?: { list?: TgChat[] } })
    | { chats?: { list?: TgChat[] } };
  const chats: TgChat[] = "messages" in root && Array.isArray((root as TgChat).messages)
    ? [root as TgChat]
    : ((root as { chats?: { list?: TgChat[] } }).chats?.list ?? []);

  const events: CaptureEvent[] = [];
  for (const chat of chats) {
    const chatName = chat.name ?? "Telegram chat";
    const threadId = `tg:${slug(chatName)}:${chat.id ?? ""}`;
    for (const m of chat.messages ?? []) {
      if (m.type !== "message") continue; // skip service messages
      const text = flattenText(m.text).trim();
      if (!text) continue;
      const author = m.from ?? m.from_id ?? "unknown";
      const outbound = isFounder(author, founders) || isFounder(m.from_id, founders);
      const occurredAt = isoDate(m);
      events.push({
        id: stableId("telegram", String(chat.id ?? chatName), String(m.id ?? ""), occurredAt, text),
        source: "telegram",
        source_ref: m.id != null ? String(m.id) : undefined,
        direction_hint: outbound ? "outbound" : "inbound",
        author,
        recipients: [chatName],
        occurred_at: occurredAt,
        thread_id: threadId,
        raw_text: text,
        metadata: {
          chat: chatName,
          chat_type: chat.type,
          from_id: m.from_id,
          reply_to_message_id: m.reply_to_message_id,
        },
      });
    }
  }
  return events;
}
