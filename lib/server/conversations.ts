import { randomUUID } from "crypto";
import { readJson, writeJson } from "@/lib/server/store";
import type { Conversation, ConversationSummary, ChatMessage } from "@/lib/types/chat";
import type { Profile } from "@/lib/types/profile";
import { getProfileById } from "@/lib/profiles";
import { completeChat, type GrokContentPartOpenAI, type GrokMessage } from "@/lib/grok";
import {
  MAX_OUTGOING_BATCH_SIZE,
  MAX_USER_MESSAGE_CHARS,
} from "@/lib/chat-send-limits";
import { CREDITS_PER_MESSAGE } from "@/lib/credits-client";
import type { UserMessageCreditLine } from "@/lib/types/credit-usage";
import { readAiSettings } from "@/lib/server/aiSettings";
import { EAST_EUROPEAN_CHAT_INSTRUCTIONS } from "@/lib/prompts/eastEuropean";
import { PERSONA_MEMORY_RULES } from "@/lib/prompts/personaMemory";
import { formatPersonaSheetForPrompt } from "@/lib/prompts/personaSheet";
import {
  ASSISTANT_VOICE_TTS_PHRASE,
  triggersAssistantVoiceReply,
  triggersTrustProofVoiceRequest,
} from "@/lib/flirt-triggers";
import { randomTypingDelayMs, sleep } from "@/lib/chat-typing-delay";
import {
  CREDIT_PACKAGES_DISPLAY,
  CREDITS_VOICE_LINE_NL,
} from "@/lib/credit-packages";
import { formatIntimacyPrompt, intimacyTierFromCount, type IntimacyTier } from "@/lib/intimacy-tier";
import { saveConversationImage } from "@/lib/server/convImageStore";

const FILE = "conversations.json";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function grokHistoryLine(m: ChatMessage): string {
  if (m.role === "user" && m.imageFile) {
    const t = (m.content ?? "").trim();
    return t ? `[Foto gestuurd] ${t}` : "[Foto gestuurd]";
  }
  return typeof m.content === "string" ? m.content : String(m.content ?? "");
}

function buildSystemContent(profile: Profile, tier: IntimacyTier): string {
  const settings = readAiSettings();
  const intimacy = formatIntimacyPrompt(tier);
  const sheet = formatPersonaSheetForPrompt(profile);
  const grounded = `\n\n${intimacy}\n\n${sheet}\n\n${PERSONA_MEMORY_RULES}`;

  if (profile.personaStyle === "east_european") {
    return `${EAST_EUROPEAN_CHAT_INSTRUCTIONS}${grounded}`;
  }

  return `${settings.systemPrompt.trim()}${grounded}`;
}

function load(): Conversation[] {
  return readJson<Conversation[]>(FILE, []);
}

function save(list: Conversation[]) {
  writeJson(FILE, list);
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

export function listSummaries(): ConversationSummary[] {
  return load()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map((c) => {
      const last = c.messages[c.messages.length - 1];
      let lastMessage = last?.content ?? "";
      if (last?.role === "user" && last.imageFile) {
        lastMessage = lastMessage.trim() ? `📷 ${lastMessage}` : "📷 Foto";
      }
      return {
        id: c.id,
        profileId: c.profileId,
        profileName: c.profileName,
        previewAvatar: c.previewAvatar,
        lastMessage,
        timestamp: last ? timeLabel(last.createdAt) : "",
        unread: 0,
        isOnline: c.isOnline,
      };
    });
}

export function getConversation(id: string): Conversation | null {
  return load().find((c) => c.id === id) ?? null;
}

export function findOrCreateConversation(profileId: string): Conversation {
  const profile = getProfileById(profileId);
  if (!profile) throw new Error("Profiel niet gevonden");

  const list = load();
  const existing = list.find((c) => c.profileId === profileId);
  if (existing) return existing;

  const id = randomUUID();
  const now = new Date().toISOString();
  const conv: Conversation = {
    id,
    profileId,
    profileName: profile.name,
    previewAvatar: profile.photo,
    isOnline: profile.isOnline,
    messages: [],
    updatedAt: now,
  };

  list.unshift(conv);
  save(list);
  return conv;
}

export type UserMessagePayload = {
  text: string;
  imageBase64?: string;
  imageMime?: string;
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

export async function appendUserMessagesAndReply(
  conversationId: string,
  payloads: UserMessagePayload[],
  options?: { noCredits?: boolean }
): Promise<{
  userMessages: ChatMessage[];
  assistantMessage: ChatMessage;
  speakAssistantReply?: { language: string };
}> {
  if (payloads.length === 0) throw new Error("Geen berichten");
  if (payloads.length > MAX_OUTGOING_BATCH_SIZE) {
    throw new Error(`Maximaal ${MAX_OUTGOING_BATCH_SIZE} berichten tegelijk.`);
  }

  const list = load();
  const idx = list.findIndex((c) => c.id === conversationId);
  if (idx === -1) throw new Error("Gesprek niet gevonden");

  const conv = list[idx]!;
  const profile = getProfileById(conv.profileId);
  if (!profile) throw new Error("Profiel ontbreekt");

  if (options?.noCredits && payloads.length > 1) {
    throw new Error("Zonder credits: stuur één bericht tegelijk.");
  }

  const userMessages: ChatMessage[] = [];
  const imageSlots: { buffer: Buffer; mime: string }[] = [];

  for (const payload of payloads) {
    const textTrim = payload.text?.trim() ?? "";
    const b64Raw = payload.imageBase64?.trim();
    const imageMime = normalizeImageMime(payload.imageMime);

    if (!textTrim && !b64Raw) {
      throw new Error("Bericht is leeg");
    }
    if (textTrim.length > MAX_USER_MESSAGE_CHARS) {
      throw new Error(
        `Een bericht mag maximaal ${MAX_USER_MESSAGE_CHARS} tekens zijn. Maak het korter of verdeel het.`
      );
    }

    if (options?.noCredits && b64Raw) {
      throw new Error("Met lege credits kun je geen foto sturen — koop credits.");
    }

    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: "user",
      content: textTrim || "📷",
      createdAt: new Date().toISOString(),
      readByPeer: true,
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

    userMessages.push(userMessage);
  }

  if (options?.noCredits) {
    const userMessage = userMessages[0]!;
    await sleep(600 + Math.floor(Math.random() * 700));
    const bodyText = `${CREDITS_VOICE_LINE_NL}\n\n${CREDIT_PACKAGES_DISPLAY}`;
    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: bodyText,
      createdAt: new Date().toISOString(),
    };
    conv.messages = [...conv.messages, userMessage, assistantMessage];
    conv.updatedAt = assistantMessage.createdAt;
    list[idx] = conv;
    save(list);
    return {
      userMessages: [userMessage],
      assistantMessage,
    };
  }

  const tier = intimacyTierFromCount(conv.messages.length);
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

  const joinedUserText = payloads.map((p) => p.text).join("\n");
  const wantTrustProofVoice =
    payloads.some((p) => triggersTrustProofVoiceRequest(p.text || "")) ||
    triggersTrustProofVoiceRequest(joinedUserText);

  const wantFlirtyVoice =
    payloads.some((p) =>
      triggersAssistantVoiceReply(p.text || " ", {
        intimacyTier: tier,
        hasImage: Boolean(p.imageBase64?.trim()),
      })
    ) ||
    triggersAssistantVoiceReply(joinedUserText, {
      intimacyTier: tier,
      hasImage: imageSlots.length > 0,
    });

  const wantVoice = wantTrustProofVoice || wantFlirtyVoice;

  const voiceInstruction = wantVoice
    ? "SPRAAK IN DE APP: Dit antwoord heeft een korte afspeelclip (alleen een enthousiast ‘hoi’). Je mag in de tekst maximaal één korte zin suggereren dat hij kan luisteren; de inhoud van je antwoord staat verder in tekst."
    : "SPRAAK IN DE APP: Bij dit antwoord zit geen audio. Zeg niet dat je iets hebt ingesproken of dat hij een spraakbericht moet checken — alleen tekst.";

  const messages: GrokMessage[] = [
    { role: "system", content: `${buildSystemContent(profile, tier)}\n\n${voiceInstruction}` },
    ...history,
    lastUserMsg,
  ];

  await sleep(randomTypingDelayMs());
  const replyText = await completeChat(messages, { hasImage: imageSlots.length > 0 });

  const assistantMessage: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content: replyText,
    createdAt: new Date().toISOString(),
    ...(wantVoice
      ? {
          voice: {
            language: profile.voiceLanguage,
            ttsText: ASSISTANT_VOICE_TTS_PHRASE,
          },
        }
      : {}),
  };

  conv.messages = [...conv.messages, ...userMessages, assistantMessage];
  conv.updatedAt = assistantMessage.createdAt;
  list[idx] = conv;
  save(list);

  return {
    userMessages,
    assistantMessage,
    speakAssistantReply: wantVoice ? { language: profile.voiceLanguage } : undefined,
  };
}

export async function appendUserMessageAndReply(
  conversationId: string,
  payload: UserMessagePayload,
  options?: { noCredits?: boolean }
): Promise<{
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  speakAssistantReply?: { language: string };
}> {
  const r = await appendUserMessagesAndReply(conversationId, [payload], options);
  return {
    userMessage: r.userMessages[0]!,
    assistantMessage: r.assistantMessage,
    speakAssistantReply: r.speakAssistantReply,
  };
}

/** Alle verstuurde gebruikersberichten → kosten voor creditoverzicht (serverbron). */
export function listUserMessageCreditUsage(): UserMessageCreditLine[] {
  const list = load();
  const out: UserMessageCreditLine[] = [];
  for (const c of list) {
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

/** Seed demo conversations from profiles if empty (optional) */
export function ensureSeedConversations() {
  const list = load();
  if (list.length > 0) return;
  const emma = getProfileById("3");
  const lisa = getProfileById("2");
  if (!emma || !lisa) return;

  const now = new Date().toISOString();
  const seed: Conversation[] = [
    {
      id: randomUUID(),
      profileId: emma.id,
      profileName: emma.name,
      previewAvatar: emma.photo,
      isOnline: emma.isOnline,
      updatedAt: now,
      messages: [
        {
          id: randomUUID(),
          role: "assistant",
          content: "Hey, heb je mijn vorige bericht gezien? 😊",
          createdAt: now,
        },
      ],
    },
    {
      id: randomUUID(),
      profileId: lisa.id,
      profileName: lisa.name,
      previewAvatar: lisa.photo,
      isOnline: lisa.isOnline,
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
  save(seed);
}
