export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  /**
   * Assistant: tap-to-play spraak.
   * Zonder `ttsText`: alleen speler, tekst verborgen (normale voice-reply).
   * Met `ttsText`: `content` zichtbaar (bijv. prijzen), audio gebruikt `ttsText`.
   */
  voice?: { language: string; ttsText?: string };
  /**
   * User: `false` = nog niet gelezen door contact; `true` of ontbreekt = gelezen.
   * Oude berichten zonder veld worden als gelezen getoond.
   */
  readByPeer?: boolean;
  /** User: bestandsnaam in data/conv-images/{conversationId}/ (jpg/png). */
  imageFile?: string;
}

export interface Conversation {
  id: string;
  profileId: string;
  profileName: string;
  previewAvatar: string;
  isOnline: boolean;
  messages: ChatMessage[];
  updatedAt: string;
}

export interface ConversationSummary {
  id: string;
  profileId: string;
  profileName: string;
  previewAvatar: string;
  lastMessage: string;
  timestamp: string;
  unread: number;
  isOnline: boolean;
}
