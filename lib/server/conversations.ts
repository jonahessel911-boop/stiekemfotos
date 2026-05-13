import { randomUUID } from "crypto";
import { readJsonBlob, writeJsonBlob } from "@/lib/server/blobJson";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import {
  loadConversationById,
  loadConversationByOwnerAndProfile,
  loadConversationsRelational,
  saveConversationsRelational,
  saveSingleConversationRelational,
} from "@/lib/server/conversationsRelational";
import { resolveUserIdForSupabaseFk } from "@/lib/server/ensureUserRowForFk";
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
import { tryUploadImageToStorage } from "@/lib/server/imageStorage";
import {
  findUserById,
  canSendInboxNotificationEmail,
  touchLastInboxNotificationEmail,
  updateUserPersonalFacts,
  type UserRecord,
} from "@/lib/server/users";
import {
  buildBodyShotIdentityDescriptor,
  compactIdentityForChatPhotoPrompt,
  generateRealisticImageDetailed,
  sanitizeIdentityForZImagePrompt,
  zModelMaxUserPromptBodyChars,
} from "@/lib/server/imageGen";
import { callGrokResponses, callXaiResponses, buildProfileInstructions, sanitizeAssistantChatText } from "@/lib/grok";
import { buildStableVisualIdentityForProfile } from "@/lib/server/profileVisualIdentity";
import { sendGiftReceivedEmail, sendOfflineNewMessageEmail } from "@/lib/server/email";
import { upsertAppUserToSupabaseUsers } from "@/lib/server/supabaseUserSync";
import {
  dedupeChatMessagesById,
  sortChatMessagesChronologically,
} from "@/lib/chat-message-order";
import { extractPersonalFactsFromText, formatPersonalFactsForPrompt } from "@/lib/user-personal-facts";

/** User-tekst die telt als concrete visuele fotowens (trigger + details). Ook: naakt/nude. */
const CONCRETE_PHOTO_INTENT_REGEX =
  /lingerie|string|strings|thong|tanga|kleur|groen|zwart|rood|blauw|wit|paars|roze|geel|gele|oranje|standje|positie|knie[eë]n|doggy|missionaris|bovenop|close|close-up|hele lichaam|kont|borsten|boobs|tits|tieten|tepels|kut|nat maken|pijp|neuken|selfie|hoek|camera|jurk|jurkje|setje|shirt|trui|pakje|sport|sportpak|trainingspak|outfit|bodysuit|bikini|badpak|jumpsuit|catsuit|romper|negligé|negligee|babydoll|teddy|zonder|met bh|zonder bh|bovenlijf|bovenlichaam|torso|billen|achterkant|vooraanzicht|van voren|van achter|gezicht|naam erop|naam op|briefje|papier|naakt|nude|naktfoto|naaktfoto|bloot|helemaal|ontkleed|doorschijnend|doorzichtig|transparant|see[- ]?through|sheer|mesh|netstof|wet ?look/i;

function isVagueUserPhotoReply(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  if (CONCRETE_PHOTO_INTENT_REGEX.test(lower)) return false;
  if (/\b(stuur|maak)\b.*\b(foto|selfie|pic|picture|plaatje)\b/i.test(lower)) return false;
  if (/\b(foto|selfie)\b/i.test(lower) && t.length < 80) return false;
  return t.length <= 40;
}

function mergePhotoCycleIntent(prev: string | undefined, incoming: string): string {
  const inc = incoming.replace(/\s+/g, " ").trim();
  if (!inc) return (prev ?? "").trim();
  if (isVagueUserPhotoReply(inc)) return (prev ?? "").trim();
  const base = (prev ?? "").trim();
  if (!base) return inc;
  if (base.includes(inc) || inc.includes(base)) return inc.length >= base.length ? inc : base;
  return `${base}\n${inc}`;
}

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

/** Oude data: previewAvatar wijst naar /api/conversations/.../image/... (alleen lokaal op schijf). */
function sanitizePreviewAvatarForRuntime(raw: string | undefined, profileId: string): string {
  const u = (raw ?? "").trim();
  if (!u) return uniqueFallbackAvatar(profileId);
  if (u.startsWith("/api/conversations/")) return uniqueFallbackAvatar(profileId);
  // Never replace a real external photo URL with a generated fallback
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return u;
}

/** Forceert unieke avatar per profiel in gesprekken/inbox (ook voor legacy data). */
function enforceUniqueConversationAvatars(list: Conversation[]): Conversation[] {
  const usedByProfile = new Map<string, string>();
  const usedByAvatar = new Map<string, string>();
  return list.map((c) => {
    const c0 = {
      ...c,
      previewAvatar: sanitizePreviewAvatarForRuntime(c.previewAvatar, c.profileId),
    };
    const profileId = c0.profileId;
    const existingForProfile = usedByProfile.get(profileId);
    if (existingForProfile) {
      return existingForProfile === c0.previewAvatar
        ? c0
        : { ...c0, previewAvatar: existingForProfile };
    }

    const key = canonicalAvatarKey(c0.previewAvatar);
    if (!key) {
      const fallback = uniqueFallbackAvatar(profileId);
      usedByProfile.set(profileId, fallback);
      usedByAvatar.set(canonicalAvatarKey(fallback), profileId);
      return { ...c0, previewAvatar: fallback };
    }

    // Only force a unique fallback on collision if this avatar is already one of our generated ones.
    // Real profile photos (Unsplash etc.) are allowed to stay even if two profiles happen to share a similar stock image.
    const isGeneratedAvatar = c0.previewAvatar.includes("dicebear.com") || c0.previewAvatar.includes("api.dicebear");
    const owner = usedByAvatar.get(key);
    if (owner && owner !== profileId && isGeneratedAvatar) {
      const fallback = uniqueFallbackAvatar(profileId);
      usedByProfile.set(profileId, fallback);
      usedByAvatar.set(canonicalAvatarKey(fallback), profileId);
      return { ...c0, previewAvatar: fallback };
    }

    usedByProfile.set(profileId, c0.previewAvatar);
    usedByAvatar.set(key, profileId);
    return c0;
  });
}

/**
 * `conversations.profile_avatar` / metadata kan leeg of verouderd zijn → Dicebear in de UI.
 * Vul `previewAvatar` (en naam) bij vanuit het actieve profiel in `profiles` (+ profile_media).
 */
async function hydrateConversationsPreviewAvatars(
  conversations: Conversation[]
): Promise<Conversation[]> {
  if (!isSupabaseProfilesEnabled() || conversations.length === 0) return conversations;

  const profiles = await listDbProfiles(220);
  const photoById = new Map<string, string>();
  const nameById = new Map<string, string>();
  for (const p of profiles) {
    const ph = p.photo?.trim();
    if (ph) photoById.set(p.id, ph);
    const nm = p.name?.trim();
    if (nm) nameById.set(p.id, nm);
  }

  const missing = new Set(
    conversations.map((c) => c.profileId).filter((id) => Boolean(id?.trim()) && !photoById.has(id.trim()))
  );
  await Promise.all(
    [...missing].map(async (pid) => {
      const p = await getDbProfileById(pid);
      const ph = p?.photo?.trim();
      if (ph) photoById.set(pid, ph);
      const nm = p?.name?.trim();
      if (nm) nameById.set(pid, nm);
    })
  );

  return conversations.map((c) => {
    const live = photoById.get(c.profileId);
    if (!live) return c;
    return {
      ...c,
      previewAvatar: live,
      profileName: nameById.get(c.profileId) ?? c.profileName,
    };
  });
}

async function hydrateSingleConversationPreviewFromProfile(c: Conversation): Promise<Conversation> {
  if (!isSupabaseProfilesEnabled()) return c;
  const p = await getDbProfileById(c.profileId);
  if (!p?.photo?.trim()) return c;
  return {
    ...c,
    previewAvatar: p.photo.trim(),
    profileName: p.name?.trim() || c.profileName,
  };
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
const FREE_START_CREDITS = 200;

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

function messageEndsConversationForNow(text: string): boolean {
  const t = (text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return false;
  return (
    /\b(slaap lekker|welterusten|fijne nacht|ik ga slapen|ik ga naar bed)\b/i.test(t) ||
    /\b(tot morgen|spreek je morgen|we praten morgen|morgen weer)\b/i.test(t) ||
    /\b(ik kijk uit naar morgen)\b/i.test(t)
  );
}

function shouldSuppressNoReplyReminder(conv: Conversation): boolean {
  const lastAssistant = [...conv.messages].reverse().find((m) => m.role === "assistant");
  if (!lastAssistant) return false;
  return messageEndsConversationForNow(lastAssistant.content ?? "");
}

function scheduleNoReplyReminderAfterAssistant(conv: Conversation, afterAssistantMessageId: string): void {
  if (shouldSuppressNoReplyReminder(conv)) {
    conv.pendingNoReplyReminderStage = undefined;
    conv.pendingNoReplyAfterAssistantId = undefined;
    conv.pendingNoReplyFollowUpAt = undefined;
    return;
  }
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

/** Postgres `messages.id` is uuid — alleen echte UUID’s van de client overnemen. */
function isDatabaseUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
}

function grokHistoryLine(m: ChatMessage): string {
  if (m.role === "user" && m.voice?.transcript) {
    const t = m.voice.transcript.trim();
    return t ? `[Spraakbericht] ${t}` : "[Spraakbericht]";
  }
  if (m.role === "user" && m.imageFile) {
    const t = (m.content ?? "").trim();
    return t ? `[Foto gestuurd] ${t}` : "[Foto gestuurd]";
  }
  return typeof m.content === "string" ? m.content : String(m.content ?? "");
}

/** Tekst voor fotoprompt / intent (zelfde bron als Grok: spraak → transcript, niet alleen “🎤”). */
function messagePlainTextForPhotoIntent(m: ChatMessage): string {
  if (m.role === "user") {
    const tx = m.voice?.transcript?.trim();
    if (tx) return tx;
    if (m.imageFile) {
      const t = (m.content ?? "").trim();
      if (t && t !== "📷" && t !== "🎤 Spraakbericht") return t;
      return "";
    }
  }
  return typeof m.content === "string" ? m.content.trim() : String(m.content ?? "").trim();
}

async function buildSystemContent(
  profile: Profile,
  messages: ChatMessage[],
  ownerUserId?: string
): Promise<string> {
  const firstName = (full: string | undefined): string => {
    const raw = (full ?? "").trim();
    if (!raw) return "";
    return raw.split(/\s+/)[0] ?? raw;
  };

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

    // Standaard UIT: `generateConversationSummary` = tweede completeChat() vóór het echte antwoord
    // (merkbare vertraging elke 10 assistant-berichten). Zet CHAT_BLOCKING_MEMORY_SUMMARY=1 om terug te zetten.
    const blockingMemorySummary =
      process.env.CHAT_BLOCKING_MEMORY_SUMMARY === "1" ||
      process.env.CHAT_BLOCKING_MEMORY_SUMMARY === "true";
    if (blockingMemorySummary && shouldGenerateSummary(messages)) {
      try {
        const summary = await Promise.race([
          generateConversationSummary(messages, profile.name),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error("summary_timeout")), 12_000)
          ),
        ]);
        if (summary) {
          basePrompt = injectMemoryIntoSystemPrompt(basePrompt, summary);
        }
      } catch (summaryErr) {
        console.error("[memory] Summary generation failed or timed out, continuing without:", summaryErr);
      }
    }

    if (ownerUserId) {
      try {
        const owner = await findUserById(ownerUserId);
        const ownerFirstName = firstName(owner?.naam);
        if (ownerFirstName) {
          basePrompt = `${basePrompt}

=== GEBRUIKERSNAAM CONTEXT (hard) ===
De gebruiker heet: ${ownerFirstName}
- Je MAG zijn naam af en toe in een zin gebruiken voor natuurlijk gevoel (bijv. "haha ${ownerFirstName}, jij maakt me gek").
- Doe dit NIET in elk bericht; houd het spaarzaam (ongeveer 1 op 4-6 antwoorden).
- Gebruik zijn naam nooit 2 antwoorden achter elkaar.
=== einde gebruikersnaam context ===`;
        }
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

function normalizeConversationMessages(list: Conversation[]): Conversation[] {
  /**
   * Dubbele `messages.id` binnen één thread → tweede krijgt nieuwe UUID (voorkomt pkey-fout bij save).
   * `seenMsgIds` moet **per gesprek** zijn: bij hergebruik van dezelfde id in twee verschillende threads
   * (bug / oude data) mag lezen via `loadList()` niet de id van thread B herschrijven terwijl thread B
   * in Postgres gewoon die id heeft — dan zou de client een andere id tonen dan `unlock`/`POST` laden
   * (`Foto niet gevonden`).
   */
  return list.map((c) => {
    const seenMsgIds = new Set<string>();
    const deduped = dedupeChatMessagesById(c.messages);
    const messages = sortChatMessagesChronologically(
      deduped.map((m) => {
        let id = typeof m.id === "string" ? m.id.trim() : "";
        if (!id) {
          const nid = randomUUID();
          seenMsgIds.add(nid);
          return { ...m, id: nid };
        }
        if (!seenMsgIds.has(id)) {
          seenMsgIds.add(id);
          return m;
        }
        const nid = randomUUID();
        seenMsgIds.add(nid);
        return { ...m, id: nid };
      })
    );

    const hasUserMessage = messages.some((x) => x.role === "user");

    return {
      ...c,
      messages,
      /** Geen geplande “ijsbreker” zolang de user nog niets heeft gestuurd. */
      pendingInitialAssistantAt: hasUserMessage ? c.pendingInitialAssistantAt : undefined,
    };
  });
}

export async function loadList(): Promise<Conversation[]> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    console.warn("[conversations] Supabase admin client ontbreekt — conversations worden niet geladen.");
    return [];
  }
  const raw = await loadConversationsRelational(admin);
  return enforceUniqueConversationAvatars(normalizeConversationMessages(raw));
}

/** Eén thread voor chat/API — geen volledige `loadList()` (die alle gesprekken + berichten laadt). */
async function loadNormalizedConversationById(conversationId: string): Promise<Conversation | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const raw = await loadConversationById(admin, conversationId);
  if (!raw) return null;
  const [one] = enforceUniqueConversationAvatars(normalizeConversationMessages([raw]));
  return one ?? null;
}

async function saveList(list: Conversation[]): Promise<void> {
  const normalized = normalizeConversationMessages(list);
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("Conversations kunnen niet worden opgeslagen: Supabase admin client ontbreekt.");
  }
  /**
   * Standaard NIET deleteOrphans: een stale snapshot mag NOOIT een net-toegevoegde
   * conversation uit de DB wissen. Alleen `purgeLegacySeedConversations` zet expliciet
   * `deleteOrphans: true` (zie hieronder).
   *
   * De per-conv message-rewrite zit onder dezelfde mutex als `updateConversationAtomic`
   * zodat een verouderde snapshot tijdens een gelijktijdige POST-flow geen
   * net-toegevoegde locked-photo message kan overschrijven.
   */
  await saveConversationsRelational(admin, normalized, {
    withConversationLock: <T>(conversationId: string, fn: () => Promise<T>) =>
      withConversationLock(conversationId, fn),
  });
}

/** Expliciete variant voor legacy cleanup paden (bv. seed-purge). */
async function saveListWithOrphanCleanup(list: Conversation[]): Promise<void> {
  const normalized = normalizeConversationMessages(list);
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("Conversations kunnen niet worden opgeslagen: Supabase admin client ontbreekt.");
  }
  await saveConversationsRelational(admin, normalized, {
    withConversationLock: <T>(conversationId: string, fn: () => Promise<T>) =>
      withConversationLock(conversationId, fn),
    deleteOrphans: true,
  });
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

/**
 * Per-conversation mutex zodat load → mutate → save strict gesequentialiseerd is per id.
 *
 * Zonder mutex kunnen twee parallelle calls elkaars wijzigingen kwijtraken: `saveSingleConversationRelational`
 * doet `DELETE FROM messages WHERE conversation_id = X` gevolgd door `INSERT` van wat in zijn snapshot
 * stond. Bij overlappende load→save windows verdwijnen messages (o.a. de locked-photo message die net
 * door een andere call werd toegevoegd) → "Foto niet gevonden" bij unlock.
 */
const conversationMutexChain = new Map<string, Promise<unknown>>();

async function withConversationLock<T>(
  conversationId: string,
  fn: () => Promise<T>
): Promise<T> {
  const prev = conversationMutexChain.get(conversationId) ?? Promise.resolve();
  /** Zelf eerst `prev` afmaken; daarna wint deze caller de exclusieve lock. */
  const run = prev.then(fn, fn);
  /** Volgende caller wacht op deze run (success én failure → daarna mogen ze door). */
  const chain = run.catch(() => undefined);
  conversationMutexChain.set(conversationId, chain);
  try {
    return await run;
  } finally {
    /** Pas opruimen als wij nog de laatste in de keten zijn — anders verstoren we volgende callers. */
    if (conversationMutexChain.get(conversationId) === chain) {
      conversationMutexChain.delete(conversationId);
    }
  }
}

async function updateConversationAtomic(
  conversationId: string,
  mutate: (conv: Conversation) => Promise<void> | void
): Promise<Conversation> {
  return withConversationLock(conversationId, async () => {
    const latestConv = await loadNormalizedConversationById(conversationId);
    if (!latestConv) throw new Error("Gesprek niet gevonden");
    await mutate(latestConv);
    const admin = getSupabaseAdmin();
    if (!admin) {
      throw new Error("Conversations kunnen niet worden opgeslagen: Supabase admin client ontbreekt.");
    }
    await saveSingleConversationRelational(admin, latestConv);
    return latestConv;
  });
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

/** Inbox toont alleen threads waar jij minstens één keer iets hebt gestuurd (geen alleen-bot spam). */
function conversationOwnerHasSentUserMessage(c: Conversation): boolean {
  return c.messages.some((m) => m.role === "user");
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

function inboxLastActivityIsoForSummary(c: Conversation): string {
  const sorted =
    c.messages.length === 0 ? [] : sortChatMessagesChronologically(c.messages);
  const last = sorted[sorted.length - 1];
  if (last?.createdAt) return last.createdAt;
  return c.threadCreatedAt ?? c.updatedAt;
}

function inboxLastActivityMs(c: Conversation): number {
  return new Date(inboxLastActivityIsoForSummary(c)).getTime();
}

export async function listSummaries(ownerUserId: string | null): Promise<ConversationSummary[]> {
  const mapRow = (c: Conversation): ConversationSummary => {
    const sorted =
      c.messages.length === 0 ? [] : sortChatMessagesChronologically(c.messages);
    const last = sorted[sorted.length - 1];
    const lastMessage = inboxPreviewLastLine(last);
    const lastActivityIso = inboxLastActivityIsoForSummary(c);
    return {
      id: c.id,
      profileId: c.profileId,
      profileName: c.profileName,
      previewAvatar: c.previewAvatar,
      lastMessage,
      /** Laatste regel in de thread (na sorteren op tijd), of van jou of van haar. */
      lastMessageFromAssistant: last?.role === "assistant",
      timestamp: last ? timeLabel(last.createdAt) : "",
      updatedAt: lastActivityIso,
      unread: 0,
      isOnline: summaryOnlineState(c),
    };
  };

  if (ownerUserId) {
    /** Geen inbox-automatisering hier: elke GET zette applyNoReplyFollowups op veel threads → oude “ghost” chats. */
    const list = await hydrateConversationsPreviewAvatars(
      enforceUniqueConversationAvatars(await loadList())
    );
    // Toon alle gesprekken van deze gebruiker (inclusief net geopende "Vraag om foto" chats met 0 berichten).
    // We willen geen lege legacy seed-chats tonen, maar wél user-gesprekken die nog geen bericht hebben.
    const mine = list.filter((c) => c.ownerUserId === ownerUserId);
    return mine
      .sort((a, b) => inboxLastActivityMs(b) - inboxLastActivityMs(a))
      .map(mapRow);
  }

  await ensureSeedConversations();
  const list = await hydrateConversationsPreviewAvatars(
    enforceUniqueConversationAvatars(await loadList())
  );
  const guest = list.filter((c) => !c.ownerUserId);
  return guest
    .sort((a, b) => inboxLastActivityMs(b) - inboxLastActivityMs(a))
    .map(mapRow);
}

export async function getConversation(
  id: string,
  ownerUserId: string | null
): Promise<Conversation | null> {
  if (ownerUserId) {
    await recordOwnerPolledConversation(id, ownerUserId);
    /**
     * Flush pending deliveries voor DEZE conversation zodat de 10-60s text-reply
     * en 60-180s photo-bubble verschijnen zonder dat de user een nieuw bericht
     * hoeft te sturen. Lichtgewicht (één conv via mutex, geen full inbox-scan).
     */
    await flushSingleConversationAutomations(id, ownerUserId).catch(() => {});
  }
  /** Zelfde laadpad als `unlockAssistantPhoto` / `updateConversationAtomic` — geen `loadList()` + andere normalisatie. */
  const c = await loadNormalizedConversationById(id);
  if (!c) return null;
  if (c.ownerUserId) {
    if (ownerUserId !== c.ownerUserId) return null;
  } else if (ownerUserId) {
    return null;
  }
  return hydrateSingleConversationPreviewFromProfile(c);
}

/**
 * Per-conversation variant van `flushInboxAutomationsForOwner`. Voert alleen
 * automations uit die geen `loadList()` nodig hebben — perfect voor 5s polling
 * vanaf de chatpagina.
 */
async function flushSingleConversationAutomations(
  conversationId: string,
  ownerUserId: string
): Promise<void> {
  try {
    await updateConversationAtomic(conversationId, async (latestConv) => {
      if (latestConv.ownerUserId !== ownerUserId) return;
      const arr = [latestConv];
      applyPendingAssistantReply(arr, ownerUserId);
      applyPendingLockedPhotoDeliveries(arr, ownerUserId);
      applyPendingLockedPhotoNudges(arr, ownerUserId);
      applyNoReplyFollowups(arr, ownerUserId);
    });
  } catch (e) {
    console.warn(
      `[flushSingleConv] conv=${conversationId} skipped:`,
      e instanceof Error ? e.message : e
    );
  }
}

export type ProfilePortfolioItem = {
  conversationId: string;
  messageId: string;
  createdAt: string;
  /** Persistent publieke Supabase Storage URL, indien beschikbaar. */
  imageUrl?: string;
};

export type PurchasedPhotoItem = {
  conversationId: string;
  messageId: string;
  createdAt: string;
  unlockedAt: string;
  profileId: string;
  profileName: string;
  /** Persistent publieke Supabase Storage URL, indien beschikbaar. */
  imageUrl?: string;
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
      if (m.role !== "assistant" || !(m.imageFile || m.imageUrl)) continue;
      const ts = new Date(m.createdAt).getTime();
      if (!Number.isFinite(ts) || ts < cutoffMs) continue;
      out.push({
        conversationId: c.id,
        messageId: m.id,
        createdAt: m.createdAt,
        imageUrl: m.imageUrl?.trim() || undefined,
      });
    }
  }
  out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return out.slice(0, 80);
}

export async function listPurchasedPhotosForOwner(ownerUserId: string): Promise<PurchasedPhotoItem[]> {
  if (!ownerUserId.trim()) return [];
  const list = await loadList();
  const out: PurchasedPhotoItem[] = [];
  for (const c of list) {
    if (c.ownerUserId !== ownerUserId) continue;
    for (const m of c.messages) {
      if (
        m.role !== "assistant" ||
        !(m.imageFile || m.imageUrl) ||
        !m.photoLock?.unlockedAt
      ) {
        continue;
      }
      out.push({
        conversationId: c.id,
        messageId: m.id,
        createdAt: m.createdAt,
        unlockedAt: m.photoLock.unlockedAt,
        profileId: c.profileId,
        profileName: c.profileName,
        imageUrl: m.imageUrl?.trim() || undefined,
      });
    }
  }
  out.sort((a, b) => new Date(b.unlockedAt).getTime() - new Date(a.unlockedAt).getTime());
  return out;
}

/**
 * ensureUserInboxForOwner is DISABLED.
 * We no longer pre-create empty conversation threads for every profile.
 * The inbox only shows conversations the user has explicitly started
 * (via "Vraag om foto" or sending the first message).
 */
export async function ensureUserInboxForOwner(_ownerUserId: string): Promise<void> {
  // Intentionally left empty — no more auto-seeding of all profiles.
  return;
}

/** Definitief verwijderen van legacy seed/local chats (zonder ownerUserId). */
export async function purgeLegacySeedConversations(_ownerUserId: string): Promise<void> {
  const list = await loadList();
  const filtered = list.filter((c) => Boolean(c.ownerUserId));
  if (filtered.length !== list.length) {
    /** Legitiem orphan-delete pad: we willen de legacy seed-rijen echt wissen. */
    await saveListWithOrphanCleanup(filtered);
  }
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

  /**
   * Hot path: gericht 1 conversation ophalen i.p.v. de hele inbox (alle users + alle
   * messages) opnieuw te laden + terug te schrijven. Dat was de oorzaak van trage
   * "Vraag om foto"-flows en de 10s frontend AbortController timeout op de eerste
   * chat voor nieuwe gebruikers.
   */
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("Chat database is niet beschikbaar. Probeer het later opnieuw.");
  }

  const [profile, ownerRecord, ownerFk] = await Promise.all([
    resolveProfileById(profileId),
    findUserById(ownerUserId),
    resolveUserIdForSupabaseFk(ownerUserId),
  ]);
  if (!profile) throw new Error("Profiel niet gevonden");
  if (!ownerRecord) {
    throw new Error("Je sessie is verlopen — log opnieuw in.");
  }
  if (!ownerFk) {
    throw new Error("Account synchronisatie mislukt — probeer opnieuw in te loggen.");
  }

  const existing = await loadConversationByOwnerAndProfile(admin, ownerFk, profileId);
  if (existing) {
    return enforceUniqueConversationAvatars(normalizeConversationMessages([existing]))[0]!;
  }

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
    threadCreatedAt: now,
  };

  await withConversationLock(conv.id, () =>
    saveSingleConversationRelational(admin, conv)
  );
  return conv;
}

export async function appendAssistantOutboundForOwner(params: {
  ownerUserId: string;
  profileId: string;
  content: string;
  replyToId?: string;
  /** Geen automatische “offline nieuw bericht”-mail (bv. bij geplande dagelijkse reactivation-mail). */
  skipOfflineAssistantEmail?: boolean;
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
  if (!params.skipOfflineAssistantEmail) {
    void maybeSendOfflineAssistantEmail(conversation.id, message);
  }
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
export async function flushInboxAutomationsForOwner(ownerUserId: string): Promise<void> {
  const list = await loadList();
  const user = await findUserById(ownerUserId);

  /**
   * Dedupe is cross-conversation (vereist saveList) — alleen voor legacy data en zeldzaam.
   * Voer apart uit, en doe de bulk save via dezelfde per-conv lock (zie saveList).
   */
  if (dedupeDuplicateOwnerConversationsInPlace(list, ownerUserId)) {
    await saveList(list);
  }

  /**
   * Andere automations werken per conv. We doen ze via `updateConversationAtomic`
   * zodat ze in dezelfde per-conv mutex zitten als de POST messages flow — dat voorkomt
   * race conditions waarbij een verouderde snapshot een net-toegevoegde locked-photo
   * message terug naar Postgres zou wegschrijven ("Foto niet gevonden" bij unlock).
   *
   * Iedere apply-functie is idempotent en filtert zelf op zijn trigger-condition,
   * dus we kunnen ze veilig op een fresh-loaded single-conv array uitvoeren.
   */
  const candidateConvIds = list
    .filter((c) => c.ownerUserId === ownerUserId)
    .map((c) => c.id);

  for (const convId of candidateConvIds) {
    try {
      await updateConversationAtomic(convId, async (latestConv) => {
        const arr = [latestConv];
        applyPendingAssistantReply(arr, ownerUserId);
        applyPendingLockedPhotoDeliveries(arr, ownerUserId);
        applyPendingLockedPhotoNudges(arr, ownerUserId);
        applyNoReplyFollowups(arr, ownerUserId);
        if (user) {
          applyNoPurchaseGiftForUser(arr, ownerUserId, user);
          applyCreditsExhaustedNudgeForUser(arr, ownerUserId, user);
        }
      });
    } catch (e) {
      console.warn(`[flushInbox] conv=${convId} skipped:`, e instanceof Error ? e.message : e);
    }
  }
}

/**
 * Realistische pauze (10-60s) tussen een user-bericht en het profiel-antwoord.
 * Gebruikt voor alle text replies van het profiel zodat het minder bot-achtig voelt.
 */
function randomAssistantReplyDelayMs(): number {
  return 10_000 + Math.floor(Math.random() * 50_001); // 10000..60000
}

/**
 * Realistische pauze (60-180s) voordat het locked-photo bericht in de chat verschijnt
 * (het profiel "maakt de foto"). Tijdens deze wachttijd kan de user gewoon doorchatten.
 */
function randomPhotoDeliveryDelayMs(): number {
  return 60_000 + Math.floor(Math.random() * 120_001); // 60000..180000
}

/**
 * Levert gequeued profiel-tekstantwoord(en) na hun timer. Wordt aangeroepen door
 * `flushInboxAutomationsForOwner` op iedere inbox-poll/GET.
 */
function applyPendingAssistantReply(list: Conversation[], ownerUserId: string): boolean {
  const now = Date.now();
  const due = list
    .filter(
      (c) =>
        c.ownerUserId === ownerUserId &&
        c.pendingAssistantReplyAt &&
        c.pendingAssistantReply &&
        c.pendingAssistantReply.messages.length > 0 &&
        now >= new Date(c.pendingAssistantReplyAt).getTime()
    )
    .sort((a, b) => {
      const ta = new Date(a.pendingAssistantReplyAt!).getTime();
      const tb = new Date(b.pendingAssistantReplyAt!).getTime();
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });

  const conv = due[0];
  const queued = conv?.pendingAssistantReply;
  if (!conv || !queued) return false;

  const baseMs = now;
  const messagesToAdd: ChatMessage[] = queued.messages.map((m, idx) => ({
    id: m.id,
    role: "assistant",
    content: m.content,
    createdAt: new Date(baseMs + idx * 850).toISOString(),
    ...(m.replyToId ? { replyToId: m.replyToId } : {}),
    ...(m.typingEvents ? { typingEvents: m.typingEvents } : {}),
  }));

  conv.messages = [...conv.messages, ...messagesToAdd];
  const tail = messagesToAdd[messagesToAdd.length - 1]!;
  conv.updatedAt = tail.createdAt;
  conv.pendingAssistantReplyAt = undefined;
  conv.pendingAssistantReply = undefined;
  conv.realismState = conv.realismState
    ? {
        ...conv.realismState,
        lastReplyAt: tail.createdAt,
        messagesSinceLastReply: 0,
        energy: Math.min(100, (conv.realismState.energy ?? 60) + 15),
      }
    : conv.realismState;
  scheduleNoReplyReminderAfterAssistant(conv, tail.id);
  void maybeSendOfflineAssistantEmail(conv.id, messagesToAdd[0]!);
  return true;
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

/** NL chat: model zegt soms "voice"; in de app heet dat overal spraakbericht. */
function normalizeDutchVoiceWording(text: string): string {
  let t = text;
  if (!t) return t;
  t = t.replace(/\bvoice\s*-?\s*memo('s|s)?\b/gi, "spraakbericht");
  t = t.replace(/\bvoice\s*-?\s*note('s|s)?\b/gi, "spraakbericht");
  t = t.replace(/\been\s+voice\b/gi, "een spraakbericht");
  t = t.replace(/\bje\s+een\s+voice\b/gi, "je een spraakbericht");
  t = t.replace(/\bme\s+een\s+voice\b/gi, "me een spraakbericht");
  t = t.replace(/\bme\s+voice\b/gi, "me een spraakbericht");
  t = t.replace(/\bnaar\s+een\s+voice\b/gi, "naar een spraakbericht");
  t = t.replace(/\bmet\s+een\s+voice\b/gi, "met een spraakbericht");
  t = t.replace(/\bvoicebericht(en)?\b/gi, "spraakbericht");
  t = t.replace(/\bvoice(s)?\b/gi, "spraakbericht");
  return t.replace(/spraakbericht\s+spraakbericht/gi, "spraakbericht");
}

function cleanTeaseLine(text: string, fallback: string): string {
  const clean = normalizeDutchVoiceWording(
    text
      .replace(/\s+/g, " ")
      .replace(/\bontgrendel(en)?\b/gi, "")
      .replace(/\bunlock(ed)?\b/gi, "")
      .trim()
  );
  if (!clean) return normalizeDutchVoiceWording(fallback);
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
          "Belangrijk: zij stuurt zelf geen audio; ze vraagt alleen of hij een spraakbericht wil sturen (niet zeggen 'voice' of 'voice memo').",
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
          "Belangrijk: zij stuurt zelf geen audio; ze vraagt alleen of hij een spraakbericht wil sturen (niet zeggen 'voice' of 'voice memo').",
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
    const clean = normalizeDutchVoiceWording(ai.replace(/\s+/g, " ").trim());
    if (!clean) return "hihi wat vind je precies geil dan? pose, outfit of close-up? 😘";
    return clean.slice(0, 180);
  } catch {
    return "hihi wat vind je precies geil dan? pose, outfit of close-up? 😘";
  }
}

/** True when the chat clearly asks for visible writing (name on skin, note, etc.). */
function conversationWantsVisibleHandwrittenText(
  mergedIntent: string,
  assistantLine: string,
  recentTranscript: string,
  viewerFirstName?: string | null
): boolean {
  const blob = [mergedIntent, assistantLine, recentTranscript]
    .map((s) => (s || "").toLowerCase())
    .join("\n");
  if (
    /\bnaam\b|schrijf|schrijven|opschrijf|opschrift|tekst|briefje|note|marker|lipstift|lipstick|eyeliner|body writing|op je lijf|op het lijf|op mijn lijf|op je huid|getatoe|tattoo|tatoeage|geschreven|ijschrift/.test(
      blob
    )
  ) {
    return true;
  }
  const n = (viewerFirstName || "").trim().toLowerCase();
  if (n.length >= 2 && blob.includes(n)) return true;
  if (/jouw naam|mijn naam|zijn naam|haar naam|name on|write my name|with my name/.test(blob)) return true;
  return false;
}

/** User explicitly wants to see her face (otherwise we default to no visible face per platform rules). */
function userExplicitlyRequestsFaceVisible(text: string): boolean {
  const t = (text || "").toLowerCase();
  return /\b(gezicht|face\b|hoofd\b|portret|ogen\b|glimlach|smile|headshot|full face|zie je gezicht|laat.*gezicht|show.*face|met gezicht|with face|gezicht laten zien)/i.test(
    t
  );
}

/** Messy bedroom vibe when the scene is clearly intimate / indoor private. */
function wantsMessyBedroomSetting(text: string): boolean {
  const t = (text || "").toLowerCase();
  return /\b(bed|slaapkamer|bedroom|spiegel|mirror|liggen|op bed|onder de dekens|naakt|lingerie|op je kamer|in je kamer)/i.test(
    t
  );
}

/**
 * Bare commands like "maak de foto" / "doe maar" / "stuur" — wel niet-vaag voor de chat-flow
 * (we sturen dan een foto), maar bevatten **geen** visuele details. Voor de fotoprompt zelf
 * willen we dan terugvallen op de laatste concrete user-message met outfit/pose/body.
 */
function isBareDeliveryCommand(text: string): boolean {
  const t = (text || "").toLowerCase().replace(/[!?.,]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (t.length > 30) return false;
  return (
    /^\s*(maak|stuur|doe|kom op|maak hem|maak m|maak 'm|doe maar|maak hem maar|maak de foto|stuur de foto|doe het|nu maar|dan maar)(\s+(de|die|het|hem|m|'m|deze|dan|maar))*(\s+(foto|selfie|pic|picture|plaatje))?\s*$/i.test(
      t
    ) || /^(ja|jaa|jaaa|doe|ok[eé]?|oke|prima|graag|tuurlijk)\s*$/i.test(t)
  );
}

function extractBestConcretePhotoDirective(cycleIntent: string, latestUserRequest: string): string {
  const latest = (latestUserRequest || "").replace(/\s+/g, " ").trim();

  const cycleLines = (cycleIntent || "")
    .split(/\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .reverse(); // newest first

  /**
   * Als de laatste user-message een kale "maak de foto"-achtige is, zoek dan eerst
   * in het cycle intent (eerdere user-messages) naar een echte visuele wens — die is
   * vele malen rijker dan "maak de foto".
   */
  if (latest && isBareDeliveryCommand(latest)) {
    for (const line of cycleLines) {
      if (line === latest) continue;
      if (isBareDeliveryCommand(line)) continue;
      if (CONCRETE_PHOTO_INTENT_REGEX.test(line.toLowerCase())) {
        return line;
      }
    }
    return latest;
  }

  // If the very last user message is concrete, use it (highest priority)
  if (latest && !isVagueUserPhotoReply(latest)) {
    return latest;
  }

  for (const line of cycleLines) {
    if (CONCRETE_PHOTO_INTENT_REGEX.test(line.toLowerCase())) {
      return line;
    }
  }

  // Fallback: if latest is short and mentions photo/selfie, still use it
  if (latest && /\b(selfie|foto|naakt|naakte|naaktfoto)\b/i.test(latest)) {
    return latest;
  }

  return latest || cycleLines[0] || "";
}

type PhotoBodyRegionHint =
  | "breasts"
  | "breasts_pelvis"
  | "butt"
  | "pelvis"
  | "full_body"
  | "generic";

/**
 * Detecteert een expliciete **pose / actie** uit de wens (bv. "string in je mond",
 * "vinger in je mond", "hand op je tieten", "knielend", "lik aan…", "voor de spiegel").
 *
 * Waarom dit nodig is: onze body-region heuristiek pakt het kledingstuk ("string")
 * en stuurt dan op een heup-framing — maar als de user vraagt "kan je je string in je
 * mond doen", dan is dit een **pose** waarbij de string NIET op haar heupen zit maar
 * tussen haar tanden. De heuristic framing zou de actie wegdrukken.
 *
 * Bij detected pose → bodyRegion blijft `generic` (geen automatische region-lock),
 * en Grok krijgt de pose-zin als hoogste-prioriteit constraint mee zodat hij de
 * juiste framing kiest voor de actie.
 *
 * Retourneert de letterlijke Nederlandse pose-zin (klein stukje rond de match) of
 * `null` als er geen expliciete pose is.
 */
function detectExplicitPhotoPose(intentBlob: string): string | null {
  const t = (intentBlob || "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  /**
   * Patronen die een **pose / actie** beschrijven (niet alleen kleding/kleur/region).
   * We matchen op een venster van ~80 tekens rond de hit zodat de exacte zin meegegeven
   * kan worden aan Grok.
   */
  const posePatterns: RegExp[] = [
    // "X in je/de mond doen / stoppen / houden", "lik aan X", "X tussen je tanden"
    /\b(string|stringetje|slipje|panty|panties|thong|vinger|vingers|tepel|tepels|tong|lolly|lollipop|ijsje|banaan|fles|fruit|sigaret|kledingstuk|bh)\b[^.!?]{0,30}\b(in je|in de|tussen|aan je)\b[^.!?]{0,20}\b(mond|lippen|tanden|tong)\b/i,
    /\b(je|de)\s+(mond|lippen|tong)\s+(om|rond|tegen)\b[^.!?]{0,40}/i,
    /\blik(t|ken|kend)?\b[^.!?]{0,30}/i,
    /\bzuig(en|t|end)?\b[^.!?]{0,30}/i,
    /\bbijt(en|t)?\s+op\s+(je|de)\s+(lip|lippen|onderlip|string)/i,
    // "hand op je tieten/borsten/buik/billen/heupen", "handen achter je hoofd"
    /\b(hand|handen|vinger|vingers)\b[^.!?]{0,15}\b(op|onder|tussen|tegen|achter|in)\b[^.!?]{0,20}\b(tieten|borsten|buik|billen|kont|heupen|hoofd|nek|haar|mond|lippen|kruis|kut|poes|tepels)\b/i,
    /\b(handen|hand)\s+(omhoog|achter je hoofd|op je hoofd|in je haar)\b/i,
    // Knie / kruip / liggend / leunend / op handen en knieën
    /\b(knielend|knielen|op je knie[eë]n|kniel)\b/i,
    /\b(op (handen en knie[eë]n|all fours)|doggy(\s?style)?|cowgirl|spread)\b/i,
    /\b(liggend op (je|de) (rug|buik|zij)|languit op (je|t) bed|gespreid)\b/i,
    /\b(leunend (tegen|over)|hangend over)\b[^.!?]{0,30}/i,
    // Spiegel / pose voor de camera / vooroverbuigen / strekken / poseren
    /\b(voor de spiegel|in de spiegel|spiegelfoto|spiegel(selfie)?)\b/i,
    /\b(vooroverbuigen|bukken|gebogen|gehurkt|hurken|gestrekt|strekken|rekken|tilt? je been|been omhoog|benen omhoog|gespreide benen)\b/i,
    /\b(poseren|pose|poseer|poseert)\b/i,
    // Specifieke seksuele poses/acties die de framing dicteren
    /\b(borst(en)? omhoog (duwen|drukken)|tieten (omhoog|samen) (drukken|knijpen)|knijpen in je (tieten|borsten|tepels))\b/i,
    /\b(string|slipje|broekje)\b[^.!?]{0,15}\b(opzij\s+(trekken|schuiven|duwen)|naar beneden trekken|omlaag trekken|optrekken)\b/i,
    /\b(open mond|mond open|tong uit|tong uitsteken)\b/i,
    /\b(kus(je)?|kus(sen|t)?\b)\b[^.!?]{0,20}\b(naar|voor) (de )?camera\b/i,
    /\b(naar (de )?camera kijken|recht in de camera|kijkt? recht in de lens)\b/i,
  ];
  for (const re of posePatterns) {
    const m = re.exec(t);
    if (m) {
      const start = Math.max(0, m.index - 20);
      const end = Math.min(t.length, m.index + m[0].length + 30);
      return t.slice(start, end).trim();
    }
  }
  return null;
}

/** Wardrobe-only term zoals jurk/jurkje/bodysuit — vraagt om full-body / knee-up framing. */
function intentMentionsFullOutfitGarment(t: string): boolean {
  return /\b(jurk|jurkje|jurkjes|dress|bodysuit|bodystocking|jumpsuit|catsuit|rompertje|romper|bikini|badpak|setje|set|lingerie|outfit|outfitje|negligé|negligee|babydoll|teddy|kanten setje|kant ?setje|sportoutfit|sportpak|trainingspak|cocktailjurk|avondjurk|mini ?dress|maxi ?dress)\b/i.test(
    t
  );
}

function inferPhotoBodyRegion(intentBlob: string): PhotoBodyRegionHint {
  const t = intentBlob.toLowerCase();
  const thongish =
    /\b(strings?|thong|g-?strings?|tangas?|tanga|minislip|minibroekje|slipje|panty|panties)\b/i.test(
      t
    );
  const wantsChest = /\b(tieten|borsten|tepels|nipples|borst|bh|beha|topless|blote tieten)\b/i.test(
    t
  );
  const explicitRearAngle = /\b(van achter|achterkant|from behind|achterwerk|rug\b|rear\b|from back)\b/i.test(
    t
  );

  if (thongish && explicitRearAngle) {
    return "butt";
  }
  if (thongish && wantsChest) {
    return "breasts_pelvis";
  }
  if (thongish) {
    return "pelvis";
  }
  if (
    /\b(tieten|borsten|boobs|tits|tepels|nipples|borst|bovenlijf|bovenlichaam|borstkas|torso\b|decolett|decollet|cleavage|chest\b|rack\b|meloenen)/i.test(
      t
    )
  ) {
    return "breasts";
  }
  if (
    /\b(kont|billen|achterkant|doggy|butt\b|ass\b|achterwerk|from behind|rug\b)\b/i.test(t)
  ) {
    return "butt";
  }
  /**
   * Wardrobe-only wens zonder body-deel keyword (jurkje, bodysuit, …) → full_body.
   * Anders pakt het model dit standaard op als headshot omdat het identity-blok gezicht-zwaar is.
   */
  if (intentMentionsFullOutfitGarment(t)) {
    return "full_body";
  }
  return "generic";
}

/** Hoeveel kleding er nog aan is (volgens user-wens). Sturen we hard mee in de scene-prompt zodat ZModel niet "veiligheidshalve" kleding bijverzint. */
type PhotoNudityLevel =
  | "fully_nude"
  | "topless"
  | "bottomless"
  | "lingerie"
  | "thong_focus"
  | "sheer_outfit"
  | "underwear"
  | "unspecified";

function inferNudityLevel(intentBlob: string): PhotoNudityLevel {
  const t = (intentBlob || "").toLowerCase();

  /**
   * Volgorde is bewust: eerst kijken of er een **lichaamsdeel-kwalificatie** aanwezig is
   * (bovenlijf / onderlijf / specifiek kledingstuk), zodat "bovenlijf zonder iets aan"
   * → topless wordt geklasseerd i.p.v. fully_nude.
   */

  // 1) Topless: bovenlijf bloot OF specifieke bovenkleding uit
  const topless =
    /\btopless\b/.test(t) ||
    /\bshirtless\b/.test(t) ||
    /\b(bovenlijf|bovenlichaam|borstkas|torso|chest)\b[^.,;\n]{0,40}\b(zonder|bloot|naakt|bare|naked|nude|niets|niks|geen)\b/.test(t) ||
    /\b(zonder|geen|no)\b[^.,;\n]{0,40}\b(shirt|t-?shirt|trui|top|bh|bra|beha|hemd|bloesje|bloesie|topje)\b/.test(t) ||
    /\b(trek|doe|haal)\b[^.,;\n]{0,24}\b(shirt|t-?shirt|trui|top|bh|bra|beha|hemd|bloesje|bloesie|topje)\b[^.,;\n]{0,16}\b(uit|weg|af|los)\b/.test(t) ||
    /\b(borsten|tieten|tepels|nipples|boobs|tits)\b[^.,;\n]{0,40}\b(bloot|naakt|zichtbaar|visible|uit|out|vrij|laten zien|zien)\b/.test(t) ||
    /\b(laat|toon|zie|met)\b[^.,;\n]{0,30}\b(borsten|tieten|tepels|boobs|tits|nipples)\b/.test(t);

  // 2) Bottomless: onderlijf bloot OF specifieke onderkleding uit
  const bottomless =
    /\bbottomless\b/.test(t) ||
    /\b(onderlijf|onderlichaam|kruis)\b[^.,;\n]{0,40}\b(zonder|bloot|naakt|niets|niks|geen)\b/.test(t) ||
    /\b(zonder|geen|no)\b[^.,;\n]{0,40}\b(broek|spijkerbroek|jeans|rok|slip|slipje|onderbroek|panty|panties|string|thong)\b/.test(t) ||
    /\b(trek|doe|haal)\b[^.,;\n]{0,24}\b(broek|spijkerbroek|jeans|rok|slip|slipje|onderbroek|panty|string|thong)\b[^.,;\n]{0,16}\b(uit|weg|af|los)\b/.test(t);

  if (topless && bottomless) return "fully_nude";
  if (topless) return "topless";
  if (bottomless) return "bottomless";

  // 3) Heel expliciet helemaal naakt
  if (
    /\b(volledig|helemaal|compleet|geheel|spier|poedel|moeder)\s*(naakt|bloot|nude|naked)\b/.test(t) ||
    /\b(in\s+(mijn|m'n|je|haar)\s+(blootje|nakie))\b/.test(t) ||
    /\b(spiernaakt|poedelnaakt|moedernaakt)\b/.test(t) ||
    /\b(geen kleren|zonder kleren|zonder iets aan|niets aan|niks aan|zonder alles aan)\b/.test(t) ||
    /\b(trek|doe|haal)\b[^.,;\n]{0,24}\b(alles|al je kleren|al je kleding|al je spullen)\b[^.,;\n]{0,16}\b(uit|weg|af)\b/.test(t) ||
    /\b(fully naked|fully nude|completely nude|completely naked|stark naked|in the nude)\b/.test(t)
  ) {
    return "fully_nude";
  }

  // 4) Standalone "naakt" / "bloot" / "nude" / "naked" → fully nude
  if (/\b(naakt|naakte|naaktfoto|nude|naked|bloot|onbedekt|ontkleed|ontkled|uitgekleed)\b/.test(t)) {
    return "fully_nude";
  }

  // 5) Lingerie / setje
  if (/\b(lingerie|negligé|negligee|babydoll|teddy|corset|kanten|kant ?setje|setje|lingerie ?set)\b/.test(t)) {
    return "lingerie";
  }

  // 5b) String / thong / tanga — apart van brede lingerie: model moet heupen tonen, geen head-only
  if (/\b(strings?|thong|g-?strings?|tangas?|tanga|minislip|minibroekje)\b/i.test(t)) {
    return "thong_focus";
  }

  // 5c) Doorschijnend / transparant / see-through — kledingstuk is wel aanwezig maar laat de huid zien
  if (
    /\b(doorschijnend|doorschijnende|doorzichtig|doorzichtige|transparant|transparante|see[- ]?through|sheer|mesh|netstof|net|wet ?look|nat shirt|nat hemd|nat top|nat ?t-?shirt)\b/i.test(
      t
    )
  ) {
    return "sheer_outfit";
  }

  // 6) Plain ondergoed
  if (/\b(ondergoed|underwear|in\s+(je|haar)\s+bh|in\s+(je|haar)\s+slipje)\b/.test(t)) {
    return "underwear";
  }

  return "unspecified";
}

/**
 * Strikte kledings-instructie voor het image-model. Komt náást de framing-regel, zodat
 * z-image niet uit zichzelf "veiligheidshalve" een topje of beha bij verzint wanneer de
 * user expliciet vraagt om naakt of bovenlijf bloot.
 *
 * We zeggen *niet* dat handen/armen niet mogen bedekken: gebruiker kan juist vragen om
 * "handen voor je tieten". Alleen kledingstukken moeten ontbreken.
 */
function buildNudityRuleForPhoto(level: PhotoNudityLevel): string {
  switch (level) {
    case "fully_nude":
      return "Subject is fully nude completely naked NO clothing of any kind NO bra NO panties NO underwear NO lingerie NO shirt NO top NO pants NO skirt NO socks no garment covering any part of the body bare skin visible everywhere; do not invent clothing the user did not ask for.";
    case "topless":
      return "Subject is topless: NO bra NO top NO shirt NO trui NO hemd on the upper body; bare breasts and nipples visible (unless user explicitly asked for hands or arms over chest); lower body only clothed if the user's request implies it.";
    case "bottomless":
      return "Subject is bare from the waist down: NO pants NO skirt NO panties NO underwear NO slipje on the lower body; upper body only clothed if the user's request implies it.";
    case "lingerie":
      return "Subject wears matching lingerie set as user described (bra and panties or set), nothing more; not fully nude; bra and panties clearly visible.";
    case "thong_focus":
      return "Subject wears the exact underwear the user asked for (thin thong G-string or panties); thong must be fully visible on hips and pelvis in frame thin side straps and front triangle fabric clearly visible; if user named a color (yellow orange pink red black white blue green purple) the garment MUST visibly match that color; no trousers no skirt over it bare midriff; do NOT deliver a head-only or shoulders-only portrait when the user asked for string thong or slip.";
    case "sheer_outfit":
      return "Subject wears the exact sheer translucent garment the user asked for (sheer dress, mesh top, see-through fabric); the fabric is visibly transparent so skin or underwear shows through — body shape and skin tone visible through the fabric; do NOT replace with an opaque dress or solid cover-up; do NOT deliver a head-only or shoulders-only portrait when the garment is the whole point of the shot.";
    case "underwear":
      return "Subject wears plain everyday underwear (bra + panties) as user described, no outerwear over it; not fully nude.";
    case "unspecified":
    default:
      return "";
  }
}

function buildFramingRuleForPhoto(showFace: boolean, region: PhotoBodyRegionHint): string {
  if (showFace) {
    return "Include face only because user asked for face or portrait; one continuous smartphone photograph.";
  }
  if (region === "breasts_pelvis") {
    return "Mirror or handheld smartphone selfie framing from upper chest through hips and upper thighs so BOTH breasts or cleavage AND the requested underwear at the hips are clearly visible in ONE continuous shot NOT a tight face-only crop NOT cropped above the waist.";
  }
  if (region === "pelvis") {
    return "Mirror or handheld smartphone selfie: frame MUST include mid-belly through upper thighs so the thong G-string or panties is fully visible on hips and pelvis fabric and straps clearly shown NOT a head-only portrait NOT shoulders-up stock headshot one continuous photograph.";
  }
  if (region === "breasts") {
    return "Do NOT show face unless user asked; FRONT torso or mirror selfie clearly showing the chest and breasts area; NOT a rear-only or butt-focused shot NOT a face-only headshot; one continuous smartphone photograph.";
  }
  if (region === "butt") {
    return "Camera angle from behind or via mirror reflection so the buttocks are the centerpiece of the frame; body shown from upper thighs through lower back; one continuous smartphone photograph.";
  }
  if (region === "full_body") {
    return "Vertical mirror selfie or handheld smartphone framing from at least mid-thigh through head — knee-up or full-body shot so the requested garment is fully visible in the frame; NOT a face-only headshot, NOT cropped at the shoulders; one continuous smartphone photograph.";
  }
  return "Do NOT show face unless user asked; match the user request with handheld or mirror amateur framing; avoid unrelated head-only portrait; one continuous smartphone photograph.";
}

/** Verzamelt de in de user-wens genoemde kledingkleuren (Engels), in volgorde van voorkomen. */
function extractRequestedGarmentColors(intentBlob: string): string[] {
  const t = (intentBlob || "").toLowerCase();
  if (
    !/\b(strings?|thong|tangas?|tanga|minislip|slipje|panty|panties|lingerie|bh|beha|ondergoed|jurk|jurkje|rok|broek|topje|shirt|trui|bikini|badpak)\b/i.test(
      t
    )
  ) {
    return [];
  }
  const colors: string[] = [];
  const push = (re: RegExp, en: string) => {
    if (re.test(t) && !colors.includes(en)) colors.push(en);
  };
  push(/\b(gele|geel|yellow)\b/i, "yellow");
  push(/\b(oranje|orange)\b/i, "orange");
  push(/\b(roze|pink)\b/i, "pink");
  push(/\b(rode|rood|red)\b/i, "red");
  push(/\b(zwarte|zwart|black)\b/i, "black");
  push(/\b(witte|wit|white)\b/i, "white");
  push(/\b(blauwe|blauw|blue)\b/i, "blue");
  push(/\b(groene|groen|green)\b/i, "green");
  push(/\b(paarse|paars|purple)\b/i, "purple");
  return colors;
}

/** Korte Engelse kleurzin voor string/slip/lingerie — helpt ZModel niet een verkeerde tint te kiezen. */
function buildUnderwearGarmentColorHint(intentBlob: string): string {
  const colors = extractRequestedGarmentColors(intentBlob);
  if (colors.length === 0) return "";
  return `Garment color(s) the user requested must match visibly in the photo: ${colors.join(", ")}.`;
}

/**
 * Composeert via Grok één Engelse **scene-directive** voor Z Image waarin
 * (a) de klantwens, (b) het profieluiterlijk en (c) framing/kleding/kleur al
 * coherent zijn verwerkt. We prefixen er deterministisch de identity-lock én
 * de safety-net regels (nudity / framing / kleur) achteraan, zodat het model
 * nooit "veiligheidshalve" iets anders kan tekenen.
 *
 * Volgorde van waarheid voor de AI:
 *  1) latestUserMessage (incl. spraaktranscript) – belangrijkst.
 *  2) chat-transcript (oldest → newest).
 *  3) heuristic summary (regex-based) – mag overruled worden.
 *  4) appearanceSummary – mag ze niet contradicteren (haar/lichaam/leeftijd).
 *
 * Pure tekstuitvoer. Max ~700 chars. Bij mislukken: deterministische fallback hieronder.
 */
async function distillChatIntoPhotoDirective(input: {
  profileFirstName: string;
  transcript: string;
  latestUserMessage: string;
  heuristicDirective: string;
  appearanceSummary: string;
  profileNarrative?: string;
  nudityLevel: PhotoNudityLevel;
  bodyRegion: PhotoBodyRegionHint;
  garmentColors: string[];
  /**
   * Letterlijke Nederlandse pose-zin uit de chat (bv. "string in je mond doen",
   * "vinger in je mond", "knielend op bed"). Als gezet → Grok MOET deze actie in
   * de Engelse beschrijving opnemen, en de framing eromheen kiezen.
   */
  explicitPose?: string | null;
  viewerFirstName?: string;
  wantsVisibleWriting: boolean;
}): Promise<string | null> {
  try {
    const constraintLines: string[] = [];
    /**
     * Pose komt EERST in de constraints — dit is de actie die de hele compositie
     * stuurt. Als er een pose is, weegt die zwaarder dan region/nudity/color.
     */
    if (input.explicitPose) {
      constraintLines.push(
        `Customer asked for a specific pose/action (LITERAL Dutch from chat): "${input.explicitPose}" — translate this action LITERALLY into English and describe it as the centerpiece of the photo. Choose framing that clearly shows this action (e.g. for anything involving mouth/lips/tongue: include face + chest in frame; for hand-on-body: include that body part + the hand; for kneeling: include full body from knees-down setting up.)`
      );
    }
    if (input.nudityLevel !== "unspecified") {
      constraintLines.push(`Detected clothing intent: ${input.nudityLevel} — keep that level, do not add clothing the user did not ask for.`);
    }
    if (input.bodyRegion !== "generic") {
      constraintLines.push(`Detected framing focus: ${input.bodyRegion}.`);
    }
    if (input.garmentColors.length > 0) {
      constraintLines.push(`Garment color(s) requested by user: ${input.garmentColors.join(", ")} — must be visible on the matching garment.`);
    }
    if (input.wantsVisibleWriting && input.viewerFirstName) {
      constraintLines.push(`User wants the name '${input.viewerFirstName}' visibly written on paper or skin — keep that detail.`);
    }

    const systemPrompt = [
      "You translate a Dutch chat conversation into ONE English paragraph describing what is visible in a single candid amateur smartphone photo.",
      "",
      "RULE #1 — THE LATEST USER MESSAGE IS THE CURRENT PHOTO WISH:",
      "Read the LATEST USER MESSAGE first. If it already names a specific garment, color, body region, pose or camera angle on its own (for example 'kan je je billen laten zien in de spiegel', 'foto in een geel slipje', 'lig naakt op bed', 'doe je shirt uit'), describe THAT wish and IGNORE older photo wishes earlier in the chat — those belong to previous photos that were already delivered. The first sentence of your paragraph must describe exactly what the LATEST USER MESSAGE asks to see.",
      "",
      "RULE #1B — EXPLICIT POSE / ACTION ALWAYS WINS OVER REGION HEURISTIC:",
      "If the customer asks for a specific POSE or ACTION (anything with mouth/lips/tongue/tanden, hand/vinger ON a body part, knielend, op handen en knieën, leunend, vooroverbuigen, opzij trekken van een slipje, een specifiek voorwerp vasthouden, bijten op een lip, kus naar de camera, etc.), describe that pose/action LITERALLY and make it the centerpiece of the paragraph. Choose framing that actually shows the action — for mouth/lip actions you MUST include the face and the upper body in frame, even if 'detected framing focus' below says something else. The pose dictates the framing; ignore region hints that would crop out the action.",
      "",
      "RULE #2 — ONLY IF THE LATEST USER MESSAGE IS SHORT OR VAGUE (e.g. 'voor de spiegel', 'klein en strak', 'doe maar', 'ja graag'):",
      "Then combine it with the most recent earlier user messages in the chat. For example 'voor de spiegel' on top of an earlier 'foto in een groen slipje' = mirror selfie wearing a green thong/panties. Never fall back to a generic face portrait when the chat already specifies a garment, color or body region.",
      "",
      "OUTPUT FORMAT:",
      "- ONE paragraph, plain English, 120 to 500 characters.",
      "- No markdown, no quotes, no prefix like 'Directive:' or 'Photo:'.",
      "- START with the requested garment + color (or 'fully nude' if user asked for nudity). Do NOT start with 'Create a photo of...'. Do NOT start with 'The same woman...'.",
      "- Then describe: pose, which body parts must be in frame, camera angle/framing (mirror selfie / handheld / knee-up / torso / full body / from front / from behind), facial expression (only if it adds anything), lighting (warm amateur, slight motion blur), setting (bedroom/bathroom/living room/etc.).",
      "",
      "HARD BANS — never write these in the output:",
      "- The woman's age, nationality, ethnicity, hair color/style, eye color, skin tone or facial features. Those are added elsewhere.",
      "- Phrases like 'same woman', 'same person', 'preserve identity', 'maintain facial consistency'. Those are added elsewhere.",
      "- Any clothing the user did NOT ask for. Never add a 'tasteful' top, dress or covering on your own initiative.",
      "",
      "DUTCH WARDROBE TRANSLATIONS (be literal, never soften):",
      "  • 'naakt' / 'bloot' / 'in je blootje' / 'geen kleren' / 'zonder iets aan' / 'niets aan' → fully nude, bare skin everywhere, no bra, no panties.",
      "  • 'bovenlijf zonder iets aan' / 'zonder shirt' / 'zonder top' / 'zonder bh' / 'topless' → bare chest, both breasts and nipples visible, no top at all.",
      "  • 'onderlijf zonder iets aan' / 'zonder broek' / 'zonder slipje' / 'bottomless' → bare lower body, no pants, no panties.",
      "  • 'lingerie' / 'setje' / 'kanten setje' → only the matching lingerie set, nothing more.",
      "  • Dutch 'string' = G-string / thong garment (NOT handwritten text). Hips and pelvis must be in frame so the thong is visible.",
      "  • 'slipje' = panties / briefs; 'klein en strak slipje' = tiny tight panties on her hips, frame mid-belly through upper thighs.",
      "  • 'doorschijnend' / 'transparant' / 'see-through' / 'sheer' → translucent fabric; skin or underwear visible through it. Do NOT swap to an opaque dress.",
      "  • 'jurk' / 'jurkje' / 'bodysuit' / 'jumpsuit' / 'bikini' / 'badpak' → describe knee-up or full-body framing so the garment is actually visible. Never default to a face-only headshot when the customer asked for a full garment.",
      "  • 'van voren' / 'from the front' vs 'van achter' / 'from behind' → match the viewing angle literally.",
      "  • 'voor de spiegel' / 'in de spiegel' = mirror selfie; show the garment in the mirror reflection, not a face portrait.",
      "  • Hands/arms covering chest → keep her topless, hands/arms cover; never put clothing back on.",
      "",
      "WORKED EXAMPLES (style + tone, not copy verbatim):",
      "  • Chat ends with 'voor de spiegel' + earlier 'foto in groen slipje' → 'Tight bright green panties on her hips, mirror selfie framed from her ribcage down through her upper thighs so the green panties are the centerpiece in the mirror reflection, one hand holding the phone, soft warm bedroom light, slight handheld motion blur, messy bed in the background.'",
      "  • Chat ends with 'lig naakt op bed' → 'Fully nude, lying on her back on a messy unmade bed, soft warm bedside lamp casting yellow light, body framed from chest down through hips, one hand resting on her belly, slight phone motion blur, late-evening bedroom setting.'",
      "  • Chat ends with 'doe je shirt uit' after 'kun je een topless foto sturen' → 'Bare chest, topless from the waist up, hands resting near her hips so both breasts and nipples are clearly visible, mirror selfie framed from belly to forehead, warm bathroom light, casual amateur phone snap.'",
      "  • Chat ends with 'kan je je string in je mond doen' → 'Topless, holding her tiny black thong stretched between her teeth, both hands pulling the thong taut up to her mouth, bare chest fully exposed, framed from the top of her hips up through her forehead so the thong-in-mouth action is the clear centerpiece, soft warm bedroom light, slight handheld phone motion blur, looking straight into the camera.'",
      "  • Chat ends with 'vinger in je mond' → 'Index finger between her parted lips, suggestive bite on the fingertip, mirror selfie framed from her chest up through her forehead so the finger-in-mouth action is centered, casual indoor light, slight phone motion blur.'",
      "  • Chat ends with 'knielend op bed met je tieten omhoog' → 'Topless and kneeling on a messy unmade bed, hands cupping and pushing her bare breasts upward toward the camera, full upper body in frame from knees up through forehead, warm bedside lamp light, casual amateur phone snap.'",
      "",
      "If a chat line starts with [Spraakbericht] it is the user's literal spoken wish — honor it word for word.",
      "Describe ONE single candid handheld smartphone photograph of one woman in one pose, captured in one continuous unbroken frame from one camera angle. If the user asked for a handwritten name on paper or skin, describe that name literally.",
    ].join("\n");

    const raw = await callXaiResponses({
      instructions: systemPrompt,
      input: [
        "RECENT CHAT (oldest to newest) — extract the CUSTOMER's photo wish from this:",
        input.transcript.slice(0, 4500),
        "",
        `LATEST USER MESSAGE (this is the most recent thing the customer said — highest priority): ${input.latestUserMessage.slice(0, 600)}`,
        "",
        `Regex heuristic summary (may be incomplete; the chat above is authoritative): ${input.heuristicDirective.slice(0, 450)}`,
        "",
        ...(constraintLines.length > 0
          ? ["AUTHORITATIVE CONSTRAINTS (these MUST be reflected literally in your paragraph):", ...constraintLines, ""]
          : []),
        "Write ONE English paragraph describing the photo. START with the requested garment + color (or 'fully nude'). Describe pose, body parts in frame, framing, setting, lighting. Do NOT mention identity, age, ethnicity, hair, eyes or skin.",
      ].join("\n"),
      maxOutputTokens: 400,
    });

    let cleaned = raw.replace(/\s+/g, " ").trim().replace(/^["'«»]+|["'«»]+$/g, "");

    /**
     * Strip leading identity-blurb if Grok ignored the system prompt. Common patterns
     * we want to remove from the start of the paragraph (one or several in a row):
     *  - "Create a candid amateur smartphone photo of the same woman, Saoirse, a 23-year-old from the Netherlands,"
     *  - "The same woman as the reference, a 23 year old Dutch …"
     *  - "Saoirse, a 23-year-old Dutch woman with long dark hair and green eyes,"
     *  - "Photo of a young woman …"
     */
    const identityLeadPatterns: RegExp[] = [
      /^\s*(?:create|generate|render|make|produce|compose|shoot)\s+(?:an?\s+|the\s+)?(?:[a-z-]+\s+){0,6}(?:photo|image|picture|snapshot|shot|portrait)[^,.]*?,\s*/i,
      /^\s*(?:photo|image|picture|snapshot|shot|portrait)\s+of\s+[^,.]*?,\s*/i,
      /^\s*(?:the\s+same\s+(?:woman|person|girl)|same\s+(?:woman|person|girl))[^,.]*?,\s*/i,
      new RegExp(`^\\s*${input.profileFirstName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*,?\\s*(?:a|an)?\\s*\\d{1,2}\\s*[- ]?\\s*(?:year[- ]?old|yo)[^,.]*?,\\s*`, "i"),
      /^\s*(?:a|an)\s+\d{1,2}\s*[- ]?\s*(?:year[- ]?old|yo)[^,.]*?(?:woman|girl|female)[^,.]*?,\s*/i,
      /^\s*(?:a|an|the)\s+(?:young|beautiful|gorgeous|stunning|attractive|sexy)?\s*(?:woman|girl|female|lady)[^,.]*?(?:with|having)\s+[^,.]*?(?:hair|eyes|skin)[^,.]*?,\s*/i,
    ];
    let stripped = true;
    let safety = 8;
    while (stripped && safety-- > 0) {
      stripped = false;
      for (const re of identityLeadPatterns) {
        if (re.test(cleaned)) {
          cleaned = cleaned.replace(re, "").trim();
          stripped = true;
        }
      }
    }
    // Soms eindigt het na strippen met losse "preserving identity" of "same face" zinnen — die mogen weg.
    cleaned = cleaned
      .replace(/[;,]?\s*(?:preserving|maintaining)\s+(?:her\s+)?(?:identity|facial\s+consistency|likeness|same\s+face)[^.]*\./gi, ".")
      .replace(/[;,]?\s*(?:same|preserve)\s+(?:woman|person|face|identity|likeness)[^.,;]*[.,;]?/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned.length < 24) {
      console.warn(`[photoPrompt] AI directive too short after cleanup (${cleaned.length} chars), falling back.`);
      return null;
    }
    if (cleaned.length > 720) {
      return cleaned.slice(0, 720).trimEnd();
    }
    return cleaned;
  } catch (e) {
    console.warn("[photoPrompt] distillChatIntoPhotoDirective failed:", e);
    return null;
  }
}

/**
 * Korte identity teaser (≤ ~80 chars) voor HELEMAAL VOORIN de Z Image prompt.
 * Bevat alleen: heritage hint + haarkleur + haarstijl + huid + body type.
 * Geen face/eyes — die woorden zouden Z Image richting portretten duwen.
 *
 * Voorbeeld output: "Dutch woman with dark blonde long loose waves, fair skin, slim hourglass body."
 */
function buildBodyShotIdentityTeaser(bodyShotIdentity: string, profile: Profile): string {
  const heritageRaw = (profile.heritage || "Dutch").trim();
  const heritageWord = /nederland|dutch|holland/i.test(heritageRaw) ? "Dutch" : heritageRaw;

  /** Haal hair-, skin- en body-tokens uit de body-shot identity string. */
  const hairMatch = bodyShotIdentity.match(/\b([a-z]+\s*blonde|[a-z]+\s*brown|[a-z]+\s*brunette|black hair|red hair|auburn|chestnut|platinum|strawberry blonde|ash blonde|dirty blonde)\b[^,.;]*?\bhair\b/i);
  const skinMatch = bodyShotIdentity.match(/\b(?:very\s+)?(?:fair|light|olive|tan|deep brown|rich brown|dark|medium|porcelain|warm beige|cool|pale)\s+skin[^,.;]*/i);
  const bodyMatch = bodyShotIdentity.match(/\b(?:slim\s+(?:hourglass|athletic|curvy)?|slender\s+athletic|petite\s+slim|soft\s+curvy|tall\s+broad-shouldered\s+lean|compact\s+muscular\s+legs|hourglass|curvy|athletic|petite|tall|slim|slender)\b/i);

  const parts: string[] = [`${heritageWord} woman`];
  if (hairMatch) parts.push(`with ${hairMatch[0].toLowerCase()}`);
  if (skinMatch) parts.push(skinMatch[0].toLowerCase());
  if (bodyMatch) parts.push(`${bodyMatch[0].toLowerCase()} body`);

  const teaser = parts.join(", ").replace(/\s+/g, " ").replace(/\s*,\s*,+/g, ", ").trim();
  return `${teaser}.`;
}

async function generatePersonalizedImagePrompt(
  profile: Profile,
  conv: Conversation,
  cycleIntentText: string,
  latestUserText: string,
  assistantText: string,
  viewerFirstName?: string | null
): Promise<string> {
  /** Admin random profile: `visual_identity_prompt` = zelfde lock-string als profielfoto’s. */
  const identityRaw = (
    profile.visualIdentityPrompt?.trim() || buildStableVisualIdentityForProfile(profile)
  ).replace(/\s+/g, " ");
  /**
   * Voor chat-foto's: korte identity (naam/leeftijd/body/basis-haarkleur). De volledige poetische
   * face-/hair-/eye-/skin-omschrijving overweldigde anders de gevraagde framing/kleding/region
   * en duwde Z Image steeds terug naar een face-portrait. De wens moet hier het zwaarst wegen.
   */
  const identityCore = compactIdentityForChatPhotoPrompt(
    sanitizeIdentityForZImagePrompt(identityRaw),
    180
  );

  const recentMessages = conv.messages
    .slice(-12)
    .map((m) => `${m.role}: ${messagePlainTextForPhotoIntent(m).slice(0, 220)}`)
    .join("\n");
  const effectiveViewerName = viewerFirstName?.trim() || "";
  const mergedIntentText = (cycleIntentText || "").replace(/\s+/g, " ").trim();
  const latestUserRequest = (latestUserText || "").replace(/\s+/g, " ").trim();
  const assistantLine = (assistantText || "").replace(/\s+/g, " ").trim();
  const wantsVisibleWriting = conversationWantsVisibleHandwrittenText(
    `${mergedIntentText}\n${latestUserRequest}`,
    assistantLine,
    recentMessages,
    effectiveViewerName || undefined
  );

  let primaryDirective = extractBestConcretePhotoDirective(mergedIntentText, latestUserRequest);
  const walkedBackFromBareCommand =
    Boolean(latestUserRequest) &&
    isBareDeliveryCommand(latestUserRequest) &&
    primaryDirective !== latestUserRequest;
  if (!primaryDirective) {
    primaryDirective =
      "amateur smartphone POV snap matching her profile body type hair and skin exactly what user will ask next";
  }

/**
 * Beperk het transcript voor de Grok-distill tot alleen messages NA de laatst gestuurde foto.
 * Anders combineert Grok de huidige wens (bv. "kan je nu je billen laten zien in de spiegel")
 * met de vorige wens (bv. "paars slipje met blote tieten") en blijft hij effectief de vorige
 * foto maken. Iedere geleverde foto = einde cyclus → nieuwe wens hoort tot nieuwe cyclus.
 */
  const lastAssistantPhotoIdx = (() => {
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i]!;
      if (m.role === "assistant" && (m.photoLock || m.imageFile)) return i;
    }
    return -1;
  })();
  const cycleMessages = conv.messages.slice(lastAssistantPhotoIdx + 1);

  // Heuristieken: alleen op de huidige cyclus, niet op oude foto-wensen.
  const cycleTextForIntent = cycleMessages
    .map((m) => messagePlainTextForPhotoIntent(m))
    .join("\n");
  const intentBlob = `${primaryDirective}\n${latestUserRequest}\n${cycleTextForIntent}`;
  const showFace = userExplicitlyRequestsFaceVisible(intentBlob);
  const messyBed = wantsMessyBedroomSetting(intentBlob);
  const nudityLevel = inferNudityLevel(intentBlob);
  /**
   * Detecteer expliciete poses/acties die het kledingstuk-naar-region heuristiek zouden
   * overrulen. Bv. "string in mond" = pose met string tussen tanden — niet een heup-shot
   * gewoon omdat "string" voorkomt. De Grok-distill krijgt de pose dan als hoogste-prioriteit
   * constraint en kiest zelf de juiste framing.
   */
  const explicitPose = detectExplicitPhotoPose(intentBlob);
  let bodyRegion = inferPhotoBodyRegion(intentBlob);
  if (!explicitPose) {
    if (bodyRegion === "generic" && nudityLevel === "topless") {
      bodyRegion = "breasts";
    }
    if (bodyRegion === "generic" && nudityLevel === "thong_focus") {
      bodyRegion = "pelvis";
    }
    // Doorschijnend jurkje / sheer top → garment moet in frame, dus full body
    if (bodyRegion === "generic" && nudityLevel === "sheer_outfit") {
      bodyRegion = "full_body";
    }
    // Billen / butt-aanvraag → frame rear
    if (
      bodyRegion === "generic" &&
      /\b(billen|kont|achterkant|achterwerk|butt|ass)\b/i.test(intentBlob)
    ) {
      bodyRegion = "butt";
    }
  } else {
    /** Pose-driven shot: laat region "generic" zodat de pose-instructie van Grok wint. */
    bodyRegion = "generic";
  }
  const garmentColors = extractRequestedGarmentColors(intentBlob);

  /** Bio + personality van het profiel — geeft de AI sfeer-context (wel/geen feest, type vrouw, etc.). */
  const profileNarrativeRaw = [profile.bio?.trim(), profile.onPlatformWhy?.trim()]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const transcriptForDistill = cycleMessages
    .slice(-18)
    .map((m) => `${m.role}: ${messagePlainTextForPhotoIntent(m).slice(0, 300)}`)
    .join("\n");
  const distilled = await distillChatIntoPhotoDirective({
    profileFirstName: profile.name,
    transcript: transcriptForDistill,
    latestUserMessage: latestUserRequest,
    heuristicDirective: primaryDirective,
    /** AI krijgt het profieluiterlijk mee zodat de pose/scene logisch is voor déze vrouw. */
    appearanceSummary: identityCore,
    profileNarrative: profileNarrativeRaw || undefined,
    nudityLevel,
    bodyRegion,
    garmentColors,
    explicitPose,
    viewerFirstName: effectiveViewerName || undefined,
    wantsVisibleWriting,
  });
  const usedAiDirective = Boolean(distilled);
  if (distilled) {
    primaryDirective = distilled;
  }

  if (
    wantsVisibleWriting &&
    effectiveViewerName &&
    !primaryDirective.toLowerCase().includes(effectiveViewerName.toLowerCase())
  ) {
    primaryDirective = `${primaryDirective}; messy amateur pen or pencil '${effectiveViewerName}' on real torn paper or skin uneven letters clearly readable`;
  }

  const textRule = wantsVisibleWriting
    ? "messy natural handwriting on physical paper or skin exact spelling no extra words NOT digital sticker NOT clean typography NOT overlay font"
    : "NO text, NO watermark, NO logo";

  const framingRule = buildFramingRuleForPhoto(showFace, bodyRegion);
  const nudityRule = buildNudityRuleForPhoto(nudityLevel);
  const garmentColorHint = buildUnderwearGarmentColorHint(intentBlob);

  const amateurStyle =
    "Ultra-realistic amateur smartphone photo grain sensor noise bad uneven lighting warm ugly lamp slight motion blur handheld imperfect framing raw quick pic for chat not studio not catalogue.";

  const settingRule = messyBed
    ? "Messy real bedroom unmade bed clothes on floor authentic chaos."
    : "";

  const referenceRule =
    "Appearance must match her profile reference photos same woman same hair body skin tone proportions.";

  const antiMulti =
    "Single candid smartphone photograph, one continuous unbroken frame, one centered subject, exactly one woman with one body in the picture, captured in one moment from one camera angle, like a normal iPhone snap sent in chat.";

  const maxBody = zModelMaxUserPromptBodyChars();

  /** Bio + personality uit admin random maker — alleen sfeer; gezicht/lichaam blijft visual identity. */
  const profileNarrative = [profile.bio?.trim(), profile.onPlatformWhy?.trim()]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const narrativeExtra =
    profileNarrative.length > 0
      ? ` Written profile context (mood and situation only; same woman as English appearance above): ${profileNarrative.slice(0, Math.min(200, Math.floor(maxBody * 0.18)))}`
      : "";

  let idPart = identityCore;
  let narrativeTag = narrativeExtra;

  /**
   * Wens vooraan (Z Image weegt eerste tokens het zwaarst).
   * Volgorde: anti-collage → user request → amateur style → framing → nudity → color.
   * Identity komt daarna als "Subject reference" — niet als opening, zodat de wens
   * de compositie stuurt en het uiterlijk de wens kleurt (niet andersom).
   */
  /**
   * Pose-instructie voor Z Image zelf — naast wat Grok in de directive zet.
   * Z Image weegt herhaling zwaar, dus we plaatsen de actie kort vooraan EN aan het einde.
   * Bij een pose mag de generieke framingRule (die op region stuurt) niet meer overheersen,
   * dus die slaan we dan over.
   */
  const poseDirective = explicitPose
    ? `Required action/pose in the photo (highest priority): the woman is performing this Dutch action — "${explicitPose}". The action must be clearly visible and centered. Frame the camera so this action is the focal point of the photo.`
    : "";

  const wishParts: string[] = [
    antiMulti,
    `User request (must be visible in the photo): ${primaryDirective}`,
  ];
  if (poseDirective) wishParts.push(poseDirective);
  if (!explicitPose) wishParts.push(framingRule);
  if (nudityRule) wishParts.push(nudityRule);
  if (garmentColorHint) wishParts.push(garmentColorHint);
  wishParts.push(amateurStyle);
  if (settingRule) wishParts.push(settingRule);
  wishParts.push(textRule);
  let wish = wishParts.join(" ");

  /** Wens-recap helemaal aan het einde voor extra recall — Z Image weegt einde óók zwaar. */
  const wishRecap = explicitPose
    ? `Make sure the photo clearly shows: ${primaryDirective}. The action "${explicitPose}" must be the visible centerpiece — not a generic portrait.`
    : `Make sure the photo clearly shows: ${primaryDirective}`;

  const subjectIntro = "Subject reference (same woman as her profile photos — do not change face, do not change body, only change clothing/pose/scene):";

  const assemble = (): string =>
    `${wish} ${subjectIntro} ${idPart}${narrativeTag} ${referenceRule} ${wishRecap}`
      .replace(/\s+/g, " ")
      .trim();

  const minIdentityChars = Math.min(
    identityCore.length,
    Math.min(220, Math.floor(maxBody * 0.32))
  );
  const minWishChars = 240;

  const shrinkWish = (): boolean => {
    if (wish.length <= minWishChars) return false;
    wish = wish.slice(0, Math.max(minWishChars, wish.length - 48)).trimEnd();
    return true;
  };

  while (assemble().length > maxBody) {
    if (narrativeTag) {
      narrativeTag = "";
      continue;
    }
    if (idPart.length > minIdentityChars) {
      idPart = idPart.slice(0, Math.max(minIdentityChars, idPart.length - 36)).trimEnd();
      continue;
    }
    if (shrinkWish()) continue;
    break;
  }

  const finalPrompt = assemble();

  console.info(
    `[photoPrompt] conv=${conv.id} len=${finalPrompt.length} aiDirective=${usedAiDirective} walkback=${walkedBackFromBareCommand} face=${showFace} region=${bodyRegion} nudity=${nudityLevel} colors=[${garmentColors.join(",")}] messyBed=${messyBed} pose=${explicitPose ? JSON.stringify(explicitPose) : "none"}`
  );
  console.info(`[photoPrompt] FULL conv=${conv.id} prompt=<<<${finalPrompt}>>>`);

  return finalPrompt;
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
  if (shouldSuppressNoReplyReminder(conv)) {
    conv.pendingNoReplyFollowUpAt = undefined;
    conv.pendingNoReplyAfterAssistantId = undefined;
    conv.pendingNoReplyReminderStage = undefined;
    return true;
  }

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
  // Chatberichten kosten credits (CREDITS_PER_MESSAGE). Zodra de user
  // door zijn free-start-budget heen is en nog niets heeft gekocht,
  // sturen we eenmalig een gentle nudge vanuit een profiel.
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

function randomCreditsExhaustedLine(): string {
  const i = Math.floor(Math.random() * CREDITS_EXHAUSTED_NUDGE_LINES.length);
  return CREDITS_EXHAUSTED_NUDGE_LINES[i] ?? CREDITS_EXHAUSTED_NUDGE_LINES[0]!;
}

function randomLockedPhotoTeaseLine(): string {
  const i = Math.floor(Math.random() * LOCKED_PHOTO_TEASE_LINES.length);
  return LOCKED_PHOTO_TEASE_LINES[i] ?? LOCKED_PHOTO_TEASE_LINES[0]!;
}

function randomPhotoEngagementStyle(options?: { allowVoiceReaction?: boolean }): PhotoEngagementStyle {
  const allowVoiceReaction = options?.allowVoiceReaction ?? true;
  const r = Math.random();
  if (allowVoiceReaction) {
    if (r < 0.38) return "voice_reaction";
    if (r < 0.66) return "choose_next_photo";
    if (r < 0.84) return "daring_prompt";
    return "natural_tease";
  }
  if (r < 0.46) return "choose_next_photo";
  if (r < 0.78) return "daring_prompt";
  return "natural_tease";
}

function styleInstructionForPhotoEngagement(style: PhotoEngagementStyle): string {
  switch (style) {
    case "voice_reaction":
      return "Vraag hem om een kort spraakbericht te sturen (niet 'voice' of 'voice memo' zeggen) omdat jij zijn stem geil vindt. Zeg dit speels, niet dwingend.";
    case "choose_next_photo":
      return "Laat hem kiezen wat hij als volgende foto wil zien met 2 concrete opties.";
    case "daring_prompt":
      return "Vraag hem om stout te reageren in tekst zodat jij nog geiler materiaal maakt.";
    default:
      return "Lok een natuurlijke reactie uit met een korte speelse tease.";
  }
}

/**
 * "In-flight" = er staat een achtergrond-image-generation gepland of bezig.
 * Een eerdere locked foto die nog niet ontgrendeld is, blokkeert NIET meer:
 * we mogen op verzoek van de user direct een nieuwe locked foto erbij sturen.
 */
function hasActiveLockedPhotoPipeline(conv: Conversation): boolean {
  return Boolean(conv.pendingLockedPhotoDeliveryAt || conv.pendingLockedPhotoDelivery);
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
  // NL/EN: "wil je / zou je" en expliciete fotokeuze-vragen
  if (/\b(wil je|wat wil je|welke|of wil je|zal ik|zou je)\b.*\?/i.test(t)) return true;
  if (/\b(wat wil je nu zien|wat zou je willen zien|zeg (maar )?wat je|noem maar wat)\b/i.test(t)) {
    return true;
  }
  // "iets straks X of liever Y bloot?" — eerder gemist omdat alleen close-up/pose als tweede helft gold
  if (/\b(of|of liever|of misschien|of zou je)\b/i.test(t)) {
    if (
      /\b(bloot|naakt|nude|lingerie|string|jurk|jurkje|strak|lichaam|uittrek|uit trek|aantrek|bh|borst|borsten|tepel|billen|kont|outfit|kleed|pose|selfie|foto|dress|tight|naked)\b/i.test(
        t
      )
    ) {
      return true;
    }
  }
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
  return /\b(ik ga .*maken|ik ga .*regelen|ik ga .*doen|ik maak .*voor je|ik maak 'm nu|ik maak m nu|ik maak hem nu|ik maak ze nu|ik ben .*aan het maken|ben .*voor je aan het maken|ik schiet .*voor je|ik combineer .*voor je|komt eraan|geef me .*minuut|geef me (heel )?even|wacht( heel)? even,? ik .*foto|ik kom zo terug.*foto|foto.*zo terug|ik stuur.*zo|hier is|check dit|kijk dit|ik ga .*aantrekken|ik ga .*schieten|ik kom zo|ben zo terug|ik ga het doen|ik ga het maken|ik ga 'm nu|ik ga m nu|ik ga nu|ik ga voor je aantrekken)\b/i.test(
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
      !/\b(ik ga .*maken|ik ga .*regelen|ik ga .*doen|ik maak .*voor je|ik maak 'm nu|ik maak m nu|ik maak hem nu|ik maak ze nu|ik ben .*aan het maken|ben .*voor je aan het maken|ik schiet .*voor je|ik combineer .*voor je|komt eraan|geef me .*minuut|geef me (heel )?even|wacht( heel)? even,? ik .*foto|ik kom zo terug.*foto|foto.*zo terug|ik stuur.*zo|hier is|check dit|kijk dit|ik ga .*aantrekken|ik ga .*schieten|ik kom zo|ben zo terug|ik ga het doen|ik ga het maken|ik ga 'm nu|ik ga m nu|ik ga nu|ik ga voor je aantrekken)\b/i.test(
        l
      )
  );
  if (kept.length > 0) return kept.join("\n\n");
  return "zeg me precies wat je wilt zien schat, dan maak ik die daarna voor je.";
}

function containsSentPhotoFollowup(text: string): boolean {
  return /\b(check (je|dit|dat)|wat vind je hier?van|wat denk je hier?van|wat denk je ervan|wat doet deze met je|maakt dit je lekker|heb je die foto al gezien|heb je (deze|hem) al gezien|wat wil je nu met me doen|word je er lekker hard van|de foto is gestuurd|foto is (net )?gestuurd|ik heb de foto gestuurd|de foto heb ik gestuurd)\b/i.test(
    text || ""
  );
}

function removeSentPhotoFollowupLines(text: string): string {
  const lines = (text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const kept = lines.filter(
    (l) =>
      !/\b(check (je|dit|dat)|wat vind je hier?van|wat denk je hier?van|wat denk je ervan|wat doet deze met je|maakt dit je lekker|heb je die foto al gezien|heb je (deze|hem) al gezien|wat wil je nu met me doen|word je er lekker hard van|de foto is gestuurd|foto is (net )?gestuurd|ik heb de foto gestuurd|de foto heb ik gestuurd)\b/i.test(
        l
      )
  );
  if (kept.length > 0) return kept.join("\n\n");
  return "zeg me wat je precies wilt zien, dan maak ik die direct voor je.";
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

  const conv = await loadNormalizedConversationById(conversationId);
  if (!conv) throw new Error("Gesprek niet gevonden");
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
      preferredId && isDatabaseUuid(preferredId) && !existingIds.has(preferredId)
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
      /**
       * Persistent: upload naar Supabase Storage (publieke bucket). Hierdoor
       * verdwijnt de foto niet bij een koude lambda of nieuwe deploy. Op falen
       * vallen we terug op lokaal fs (alleen werkbaar in dev — accepted).
       */
      const uploaded = await tryUploadImageToStorage({
        pathSegments: ["chat-images", conversationId, `${userMessage.id}`],
        buffer: imageBuffer,
        mime: imageMime,
        upsert: true,
      });
      if (uploaded?.publicUrl) {
        userMessage.imageUrl = uploaded.publicUrl;
      }
      try {
        const filename = await saveConversationImage(
          conversationId,
          userMessage.id,
          imageBuffer,
          imageMime
        );
        userMessage.imageFile = filename;
      } catch (e) {
        /** Vercel: schijf is read-only — niet erg, Supabase URL is bron van waarheid. */
        if (!uploaded?.publicUrl) {
          throw e;
        }
        console.warn(
          "[messages] local saveConversationImage failed, relying on Supabase URL",
          e instanceof Error ? e.message : String(e)
        );
      }
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
      /**
       * Schoon transcript-veld: als de voice route bij een STT-fout een
       * Grok-instructie als "text" meestuurt (zodat de AI alsnog kan
       * reageren), willen we die instructie NIET als chat-transcript tonen.
       * Markers zoals "transcriptie", "spraakbericht", "vraag of hij" zijn
       * tekenen dat dit een prompt-instructie was — bewaar in dat geval geen
       * transcript op het user-bericht.
       */
      const looksLikePromptInstruction =
        /transcriptie|reageer vriendelijk|typen|inspreken/i.test(textTrim) &&
        /spraakbericht/i.test(textTrim);
      const cleanTranscript = looksLikePromptInstruction ? "" : textTrim;
      userMessage.voice = {
        language: "nl",
        transcript: cleanTranscript || undefined,
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
  const mergedPhotoCycleIntent = mergePhotoCycleIntent(conv.pendingPhotoCycleIntent, joinedUserText);
  const recentUserIntentForTrigger = `${joinedUserText}\n${conv.messages
    .filter((m) => m.role === "user")
    .slice(-6)
    .map((m) => messagePlainTextForPhotoIntent(m))
    .join("\n")}`.toLowerCase();
  const asksForPhotoButVague =
    /(wat kan je voor me maken|wat kun je voor me maken|kan je iets maken|kun je iets maken|maak iets voor me|stuur iets leuks|wat kan je sturen|iets spannends voor me)/i.test(
      lastUserTextLower
    );
  const askedForPreferenceEarlier = conv.pendingPhotoPreferenceRequest === true;
  const previousUserMessage = conv.messages
    .filter((m) => m.role === "user")
    .slice(-1)[0]
    ?.content?.trim();
  const concreteVisualPreferenceRegex = CONCRETE_PHOTO_INTENT_REGEX;
  const hasConcreteVisualPreferenceNow = concreteVisualPreferenceRegex.test(
    recentUserIntentForTrigger
  );
  const currentUserHasConcreteVisualPreference = concreteVisualPreferenceRegex.test(
    lastUserTextLower
  );
  const confirmsPreviousPhotoRequest =
    /\b(kan je dit doen|kan je dat doen|kun je dit doen|kun je dat doen|doe maar|ja doe maar|ja doe\b|maak (hem|m)|regel maar|graag|ok[eé]?\b|is goed|zeker)\b/i.test(
      lastUserTextLower
    );
  const userGivesCreativeFreedom =
    /\b(verzin( jij)? wat|bedenk( jij)? wat|jij mag kiezen|kies jij( maar)?|doe maar iets|surprise me|jij beslist|maak maar wat)\b/i.test(
      lastUserTextLower
    );
  const lastAssistantTextBeforeUser = [...conv.messages]
    .reverse()
    .find((m) => m.role === "assistant")
    ?.content?.toLowerCase();
  const lastAssistantFullText =
    [...conv.messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const assistantAskedPhotoChoiceOrPreference = containsPhotoPreferenceQuestion(lastAssistantFullText);
  const trimmedUserForPhoto = joinedUserText.trim();
  const userAffirmsPhotoOffer =
    trimmedUserForPhoto.length > 0 &&
    trimmedUserForPhoto.length <= 96 &&
    !/\b(nee|niet|niet doen|liever niet|stop|geen zin|don't|no)\b/i.test(lastUserTextLower) &&
    (/\b(ja doe|doe maar|ja hoor|ja schat|is goed schat|tuurlijk|natuurlijk|alsjeblieft|jawel|jazeker)\b/i.test(
      lastUserTextLower
    ) ||
      (trimmedUserForPhoto.length <= 36 &&
        /^(?:\s*(?:ja|graag|prima|ok[eé]?|oke|okay|zeker|yes|doe)\b[\s!.,]*){1,3}\s*$/i.test(
          trimmedUserForPhoto
        )));
  /** "maak hem" / "doe maar" na een zin als "zal ik …?" telt ook als bevestiging. */
  const photoChoiceConfirmedByUser =
    !activePhotoPipeline &&
    assistantAskedPhotoChoiceOrPreference &&
    (userAffirmsPhotoOffer || confirmsPreviousPhotoRequest);
  const assistantRecentlyOfferedPhoto = /\b(nog eentje maak|nog een foto|zeg maar wat je .*wil zien|wat wil je dat ik nu doe|wat wil je nu zien|zal ik .*maken|ik kan .*maken)\b/i.test(
    lastAssistantTextBeforeUser || ""
  );
  const forceCreativePhotoNow =
    !activePhotoPipeline && userGivesCreativeFreedom && assistantRecentlyOfferedPhoto;
  const previousConcreteUserMessage = [...conv.messages]
    .filter((m) => m.role === "user")
    .reverse()
    .find((m) => concreteVisualPreferenceRegex.test(messagePlainTextForPhotoIntent(m).toLowerCase()));
  const previousConcreteUserText = previousConcreteUserMessage
    ? messagePlainTextForPhotoIntent(previousConcreteUserMessage).trim()
    : undefined;
  const shouldCarryForwardConcreteIntent =
    confirmsPreviousPhotoRequest &&
    !currentUserHasConcreteVisualPreference &&
    Boolean(previousConcreteUserMessage);
  let cycleIntentForPrompt = mergedPhotoCycleIntent.trim();
  if (askedForPreferenceEarlier && previousUserMessage) {
    cycleIntentForPrompt = `${previousUserMessage}\n${cycleIntentForPrompt}`.trim();
  }
  if (shouldCarryForwardConcreteIntent && previousConcreteUserText) {
    cycleIntentForPrompt = `${previousConcreteUserText}\n${cycleIntentForPrompt}`.trim();
  }
  if (!cycleIntentForPrompt) cycleIntentForPrompt = joinedUserText;
  if (photoChoiceConfirmedByUser) {
    const anchor = lastAssistantFullText.replace(/\s+/g, " ").trim();
    if (anchor) {
      cycleIntentForPrompt = `${anchor}\n${cycleIntentForPrompt}`.trim();
    }
  }

  // Vage fotovraag => eerst doorvragen naar voorkeur, nog geen foto sturen.
  if (
    (asksForPhotoButVague || askedForPreferenceEarlier) &&
    !hasConcreteVisualPreferenceNow &&
    !forceCreativePhotoNow &&
    !photoChoiceConfirmedByUser
  ) {
    await updateConversationAtomic(conversationId, (latestConv) => {
      latestConv.messages = [...latestConv.messages, ...userMessages];
      latestConv.updatedAt = userMessages[userMessages.length - 1]!.createdAt;
      latestConv.realismState = realismState;
      latestConv.pendingPhotoPreferenceRequest = true;
      latestConv.pendingPhotoCycleIntent = mergedPhotoCycleIntent;
    });
    if (conv.ownerUserId) {
      await deductMessageCredits(conv.ownerUserId, userMessages.length, conversationId);
    }
    const prefDelay = Math.min(1200, getRealisticReplyDelay(realismState));
    const [_, preferenceText] = await Promise.all([
      sleep(prefDelay),
      generatePhotoPreferenceQuestion(profile.name, joinedUserText),
    ]);
    const askMsg: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: preferenceText,
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
      latestConv.pendingPhotoCycleIntent = mergedPhotoCycleIntent;
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
      latestConv.pendingPhotoCycleIntent = mergedPhotoCycleIntent;
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
    const p = payloads[0]!;
    const tx = p.text?.trim() ?? "";
    const hasVoice = Boolean(p.voiceAudioBase64?.trim());
    if (hasVoice) {
      lastUserMsg = {
        role: "user",
        content: tx
          ? `[Spraakbericht] ${tx}`
          : "[Spraakbericht] (transcriptie onduidelijk; reageer in character en nodig hem uit om het kort in tekst te herhalen.)",
      };
    } else {
      lastUserMsg = { role: "user", content: tx };
    }
  } else {
    const n = payloads.length;
    const body = payloads.map((p, i) => `${i + 1}. ${p.text.trim()}`).join("\n");
    lastUserMsg = {
      role: "user",
      content: `Hij stuurde ${n} berichten direct achter elkaar, zonder te wachten op jouw antwoord. Lees ze allemaal en reageer één keer, in character.\n\n${body}`,
    };
  }

  const voiceInstruction =
    "SPRAAK IN DE APP: Bij dit antwoord zit geen audio. Zeg niet dat je iets hebt ingesproken of dat hij een spraakbericht moet checken — alleen tekst. Als je hem vraagt iets in te spreken: gebruik **spraakbericht** (nooit **voice** of 'voice memo'). " +
    "Als zijn bericht begint met **[Spraakbericht]**: de tekst erna is wat hij in zijn spraakmemo zei (Grok-transcriptie) — reageer inhoudelijk op die woorden, niet met een willekeurige foto-vraag die er los van staat.";

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
    latestConv.pendingPhotoCycleIntent = mergedPhotoCycleIntent;
  });
  if (conv.ownerUserId) {
    await deductMessageCredits(conv.ownerUserId, userMessages.length, conversationId);
  }

  // Typing delay runs in parallel with Grok — do not stack artificial wait + model latency.
  const realisticDelay = getRealisticReplyDelay(realismState);
  // === Alleen Responses API met exacte Luna prompt (geen legacy completeChat meer) ===
  let replyText: string;
  let imagePromptFromModel: string | null = null;

  /**
   * Foto-onderhandeling: tel hoeveel berichten de user al heeft gestuurd in
   * dit gesprek (inclusief de huidige batch). Onder de 10 zit de chat nog in
   * een "onderhandel-fase" en mag er geen foto worden gestuurd, ongeacht hoe
   * expliciet zijn vraag is. Vanaf 10 is het profiel vrij om foto's te sturen
   * wanneer de spanning klopt. Buiten de try-block geplaatst zodat de
   * server-side guard verderop deze variabelen ook kan inzien.
   */
  const negotiationThreshold = 10;
  const userMessageCount =
    conv.messages.filter((m) => m.role === "user").length + userMessages.length;
  const negotiationPhase = userMessageCount < negotiationThreshold;

  try {
    /**
     * Bouw chat history vanaf NA de laatst geleverde foto (= huidige photo cycle).
     * Anders blijft het model "doorhangen" in de vorige photo wens en negeert hij de nieuwe wens.
     *
     * Voorbeeld bug die dit voorkomt:
     *   - User: "stuur foto in roze string"  → foto gemaakt
     *   - User: "ga naakt voor spiegel staan" → model zag oude "roze string" wens en maakte weer
     *     dezelfde generieke foto i.p.v. naakt mirror selfie.
     */
    const lastAssistantPhotoIdx = (() => {
      for (let i = conv.messages.length - 1; i >= 0; i--) {
        const m = conv.messages[i]!;
        if (m.role === "assistant" && (m.photoLock || m.imageFile)) return i;
      }
      return -1;
    })();
    /** Messages NA de laatste foto = huidige cyclus (incl. nieuwe user wens). */
    const cycleMessages = conv.messages.slice(lastAssistantPhotoIdx + 1);
    const recentHistory = cycleMessages
      .slice(-10)
      .map((m) => {
        const role = m.role === "user" ? "User" : profile.name;
        const text = messagePlainTextForPhotoIntent(m).slice(0, 220);
        return `${role}: ${text}`;
      })
      .join("\n");

    const userLatest = (joinedUserText || lastUserTextLower || "").trim();

    const negotiationLine = negotiationPhase
      ? `⚠️ ONDERHANDEL-FASE ACTIEF: dit is pas zijn ${userMessageCount}e user-bericht. JE STUURT NU GEEN FOTO. image_prompt MOET null zijn. Kies per beurt een ANDERE tactiek (varieer!): (A) diep doorvragen op zijn wens en de fantasie opbouwen in tekst, (B) speels weigeren/uitstellen ("nee doe ik nu niet schat", "doe ik straks"), of (C) het script omdraaien ("stuur jij eerst maar wat", "spreek eerst iets in", "vertel eerst je stoutste fantasie"). Doel: hem geëngageerd houden, hem laten investeren — niet leveren.`
      : `Onderhandel-fase voorbij (${userMessageCount} user-berichten ≥ ${negotiationThreshold}). Je mag een foto sturen wanneer de spanning klopt en hij erom vraagt of jij hem hebt opgegeild en hij ja zegt. Ook hier blijf je variëren met tactieken A/B/C — niet elke vraag direct belonen, anders verdwijnt de spanning.`;

    const latestInput = [
      "=== HUIDIGE CHAT CYCLUS (sinds laatste foto) ===",
      recentHistory || "(begin van gesprek)",
      "",
      "=== ALLERLAATSTE USER BERICHT (DIT IS DE WENS DIE JE MOET UITVOEREN) ===",
      userLatest || "(geen bericht)",
      "",
      `=== USER_MESSAGE_COUNT = ${userMessageCount} (drempel: ${negotiationThreshold}) ===`,
      negotiationLine,
      "",
      "=== INSTRUCTIES ===",
      "1. Geef een normale chat 'response' (1-4 zinnen, Nederlands, vrouwelijk, in karakter).",
      "2. Foto-regels:",
      negotiationPhase
        ? "   - image_prompt = null (we zitten in onderhandel-fase, NOOIT een foto deze beurt)."
        : "   - Als de user om een foto vraagt OF jij hem in een vorige beurt opgegeild hebt en hij zegt ja: maak image_prompt die LETTERLIJK een SELFIE beschrijft van wat de user vraagt. Anders: image_prompt = null.",
      "   - Image_prompt MOET, indien niet null, altijd beschrijven als zelfgemaakte selfie (vrouw houdt zelf de telefoon vast, arm in beeld of mirror selfie). NOOIT 3rd-party fotograaf of professionele setup.",
      "   - Niet meer focussen op vorige foto-wensen, alleen op de huidige wens.",
      "   - Voorbeelden: 'naakt voor spiegel' → 'fully naked self-mirror selfie holding phone', 'roze string' → 'wearing only pink thong, selfie, arm extended into frame', 'billen' → 'back view of bare buttocks, mirror selfie with phone visible'.",
      "3. Anders: image_prompt = null.",
    ].join("\n").slice(0, 2000);

    const personaInstructions = buildProfileInstructions({
      name: profile.name,
      age: profile.age,
      bio: profile.bio,
      communicationStyle: profile.communicationStyle,
      onPlatformWhy: profile.onPlatformWhy,
      heritage: profile.heritage,
      location: profile.location,
    });

    const r = await callGrokResponses({
      instructions: personaInstructions,
      input: latestInput,
      maxOutputTokens: 2000,
    });

    console.info(`[responses] SUCCESS conv=${conversationId} responseLen=${r.response.length} hasImagePrompt=${!!r.image_prompt}`);
    replyText = sanitizeAssistantChatText(
      normalizeDutchVoiceWording(sparsifyEmojis(r.response))
    );
    imagePromptFromModel = r.image_prompt;
  } catch (e) {
    // Responses API faalde → minimale veilige reply, geen completeChat fallback.
    const err = e as Error;
    console.error("[responses] FATAL: callGrokResponses threw for conv=" + conversationId);
    console.error("[responses] error name=" + err.name + " message=" + err.message);
    console.error("[responses] stack=" + (err.stack || "").split("\n").slice(0, 5).join(" | "));
    console.error("[responses] lastInput=" + (joinedUserText || lastUserTextLower || "").slice(0, 200));
    replyText = "even denken...";
    imagePromptFromModel = null;
  }
  if (activePhotoPipeline) {
    replyText = enforcePendingPhotoReply(replyText);
  }

  // === FOTO ALLEEN ALS DE RESPONSES API EEN image_prompt TERUGGEEFT ===
  // De Luna prompt beslist zelf wanneer ze een foto wil sturen en levert de volledige prompt.
  // Als image_prompt null is → nooit een foto genereren in deze turn.
  // Alleen foto als de Responses API (Luna) expliciet een image_prompt teruggeeft
  let shouldSendPhotoNow = Boolean(imagePromptFromModel && imagePromptFromModel.trim().length > 20);
  if (activePhotoPipeline) {
    shouldSendPhotoNow = false;
  }
  /**
   * Server-side guard voor de onderhandel-fase: zelfs als Grok per ongeluk
   * een image_prompt teruggeeft terwijl `userMessageCount < 10`, sturen we
   * geen foto. Dit garandeert de "eerst onderhandelen" UX onafhankelijk van
   * eventuele drift in het Grok-antwoord.
   */
  if (negotiationPhase && shouldSendPhotoNow) {
    console.info(
      `[photoFlow] conv=${conversationId} negotiationPhase=true userMsg=${userMessageCount} — image_prompt genegeerd (te vroeg voor foto)`
    );
    shouldSendPhotoNow = false;
    imagePromptFromModel = null;
  }
  /**
   * Stuur de vergrendelde foto direct in dezelfde server-response.
   * (Geen wachttimer meer; gebruiker ziet meteen de unlock-bubble.)
   * Foto wordt alleen gegenereerd als de Responses API een image_prompt terug gaf.
   */
  let immediateLockedPhotoDelivery:
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
    let viewerFirstName: string | null = null;
    if (conv.ownerUserId) {
      try {
        const owner = await findUserById(conv.ownerUserId);
        const raw = owner?.naam?.trim().split(/\s+/)[0];
        if (raw) viewerFirstName = raw[0]!.toUpperCase() + raw.slice(1).toLowerCase();
      } catch {
        viewerFirstName = null;
      }
    }
    const hasUserEverSentVoiceInChat =
      conv.messages.some((m) => m.role === "user" && Boolean(m.voice)) ||
      userMessages.some((m) => m.role === "user" && Boolean(m.voice));
    const engagementStyle = randomPhotoEngagementStyle({
      allowVoiceReaction: hasUserEverSentVoiceInChat,
    });
    const photoMsgId = randomUUID();

    /**
     * Bouw de definitieve image prompt: de WENS van de user (uit de model-prompt) is dominant,
     * de profiel-identiteit volgt als body-focused descriptor.
     *
     * Belangrijk:
     *   - NIET starten met "Subject — same face, same eyes". Die tokens duwen Z Image naar een
     *     face-portrait, ongeacht de gevraagde kleding/pose. De wens moet voorop staan.
     *   - Hard cap op 1000 chars TOTAAL — dat is de Z Image API limiet. We reserveren ruimte voor
     *     ZMODEL_SINGLE_FRAME_PREFIX (~290 chars) en de identity-staart, daarna wordt de model-prompt
     *     intelligent ingekort zodat de identity nooit wegvalt.
     */
    const profileAppearanceRaw = (
      profile.visualIdentityPrompt?.trim() || buildStableVisualIdentityForProfile(profile)
    ).replace(/\s+/g, " ");
    /** Sanitized identity — verwijdert frame-filling / mirror-selfie termen. */
    const profileAppearanceSanitized = sanitizeIdentityForZImagePrompt(profileAppearanceRaw);
    /**
     * Body-focused descriptor: hair, skin, body type, heritage — ZONDER face/eyes tokens.
     * Beperkt tot ~180 chars zodat er ruim plek is voor de model-prompt binnen het budget.
     */
    const bodyShotIdentity = buildBodyShotIdentityDescriptor(profileAppearanceSanitized, 180);

    /**
     * Korte teaser HELEMAAL voor de wens — alleen heritage + haar + huid (geen face/eyes).
     * Z Image gebruikt de eerste tokens het zwaarst voor identity-vorming, daarom dit nu vooraan.
     */
    const identityTeaser = buildBodyShotIdentityTeaser(bodyShotIdentity, profile);
    const identityTail = `The woman is ${profile.name}, ${profile.age} years old, same person as her profile reference photo: ${bodyShotIdentity}.`;

    /**
     * Z Image budget: 1000 totaal. Onze finalize-stap voegt nog een prefix toe (~290 chars).
     * Daarom houden we het USER prompt-body deel ≤ 700 chars, zodat na prefix het totaal ≤ 990 blijft.
     */
    const Z_IMAGE_BODY_BUDGET = 700;
    const reservedForIdentity = identityTeaser.length + identityTail.length + 2; // +2 voor spaties
    const modelPromptBudget = Math.max(120, Z_IMAGE_BODY_BUDGET - reservedForIdentity);
    const modelPromptRaw = imagePromptFromModel!.replace(/\s+/g, " ").trim();
    /** Truncate de model-prompt op woordgrens als hij te lang is — behoudt het begin (de wens). */
    const modelPromptCapped = modelPromptRaw.length <= modelPromptBudget
      ? modelPromptRaw
      : (() => {
          const cut = modelPromptRaw.slice(0, modelPromptBudget);
          const lastBreak = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(" "));
          return (lastBreak > modelPromptBudget * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd().replace(/[,;]+$/g, "");
        })();
    const modelPromptTruncated = modelPromptCapped.length < modelPromptRaw.length;

    const composedImagePrompt = `${identityTeaser} ${modelPromptCapped} ${identityTail}`;

    /** Parallel: serialiseren van 3× Grok tot 1× batch voorkomt Vercel/host timeouts (>240s). */
    const [imagePrompt, immediateLockedTease, delayedLockedNudgeText] = await Promise.all([
      // Definitieve prompt = model-prompt + profiel-uiterlijk
      Promise.resolve(composedImagePrompt),
      generateLockedPhotoTeaseText(
        profile.name,
        joinedUserText,
        replyText,
        engagementStyle
      ),
      generateLockedPhotoDelayedNudgeText(
        profile.name,
        joinedUserText,
        engagementStyle
      ),
    ]);
    console.info(
      `[photoPrompt] conv=${conversationId} msg=${photoMsgId} request="${joinedUserText
        .replace(/\s+/g, " ")
        .slice(0, 180)}" modelPrompt=${Boolean(imagePromptFromModel)} promptLen=${imagePrompt.length} modelPromptLen=${modelPromptRaw.length}->${modelPromptCapped.length}${modelPromptTruncated ? " (TRUNCATED)" : ""} teaser=${identityTeaser.length} identityTail=${identityTail.length}`
    );
    console.info(`[photoPrompt] SENT conv=${conversationId} msg=${photoMsgId} prompt=<<<${imagePrompt}>>>`);
    immediateLockedPhotoDelivery = {
      messageId: photoMsgId,
      prompt: imagePrompt,
      width: 720,
      height: 1280, // 9:16 portrait — beste voor mobiel, vult de telefoonchat verticaal.
      teaseText: immediateLockedTease,
      delayedNudgeText: delayedLockedNudgeText,
    };
  }

  // Nooit "check je dit / wat vind je hiervan" sturen zonder dat er echt een foto gestuurd is.
  const sentPhotoThisTurn = Boolean(immediateLockedPhotoDelivery);
  if (!sentPhotoThisTurn && containsSentPhotoFollowup(replyText)) {
    replyText = removeSentPhotoFollowupLines(replyText);
  }

  /**
   * Veiligheidsklep: als de tekstreply na alle sanitizers leeg is (bv. Grok
   * gaf een puur boolean-veld terug of de hele response werd uitgepoetst),
   * stuur dan toch een korte fallback zodat het profiel niet "stil" blijft —
   * vooral van belang bij voice-input waarbij de user anders denkt dat het
   * profiel niets ontvangen heeft.
   */
  if (!replyText.trim()) {
    const hasVoicePayload = payloads.some((p) => Boolean(p.voiceAudioBase64?.trim()));
    replyText = hasVoicePayload
      ? "haha je stem is leuk, wat zei je precies? typ het even kort voor me"
      : "haha leuk";
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
    createdAt: new Date(Date.now() + index * 850).toISOString(),
    replyToId:
      index === 0
        ? payloads[payloads.length - 1]?.replyToId?.trim() ||
          (payloads.some((p) => Boolean(p.voiceAudioBase64?.trim()))
            ? userMessages[userMessages.length - 1]?.id
            : undefined) ||
          (Math.random() < 0.28 ? userMessages[userMessages.length - 1]?.id : undefined)
        : undefined,
  }));

  const assistantMessage = assistantMessages[0] ?? {
    id: randomUUID(),
    role: "assistant",
    content: replyText,
    createdAt: new Date().toISOString(),
  };

  /**
   * Realistische vertragingen:
   *   - tekstantwoord: random 10-60s nadat de user een bericht stuurt
   *   - foto: random 60-180s (en in de tussentijd kan de user gewoon doorchatten)
   * Beide worden via de pending-queues afgeleverd door `applyPendingAssistantReply`
   * en `applyPendingLockedPhotoDeliveries` bij de volgende inbox-poll.
   */
  const replyDelayMs = randomAssistantReplyDelayMs();
  const photoDelayMs = immediateLockedPhotoDelivery ? randomPhotoDeliveryDelayMs() : 0;
  void realisticDelay; // legacy 120-500ms wordt vervangen door de queue-delay hierboven

  await updateConversationAtomic(conversationId, async (latestConv) => {
    markPendingUserMessagesAsReadByPeer(latestConv);

    /** Typing events op het queued bericht — UI kan "X typt…" tonen rond de drop-tijd. */
    const typingEvents = simulateTypingBehavior(realismState, replyDelayMs);
    assistantMessage.typingEvents = typingEvents;
    if (assistantMessages[0]) assistantMessages[0].typingEvents = typingEvents;

    /** Queue: tekstantwoord(en) verschijnen na replyDelayMs in de chat. */
    if (assistantMessages.length > 0) {
      latestConv.pendingAssistantReplyAt = new Date(Date.now() + replyDelayMs).toISOString();
      latestConv.pendingAssistantReply = {
        messages: assistantMessages.map((m) => ({
          id: m.id,
          content: m.content,
          ...(m.replyToId ? { replyToId: m.replyToId } : {}),
          ...(m.typingEvents ? { typingEvents: m.typingEvents } : {}),
        })),
      };
    }

    latestConv.realismState = {
      ...realismState,
      lastReplyAt: new Date().toISOString(),
      messagesSinceLastReply: 0,
      energy: Math.min(100, realismState.energy + 5),
    };

    if (shouldSendPhotoNow) {
      latestConv.pendingPhotoPreferenceRequest = false;
      latestConv.pendingPhotoCycleIntent = undefined;
    }

    if (immediateLockedPhotoDelivery) {
      /**
       * Queue de locked foto met 60-180s vertraging. `applyPendingLockedPhotoDeliveries`
       * plaatst de bubble in de chat zodra de timer voorbij is, en zet daarbij ook
       * `pendingLockedPhotoNudgeAt` voor de delayed unlock-nudge.
       */
      latestConv.pendingLockedPhotoDeliveryAt = new Date(
        Date.now() + photoDelayMs
      ).toISOString();
      latestConv.pendingLockedPhotoDelivery = {
        messageId: immediateLockedPhotoDelivery.messageId,
        prompt: immediateLockedPhotoDelivery.prompt,
        width: immediateLockedPhotoDelivery.width ?? 1024,
        height: immediateLockedPhotoDelivery.height ?? 1024,
        ...(immediateLockedPhotoDelivery.teaseText
          ? { teaseText: immediateLockedPhotoDelivery.teaseText }
          : {}),
        ...(immediateLockedPhotoDelivery.delayedNudgeText
          ? { delayedNudgeText: immediateLockedPhotoDelivery.delayedNudgeText }
          : {}),
      };
      latestConv.pendingLockedPhotoMessageId = undefined;
      latestConv.pendingLockedPhotoNudgeAt = undefined;
      latestConv.pendingLockedPhotoNudgeText = undefined;
    }
  });
  /**
   * Offline e-mail wordt verstuurd vanuit `applyPendingAssistantReply` zodra het
   * bericht echt zichtbaar is. Hier niet meer triggeren — anders krijgt een offline
   * user de mail vóór het profiel "geantwoord" heeft.
   */

  return {
    userMessages,
    assistantMessage: null,
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
    assistantMessage: r.assistantMessage,
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

  const baseMs = Date.now();
  const msg: ChatMessage = {
    id: randomUUID(),
    role: "user",
    content: note.trim() || `cadeautje voor jou (${giftCredits} credits)`,
    createdAt: new Date(baseMs).toISOString(),
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
    createdAt: new Date(baseMs + 900).toISOString(),
    replyToId: msg.id,
  };
  const openedEvent: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content: `${conv.profileName} heeft je cadeau geopend`,
    createdAt: new Date(baseMs + 1700).toISOString(),
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
 * Trek `CREDITS_PER_MESSAGE` af voor elke verstuurde chat-message.
 * Werkt alleen wanneer Supabase + credit_ledger geconfigureerd zijn;
 * in lokale demo-mode wordt het alleen gelogd.
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
    if (!target) {
      const assistantMsgIds = conv.messages
        .filter((m) => m.role === "assistant")
        .map((m) => ({ id: m.id, hasLock: Boolean(m.photoLock), hasGen: Boolean(m.photoGeneration) }));
      console.warn(
        `[unlockPhoto] target not found conv=${conv.id} requested=${messageId} totalMsgs=${conv.messages.length} assistantMsgs=${JSON.stringify(assistantMsgIds)}`
      );
      throw new Error("Foto niet gevonden");
    }
    if (target.role !== "assistant" || !target.photoLock) {
      console.warn(
        `[unlockPhoto] target has no photoLock conv=${conv.id} id=${target.id} role=${target.role} hasLock=${Boolean(target.photoLock)} hasGen=${Boolean(target.photoGeneration)}`
      );
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
      const width = target.photoGeneration?.width ?? 720;
      const height = target.photoGeneration?.height ?? 1280;
      if (!prompt) {
        throw new Error("Foto prompt ontbreekt voor deze vergrendelde foto");
      }
      // Generates the real image only when user unlocks.
      const generated = await generateRealisticImageDetailed(
        { prompt, width, height, steps: 9, randomSeed: true },
        conv.id,
        target.id
      );
      if (!generated.filename) {
        throw new Error("Foto genereren mislukt");
      }
      target.imageFile = generated.filename;
      if (generated.publicUrl) {
        /** Persistent Supabase URL — frontend gebruikt deze direct, geen proxy roundtrip nodig. */
        target.imageUrl = generated.publicUrl;
      }
      if (!conv.firstGeneratedPhotoMessageId) {
        conv.firstGeneratedPhotoMessageId = target.id;
        conv.firstGeneratedPhotoFile = generated.filename;
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
  if (!isSupabaseProfilesEnabled()) return;

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
