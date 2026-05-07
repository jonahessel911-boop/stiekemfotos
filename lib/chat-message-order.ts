import type { ChatMessage } from "@/lib/types/chat";

/** Stabiele chronologische volgorde voor thread + optimistic berichten. */
export function compareChatMessagesChronologically(a: ChatMessage, b: ChatMessage): number {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  const na = Number.isFinite(ta) ? ta : 0;
  const nb = Number.isFinite(tb) ? tb : 0;
  if (na !== nb) return na - nb;
  return a.id.localeCompare(b.id);
}

export function sortChatMessagesChronologically(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort(compareChatMessagesChronologically);
}
