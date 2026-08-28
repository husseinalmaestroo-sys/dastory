/**
 * Conversation history, kept in localStorage.
 *
 * The chat has no user identity behind it, so there is nowhere on the server to
 * key a transcript to. The browser is the only thing that knows "my" chats.
 */

import type { ChatMessage } from "@/types";

const KEY = "legal-assistant:conversations";
const MAX = 50;

export type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
};

/** First user line, trimmed to something that fits a sidebar row. */
export function titleOf(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.content.trim() ?? "";
  const oneLine = first.replace(/\s+/g, " ");
  return oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine || "محادثة جديدة";
}

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Conversation[]) : [];
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // Quota or private mode: history is a convenience, never worth an error.
  }
}

/**
 * Store `messages` under `id`, newest first.
 *
 * Pending and errored turns are dropped — a half-streamed answer restored from
 * history would look like a real one that stopped mid-sentence.
 */
export function upsertConversation(list: Conversation[], id: string, messages: ChatMessage[]): Conversation[] {
  const clean = messages.filter((m) => !m.pending && !m.error);
  if (clean.length === 0) return list;

  const rest = list.filter((c) => c.id !== id);
  return [{ id, title: titleOf(clean), messages: clean, updatedAt: Date.now() }, ...rest];
}

export function formatWhen(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `قبل ${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `قبل ${hours} س`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `قبل ${days} ي`;
  return new Date(ts).toLocaleDateString("ar-JO");
}
