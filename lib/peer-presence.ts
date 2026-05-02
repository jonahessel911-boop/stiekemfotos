import type { ChatMessage } from "@/lib/types/chat";

/** Stabiele “minuten geleden” voor nieuwe chats zonder assistant-bericht (15–45). */
export function syntheticLastSeenMinutes(conversationId: string): number {
  let h = 0;
  for (let i = 0; i < conversationId.length; i++) {
    h = (h * 31 + conversationId.charCodeAt(i)) >>> 0;
  }
  return 15 + (h % 31);
}

export function lastAssistantMessageAt(messages: ChatMessage[]): string | null {
  let best: string | null = null;
  let t = 0;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    const x = new Date(m.createdAt).getTime();
    if (!Number.isFinite(x)) continue;
    if (x >= t) {
      t = x;
      best = m.createdAt;
    }
  }
  return best;
}

/** Nederlands, kort — voor “Voor het laatst online · …”. */
export function formatLastOnlineAgo(iso: string, nowMs: number = Date.now()): string {
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return "—";
  const sec = Math.max(0, Math.floor((nowMs - d) / 1000));
  if (sec < 45) return "zojuist";
  const min = Math.floor(sec / 60);
  if (min < 1) return "zojuist";
  if (min === 1) return "1 minuut geleden";
  if (min < 60) return `${min} minuten geleden`;
  const h = Math.floor(min / 60);
  if (h === 1) return "1 uur geleden";
  if (h < 24) return `${h} uur geleden`;
  const days = Math.floor(h / 24);
  if (days === 1) return "1 dag geleden";
  return `${days} dagen geleden`;
}
