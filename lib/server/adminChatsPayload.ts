import { countOpenChats } from "@/lib/admin/chat-open";
import type { AdminUserConversations } from "@/lib/admin/types";
import type { Conversation } from "@/lib/types/chat";
import type { AdminUserRow } from "@/lib/server/adminDataset";

export function buildAdminConversationsByUser(
  users: AdminUserRow[],
  conversations: Conversation[]
): AdminUserConversations[] {
  const withConversations = users
    .map((u) => ({
      userId: u.id,
      userEmail: u.email,
      userName: u.naam,
      conversations: conversations
        .filter((c) => c.ownerUserId === u.id)
        .map((c) => ({
          id: c.id,
          profileName: c.profileName,
          updatedAt: c.updatedAt,
          messages: c.messages.length,
          lastMessage: c.messages[c.messages.length - 1]?.content ?? "",
          history: c.messages.map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            createdAt: m.createdAt,
          })),
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    }))
    .filter((u) => u.conversations.length > 0);

  return withConversations.sort((a, b) => {
    const aMax = a.conversations[0]?.updatedAt ?? "";
    const bMax = b.conversations[0]?.updatedAt ?? "";
    return bMax.localeCompare(aMax);
  });
}

export function adminChatsPayload(users: AdminUserRow[], conversations: Conversation[]) {
  const conversationsByUser = buildAdminConversationsByUser(users, conversations);
  return {
    conversationsByUser,
    openChats: countOpenChats(conversationsByUser),
  };
}
