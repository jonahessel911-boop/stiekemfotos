import {
  appendSystemAssistantMessage,
  loadList,
} from "@/lib/server/conversations";
import {
  appendEngagementOutboundEntry,
  canSendAutomatedProfileOutreach,
  ENGAGEMENT_DEFER_MS,
  pruneEngagementOutboundLog,
} from "@/lib/server/engagementWeeklyCap";
import { isPlatform2User } from "@/lib/server/platform2-user";
import {
  findUserById,
  updateUserEngagementOutboundLog,
  updateUserEngagementSlots,
  updateUserReactionNudges,
} from "@/lib/server/users";

const ICEBREAKER_LINES = [
  "kom je wel eens in utrecht?",
  "hoe ben jij op t platform gekomen haha",
  "hee hoe is het?",
  "hii ben jij een man of vrouw zoek echt echt een man haha",
  "waar woon jij ongeveer?",
  "ben jij hier nieuw of zit je hier al lang?",
  "wat zoek jij hier eigenlijk?",
  "woon je een beetje in de buurt?",
  "ben je vanavond een beetje gezellig?",
  "hou jij van spontaan afspreken of rustig appen?",
  "ben jij meer serieus of meer speels?",
  "vind jij snelle klik belangrijk?",
  "wat trok jou aan op mijn profiel?",
  "ben jij vaker online in de avond?",
  "wat is je vibe vandaag?",
] as const;

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function normalizeIcebreaker(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[,;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const firstSentence = cleaned.split(/[.!?]/)[0]?.trim() ?? "";
  return firstSentence ? `${firstSentence}?` : "hoe is het?";
}

function pickLine(): string {
  const i = randInt(0, ICEBREAKER_LINES.length - 1);
  return normalizeIcebreaker(ICEBREAKER_LINES[i] ?? ICEBREAKER_LINES[0]!);
}

const PROFILE_LIKE_NUDGE_LINES = [
  "hee je had een like gestuurd, wat zoek je hier precies?",
  "ik zag je like op m'n profiel haha, vertel eens?",
  "je liet een like achter, nu ben ik benieuwd naar jou",
  "thanks voor je like, ga je ook iets sturen? ;)",
] as const;

const POST_LIKE_NUDGE_LINES = [
  "hee je zag m'n post en je stuurde een like, wat trok je aan?",
  "ik zag je like op m'n post haha, ben je een beetje spannend of braaf?",
  "je had m'n post geliket, nu ben ik wel nieuwsgierig naar jou",
  "thanks voor je post-like 😉 ga je ook hallo zeggen?",
] as const;

function pickLikeNudgeLine(source: "profile_like" | "post_like"): string {
  const pool = source === "post_like" ? POST_LIKE_NUDGE_LINES : PROFILE_LIKE_NUDGE_LINES;
  const i = randInt(0, pool.length - 1);
  return pool[i] ?? pool[0]!;
}

/** Per gebruiker: voorkomt herhaalde zware passes bij snelle opeenvolgende API-calls. */
const lastNudgeRunAt = new Map<string, number>();
const NUDGE_COOLDOWN_MS = 45_000;

/**
 * Verstuurt geplande assistent-ijsbrekers per profiel als hij nog niet heeft geantwoord in dat gesprek.
 * Caller moet eerst `ensureUserInboxForOwner` hebben aangeroepen (zoals bij GET /api/conversations).
 */
export async function maybeSendEngagementNudges(userId: string): Promise<void> {
  const now = Date.now();
  const prev = lastNudgeRunAt.get(userId) ?? 0;
  if (now - prev < NUDGE_COOLDOWN_MS) return;
  lastNudgeRunAt.set(userId, now);

  const user = await findUserById(userId);
  if (!user) return;
  if (isPlatform2User(user)) return;

  // SINGLE loadList() for the entire function — was previously O(slots) full blob loads + getConversation side effects
  const list = await loadList();

  const slots = (user.engagementSlots ?? []).map((s) => ({ ...s }));
  let changedSlots = false;
  let outboundLog = pruneEngagementOutboundLog(user.engagementOutboundLog);
  let changedOutboundLog = false;

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    if (s.sentAt) continue;
    if (Date.now() < new Date(s.fireAt).getTime()) continue;

    const conv = list.find(
      (c) => c.ownerUserId === userId && c.profileId === s.profileId
    );
    if (!conv) {
      s.sentAt = new Date().toISOString();
      changedSlots = true;
      continue;
    }

    const userReplied = conv.messages.some((m) => m.role === "user");
    if (userReplied) {
      s.sentAt = new Date().toISOString();
      changedSlots = true;
      continue;
    }

    if (!canSendAutomatedProfileOutreach(outboundLog, s.profileId)) {
      s.fireAt = new Date(Date.now() + ENGAGEMENT_DEFER_MS).toISOString();
      changedSlots = true;
      continue;
    }

    await appendSystemAssistantMessage(conv.id, pickLine());
    s.sentAt = new Date().toISOString();
    changedSlots = true;
    outboundLog = appendEngagementOutboundEntry(outboundLog, s.profileId);
    changedOutboundLog = true;
  }

  if (changedSlots) await updateUserEngagementSlots(userId, slots);

  const reactionNudges = (user.reactionNudges ?? []).map((n) => ({ ...n }));
  let changedReactionNudges = false;
  for (let i = 0; i < reactionNudges.length; i++) {
    const n = reactionNudges[i]!;
    if (n.sentAt) continue;
    if (Date.now() < new Date(n.fireAt).getTime()) continue;

    const conv = list.find(
      (c) => c.ownerUserId === userId && c.profileId === n.profileId
    );
    if (!conv) {
      n.sentAt = new Date().toISOString();
      changedReactionNudges = true;
      continue;
    }

    if (!canSendAutomatedProfileOutreach(outboundLog, n.profileId)) {
      n.fireAt = new Date(Date.now() + ENGAGEMENT_DEFER_MS).toISOString();
      changedReactionNudges = true;
      continue;
    }

    await appendSystemAssistantMessage(conv.id, pickLikeNudgeLine(n.source));
    n.sentAt = new Date().toISOString();
    changedReactionNudges = true;
    outboundLog = appendEngagementOutboundEntry(outboundLog, n.profileId);
    changedOutboundLog = true;
  }
  if (changedReactionNudges) {
    await updateUserReactionNudges(userId, reactionNudges);
  }
  if (changedOutboundLog) {
    await updateUserEngagementOutboundLog(userId, outboundLog);
  }
}
