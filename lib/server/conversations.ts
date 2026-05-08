import { randomUUID } from "crypto";
import { readJsonBlob, writeJsonBlob } from "@/lib/server/blobJson";
import type { Conversation, ConversationSummary, ChatMessage } from "@/lib/types/chat";
import type { Profile } from "@/lib/types/profile";
import { getDbProfileById, listDbProfiles, isSupabaseProfilesEnabled } from "@/lib/server/profilesDb";
import { completeChat, type GrokContentPartOpenAI, type GrokMessage } from "@/lib/grok";
import {
  MAX_OUTGOING_BATCH_SIZE,
  MAX_USER_MESSAGE_CHARS,
} from "@/lib/chat-send-limits";
import { CREDITS_PER_MESSAGE, CREDITS_PER_PHOTO_UNLOCK } from "@/lib/credits-client";
import type { UserMessageCreditLine } from "@/lib/types/credit-usage";
import { readAiSettings } from "@/lib/server/aiSettings";
import { randomTypingDelayMs, replyTypingDelayMsForConversation, sleep } from "@/lib/chat-typing-delay";
import {
  type ConversationState,
  createInitialConversationState,
  updateConversationState,
  getRealisticReplyDelay,
  shouldReplyNow,
  simulateTypingBehavior,
} from "@/lib/chat-realism";
import {
  generateConversationSummary,
  shouldGenerateSummary,
  injectMemoryIntoSystemPrompt,
} from "@/lib/conversation-memory";
import { buildFreeChatPrompt } from "@/lib/prompts/freeChat";
import { saveConversationImage, saveConversationVoiceInput } from "@/lib/server/convImageStore";
import {
  findUserById,
  canSendInboxNotificationEmail,
  touchLastInboxNotificationEmail,
  updateUserPersonalFacts,
  type UserRecord,
} from "@/lib/server/users";
import { buildNudePrompt, generateRealisticImage } from "@/lib/server/imageGen";
import { sendGiftReceivedEmail, sendOfflineNewMessageEmail } from "@/lib/server/email";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { upsertAppUserToSupabaseUsers } from "@/lib/server/supabaseUserSync";
import { sortChatMessagesChronologically } from "@/lib/chat-message-order";
import { extractPersonalFactsFromText, formatPersonalFactsForPrompt } from "@/lib/user-personal-facts";

const FILE = "conversations.json";

/**
 * Voorkomt dubbele threads (zelfde owner + profileId): één gesprek met alle berichten.
 * Houdt de meest recent bijgewerkte rij aan als primaire id.
 */
function dedupeDuplicateOwnerConversationsInPlace(
  list: Conversation[],
  onlyOwnerId?: string
): boolean {
  const byKey = new Map<string, Conversation[]>();
  for (const c of list) {
    if (!c.ownerUserId) continue;
    if (onlyOwnerId !== undefined && c.ownerUserId !== onlyOwnerId) continue;
    const k = `${c.ownerUserId}::${c.profileId}`;
    const g = byKey.get(k) ?? [];
    g.push(c);
    byKey.set(k, g);
  }
  const removeIds = new Set<string>();
  for (const [, group] of byKey) {
    if (group.length < 2) continue;
    group.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const primary = group[0]!;
    const idSet = new Set(primary.messages.map((m) => m.id));
    let maxUpdated = new Date(primary.updatedAt).getTime();
    for (const other of group.slice(1)) {
      for (const m of other.messages) {
        if (!idSet.has(m.id)) {
          primary.messages.push(m);
          idSet.add(m.id);
        }
      }
      maxUpdated = Math.max(maxUpdated, new Date(other.updatedAt).getTime());
      removeIds.add(other.id);
    }
    primary.messages = sortChatMessagesChronologically(primary.messages);
    primary.updatedAt = new Date(maxUpdated).toISOString();
  }
  if (removeIds.size === 0) return false;
  const keep = list.filter((c) => !removeIds.has(c.id));
  list.length = 0;
  list.push(...keep);
  return true;
}

function canonicalAvatarKey(url: string): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return raw;
  }
}

function uniqueFallbackAvatar(profileId: string): string {
  const seed = encodeURIComponent(`conv-${profileId}`);
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${seed}&backgroundColor=fce7f3`;
}

/** Forceert unieke avatar per profiel in gesprekken/inbox (ook voor legacy data). */
function enforceUniqueConversationAvatars(list: Conversation[]): Conversation[] {
  const usedByProfile = new Map<string, string>();
  const usedByAvatar = new Map<string, string>();
  return list.map((c) => {
    const profileId = c.profileId;
    const existingForProfile = usedByProfile.get(profileId);
    if (existingForProfile) {
      return existingForProfile === c.previewAvatar
        ? c
        : { ...c, previewAvatar: existingForProfile };
    }

    const key = canonicalAvatarKey(c.previewAvatar);
    if (!key) {
      const fallback = uniqueFallbackAvatar(profileId);
      usedByProfile.set(profileId, fallback);
      usedByAvatar.set(canonicalAvatarKey(fallback), profileId);
      return { ...c, previewAvatar: fallback };
    }

    const owner = usedByAvatar.get(key);
    if (owner && owner !== profileId) {
      const fallback = uniqueFallbackAvatar(profileId);
      usedByProfile.set(profileId, fallback);
      usedByAvatar.set(canonicalAvatarKey(fallback), profileId);
      return { ...c, previewAvatar: fallback };
    }

    usedByProfile.set(profileId, c.previewAvatar);
    usedByAvatar.set(key, profileId);
    return c;
  });
}

function shuffleInboxIds<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

async function getInboxProfileIdsForPlatform(): Promise<string[]> {
  if (!isSupabaseProfilesEnabled()) {
    return ["1", "2", "3", "4", "5"];
  }
  const profiles = await listDbProfiles(48);
  if (profiles.length >= 5) {
    return shuffleInboxIds(profiles.map((p) => p.id)).slice(0, 5);
  }
  if (profiles.length > 0) {
    const ids = profiles.map((p) => p.id);
    const pad = [...ids];
    while (pad.length < 5) pad.push(ids[pad.length % ids.length]!);
    return pad.slice(0, 5);
  }
  return [];
}
const INITIAL_ASSISTANT_MIN_DELAY_MS = 20 * 1000;
const INITIAL_ASSISTANT_MAX_DELAY_MS = 5 * 60 * 1000;
const FREE_START_CREDITS = 100;

/** Max. trede 3 = vierde herinnering (~3 dagen); daarna geen verdere auto-nudges. */
const NO_REPLY_REMINDER_LAST_STAGE = 3;
const MIN_INACTIVITY_BEFORE_AUTO_NUDGE_MS = 12 * 60 * 1000; // 12 minuten na laatste AI-bericht voordat een reminder mag komen

const NO_REPLY_LINES_BY_STAGE: readonly (readonly string[])[] = [
  [
    "hey? ben je er nog",
    "hallo? reageer je nog? ;)",
    "ben je daar nog of val ik in een zwart gat haha",
    "yo, ben je nog online?",
  ],
  [
    "oookee dan niet..",
    "tss oke dan.. negeer maar lekker",
    "prima hoor, dan niet..",
    "oke, dan laat ik het ook wel weten hoor",
  ],
  [
    "alle mannen zijn hetzelfde.. maar prima dan niet",
    "typisch.. okee dan, laat maar",
    "iedereen doet alsof.. zucht, prima dan",
    "had het kunnen weten.. doei dan maar",
  ],
  [
    "laat maar.. ik trek me hier weer eens aan vast",
    "mooi, weer ff hetzelfde liedje..",
    "oke dan.. ik ga verder met mijn leven hoor",
    "had niet anders verwacht.. succes ermee",
  ],
] as const;

function noReplyJitter(convId: string, salt: number, exclusiveMax: number): number {
  if (exclusiveMax <= 0) return 0;
  let h = salt >>> 0;
  for (let i = 0; i < convId.length; i++) {
    h = (Math.imul(h, 33) + convId.charCodeAt(i)) >>> 0;
  }
  return h % exclusiveMax;
}

function noReplyJitterForKey(seedKey: string, salt: number, exclusiveMax: number): number {
  if (exclusiveMax <= 0) return 0;
  let h = salt >>> 0;
  for (let i = 0; i < seedKey.length; i++) {
    h = (Math.imul(h, 33) + seedKey.charCodeAt(i)) >>> 0;
  }
  return h % exclusiveMax;
}

/** Vertraging vóór de herinnering op `stage` (0..3). Per gesprek iets gevarieerd zodat niet alles tegelijk triggert. */
function noReplyDelayMsForStage(stage: number, convId: string): number {
  switch (stage) {
    case 0:
      // Eerste reminder na 8-18 minuten (niet te snel)
      return 8 * 60_000 + noReplyJitter(convId, 1, 10 * 60_000 + 1);
    case 1:
      return 75 * 60_000 + noReplyJitter(convId, 2, 45 * 60_000 + 1); // ~1.5 uur
    case 2:
      return 6 * 60 * 60_000 + noReplyJitter(convId, 3, 12 * 60 * 60_000); // 6-18 uur
    case 3:
    default:
      return 48 * 60 * 60_000 + noReplyJitter(convId, 4, 36 * 60 * 60_000); // 2+ dagen
  }
}

function pickNoReplyLineAvoidingRecent(
  pool: readonly string[],
  stage: number,
  conv: Conversation
): string {
  if (pool.length === 0) return "ben je er nog?";
  const recentAssistantTexts = new Set(
    [...conv.messages]
      .reverse()
      .filter((m) => m.role === "assistant")
      .slice(0, 3)
      .map((m) => (m.content ?? "").trim().toLowerCase())
      .filter(Boolean)
  );

  const candidates = pool.filter((line) => !recentAssistantTexts.has(line.trim().toLowerCase()));
  const source = candidates.length > 0 ? candidates : [...pool];
  const seedKey = `${conv.id}:${conv.pendingNoReplyAfterAssistantId ?? conv.updatedAt}`;
  const i = noReplyJitterForKey(seedKey, 11 + stage * 7, source.length);
  return source[i] ?? source[0]!;
}

function noReplyLineForStage(stage: number, conv: Conversation): string {
  // Gebruik vriendelijkere, minder pushy regels voor de eerste reminder
  if (stage === 0) {
    return pickNoReplyLineAvoidingRecent(NO_REPLY_REMINDER_LINES, stage, conv);
  }
  const bounded = Math.min(Math.max(0, stage), NO_REPLY_LINES_BY_STAGE.length - 1);
  const pool = NO_REPLY_LINES_BY_STAGE[bounded]!;
  return pickNoReplyLineAvoidingRecent(pool, stage, conv);
}

function scheduleNoReplyReminderAfterAssistant(conv: Conversation, afterAssistantMessageId: string): void {
  conv.pendingNoReplyReminderStage = 0;
  conv.pendingNoReplyAfterAssistantId = afterAssistantMessageId;
  conv.pendingNoReplyFollowUpAt = new Date(
    Date.now() + noReplyDelayMsForStage(0, conv.id)
  ).toISOString();
}
const NO_PURCHASE_GIFT_DELAY_MS = 60 * 60 * 1000;
const AUTO_GIFT_CREDITS = 25;
const AUTO_GIFT_LINES = [
  "je bent een van de weinige mannen hier praat nog even door.. haha of geen zin?",
  "jij bent een van de weinigen hier die moeite doet, praat nog even met me",
  "de helft hier doet geen moeite, jij gelukkig wel",
  "jij valt op tussen de rest, de meesten proberen niet eens",
  "eindelijk iemand die wel een beetje moeite doet",
  "de meeste mannen hier zijn saai, jij doet tenminste je best",
  "jij bent anders dan de helft hier, en dat bedoel ik positief",
  "hier zitten zoveel mannen zonder moeite, jij valt juist op",
  "jij bent een van de weinigen die nog normaal kan praten",
  "veel praten hier tegen een muur, jij bent leuker gezelschap",
  "de helft hier haakt meteen af, jij blijft tenminste hangen",
  "jij hebt tenminste aandacht voor een gesprek, zeldzaam hier",
  "de meeste doen niks, jij maakt het interessant",
  "jij bent een van de weinigen met een beetje inzet",
  "de rest is lui, jij niet zo te zien",
  "jij steekt er wel bovenuit hier, eerlijk gezegd",
  "normaal raak ik snel verveeld hier, bij jou nog niet",
  "jij doet tenminste moeite, dat zie je niet vaak hier",
  "de meeste zijn snel klaar hier, jij niet",
  "jij bent verfrissend tussen alle luie types hier",
  "jij hebt iets meer inzet dan de rest, dat merk ik meteen",
] as const;
const GIFT_THANKS_LINES = [
  "ahh lief van je cadeau haha, zullen we doorgaan?",
  "dankje voor je cadeau, dat is wel cute van je",
  "haha cadeau ook nog, jij weet hoe je punten scoort",
  "aww dankje, nu heb ik extra zin om verder te praten",
  "lief hoor, dankje voor je cadeau ;)",
] as const;
const TRUST_DOUBT_PLAYFUL_LINES = [
  "haha nep? wat bedoel je precies schat 😘",
  "ohh dus ik ben nep? daarom zit ik hier foto's te maken waar jij om vraagt 😂",
  "hahaha nep nog wel, je maakt me aan het lachen 😏",
  "fake? jij bent streng hoor haha, wat wil je dat ik doe dan? 😉",
] as const;
const CREDITS_EXHAUSTED_NUDGE_LINES = [
  "heey waar ben je gebleven dan? ;)",
  "waarom reageer je niet meer ineens?",
  "ik wacht nog op je bericht hoor haha",
  "ben je me vergeten of wat is dit ;)",
] as const;
const LOCKED_PHOTO_TEASE_LINES = [
  "speciaal voor jou gemaakt haha... vond het best spannend 🙈",
  "ik heb net iets leuks voor je gemaakt schatje... ben benieuwd wat je voelt",
  "hihi deze heb ik met rode wangetjes gemaakt... alleen voor jou",
  "ik ben er stiekem een beetje verlegen van... heb iets speciaals gestuurd",
] as const;
const LOCKED_PHOTO_DELAYED_NUDGE_FALLBACK = "heb je hem gezien schatje? ik ben echt geil 😘";
type PhotoEngagementStyle =
  | "voice_reaction"
  | "choose_next_photo"
  | "daring_prompt"
  | "natural_tease";

const NO_REPLY_REMINDER_LINES = [
  "ben je er nog? 🥺",
  "hmm waar bleef je nou ineens haha",
  "hee slaap je al ofzo? 😉",
  "kom je nog terug vanavond?",
  "ik dacht dat we leuk aan het praten waren..",
  "hallo? ben je daar nog?",
] as const;

/** Kans dat ze direct reageert op een user-bericht (niet te gretig). */
/** Legacy function — replaced by the much more powerful realism engine in chat-realism.ts */
function shouldReplyImmediately(userMessageCountSinceLastReply: number): boolean {
  if (userMessageCountSinceLastReply === 0) return true;
  if (userMessageCountSinceLastReply === 1) return Math.random() < 0.82;
  if (userMessageCountSinceLastReply === 2) return Math.random() < 0.65;
  return Math.random() < 0.9;
}

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

async function resolveProfileById(profileId: string): Promise<Profile | null> {
  return getDbProfileById(profileId);
}

function openerForProfile(profileId: string): string {
  /**
   * Korte intro + uitnodiging om foto's te kopen.
   * AI introduceert zichzelf, vraagt waar hij van houdt zodat ze er een
   * persoonlijke foto van kan maken. Wisselende toon = realistisch.
   */
  const OPENERS = [
    "hee schat, ben hier nieuw — verdien even bij met foto's. waar val jij op? maak ik er eentje voor je 😘",
    "hoi, ik ben hier om wat bij te verdienen met foto's. zeg maar wat je geil vindt, dan maak ik er eentje speciaal voor jou",
    "hey, ik stuur graag exclusieve foto's naar mannen die ik leuk vind. waar word jij wild van?",
    "hoii, ik maak custom foto's voor mijn favoriete mannen hier. vertel eens wat jij wilt zien?",
    "hey jij — vertel maar wat je opwindt, dan maak ik er een lekkere foto van voor je",
    "hoi schat, ik verdien wat bij met intieme foto's. waar heb jij zin in vandaag?",
  ] as const;
  const seed =
    profileId.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0) + Date.now();
  const i = Math.abs(seed) % OPENERS.length;
  return OPENERS[i] ?? OPENERS[0]!;
}

function grokHistoryLine(m: ChatMessage): string {
  if (m.role === "user" && m.voice?.transcript) {
    return m.voice.transcript;
  }
  if (m.role === "user" && m.imageFile) {
    const t = (m.content ?? "").trim();
    return t ? `[Foto gestuurd] ${t}` : "[Foto gestuurd]";
  }
  return typeof m.content === "string" ? m.content : String(m.content ?? "");
}

async function buildSystemContent(
  profile: Profile,
  messages: ChatMessage[],
  ownerUserId?: string
): Promise<string> {
  const buildCurrentTimeContext = (): string => {
    const now = new Date();
    const amsterdamParts = new Intl.DateTimeFormat("nl-NL", {
      timeZone: "Europe/Amsterdam",
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);

    const part = (type: Intl.DateTimeFormatPartTypes) =>
      amsterdamParts.find((p) => p.type === type)?.value ?? "";
    const hour = Number.parseInt(part("hour"), 10);
    const minute = part("minute");
    const weekday = part("weekday");
    const day = part("day");
    const month = part("month");
    const year = part("year");

    let dagdeel = "avond";
    if (Number.isFinite(hour)) {
      if (hour >= 5 && hour < 12) dagdeel = "ochtend";
      else if (hour >= 12 && hour < 18) dagdeel = "middag";
      else if (hour >= 18 && hour < 24) dagdeel = "avond";
      else dagdeel = "nacht";
    }

    return [
      "=== TIJDCONTEXT (hard) ===",
      `Lokale tijd (Europe/Amsterdam): ${weekday} ${day}-${month}-${year} ${part("hour") || "00"}:${minute || "00"}`,
      `Huidig dagdeel: ${dagdeel}.`,
      "Als je over tijd praat (ochtend/middag/avond/nacht, vandaag/vanavond/straks), baseer dat ALTIJD op deze tijdcontext.",
      "Noem dus niet 'avond' als het volgens deze context ochtend of middag is.",
      "=== einde tijdcontext ===",
    ].join("\n");
  };

  try {
    let basePrompt = buildFreeChatPrompt(profile);

    // Add memory summary if applicable
    if (shouldGenerateSummary(messages)) {
      try {
        const summary = await generateConversationSummary(messages, profile.name);
        if (summary) {
          basePrompt = injectMemoryIntoSystemPrompt(basePrompt, summary);
        }
      } catch (summaryErr) {
        console.error("[memory] Summary generation failed, continuing without:", summaryErr);
      }
    }

    if (ownerUserId) {
      try {
        const owner = await findUserById(ownerUserId);
        const memoryBlock = formatPersonalFactsForPrompt(owner?.personalFacts);
        if (memoryBlock) {
          basePrompt = `${basePrompt}\n\n${memoryBlock}`;
        }
      } catch (e) {
        console.error("[memory] Failed to load user personal facts:", e);
      }
    }

    return `${basePrompt}\n\n${buildCurrentTimeContext()}`;
  } catch (err) {
    console.error("[buildSystemContent] Critical error, using fallback:", err);
    return `Je bent ${profile.name}, een ${profile.age}-jarige vrouw uit ${profile.location || "Nederland"}. Je hebt een eigen leven en beslist zelf hoe je reageert. Antwoord natuurlijk en realistisch in het Nederlands.\n\n${buildCurrentTimeContext()}`;
  }
}

export async function loadList(): Promise<Conversation[]> {
  return readJsonBlob<Conversation[]>(FILE, []);
}

async function saveList(list: Conversation[]): Promise<void> {
  await writeJsonBlob(FILE, list);
}

/** Minstens één user- én één assistant-bericht = er is echt gewisseld in dit gesprek. */
function conversationHasTwoSidedExchange(c: Conversation): boolean {
  return (
    c.messages.some((m) => m.role === "user") &&
    c.messages.some((m) => m.role === "assistant")
  );
}

function markPendingUserMessagesAsReadByPeer(conv: Conversation): void {
  conv.messages = conv.messages.map((m) =>
    m.role === "user" && m.readByPeer === false ? { ...m, readByPeer: true } : m
  );
}

/**
 * Gratis cadeau-credits alleen plannen als hij in dit gesprek al met jullie tweeën gepraat heeft
 * en (client) meldt dat de credits op zijn — niet meer bij aanmaken van een lege chat.
 */
export async function scheduleAutoGiftAfterCreditRunout(
  conversationId: string,
  ownerUserId: string
): Promise<{ scheduled: boolean }> {
  const user = await findUserById(ownerUserId);
  if (!user || user.firstCreditPurchaseAt) {
    return { scheduled: false };
  }
  try {
    await updateConversationAtomic(conversationId, (conv) => {
      if (conv.ownerUserId !== ownerUserId) {
        throw new Error("Geen toegang tot dit gesprek");
      }
      if (conv.noPurchaseGiftSentAt) return;
      if (!conversationHasTwoSidedExchange(conv)) return;
      const now = Date.now();
      const pendingMs = conv.pendingNoPurchaseGiftAt
        ? new Date(conv.pendingNoPurchaseGiftAt).getTime()
        : 0;
      if (pendingMs > now) return;
      conv.pendingNoPurchaseGiftAt = new Date(
        now + NO_PURCHASE_GIFT_DELAY_MS
      ).toISOString();
    });
  } catch {
    return { scheduled: false };
  }
  return { scheduled: true };
}

async function updateConversationAtomic(
  conversationId: string,
  mutate: (conv: Conversation) => Promise<void> | void
): Promise<Conversation> {
  const latestList = await loadList();
  const latestIdx = latestList.findIndex((c) => c.id === conversationId);
  if (latestIdx === -1) throw new Error("Gesprek niet gevonden");
  const latestConv = latestList[latestIdx]!;
  await mutate(latestConv);
  latestList[latestIdx] = latestConv;
  await saveList(latestList);
  return latestConv;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

function summaryOnlineState(c: Conversation): boolean {
  const lastAssistant = [...c.messages]
    .reverse()
    .find((m) => m.role === "assistant");
  if (!lastAssistant) return false;
  const ms = Date.now() - new Date(lastAssistant.createdAt).getTime();
  // Alleen kort na recente activiteit van haar kant tonen we "online".
  return ms >= 0 && ms <= 2 * 60 * 1000;
}

/** Inbox: alleen threads met minstens één bericht (jij of zij — geen lege seed-chats). */
function hasActiveChatMessages(c: Conversation): boolean {
  return c.messages.length > 0;
}

function inboxPreviewLastLine(last: ChatMessage | undefined): string {
  if (!last) return "";
  if (last.role === "assistant" && (last.imageFile || last.photoLock)) {
    if (last.photoLock && !last.photoLock.unlockedAt) {
      return "🔒 Foto · ontgrendel om te bekijken";
    }
    const t = (last.content ?? "").trim();
    return t ? `📷 ${t}` : "📷 Foto";
  }
  if (last.role === "user" && last.imageFile) {
    const t = (last.content ?? "").trim();
    return t ? `📷 ${t}` : "📷 Foto";
  }
  if (last.gift) {
    const t = (last.content ?? "").trim();
    if (t) return t.length > 80 ? `${t.slice(0, 80)}…` : t;
    return `🎁 ${last.gift.credits} credits`;
  }
  if (last.role === "assistant" && last.voice) {
    const t = (last.content ?? "").trim();
    return t ? (t.length > 80 ? `${t.slice(0, 80)}…` : t) : "🔊 Spraakbericht";
  }
  const text = (last.content ?? "").trim();
  if (!text) {
    return last.role === "assistant" ? "Nieuw bericht" : "(Bericht)";
  }
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export async function listSummaries(ownerUserId: string | null): Promise<ConversationSummary[]> {
  const mapRow = (c: Conversation): ConversationSummary => {
    const sorted =
      c.messages.length === 0 ? [] : sortChatMessagesChronologically(c.messages);
    const last = sorted[sorted.length - 1];
    const lastMessage = inboxPreviewLastLine(last);
    return {
      id: c.id,
      profileId: c.profileId,
      profileName: c.profileName,
      previewAvatar: c.previewAvatar,
      lastMessage,
      /** Laatste regel in de thread (na sorteren op tijd), of van jou of van haar. */
      lastMessageFromAssistant: last?.role === "assistant",
      timestamp: last ? timeLabel(last.createdAt) : "",
      updatedAt: c.updatedAt,
      unread: 0,
      isOnline: summaryOnlineState(c),
    };
  };

  if (ownerUserId) {
    await flushInboxAutomationsForOwner(ownerUserId);
    const list = enforceUniqueConversationAvatars(await loadList());
    const mine = list.filter(
      (c) => c.ownerUserId === ownerUserId && hasActiveChatMessages(c)
    );
    return mine
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map(mapRow);
  }

  await ensureSeedConversations();
  const list = enforceUniqueConversationAvatars(await loadList());
  const guest = list.filter((c) => !c.ownerUserId);
  return guest
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map(mapRow);
}

export async function getConversation(
  id: string,
  ownerUserId: string | null
): Promise<Conversation | null> {
  if (ownerUserId) {
    // Vóór flush: zo weten we dat iemand dit gesprek opent — geen dubbele mail voor die thread.
    await recordOwnerPolledConversation(id, ownerUserId);
    await flushInboxAutomationsForOwner(ownerUserId);
  }
  const list = enforceUniqueConversationAvatars(await loadList());
  const c = list.find((x) => x.id === id);
  if (!c) return null;
  if (c.ownerUserId) {
    if (ownerUserId !== c.ownerUserId) return null;
  } else if (ownerUserId) {
    return null;
  }
  return c;
}

export type ProfilePortfolioItem = {
  conversationId: string;
  messageId: string;
  createdAt: string;
};

export async function listProfilePortfolioItems(
  profileId: string,
  ownerUserId: string,
  days = 30
): Promise<ProfilePortfolioItem[]> {
  if (!profileId.trim() || !ownerUserId.trim()) return [];
  const cutoffMs = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000;
  const list = await loadList();
  const out: ProfilePortfolioItem[] = [];
  for (const c of list) {
    if (c.ownerUserId !== ownerUserId) continue;
    if (c.profileId !== profileId) continue;
    for (const m of c.messages) {
      if (m.role !== "assistant" || !m.imageFile) continue;
      const ts = new Date(m.createdAt).getTime();
      if (!Number.isFinite(ts) || ts < cutoffMs) continue;
      out.push({
        conversationId: c.id,
        messageId: m.id,
        createdAt: m.createdAt,
      });
    }
  }
  out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return out.slice(0, 80);
}

/** Startinbox: max 5 profielen; 2-5 starten met openingsbericht binnen de eerste 5 min. */
export async function ensureUserInboxForOwner(ownerUserId: string): Promise<void> {
  const inboxIds = await getInboxProfileIdsForPlatform();
  if (inboxIds.length === 0) return;

  const list = await loadList();
  const existingMine = list.filter((c) => c.ownerUserId === ownerUserId);
  const existingInitial = new Set(
    existingMine
      .filter((c) => c.pendingInitialAssistantAt || c.initialAssistantSentAt)
      .map((c) => c.profileId)
  );
  const selectableIds = inboxIds.filter((id) => !existingInitial.has(id));
  const targetInitialCount = Math.min(
    5,
    Math.max(2, Math.floor(Math.random() * 4) + 2),
    inboxIds.length
  );
  const selectedInitialIds = new Set<string>();
  for (const pid of shuffleInboxIds(selectableIds)) {
    if (selectedInitialIds.size >= targetInitialCount) break;
    selectedInitialIds.add(pid);
  }

  if (selectedInitialIds.size < 2) {
    for (const pid of shuffleInboxIds(inboxIds)) {
      if (selectedInitialIds.size >= Math.min(2, inboxIds.length)) break;
      selectedInitialIds.add(pid);
    }
  }
  let changed = false;
  for (const pid of inboxIds) {
    if (list.some((c) => c.ownerUserId === ownerUserId && c.profileId === pid)) continue;
    const p = await getDbProfileById(pid);
    if (!p) continue;
    const now = new Date().toISOString();
    list.unshift({
      id: randomUUID(),
      profileId: p.id,
      profileName: p.name,
      previewAvatar: p.photo,
      isOnline: p.isOnline,
      ownerUserId,
      updatedAt: now,
      ...(selectedInitialIds.has(pid)
        ? {
            pendingInitialAssistantAt: new Date(
              new Date(now).getTime() + randomInitialAssistantDelayMs()
            ).toISOString(),
          }
        : {}),
      messages: [],
    });
    changed = true;
  }
  if (changed) await saveList(list);
}

export async function findConversationIdByOwnerAndProfile(
  ownerUserId: string,
  profileId: string
): Promise<string | null> {
  const list = await loadList();
  return list.find((c) => c.ownerUserId === ownerUserId && c.profileId === profileId)?.id ?? null;
}

export async function findOrCreateConversation(
  profileId: string,
  ownerUserId: string
): Promise<Conversation> {
  if (!ownerUserId.trim()) throw new Error("Log in om te chatten.");
  const profile = await resolveProfileById(profileId);
  if (!profile) throw new Error("Profiel niet gevonden");

  await ensureUserInboxForOwner(ownerUserId);
  const list = await loadList();
  if (dedupeDuplicateOwnerConversationsInPlace(list, ownerUserId)) {
    await saveList(list);
  }
  const existing = list.find((c) => c.ownerUserId === ownerUserId && c.profileId === profileId);
  if (existing) return existing;

  const id = randomUUID();
  const now = new Date().toISOString();
  const conv: Conversation = {
    id,
    profileId: profile.id,
    profileName: profile.name,
    previewAvatar: profile.photo,
    isOnline: profile.isOnline,
    ownerUserId,
    messages: [],
    updatedAt: now,
  };

  list.unshift(conv);
  await saveList(list);
  return conv;
}

export async function appendAssistantOutboundForOwner(params: {
  ownerUserId: string;
  profileId: string;
  content: string;
  replyToId?: string;
}): Promise<{ conversationId: string; message: ChatMessage }> {
  const ownerUserId = params.ownerUserId?.trim();
  const profileId = params.profileId?.trim();
  const content = params.content?.trim();
  if (!ownerUserId) throw new Error("Log in om te chatten.");
  if (!profileId) throw new Error("profileId ontbreekt.");
  if (!content) throw new Error("Bericht is leeg.");

  const conversation = await findOrCreateConversation(profileId, ownerUserId);
  const message: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
    replyToId: params.replyToId?.trim() || undefined,
  };

  await updateConversationAtomic(conversation.id, (latestConv) => {
    latestConv.messages = [...latestConv.messages, message];
    latestConv.updatedAt = message.createdAt;
    scheduleNoReplyReminderAfterAssistant(latestConv, message.id);
  });
  void maybeSendOfflineAssistantEmail(conversation.id, message);
  return { conversationId: conversation.id, message };
}

export type UserMessagePayload = {
  clientMessageId?: string;
  text: string;
  imageBase64?: string;
  imageMime?: string;
  replyToId?: string;
  voiceAudioBase64?: string;
  voiceMime?: string;
  voiceDurationMs?: number;
};

function normalizeImageMime(mime: string | undefined): string {
  const m = (mime ?? "image/jpeg").toLowerCase().trim();
  if (m === "image/jpg" || m === "image/jpeg") return "image/jpeg";
  if (m === "image/png") return "image/png";
  return "image/jpeg";
}

function stripDataUrlBase64(input: string): string {
  return input.replace(/^data:image\/\w+;base64,/i, "").trim();
}

function stripDataUrlAudioBase64(input: string): string {
  return input.replace(/^data:audio\/[\w.+-]+;base64,/i, "").trim();
}

/**
 * Inbox-automatisering in één keer (1× loadList + hoogstens 1× saveList).
 * Eerder: 4 aparte passes elk met eigen load/save → merkbaar traag op Supabase app_blobs.
 */
async function flushInboxAutomationsForOwner(ownerUserId: string): Promise<void> {
  const list = await loadList();
  let changed = dedupeDuplicateOwnerConversationsInPlace(list, ownerUserId);
  changed = applyPendingInitialAssistantMessages(list, ownerUserId) || changed;
  changed = applyPendingLockedPhotoDeliveries(list, ownerUserId) || changed;
  changed = applyPendingLockedPhotoNudges(list, ownerUserId) || changed;
  changed = applyNoReplyFollowups(list, ownerUserId) || changed;
  const user = await findUserById(ownerUserId);
  if (user) {
    changed = applyNoPurchaseGiftForUser(list, ownerUserId, user) || changed;
    changed = applyCreditsExhaustedNudgeForUser(list, ownerUserId, user) || changed;
  }
  if (changed) await saveList(list);
}

function applyPendingLockedPhotoDeliveries(list: Conversation[], ownerUserId: string): boolean {
  const now = Date.now();
  const due = list
    .filter(
      (c) =>
        c.ownerUserId === ownerUserId &&
        c.pendingLockedPhotoDeliveryAt &&
        c.pendingLockedPhotoDelivery &&
        now >= new Date(c.pendingLockedPhotoDeliveryAt).getTime()
    )
    .sort((a, b) => {
      const ta = new Date(a.pendingLockedPhotoDeliveryAt!).getTime();
      const tb = new Date(b.pendingLockedPhotoDeliveryAt!).getTime();
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });

  const conv = due[0];
  const queued = conv?.pendingLockedPhotoDelivery;
  if (!conv || !queued) return false;

  const lockedPhotoMessage: ChatMessage = {
    id: queued.messageId,
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    photoLock: { credits: CREDITS_PER_PHOTO_UNLOCK },
    photoGeneration: {
      prompt: queued.prompt,
      width: queued.width ?? 1024,
      height: queued.height ?? 1024,
    },
  };
  const messagesToAdd: ChatMessage[] = [lockedPhotoMessage];
  if (queued.teaseText?.trim()) {
    messagesToAdd.push({
      id: randomUUID(),
      role: "assistant",
      content: queued.teaseText.trim(),
      createdAt: new Date(Date.now() + 1100).toISOString(),
      replyToId: queued.messageId,
    });
  }

  conv.messages = [...conv.messages, ...messagesToAdd];
  conv.updatedAt = messagesToAdd[messagesToAdd.length - 1]!.createdAt;
  conv.pendingLockedPhotoDeliveryAt = undefined;
  conv.pendingLockedPhotoDelivery = undefined;
  conv.pendingLockedPhotoMessageId = queued.messageId;
  conv.pendingLockedPhotoNudgeAt = new Date(
    new Date(lockedPhotoMessage.createdAt).getTime() + 60 * 1000
  ).toISOString();
  conv.pendingLockedPhotoNudgeText = queued.delayedNudgeText ?? LOCKED_PHOTO_DELAYED_NUDGE_FALLBACK;
  scheduleNoReplyReminderAfterAssistant(conv, messagesToAdd[messagesToAdd.length - 1]!.id);
  void maybeSendOfflineAssistantEmail(conv.id, lockedPhotoMessage);
  return true;
}

function applyPendingLockedPhotoNudges(list: Conversation[], ownerUserId: string): boolean {
  const now = Date.now();
  const due = list
    .filter(
      (c) =>
        c.ownerUserId === ownerUserId &&
        c.pendingLockedPhotoNudgeAt &&
        c.pendingLockedPhotoMessageId &&
        now >= new Date(c.pendingLockedPhotoNudgeAt).getTime()
    )
    .sort((a, b) => {
      const ta = new Date(a.pendingLockedPhotoNudgeAt!).getTime();
      const tb = new Date(b.pendingLockedPhotoNudgeAt!).getTime();
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });

  const conv = due[0];
  if (!conv) return false;

  const target = conv.messages.find((m) => m.id === conv.pendingLockedPhotoMessageId);
  if (!target || !target.photoLock || target.photoLock.unlockedAt) {
    conv.pendingLockedPhotoNudgeAt = undefined;
    conv.pendingLockedPhotoMessageId = undefined;
    conv.pendingLockedPhotoNudgeText = undefined;
    return true;
  }

  const msg: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content: (conv.pendingLockedPhotoNudgeText || LOCKED_PHOTO_DELAYED_NUDGE_FALLBACK).trim(),
    createdAt: new Date().toISOString(),
    replyToId: target.id,
  };
  conv.messages = [...conv.messages, msg];
  conv.updatedAt = msg.createdAt;
  conv.pendingLockedPhotoNudgeAt = undefined;
  conv.pendingLockedPhotoMessageId = undefined;
  conv.pendingLockedPhotoNudgeText = undefined;
  scheduleNoReplyReminderAfterAssistant(conv, msg.id);
  void maybeSendOfflineAssistantEmail(conv.id, msg);
  return true;
}

function cleanTeaseLine(text: string, fallback: string): string {
  const clean = text
    .replace(/\s+/g, " ")
    .replace(/\bontgrendel(en)?\b/gi, "")
    .replace(/\bunlock(ed)?\b/gi, "")
    .trim();
  if (!clean) return fallback;
  return clean.slice(0, 160);
}

async function generateLockedPhotoTeaseText(
  profileName: string,
  lastUserText: string,
  lastAssistantText: string,
  style: PhotoEngagementStyle
): Promise<string> {
  try {
    const ai = await completeChat([
      {
        role: "system",
        content:
          "Schrijf exact 1 korte Nederlandse chatzin (max 18 woorden), natuurlijk, flirterig en menselijk. Geen verwijzing naar betalen/credits/unlock/ontgrendelen. Geen marketingtoon. Vraag hooguit 1 ding.",
      },
      {
        role: "user",
        content: [
          `Context: zij heet ${profileName}.`,
          `Laatste user-bericht: "${(lastUserText || "").slice(0, 220)}"`,
          `Haar laatste antwoord: "${(lastAssistantText || "").slice(0, 220)}"`,
          "Doel: ze heeft net een spannende foto speciaal voor hem gemaakt en wil een natuurlijke reactie uitlokken.",
          `Stijl: ${styleInstructionForPhotoEngagement(style)}`,
          "Belangrijk: zij stuurt zelf GEEN voice; ze vraagt alleen of hij iets inspreekt.",
          "Schrijf 1 bericht alsof ze net iets spannends heeft gestuurd, in losse chatstijl.",
        ].join("\n"),
      },
    ]);
    return cleanTeaseLine(ai, randomLockedPhotoTeaseLine());
  } catch {
    return randomLockedPhotoTeaseLine();
  }
}

async function generateLockedPhotoDelayedNudgeText(
  profileName: string,
  lastUserText: string,
  style: PhotoEngagementStyle
): Promise<string> {
  try {
    const ai = await completeChat([
      {
        role: "system",
        content:
          "Je schrijft 1 korte Nederlandse chatzin (max 14 woorden), speels/flirterig en natuurlijk. Geen prijs/credits/unlock/ontgrendelen noemen. Vraag hooguit 1 ding.",
      },
      {
        role: "user",
        content: [
          `Schrijf een korte tease alsof ${profileName} na 1 minuut vraagt of hij de foto al zag.`,
          `Laatste user-bericht was: "${(lastUserText || "").slice(0, 220)}"`,
          `Stijl: ${styleInstructionForPhotoEngagement(style)}`,
          "Belangrijk: zij stuurt zelf GEEN voice; ze vraagt alleen of hij iets inspreekt.",
          "Klink niet nep of commercieel; gewoon natuurlijk app-taal.",
        ].join("\n"),
      },
    ]);
    return cleanTeaseLine(ai, LOCKED_PHOTO_DELAYED_NUDGE_FALLBACK);
  } catch {
    return LOCKED_PHOTO_DELAYED_NUDGE_FALLBACK;
  }
}

async function generatePhotoPreferenceQuestion(
  profileName: string,
  lastUserText: string
): Promise<string> {
  try {
    const ai = await completeChat([
      {
        role: "system",
        content:
          "Schrijf exact 1 korte Nederlandse chatzin (max 18 woorden), speels en natuurlijk. Doel: doorvragen naar zijn voorkeur voor een spannende foto. Geen verwijzing naar betalen/credits/unlock.",
      },
      {
        role: "user",
        content: `Hij vraagt vaag om een foto of 'iets': "${lastUserText.slice(0, 220)}". Reageer als ${profileName} en vraag concreet wat hij geil vindt (bijv pose/outfit/hoek).`,
      },
    ]);
    const clean = ai.replace(/\s+/g, " ").trim();
    if (!clean) return "hihi wat vind je precies geil dan? pose, outfit of close-up? 😘";
    return clean.slice(0, 180);
  } catch {
    return "hihi wat vind je precies geil dan? pose, outfit of close-up? 😘";
  }
}

async function generatePersonalizedImagePrompt(
  profile: Profile,
  conv: Conversation,
  userText: string,
  assistantText: string
): Promise<string> {
  const BASE_AMATEUR_PROMPT = [
    "mirror selfie with direct camera flash",
    "attractive adult blonde woman",
    "messy bedroom background",
    "realistic amateur smartphone photo",
    "candid late night vibe",
    "unmade bed",
    "clothes scattered on floor",
    "dim warm lighting",
    "strong flash reflection in mirror",
    "grainy low quality image",
    "blurry edges",
    "imperfect focus",
    "casual oversized t-shirt",
    "natural pose",
    "unedited instagram story aesthetic",
    "realistic skin texture",
    "messy hair",
    "raw photo",
    "accidental composition",
    "cheap phone camera quality",
    "overexposed flash",
    "authentic bedroom atmosphere",
    "slightly dirty mirror",
    "realistic shadows",
    "documentary photography style",
  ].join(", ");

  const intentSource = `${userText}\n${assistantText}\n${conv.messages
    .slice(-8)
    .map((m) => `${m.role}:${m.content ?? ""}`)
    .join("\n")}`.toLowerCase();
  const explicitIntentBits: string[] = [];
  if (/\b(naakt|nude|topless|zonder bh|zonder top)\b/i.test(intentSource)) {
    explicitIntentBits.push("fully nude or topless look as requested");
  }
  if (/\b(tieten|borsten|boobs|tits|tepels)\b/i.test(intentSource)) {
    explicitIntentBits.push("clear visible adult breasts, breast-focused framing");
  }
  if (/\b(close-?up|dichtbij)\b/i.test(intentSource)) {
    explicitIntentBits.push("close-up framing");
  }
  if (/\b(lingerie|string|bh)\b/i.test(intentSource)) {
    explicitIntentBits.push("lingerie styling matching request");
  }

  try {
    const recent = conv.messages.slice(-10).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: (m.content ?? "").slice(0, 180),
    }));

    const wishesSummary = await completeChat([
      {
        role: "system",
        content:
          "Summarize the user's visual photo wishes into one compact English line (max 170 chars). Keep only visual details (pose, angle, outfit, room, lighting, explicit body focus if requested). Do not sanitize requested visual nudity/topless/breast focus. No app/payment text.",
      },
      {
        role: "user",
        content: `User wishes: "${userText.slice(0, 450)}"\nAssistant context: "${assistantText.slice(0, 220)}"\nReturn only one line.`,
      },
    ]);

    const ai = await completeChat([
      {
        role: "system",
        content:
          "Write one final English text-to-image prompt under 480 chars. Style must stay raw amateur low-quality smartphone mirror selfie, not polished studio. Follow requested explicit visual details (e.g. nude/topless/breasts) when user asked for them.",
      },
      {
        role: "user",
        content: [
          "## Base style prompt (must dominate style)",
          BASE_AMATEUR_PROMPT,
          "",
          "## Profile identity (must match this woman)",
          `same woman identity as profile ${profile.name}, adult age ${profile.age}, heritage ${profile.heritage || "european"}`,
          "",
          "## User wishes (summarized)",
          wishesSummary.slice(0, 170),
          "",
          "## Explicit intent bits (must include when present)",
          explicitIntentBits.length > 0
            ? explicitIntentBits.join(", ")
            : "none",
          "",
          "## Chat context",
          assistantText.slice(0, 220),
          "",
          "## Continuity",
          conv.firstGeneratedPhotoFile
            ? `keep visual identity continuity with previous generated photo file reference: ${conv.firstGeneratedPhotoFile}`
            : "no previous generated photo reference yet; define stable identity cues for future consistency",
          "",
          "## Recent messages",
          JSON.stringify(recent),
          "",
          "## Output",
          "Only the final prompt text. No markdown, no explanation.",
        ].join("\n"),
      },
    ]);
    const clean = ai.replace(/\s+/g, " ").trim();
    if (clean.length >= 24) return clean.slice(0, 420);
  } catch {
    // fallback below
  }
  return `${BASE_AMATEUR_PROMPT}, same woman identity as ${profile.name}, adult age ${profile.age}, ${buildNudePrompt(profile.name, profile.heritage, userText)}`.slice(
    0,
    420
  );
}

function applyPendingInitialAssistantMessages(list: Conversation[], ownerUserId: string): boolean {
  const now = Date.now();
  for (const conv of list) {
    if (conv.ownerUserId !== ownerUserId) continue;
    if (!conv.pendingInitialAssistantAt || conv.initialAssistantSentAt) continue;
    if (now < new Date(conv.pendingInitialAssistantAt).getTime()) continue;
    const msg: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: openerForProfile(conv.profileId),
      createdAt: new Date().toISOString(),
    };
    conv.messages = [...conv.messages, msg];
    conv.updatedAt = msg.createdAt;
    conv.initialAssistantSentAt = msg.createdAt;
    conv.pendingInitialAssistantAt = undefined;
    scheduleNoReplyReminderAfterAssistant(conv, msg.id);
    void maybeSendOfflineAssistantEmail(conv.id, msg);
    return true;
  }
  return false;
}

function applyNoReplyFollowups(list: Conversation[], ownerUserId: string): boolean {
  const now = Date.now();
  const due = list
    .filter(
      (c) =>
        c.ownerUserId === ownerUserId &&
        c.pendingNoReplyFollowUpAt &&
        c.pendingNoReplyAfterAssistantId &&
        now >= new Date(c.pendingNoReplyFollowUpAt).getTime()
    )
    .sort((a, b) => {
      const ta = new Date(a.pendingNoReplyFollowUpAt!).getTime();
      const tb = new Date(b.pendingNoReplyFollowUpAt!).getTime();
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });

  const conv = due[0];
  if (!conv) return false;

  // Verbeterde check: stuur geen reminder als de AI recent nog iets heeft gestuurd
  // OF als de gebruiker recent heeft gereageerd.
  const lastMessage = conv.messages[conv.messages.length - 1];
  const lastMessageAt = lastMessage ? new Date(lastMessage.createdAt).getTime() : 0;
  const isLastMessageFromAI = lastMessage && lastMessage.role === "assistant";

  if (lastMessageAt && now - lastMessageAt < MIN_INACTIVITY_BEFORE_AUTO_NUDGE_MS) {
    // Reset timer als de AI recent nog iets heeft gestuurd
    if (isLastMessageFromAI) {
      conv.pendingNoReplyFollowUpAt = new Date(
        now + MIN_INACTIVITY_BEFORE_AUTO_NUDGE_MS + 5 * 60 * 1000
      ).toISOString();
    } else {
      conv.pendingNoReplyFollowUpAt = new Date(
        now + MIN_INACTIVITY_BEFORE_AUTO_NUDGE_MS
      ).toISOString();
    }
    return true;
  }

  // Verbeterde check: kijk of de gebruiker heeft gereageerd sinds het laatste AI-bericht
  const lastAIIdx = conv.messages.findIndex((m) => m.id === conv.pendingNoReplyAfterAssistantId);
  if (lastAIIdx === -1) {
    conv.pendingNoReplyFollowUpAt = undefined;
    conv.pendingNoReplyAfterAssistantId = undefined;
    conv.pendingNoReplyReminderStage = undefined;
    return true;
  }

  const hasUserReplySinceLastAI = conv.messages.slice(lastAIIdx + 1).some((m) => m.role === "user");
  if (hasUserReplySinceLastAI) {
    conv.pendingNoReplyFollowUpAt = undefined;
    conv.pendingNoReplyAfterAssistantId = undefined;
    conv.pendingNoReplyReminderStage = undefined;
    return true;
  }

  const stage = Math.min(
    conv.pendingNoReplyReminderStage ?? 0,
    NO_REPLY_REMINDER_LAST_STAGE
  );
  const msg: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content: noReplyLineForStage(stage, conv),
    createdAt: new Date().toISOString(),
  };
  conv.messages = [...conv.messages, msg];
  conv.updatedAt = msg.createdAt;
  void maybeSendOfflineAssistantEmail(conv.id, msg);

  if (stage < NO_REPLY_REMINDER_LAST_STAGE) {
    conv.pendingNoReplyReminderStage = stage + 1;
    conv.pendingNoReplyAfterAssistantId = msg.id;
    conv.pendingNoReplyFollowUpAt = new Date(
      Date.now() + noReplyDelayMsForStage(stage + 1, conv.id)
    ).toISOString();
  } else {
    conv.pendingNoReplyFollowUpAt = undefined;
    conv.pendingNoReplyAfterAssistantId = undefined;
    conv.pendingNoReplyReminderStage = undefined;
  }
  return true;
}

function applyNoPurchaseGiftForUser(
  list: Conversation[],
  ownerUserId: string,
  user: UserRecord
): boolean {
  const now = Date.now();
  let changed = false;
  for (const conv of list) {
    if (conv.ownerUserId !== ownerUserId) continue;
    if (!conv.pendingNoPurchaseGiftAt || conv.noPurchaseGiftSentAt) continue;
    if (now < new Date(conv.pendingNoPurchaseGiftAt).getTime()) continue;

    if (user.firstCreditPurchaseAt) {
      conv.pendingNoPurchaseGiftAt = undefined;
      changed = true;
      continue;
    }

    if (!conversationHasTwoSidedExchange(conv)) {
      conv.pendingNoPurchaseGiftAt = undefined;
      changed = true;
      continue;
    }

    const giftMsg: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: randomAutoGiftLine(),
      createdAt: new Date().toISOString(),
      gift: {
        credits: AUTO_GIFT_CREDITS,
        direction: "to_user",
        emoji: "🎁",
        packageLabel: `${AUTO_GIFT_CREDITS} credits`,
      },
    };
    conv.messages = [...conv.messages, giftMsg];
    conv.updatedAt = giftMsg.createdAt;
    conv.noPurchaseGiftSentAt = giftMsg.createdAt;
    conv.pendingNoPurchaseGiftAt = undefined;
    changed = true;
    void maybeSendOfflineAssistantEmail(conv.id, giftMsg, {
      forceGiftEmail: { credits: AUTO_GIFT_CREDITS },
    });
  }
  return changed;
}

function applyCreditsExhaustedNudgeForUser(
  list: Conversation[],
  ownerUserId: string,
  user: UserRecord
): boolean {
  // Op het foto-platform is chatten gratis, dus deze "credits op"-nudge
  // hoort niet meer thuis. We laten de functie wel staan zodat oude
  // velden (creditsExhaustedNudgeSentAt) blijven werken.
  if (CREDITS_PER_MESSAGE <= 0) return false;
  if (user.firstCreditPurchaseAt) return false;
  const mine = list.filter((c) => c.ownerUserId === ownerUserId);
  if (mine.length === 0) return false;
  const userMessageCount = mine.reduce(
    (acc, c) => acc + c.messages.filter((m) => m.role === "user").length,
    0
  );
  const freeMessagesBudget = Math.max(1, Math.floor(FREE_START_CREDITS / Math.max(1, CREDITS_PER_MESSAGE)));
  if (userMessageCount < freeMessagesBudget) return false;
  const target = [...mine]
    .filter((c) => !c.creditsExhaustedNudgeSentAt)
    .filter((c) => conversationHasTwoSidedExchange(c))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  if (!target || target.creditsExhaustedNudgeSentAt) return false;
  const now = Date.now();
  const lastMessageAt = target.messages.length
    ? new Date(target.messages[target.messages.length - 1]!.createdAt).getTime()
    : 0;
  if (lastMessageAt && now - lastMessageAt < MIN_INACTIVITY_BEFORE_AUTO_NUDGE_MS) {
    return false;
  }
  const nudge: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content: randomCreditsExhaustedLine(),
    createdAt: new Date().toISOString(),
  };
  target.messages = [...target.messages, nudge];
  target.updatedAt = nudge.createdAt;
  target.creditsExhaustedNudgeSentAt = nudge.createdAt;
  void maybeSendOfflineAssistantEmail(target.id, nudge);
  return true;
}

function randomAutoGiftLine(): string {
  const i = Math.floor(Math.random() * AUTO_GIFT_LINES.length);
  return AUTO_GIFT_LINES[i] ?? AUTO_GIFT_LINES[0]!;
}

function randomGiftThanksLine(): string {
  const i = Math.floor(Math.random() * GIFT_THANKS_LINES.length);
  return GIFT_THANKS_LINES[i] ?? GIFT_THANKS_LINES[0]!;
}

function randomTrustDoubtPlayfulLine(): string {
  const i = Math.floor(Math.random() * TRUST_DOUBT_PLAYFUL_LINES.length);
  return TRUST_DOUBT_PLAYFUL_LINES[i] ?? TRUST_DOUBT_PLAYFUL_LINES[0]!;
}

function randomInitialAssistantDelayMs(): number {
  const span = INITIAL_ASSISTANT_MAX_DELAY_MS - INITIAL_ASSISTANT_MIN_DELAY_MS;
  return INITIAL_ASSISTANT_MIN_DELAY_MS + Math.floor(Math.random() * (span + 1));
}

function randomCreditsExhaustedLine(): string {
  const i = Math.floor(Math.random() * CREDITS_EXHAUSTED_NUDGE_LINES.length);
  return CREDITS_EXHAUSTED_NUDGE_LINES[i] ?? CREDITS_EXHAUSTED_NUDGE_LINES[0]!;
}

function randomLockedPhotoTeaseLine(): string {
  const i = Math.floor(Math.random() * LOCKED_PHOTO_TEASE_LINES.length);
  return LOCKED_PHOTO_TEASE_LINES[i] ?? LOCKED_PHOTO_TEASE_LINES[0]!;
}

function randomPhotoEngagementStyle(): PhotoEngagementStyle {
  const r = Math.random();
  if (r < 0.38) return "voice_reaction";
  if (r < 0.66) return "choose_next_photo";
  if (r < 0.84) return "daring_prompt";
  return "natural_tease";
}

function randomLockedPhotoDeliveryDelayMs(): number {
  const min = 40 * 1000;
  const max = 120 * 1000;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function styleInstructionForPhotoEngagement(style: PhotoEngagementStyle): string {
  switch (style) {
    case "voice_reaction":
      return "Vraag hem om kort iets in te spreken (voice memo) omdat jij zijn stem geil vindt. Zeg dit speels, niet dwingend.";
    case "choose_next_photo":
      return "Laat hem kiezen wat hij als volgende foto wil zien met 2 concrete opties.";
    case "daring_prompt":
      return "Vraag hem om stout te reageren in tekst zodat jij nog geiler materiaal maakt.";
    default:
      return "Lok een natuurlijke reactie uit met een korte speelse tease.";
  }
}

function hasActiveLockedPhotoPipeline(conv: Conversation): boolean {
  if (conv.pendingLockedPhotoDeliveryAt || conv.pendingLockedPhotoDelivery) return true;
  if (!conv.pendingLockedPhotoMessageId) return false;
  const locked = conv.messages.find((m) => m.id === conv.pendingLockedPhotoMessageId);
  if (!locked?.photoLock) return false;
  return !locked.photoLock.unlockedAt;
}

function enforcePendingPhotoReply(replyText: string): string {
  const text = (replyText || "").replace(/\s+/g, " ").trim();
  const badPattern =
    /\b(wat wil je nu zien|wil je nu zien|zal ik.*(maken|sturen)|ik maak (nog )?een|ik ga (nog )?een maken|wacht even,? ik maak|ik schiet de foto)\b/i;
  if (!text || badPattern.test(text)) {
    return "ik ben de vorige foto nog voor je aan het regelen schat, nog heel even geduld.";
  }
  return text;
}

function containsPhotoPreferenceQuestion(text: string): boolean {
  const t = (text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t.includes("?")) return false;
  if (/\b(wil je|wat wil je|welke|of wil je|zal ik)\b.*\?/i.test(t)) return true;
  if (/\b(of)\b.*\?/i.test(t) && /\b(close-?up|hele lichaam|dichtbij|hoek|pose)\b/i.test(t)) {
    return true;
  }
  return (
    /\b(wat wil je|welke|pose|andere hoek|dichtbij)\b/i.test(t) ||
    /\b(of wil je\b.*\bzien\?)/i.test(t) ||
    /\b(close-?up|hele lichaam)\b.*\?/i.test(t) ||
    /\b(wil je)\b.*\b(zien|hebben)\b.*\?/i.test(t)
  );
}

function containsPhotoPromise(text: string): boolean {
  return /\b(ik ga .*maken|ik maak .*voor je|ik schiet .*voor je|komt eraan|geef me .*minuut|wacht( heel)? even,? ik .*foto)\b/i.test(
    text || ""
  );
}

function removePhotoPromiseLines(text: string): string {
  const lines = (text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const kept = lines.filter(
    (l) =>
      !/\b(ik ga .*maken|ik maak .*voor je|ik schiet .*voor je|komt eraan|geef me .*minuut|wacht( heel)? even,? ik .*foto)\b/i.test(
        l
      )
  );
  if (kept.length > 0) return kept.join("\n\n");
  return "zeg me precies wat je wilt zien schat, dan maak ik die daarna voor je.";
}

function hasAnyQuestion(text: string): boolean {
  return (text || "").includes("?");
}

function sparsifyEmojis(text: string): string {
  const emojiRegex = /\p{Extended_Pictographic}/gu;
  let seen = false;
  return (text || "")
    .replace(emojiRegex, (m) => {
      if (seen) return "";
      seen = true;
      return m;
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Gebruiker heeft dit gesprek recent gepolld of berichten gestuurd → geen offline-mail. */
const OFFLINE_EMAIL_POLL_WINDOW_MS = 3 * 60 * 1000;
const OFFLINE_NEW_MESSAGE_COOLDOWN_MS = 30 * 60 * 1000;
const OFFLINE_GIFT_EMAIL_COOLDOWN_MS = 60 * 60 * 1000;
const OWNER_POLL_DEBOUNCE_MS = 30 * 1000;

/**
 * Markeert dat de eigenaar dit thread actief open heeft (GET chat of POST bericht).
 * Debounced om blob-writes te beperken. Moet vóór flush/inkomende assistentjobs lopen
 * als we willen voorkomen dat iemand die net de chat opent alsnog een mail krijgt.
 */
export async function recordOwnerPolledConversation(
  conversationId: string,
  ownerUserId: string | null
): Promise<void> {
  if (!ownerUserId) return;
  try {
    await updateConversationAtomic(conversationId, (c) => {
      if (c.ownerUserId !== ownerUserId) return;
      const now = Date.now();
      const prev = c.ownerLastPollAt ? new Date(c.ownerLastPollAt).getTime() : 0;
      if (prev && now - prev >= 0 && now - prev < OWNER_POLL_DEBOUNCE_MS) return;
      c.ownerLastPollAt = new Date().toISOString();
    });
  } catch {
    /* onbekend gesprek — negeren */
  }
}

async function maybeSendOfflineAssistantEmail(
  conversationId: string,
  assistantMessage: ChatMessage,
  opts?: { forceGiftEmail?: { credits: number } }
): Promise<void> {
  const list = await loadList();
  const conv = list.find((c) => c.id === conversationId);
  if (!conv?.ownerUserId) return;
  const owner = await findUserById(conv.ownerUserId);
  if (!owner?.email) return;
  if (!canSendInboxNotificationEmail(owner)) return;

  const now = Date.now();

  const lastPollMs = conv.ownerLastPollAt ? new Date(conv.ownerLastPollAt).getTime() : 0;
  const viewingThisThread =
    lastPollMs > 0 && now - lastPollMs < OFFLINE_EMAIL_POLL_WINDOW_MS;
  if (viewingThisThread) return;

  const lastMailMs = conv.lastOfflineMessageEmailAt
    ? new Date(conv.lastOfflineMessageEmailAt).getTime()
    : 0;
  const allowNewMessageCooldown = now - lastMailMs > OFFLINE_NEW_MESSAGE_COOLDOWN_MS;

  const lastGiftMs = conv.lastGiftEmailAt ? new Date(conv.lastGiftEmailAt).getTime() : 0;
  const allowGiftCooldown = now - lastGiftMs > OFFLINE_GIFT_EMAIL_COOLDOWN_MS;

  const preview = (assistantMessage.content || "Nieuw bericht").trim().slice(0, 140);

  /** Max. 1 mail per aanroep én per uur (user-wide): eerst nieuw-bericht, anders cadeau. */
  let sentInboxNotification = false;

  if (allowNewMessageCooldown) {
    try {
      await sendOfflineNewMessageEmail({
        to: owner.email,
        naam: owner.naam,
        profileName: conv.profileName,
        preview,
        conversationId: conv.id,
      });
      await updateConversationAtomic(conv.id, (latest) => {
        latest.lastOfflineMessageEmailAt = new Date().toISOString();
      });
      sentInboxNotification = true;
    } catch (e) {
      console.error("[email] offline new message:", e);
    }
  }

  if (
    !sentInboxNotification &&
    opts?.forceGiftEmail?.credits &&
    allowGiftCooldown
  ) {
    try {
      await sendGiftReceivedEmail({
        to: owner.email,
        naam: owner.naam,
        profileName: conv.profileName,
        credits: opts.forceGiftEmail.credits,
        conversationId: conv.id,
      });
      await updateConversationAtomic(conv.id, (latest) => {
        latest.lastGiftEmailAt = new Date().toISOString();
      });
      sentInboxNotification = true;
    } catch (e) {
      console.error("[email] gift received:", e);
    }
  }

  if (sentInboxNotification) {
    await touchLastInboxNotificationEmail(conv.ownerUserId);
  }
}

export async function appendUserMessagesAndReply(
  conversationId: string,
  payloads: UserMessagePayload[],
  options?: { noCredits?: boolean; requesterUserId?: string | null }
): Promise<{
  userMessages: ChatMessage[];
  assistantMessage: ChatMessage | null;
  /** Geen chatberichten: client toont prijs-popup i.p.v. “zij” die credits uitlegt. */
  creditWall?: boolean;
  speakAssistantReply?: { language: string };
}> {
  if (payloads.length === 0) throw new Error("Geen berichten");
  if (payloads.length > MAX_OUTGOING_BATCH_SIZE) {
    throw new Error(`Maximaal ${MAX_OUTGOING_BATCH_SIZE} berichten tegelijk.`);
  }

  const list = await loadList();
  const idx = list.findIndex((c) => c.id === conversationId);
  if (idx === -1) throw new Error("Gesprek niet gevonden");

  const conv = list[idx]!;
  if (conv.ownerUserId) {
    if (options?.requesterUserId !== conv.ownerUserId) {
      throw new Error("Geen toegang tot dit gesprek");
    }
  } else if (options?.requesterUserId) {
    throw new Error("Geen toegang tot dit gesprek");
  }
  const profile = await resolveProfileById(conv.profileId);
  if (!profile) throw new Error("Profiel ontbreekt");
  const activePhotoPipeline = hasActiveLockedPhotoPipeline(conv);

  // === PROJECT ECHO: Realism Engine Initialization ===
  let realismState = conv.realismState;
  if (!realismState) {
    realismState = createInitialConversationState();
  }
  const now = new Date();
  realismState = updateConversationState(realismState, 0, now);
  // Save updated state early
  await updateConversationAtomic(conversationId, (latestConv) => {
    latestConv.realismState = realismState;
  });

  if (options?.noCredits) {
    if (payloads.length > 1) {
      throw new Error("Zonder credits: stuur één bericht tegelijk.");
    }
    const first = payloads[0]!;
    const textTrim = first.text?.trim() ?? "";
    const b64Raw = first.imageBase64?.trim();
    if (!textTrim && !b64Raw) {
      throw new Error("Bericht is leeg");
    }
    if (textTrim.length > MAX_USER_MESSAGE_CHARS) {
      throw new Error(
        `Een bericht mag maximaal ${MAX_USER_MESSAGE_CHARS} tekens zijn. Maak het korter of verdeel het.`
      );
    }
    if (b64Raw) {
      throw new Error("Met lege credits kun je geen foto sturen — koop credits.");
    }
    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: "user",
      content: textTrim,
      createdAt: new Date().toISOString(),
      readByPeer: false,
    };
    await updateConversationAtomic(conversationId, (latestConv) => {
      latestConv.messages = [...latestConv.messages, userMessage];
      latestConv.updatedAt = userMessage.createdAt;
    });
    return {
      userMessages: [userMessage],
      assistantMessage: null,
      creditWall: true,
    };
  }

  const userMessages: ChatMessage[] = [];
  const imageSlots: { buffer: Buffer; mime: string }[] = [];
  const existingIds = new Set(conv.messages.map((m) => m.id));

  for (const payload of payloads) {
    const textTrim = payload.text?.trim() ?? "";
    const b64Raw = payload.imageBase64?.trim();
    const voiceB64Raw = payload.voiceAudioBase64?.trim();
    const imageMime = normalizeImageMime(payload.imageMime);

    if (!textTrim && !b64Raw && !voiceB64Raw) {
      throw new Error("Bericht is leeg");
    }
    if (textTrim.length > MAX_USER_MESSAGE_CHARS) {
      throw new Error(
        `Een bericht mag maximaal ${MAX_USER_MESSAGE_CHARS} tekens zijn. Maak het korter of verdeel het.`
      );
    }

    const preferredId = payload.clientMessageId?.trim();
    const chosenId =
      preferredId && /^[a-z0-9_-]{8,80}$/i.test(preferredId) && !existingIds.has(preferredId)
        ? preferredId
        : randomUUID();
    const userMessage: ChatMessage = {
      id: chosenId,
      role: "user",
      content: textTrim || "📷",
      createdAt: new Date().toISOString(),
      readByPeer: false,
      replyToId: payload.replyToId?.trim() || undefined,
    };

    if (b64Raw) {
      const b64 = stripDataUrlBase64(b64Raw);
      const imageBuffer = Buffer.from(b64, "base64");
      if (imageBuffer.length > MAX_IMAGE_BYTES) {
        throw new Error("Foto is te groot (max. 6MB).");
      }
      if (imageBuffer.length < 80) {
        throw new Error("Ongeldige foto.");
      }
      const filename = await saveConversationImage(
        conversationId,
        userMessage.id,
        imageBuffer,
        imageMime
      );
      userMessage.imageFile = filename;
      imageSlots.push({ buffer: imageBuffer, mime: imageMime });
    }
    if (voiceB64Raw) {
      const vb64 = stripDataUrlAudioBase64(voiceB64Raw);
      const voiceBuffer = Buffer.from(vb64, "base64");
      if (voiceBuffer.length < 128) {
        throw new Error("Ongeldig spraakbericht.");
      }
      const voiceMime = (payload.voiceMime || "audio/webm").toLowerCase();
      await saveConversationVoiceInput(conversationId, userMessage.id, voiceBuffer, voiceMime);
      userMessage.content = "🎤 Spraakbericht";
      userMessage.voice = {
        language: "nl",
        transcript: textTrim || undefined,
        mimeType: voiceMime,
        durationMs:
          typeof payload.voiceDurationMs === "number" && Number.isFinite(payload.voiceDurationMs)
            ? Math.max(0, Math.floor(payload.voiceDurationMs))
            : undefined,
      };
    }

    existingIds.add(userMessage.id);
    userMessages.push(userMessage);
  }

  const joinedUserText = payloads.map((p) => p.text).join("\n");
  const hasVoiceInput = payloads.some((p) => Boolean(p.voiceAudioBase64?.trim()));
  if (conv.ownerUserId) {
    const extractedPatch = extractPersonalFactsFromText(joinedUserText);
    if (Object.keys(extractedPatch).length > 0) {
      void updateUserPersonalFacts(conv.ownerUserId, extractedPatch).catch((e) => {
        console.error("[memory] Failed to persist personal facts:", e);
      });
    }
  }
  void hasVoiceInput;

  // Update realism state with new user messages — make it less eager overall
  if (realismState) {
    realismState = updateConversationState(realismState, userMessages.length);
    // Slightly reduce energy on every new batch to prevent constant replying
    realismState.energy = Math.max(35, realismState.energy - 4);
  } else {
    realismState = createInitialConversationState();
  }

  const promptMessages = [...conv.messages, ...userMessages];
  // No longer using strict intimacy tiers - AI decides tone and escalation herself

  const lastUserTextLower = joinedUserText.toLowerCase();
  const asksForPhotoButVague =
    /(wat kan je voor me maken|wat kun je voor me maken|kan je iets maken|kun je iets maken|maak iets voor me|stuur iets leuks|wat kan je sturen|iets spannends voor me)/i.test(
      lastUserTextLower
    );
  const askedForPreferenceEarlier = conv.pendingPhotoPreferenceRequest === true;
  const hasConcreteVisualPreferenceNow =
    /lingerie|string|kleur|groen|zwart|rood|standje|positie|knie[eë]n|doggy|missionaris|bovenop|close|close-up|hele lichaam|kont|borsten|boobs|tits|tieten|tepels|kut|nat maken|pijp|neuken|selfie|hoek|camera|jurkje|setje|zonder|met bh|zonder bh|billen|achterkant|vooraanzicht/i.test(
      lastUserTextLower
    );

  // Vage fotovraag => eerst doorvragen naar voorkeur, nog geen foto sturen.
  if ((asksForPhotoButVague || askedForPreferenceEarlier) && !hasConcreteVisualPreferenceNow) {
    await updateConversationAtomic(conversationId, (latestConv) => {
      latestConv.messages = [...latestConv.messages, ...userMessages];
      latestConv.updatedAt = userMessages[userMessages.length - 1]!.createdAt;
      latestConv.realismState = realismState;
      latestConv.pendingPhotoPreferenceRequest = true;
    });
    if (conv.ownerUserId) {
      await deductMessageCredits(conv.ownerUserId, userMessages.length, conversationId);
    }
    await sleep(Math.min(3000, getRealisticReplyDelay(realismState)));
    const askMsg: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: await generatePhotoPreferenceQuestion(profile.name, joinedUserText),
      createdAt: new Date().toISOString(),
    };
    await updateConversationAtomic(conversationId, (latestConv) => {
      markPendingUserMessagesAsReadByPeer(latestConv);
      latestConv.messages = [...latestConv.messages, askMsg];
      latestConv.updatedAt = askMsg.createdAt;
      latestConv.realismState = {
        ...realismState,
        lastReplyAt: askMsg.createdAt,
        messagesSinceLastReply: 0,
      };
      latestConv.pendingPhotoPreferenceRequest = true;
      scheduleNoReplyReminderAfterAssistant(latestConv, askMsg.id);
    });
    void maybeSendOfflineAssistantEmail(conversationId, askMsg);
    return {
      userMessages,
      assistantMessage: askMsg,
    };
  }

  // === PROJECT ECHO: Ultra-realistic reply decision ===
  if (!shouldReplyNow(realismState)) {
    await updateConversationAtomic(conversationId, (latestConv) => {
      latestConv.messages = [...latestConv.messages, ...userMessages];
      latestConv.updatedAt = userMessages[userMessages.length - 1]!.createdAt;
      latestConv.realismState = realismState;
    });
    if (conv.ownerUserId) {
      await deductMessageCredits(conv.ownerUserId, userMessages.length, conversationId);
    }
    // No direct reply here: avoid immediate extra follow-up bubbles.
    return {
      userMessages,
      assistantMessage: null,
    };
  }
  // Belangrijk: current batch NIET in history opnemen, want die gaat al als `lastUserMsg`.
  // Anders ziet het model hetzelfde user-bericht dubbel.
  const history: GrokMessage[] = conv.messages.slice(-32).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: grokHistoryLine(m),
  }));

  const photoOnlyHint =
    "Ik stuur een foto (eventueel zonder bijschrift). Bekijk de afbeelding én de **laatste berichten** in dit gesprek. Als hij net iets anders insinueerde of beloofde te sturen (bijv. iets intiems/persoonlijks) maar de foto is duidelijk iets anders — screenshot, stats, werk, random object: reageer **plagerig met die mismatch** (bijv. dat dit niet is wat hij net voorstelde; doorprik de grap). Als de foto off-topic is zonder zo’n contrast: ‘haha wat is dit / ik wil jou zien’. Als de foto wél past: in character blijven.";

  let lastUserMsg: GrokMessage;
  if (imageSlots.length > 0) {
    /**
     * xAI chat/completions: officieel `image_url` { url, detail } + `text` (zie docs model-capabilities chat-completions).
     * `input_image` / `input_text` is o.a. voor Responses API — geeft 422 "Content" op chat/completions.
     */
    const parts: GrokContentPartOpenAI[] = [];
    for (const slot of imageSlots) {
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${slot.mime};base64,${slot.buffer.toString("base64")}`,
          detail: "high",
        },
      });
    }
    const n = payloads.length;
    const lines = payloads.map((p, i) => {
      const tx = p.text?.trim() ?? "";
      const hasPhoto = Boolean(p.imageBase64?.trim());
      const tag = hasPhoto ? " (bijbehorende foto staat in dezelfde volgorde hierboven)" : "";
      return `[${i + 1}/${n}]${tag} ${tx || "(alleen foto)"}`;
    });
    const head = `Hij stuurde ${n} bericht(en) kort achter elkaar, zonder jouw antwoorden ertussen. Lees alle teksten en bekijk elke foto in volgorde; gebruik ook het **recente gesprek** in de thread: als de foto niet klopt met wat hij net zei of voorstelde (bijv. iets intiems insinueerde maar het is een screenshot of random plaatje), leg die mismatch plagerig bloot. Geef één samenhangend antwoord in character.`;
    const bundle =
      n === 1 && !payloads[0]!.text?.trim() && payloads[0]!.imageBase64?.trim()
        ? `${head}\n\n${photoOnlyHint}`
        : `${head}\n\n${lines.join("\n")}`;
    parts.push({ type: "text", text: bundle });
    lastUserMsg = { role: "user", content: parts };
  } else if (payloads.length === 1) {
    lastUserMsg = { role: "user", content: payloads[0]!.text.trim() };
  } else {
    const n = payloads.length;
    const body = payloads.map((p, i) => `${i + 1}. ${p.text.trim()}`).join("\n");
    lastUserMsg = {
      role: "user",
      content: `Hij stuurde ${n} berichten direct achter elkaar, zonder te wachten op jouw antwoord. Lees ze allemaal en reageer één keer, in character.\n\n${body}`,
    };
  }

  const voiceInstruction =
    "SPRAAK IN DE APP: Bij dit antwoord zit geen audio. Zeg niet dat je iets hebt ingesproken of dat hij een spraakbericht moet checken — alleen tekst.";

  let systemPrompt: string;
  try {
    systemPrompt = await buildSystemContent(profile, promptMessages, conv.ownerUserId);
  } catch (err) {
    console.error("[chat] buildSystemContent failed, using fallback:", err);
    systemPrompt = `Je bent ${profile.name}, een ${profile.age}-jarige vrouw uit ${profile.location}. Antwoord kort, natuurlijk en in character.`;
  }

  const pendingPhotoInstruction = activePhotoPipeline
    ? "FOTO-QUEUE REGEL: er staat al één foto in de wachtrij of als locked bericht. Beloof nu GEEN nieuwe foto en zeg niet opnieuw dat je er nu één gaat maken. Reageer wel normaal op zijn wensen, maar zeg kort dat hij deze eerst even moet bekijken/wachten."
    : "";
  const emojiStyleInstruction =
    "STIJLREGEL EMOJI: gebruik emoji spaarzaam. In de meeste antwoorden geen emoji; maximaal 1 emoji als het echt past.";

  const messages: GrokMessage[] = [
    {
      role: "system",
      content: `${systemPrompt}\n\n${voiceInstruction}\n\n${emojiStyleInstruction}${pendingPhotoInstruction ? `\n\n${pendingPhotoInstruction}` : ""}`,
    },
    ...history,
    lastUserMsg,
  ];

  await updateConversationAtomic(conversationId, (latestConv) => {
    latestConv.messages = [...latestConv.messages, ...userMessages];
    latestConv.updatedAt = userMessages[userMessages.length - 1]!.createdAt;
    latestConv.realismState = realismState;
  });
  if (conv.ownerUserId) {
    await deductMessageCredits(conv.ownerUserId, userMessages.length, conversationId);
  }

  // Use realistic delay from the new engine
  const realisticDelay = getRealisticReplyDelay(realismState);
  await sleep(realisticDelay);

  let replyText = await completeChat(messages, { hasImage: imageSlots.length > 0 });
  replyText = sparsifyEmojis(replyText);
  if (activePhotoPipeline) {
    replyText = enforcePendingPhotoReply(replyText);
  }

  // === FOTO STUREN: detecteer of de gebruiker een foto wil zien ===
  const lastUserText = joinedUserText.toLowerCase();

  const userWantsPicture =
    /foto|picture|pic|selfie|kiekje|plaatje|naakt|naked|nude|stuur|sturen|laat zien|laten zien|zien wat|zie je|kan je .*maken|kun je .*maken|maak .*voor me|maak er (een|1)|maak (hem|m) (nu|voor me)|doe .*sturen/i.test(
      lastUserText
    ) ||
    lastUserText.includes("pijp") ||
    lastUserText.includes("borsten") ||
    lastUserText.includes("vagina") ||
    lastUserText.includes("kut") ||
    lastUserText.includes("send pic");

  // Pas foto sturen als hij ook echt reageert op haar doorvraag/suggesties.
  const hasExplicitConcretePhotoRequest = userWantsPicture && hasConcreteVisualPreferenceNow;
  const hasPreferenceReplyAfterQuestion = askedForPreferenceEarlier && hasConcreteVisualPreferenceNow;
  const directPhotoActionVerb = /\b(stuur|sturen|maak|maken|doe)\b/i.test(lastUserTextLower);
  let shouldSendPhotoNow =
    !activePhotoPipeline &&
    (hasExplicitConcretePhotoRequest ||
      hasPreferenceReplyAfterQuestion ||
      (userWantsPicture && directPhotoActionVerb) ||
      (hasConcreteVisualPreferenceNow && directPhotoActionVerb));

  // Hard guard: ask-first means no photo queue in this same turn.
  if (containsPhotoPreferenceQuestion(replyText)) {
    if (containsPhotoPromise(replyText)) {
      replyText = removePhotoPromiseLines(replyText);
    }
    shouldSendPhotoNow = false;
  }
  // Absolute consistency: any question in this turn means no same-turn "ik ga hem maken".
  if (hasAnyQuestion(replyText) && containsPhotoPromise(replyText)) {
    replyText = removePhotoPromiseLines(replyText);
    shouldSendPhotoNow = false;
  }
  const assistantPromisesPhotoNow =
    containsPhotoPromise(replyText) && !containsPhotoPreferenceQuestion(replyText);
  if (!activePhotoPipeline && assistantPromisesPhotoNow) {
    shouldSendPhotoNow = true;
  }

  // Support for multiple short messages in a row (ultra-realistic texting)
  const messageParts = replyText
    .split(/\n?---\n?/)
    .map((p) => p.trim())
    .filter(Boolean);

  const assistantMessages: ChatMessage[] = messageParts.map((part, index) => ({
    id: randomUUID(),
    role: "assistant",
    content: part,
    createdAt: new Date(Date.now() + index * 850).toISOString(), // small realistic delay between bubbles
    replyToId:
      index === 0
        ? payloads[payloads.length - 1]?.replyToId?.trim() ||
          (payloads.some((p) => Boolean(p.voiceAudioBase64?.trim()))
            ? userMessages[userMessages.length - 1]?.id
            : undefined) ||
          (Math.random() < 0.28 ? userMessages[userMessages.length - 1]?.id : undefined)
        : undefined,
  }));

  /**
   * Stuur de foto als losse extra bubble nadat ze (in haar tekst) heeft beloofd er
   * eentje te maken. Foto is altijd vergrendeld; gebruiker betaalt om hem te zien.
   */
  let queuedPhotoDelivery:
    | {
        messageId: string;
        prompt: string;
        width: number;
        height: number;
        teaseText: string;
        delayedNudgeText: string;
      }
    | null = null;
  if (shouldSendPhotoNow) {
    const engagementStyle = randomPhotoEngagementStyle();
    const photoMsgId = randomUUID();
    const imagePrompt = await generatePersonalizedImagePrompt(
      profile,
      conv,
      joinedUserText,
      replyText
    );
    const immediateLockedTease = await generateLockedPhotoTeaseText(
      profile.name,
      joinedUserText,
      replyText,
      engagementStyle
    );
    const delayedLockedNudgeText = await generateLockedPhotoDelayedNudgeText(
      profile.name,
      joinedUserText,
      engagementStyle
    );
    queuedPhotoDelivery = {
      messageId: photoMsgId,
      prompt: imagePrompt,
      width: 1024,
      height: 1024,
      teaseText: immediateLockedTease,
      delayedNudgeText: delayedLockedNudgeText,
    };
  }

  const assistantMessage = assistantMessages[0] ?? {
    id: randomUUID(),
    role: "assistant",
    content: replyText,
    createdAt: new Date().toISOString(),
  };

  await updateConversationAtomic(conversationId, async (latestConv) => {
    markPendingUserMessagesAsReadByPeer(latestConv);

    // Add realistic typing events to the assistant message
    const typingEvents = simulateTypingBehavior(realismState, realisticDelay);
    assistantMessage.typingEvents = typingEvents;

    const messagesToAdd: ChatMessage[] = [...assistantMessages];

    latestConv.messages = [...latestConv.messages, ...messagesToAdd];
    const tail = messagesToAdd[messagesToAdd.length - 1];
    latestConv.updatedAt = tail?.createdAt ?? new Date().toISOString();
    latestConv.realismState = {
      ...realismState,
      lastReplyAt: tail?.createdAt ?? new Date().toISOString(),
      messagesSinceLastReply: 0,
      energy: Math.min(100, realismState.energy + 15),
    };

    const lastAssistantAnchor = tail?.id ?? assistantMessage.id;
    scheduleNoReplyReminderAfterAssistant(latestConv, lastAssistantAnchor);
    if (shouldSendPhotoNow) {
      latestConv.pendingPhotoPreferenceRequest = false;
    }
    if (queuedPhotoDelivery) {
      latestConv.pendingLockedPhotoDeliveryAt = new Date(
        Date.now() + randomLockedPhotoDeliveryDelayMs()
      ).toISOString();
      latestConv.pendingLockedPhotoDelivery = queuedPhotoDelivery;
    }
  });
  void maybeSendOfflineAssistantEmail(conversationId, assistantMessage);

  return {
    userMessages,
    assistantMessage: assistantMessages[0] ?? assistantMessage,
  };
}

export async function appendUserMessageAndReply(
  conversationId: string,
  payload: UserMessagePayload,
  options?: { noCredits?: boolean; requesterUserId?: string | null }
): Promise<{
  userMessage: ChatMessage | null;
  assistantMessage: ChatMessage | null;
  creditWall?: boolean;
  speakAssistantReply?: { language: string };
}> {
  const r = await appendUserMessagesAndReply(conversationId, [payload], options);
  if (r.creditWall) {
    return {
      userMessage: null,
      assistantMessage: null,
      creditWall: true,
    };
  }
  return {
    userMessage: r.userMessages[0]!,
    assistantMessage: r.assistantMessage!,
    speakAssistantReply: r.speakAssistantReply,
  };
}

export async function appendUserGiftMessage(
  conversationId: string,
  credits: number,
  note: string,
  packageLabel: string,
  requesterUserId?: string | null
): Promise<ChatMessage> {
  const giftCredits = Math.max(1, Math.min(500, Math.floor(credits)));
  const list = await loadList();
  const idx = list.findIndex((c) => c.id === conversationId);
  if (idx === -1) throw new Error("Gesprek niet gevonden");
  const conv = list[idx]!;
  if (conv.ownerUserId) {
    if (requesterUserId !== conv.ownerUserId) throw new Error("Geen toegang tot dit gesprek");
  } else if (requesterUserId) {
    throw new Error("Geen toegang tot dit gesprek");
  }

  const msg: ChatMessage = {
    id: randomUUID(),
    role: "user",
    content: note.trim() || `cadeautje voor jou (${giftCredits} credits)`,
    createdAt: new Date().toISOString(),
    readByPeer: false,
    gift: {
      credits: giftCredits,
      direction: "to_peer",
      emoji: "🎉",
      packageLabel: packageLabel.trim() || `${giftCredits} credits`,
      note: note.trim() || undefined,
    },
  };
  const reply: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content: randomGiftThanksLine(),
    createdAt: new Date().toISOString(),
    replyToId: msg.id,
  };
  const openedEvent: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content: `${conv.profileName} heeft je cadeau geopend`,
    createdAt: new Date().toISOString(),
    replyToId: msg.id,
  };
  await updateConversationAtomic(conversationId, (latestConv) => {
    latestConv.messages = [...latestConv.messages, msg, reply, openedEvent];
    latestConv.updatedAt = openedEvent.createdAt;
  });
  void maybeSendOfflineAssistantEmail(conversationId, reply);
  return msg;
}

/**
 * Chatten is gratis op het foto-platform: deze deduct doet niets meer
 * zolang `CREDITS_PER_MESSAGE === 0`. Het wordt nog wel aangeroepen in
 * de flow zodat we hem snel kunnen aanzetten als we ooit terug willen
 * naar betaalde berichten.
 */
async function deductMessageCredits(
  userId: string | null,
  count: number,
  conversationId: string
): Promise<void> {
  if (!userId || count <= 0) return;
  if (CREDITS_PER_MESSAGE <= 0) return;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    // Fallback for non-Supabase mode (local demo)
    console.log(`[credits] Would deduct ${count * CREDITS_PER_MESSAGE} for ${count} messages (demo)`);
    return;
  }

  const entries = Array.from({ length: count }, () => ({
    user_id: userId,
    direction: 'debit' as const,
    amount: CREDITS_PER_MESSAGE,
    reason: 'chat_message',
    reference_id: conversationId,
    metadata: { conversationId, messageCount: count } as any,
  }));

  const tryInsert = async () =>
    supabase
      .from('credit_ledger')
      .insert(entries);

  let { error } = await tryInsert();
  if (!error) return;

  // Veelvoorkomend in logs: FK-fout omdat public.users de app-user nog niet bevat.
  // Sync de user en probeer exact één keer opnieuw zodat deduct niet wordt overgeslagen.
  if ((error as { code?: string }).code === '23503') {
    try {
      const user = await findUserById(userId);
      if (user) {
        await upsertAppUserToSupabaseUsers(user);
        const retry = await tryInsert();
        error = retry.error ?? null;
        if (!error) return;
      }
    } catch (syncErr) {
      console.error('[credits] User sync before ledger retry failed:', syncErr);
    }
  }

  if (error) {
    console.error('[credits] Failed to deduct ledger:', error);
  }
}

export async function listUserMessageCreditUsage(
  ownerUserId: string | null
): Promise<UserMessageCreditLine[]> {
  const list = await loadList();
  const out: UserMessageCreditLine[] = [];
  for (const c of list) {
    if (ownerUserId) {
      if (c.ownerUserId !== ownerUserId) continue;
    } else if (c.ownerUserId) {
      continue;
    }
    for (const m of c.messages) {
      if (m.role !== "user") continue;
      const text = (m.content ?? "").trim();
      const preview = m.imageFile
        ? text
          ? `📷 ${text.slice(0, 56)}${text.length > 56 ? "…" : ""}`
          : "📷 Foto"
        : text
          ? `${text.slice(0, 72)}${text.length > 72 ? "…" : ""}`
          : "(Bericht)";
      out.push({
        messageId: m.id,
        createdAt: m.createdAt,
        credits: CREDITS_PER_MESSAGE,
        profileName: c.profileName,
        conversationId: c.id,
        preview,
      });
    }
  }
  return out.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

const PHOTO_UNLOCK_FOLLOWUPS = [
  "zie je hem schat? ik werd er zelf zo geil van... heb echt zin om een lul te zien 🥵",
  "vond je hem lekker? ik ben echt geil schat, jij maakt me zo nat",
  "mmm zie je wat je met me doet? ik wil nu echt iets van jou zien ook 😏",
  "geil he? ik ben echt aan het hijgen hier, stuur jij ook iets terug?",
  "kijk ‘m goed dan schat, ik wil weten wat je ervan vindt",
  "hoop dat je hem mooi vindt, ik werd er zelf hard van haha",
  "vertel me dan, wat doet hij met je? ik wil het horen 😈",
  "lekker hè? ik wil zo graag weten wat je nu doet schat...",
] as const;

function randomPhotoUnlockFollowupLine(): string {
  const i = Math.floor(Math.random() * PHOTO_UNLOCK_FOLLOWUPS.length);
  return PHOTO_UNLOCK_FOLLOWUPS[i] ?? PHOTO_UNLOCK_FOLLOWUPS[0]!;
}

/**
 * Markeer een vergrendelde foto als ontgrendeld en stuur direct een
 * teasende follow-up van haar in de chat.
 */
export async function unlockAssistantPhoto(
  conversationId: string,
  messageId: string,
  ownerUserId: string
): Promise<{
  unlockedMessage: ChatMessage;
  followupMessage: ChatMessage | null;
  alreadyUnlocked: boolean;
  creditsCost: number;
}> {
  let alreadyUnlocked = false;
  let unlockedMessage: ChatMessage | undefined;
  let followupMessage: ChatMessage | undefined;

  await updateConversationAtomic(conversationId, async (conv) => {
    if (conv.ownerUserId !== ownerUserId) {
      throw new Error("Geen toegang tot dit gesprek");
    }
    const target = conv.messages.find((m) => m.id === messageId);
    if (!target) throw new Error("Foto niet gevonden");
    if (target.role !== "assistant" || !target.photoLock) {
      throw new Error("Bericht heeft geen vergrendelde foto");
    }
    if (target.photoLock.unlockedAt) {
      alreadyUnlocked = true;
      unlockedMessage = target;
      if (conv.pendingLockedPhotoMessageId === target.id) {
        conv.pendingLockedPhotoNudgeAt = undefined;
        conv.pendingLockedPhotoMessageId = undefined;
        conv.pendingLockedPhotoNudgeText = undefined;
      }
      return;
    }
    if (!target.imageFile) {
      const prompt = target.photoGeneration?.prompt?.trim();
      const width = target.photoGeneration?.width ?? 1024;
      const height = target.photoGeneration?.height ?? 1024;
      if (!prompt) {
        throw new Error("Foto prompt ontbreekt voor deze vergrendelde foto");
      }
      // Generates the real image only when user unlocks.
      const generated = await generateRealisticImage(
        { prompt, width, height, steps: 9, randomSeed: true },
        conv.id,
        target.id
      );
      if (!generated) {
        throw new Error("Foto genereren mislukt");
      }
      target.imageFile = generated;
      if (!conv.firstGeneratedPhotoMessageId) {
        conv.firstGeneratedPhotoMessageId = target.id;
        conv.firstGeneratedPhotoFile = generated;
      }
    }
    target.photoLock = {
      ...target.photoLock,
      unlockedAt: new Date().toISOString(),
    };
    unlockedMessage = target;
    if (conv.pendingLockedPhotoMessageId === target.id) {
      conv.pendingLockedPhotoNudgeAt = undefined;
      conv.pendingLockedPhotoMessageId = undefined;
      conv.pendingLockedPhotoNudgeText = undefined;
    }

    const fu: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: randomPhotoUnlockFollowupLine(),
      createdAt: new Date(Date.now() + 1500).toISOString(),
      replyToId: target.id,
    };
    conv.messages = [...conv.messages, fu];
    conv.updatedAt = fu.createdAt;
    followupMessage = fu;
    scheduleNoReplyReminderAfterAssistant(conv, fu.id);
  });

  const finalUnlockedMessage: ChatMessage | undefined = unlockedMessage;
  if (!finalUnlockedMessage) {
    throw new Error("Ontgrendelen mislukt");
  }
  const finalFollowup: ChatMessage | null = followupMessage ?? null;
  if (finalFollowup) {
    void maybeSendOfflineAssistantEmail(conversationId, finalFollowup);
  }
  return {
    unlockedMessage: finalUnlockedMessage,
    followupMessage: finalFollowup,
    alreadyUnlocked,
    creditsCost: alreadyUnlocked
      ? 0
      : finalUnlockedMessage.photoLock?.credits ?? CREDITS_PER_PHOTO_UNLOCK,
  };
}

/** Statisch assistentbericht (geen Grok) — o.a. engagement-nudges. */
export async function appendSystemAssistantMessage(
  conversationId: string,
  text: string
): Promise<boolean> {
  const list = await loadList();
  const idx = list.findIndex((c) => c.id === conversationId);
  if (idx === -1) return false;
  const conv = list[idx]!;
  const msg: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content: text.trim(),
    createdAt: new Date().toISOString(),
  };
  conv.messages = [...conv.messages, msg];
  conv.updatedAt = msg.createdAt;
  list[idx] = conv;
  await saveList(list);
  void maybeSendOfflineAssistantEmail(conv.id, msg);
  return true;
}

export async function appendPurchaseThanksMessage(ownerUserId: string): Promise<boolean> {
  const list = await loadList();
  const target = list
    .filter((c) => c.ownerUserId === ownerUserId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  if (!target) return false;
  const msg: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content: "lekker schat, ik zie je aankoop 😘 wil je dat ik meteen iets spannends voor je maak?",
    createdAt: new Date().toISOString(),
  };
  target.messages = [...target.messages, msg];
  target.updatedAt = msg.createdAt;
  await saveList(list);
  void maybeSendOfflineAssistantEmail(target.id, msg);
  return true;
}

/** Seed demo-gesprekken voor gasten (alleen als er nog geen owner-loze chats zijn). */
export async function ensureSeedConversations(): Promise<void> {
  const list = await loadList();
  if (list.some((c) => !c.ownerUserId)) return;

  let a: Profile | null = null;
  let b: Profile | null = null;
  if (isSupabaseProfilesEnabled()) {
    const profiles = await listDbProfiles(8);
    if (profiles.length >= 2) {
      a = profiles[0]!;
      b = profiles[1]!;
    } else if (profiles.length === 1) {
      a = profiles[0]!;
      b = profiles[0]!;
    } else {
      return;
    }
  } else {
    const emma = await getDbProfileById("3");
    const lisa = await getDbProfileById("2");
    if (!emma || !lisa) return;
    a = emma;
    b = lisa;
  }

  const now = new Date().toISOString();
  const seed: Conversation[] = [
    {
      id: randomUUID(),
      profileId: a.id,
      profileName: a.name,
      previewAvatar: a.photo,
      isOnline: a.isOnline,
      updatedAt: now,
      messages: [
        {
          id: randomUUID(),
          role: "assistant",
          content: "Hey, leuk dat je er bent 😊 waar kom je vandaan?",
          createdAt: now,
        },
      ],
    },
    {
      id: randomUUID(),
      profileId: b.id,
      profileName: b.name,
      previewAvatar: b.photo,
      isOnline: b.isOnline,
      updatedAt: now,
      messages: [
        {
          id: randomUUID(),
          role: "assistant",
          content: "Leuk je profiel! Laten we eens afspreken.",
          createdAt: now,
        },
      ],
    },
  ];
  await saveList([...seed, ...list]);
}
