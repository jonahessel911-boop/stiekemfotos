export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  /** WhatsApp-style reply-to. References another message id in the same conversation. */
  replyToId?: string;
  /**
   * Assistant: tap-to-play spraak.
   * Zonder `ttsText`: alleen speler, tekst verborgen (normale voice-reply).
   * Met `ttsText`: `content` zichtbaar (bijv. prijzen), audio gebruikt `ttsText`.
   */
  voice?: {
    language: string;
    ttsText?: string;
    transcript?: string;
    mimeType?: string;
    durationMs?: number;
  };
  /**
   * User: `false` = nog niet gelezen door contact; `true` of ontbreekt = gelezen.
   * Oude berichten zonder veld worden als gelezen getoond.
   */
  readByPeer?: boolean;
  /** When the message was delivered to the other side (for realistic receipts) */
  deliveredAt?: string;
  /** When the other side actually read the message (realistic timing) */
  readAt?: string;
  /** User: bestandsnaam in data/conv-images/{conversationId}/ (jpg/png). */
  imageFile?: string;
  /**
   * Assistant-foto's worden vergrendeld verstuurd. Pas na betaling van
   * `credits` mag de gebruiker de foto bekijken.
   */
  photoLock?: {
    credits: number;
    unlockedAt?: string;
  };
  /**
   * Assistant locked-photo generation payload.
   * Photo gets generated on unlock using this prompt.
   */
  photoGeneration?: {
    prompt: string;
    width?: number;
    height?: number;
  };
  /** Gift-badge die in de chat zichtbaar is. */
  gift?: {
    credits: number;
    direction: "to_peer" | "to_user";
    emoji?: string;
    packageLabel?: string;
    note?: string;
  };
  /**
   * Simulated typing events for ultra-realistic UI.
   * Allows showing "is typing..." → stops → starts again → sends.
   */
  typingEvents?: Array<{
    startedAt: string;
    stoppedAt?: string;
    sent?: boolean;
  }>;
}

export interface Conversation {
  id: string;
  profileId: string;
  profileName: string;
  previewAvatar: string;
  isOnline: boolean;
  messages: ChatMessage[];
  updatedAt: string;
  /** Ingelogde gebruiker die dit gesprek ziet; ontbreekt = legacy demo-seed voor gasten. */
  ownerUserId?: string;
  /** Na assistent-antwoord: optionele follow-up timer als gebruiker niet reageert. */
  pendingNoReplyFollowUpAt?: string;
  /** Assistentbericht-id waar sindsdien geen user-bericht op mag volgen voor follow-up. */
  pendingNoReplyAfterAssistantId?: string;
  /**
   * Welke herinnering (0–3) wordt verstuurd als de timer afgaat; daarna plannen we de volgende trede.
   * 0 ≈ 5 min (licht), 1 ≈ 1–2 u, 2 ≈ ~1 dag, 3 ≈ ~3 dagen (schrijver).
   */
  pendingNoReplyReminderStage?: number;
  /** Auto-gift trigger als er binnen 1 uur geen aankoop is gedaan. */
  pendingNoPurchaseGiftAt?: string;
  noPurchaseGiftSentAt?: string;
  /** Eerste automatisch bericht voor nieuwe account na 3-10 min (eenmalig). */
  pendingInitialAssistantAt?: string;
  initialAssistantSentAt?: string;
  postPurchaseNudgeAfterReplies?: number;
  postPurchaseAssistantReplyCount?: number;
  postPurchaseNudgeSentAt?: string;
  /** Eenmalige nudge zodra gratis startcredits op zijn en er geen aankoop is. */
  creditsExhaustedNudgeSentAt?: string;
  /** Anti-spam voor e-mail: laatste offline nieuw-bericht mail. */
  lastOfflineMessageEmailAt?: string;
  /** Anti-spam voor e-mail: laatste gift-mail. */
  lastGiftEmailAt?: string;
  /**
   * Laatste keer dat de eigenaar dit gesprek opvroeg (GET) of er actief in postte.
   * Voor offline-e-mail: geen mail sturen als dit kort geleden is (gebruiker leest mee).
   */
  ownerLastPollAt?: string;
  /** Voice flow: na herhaalde inspreekvraag eerst verduidelijking vragen in chat. */
  /** Delayed tease after locked photo if still not unlocked. */
  pendingLockedPhotoNudgeAt?: string;
  pendingLockedPhotoMessageId?: string;
  pendingLockedPhotoNudgeText?: string;
  /** Queue: send locked photo bubble after realistic delay (40-120s). */
  pendingLockedPhotoDeliveryAt?: string;
  pendingLockedPhotoDelivery?: {
    messageId: string;
    prompt: string;
    width?: number;
    height?: number;
    teaseText?: string;
    delayedNudgeText?: string;
  };
  /** Assistant asked user what kind of photo he wants; wait for concrete visual details. */
  pendingPhotoPreferenceRequest?: boolean;
  /** Geaccumuleerde user-intent binnen één foto-cyclus (trigger + details); wordt gewist na versturen locked foto. */
  pendingPhotoCycleIntent?: string;
  /** First generated assistant photo in this conversation; used as identity reference for future images. */
  firstGeneratedPhotoMessageId?: string;
  firstGeneratedPhotoFile?: string;

  /** === ULTRA-REALISM ENGINE FIELDS (Project Echo) === */
  realismState?: {
    mood: 'playful' | 'bratty' | 'affectionate' | 'distant' | 'horny' | 'tired' | 'engaged';
    energy: number;
    lastReplyAt: string;
    messagesSinceLastReply: number;
    ghostProbability: number;
    lastSpontaneousMessageAt?: string;
  };
}

export interface ConversationSummary {
  id: string;
  profileId: string;
  profileName: string;
  previewAvatar: string;
  lastMessage: string;
  /** Laatste regel is van haar (assistant) → vet in inbox zodat nieuwe reacties opvallen. */
  lastMessageFromAssistant?: boolean;
  /** HH:mm voor UI; voor sorteren/dedup gebruik `updatedAt`. */
  timestamp: string;
  /** ISO-tijd laatste activiteit (server), voor betrouwbare dedup per profiel. */
  updatedAt: string;
  unread: number;
  isOnline: boolean;
}
