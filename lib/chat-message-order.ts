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

/**
 * Één bericht per id (laatste wint). Voorkomt Postgres `messages_pkey`-fouten bij
 * dubbele ids in `conversation.messages` (optimistic + server merge, retries).
 */
export function dedupeChatMessagesById(messages: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of messages) {
    const id = typeof m.id === 'string' ? m.id.trim() : '';
    if (!id) continue;
    byId.set(id, m);
  }
  return sortChatMessagesChronologically([...byId.values()]);
}
