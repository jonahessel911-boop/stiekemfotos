import type { AdminChatMessage, AdminUserConversations } from "@/lib/admin/types";

/** Laatste bericht is van de user → wacht op handmatig profiel-antwoord. */
export function isConversationAwaitingReply(history: AdminChatMessage[]): boolean {
  if (!history.length) return false;
  return history[history.length - 1]!.role === "user";
}

export function countOpenChats(conversationsByUser: AdminUserConversations[]): number {
  let n = 0;
  for (const u of conversationsByUser) {
    for (const c of u.conversations) {
      if (isConversationAwaitingReply(c.history)) n += 1;
    }
  }
  return n;
}

export function openChatsForUser(user: AdminUserConversations): number {
  return user.conversations.filter((c) => isConversationAwaitingReply(c.history)).length;
}
