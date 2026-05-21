import type { Profile } from "@/lib/types/profile";
import { appendAssistantOutboundForOwner } from "@/lib/server/conversations";
import { sendDailyChatPromptEmail } from "@/lib/server/email";
import { listDbProfiles } from "@/lib/server/profilesDb";
import { isPlatform2User } from "@/lib/server/platform2-user";
import type { UserRecord } from "@/lib/server/users";
import { updateUserLastDailyChatPromptDay } from "@/lib/server/users";

/** Eerste-persoon assistentregels (geen Grok) — wisselt per user/dag. */
const DAILY_ASSISTANT_LINES = [
  "hey schat ik zou graag met je chatten of een foto voor je maken wat wil jij van me zien haha",
  "hii wil je met me appen of zal ik eerst een foto voor je maken zeg maar wat je geil vindt",
  "kom je ff in de chat ik wil met je praten en misschien wel een foto sturen wat heb jij zin in",
  "ben je daar ik wil best ff chatten of iets spannends voor je fotograferen wat wil jij precies",
] as const;

export function amsterdamCalendarDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Huidige uur + minuut in Europe/Amsterdam (0-23, 0-59). */
export function amsterdamHourMinute(now = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minStr = parts.find((p) => p.type === "minute")?.value ?? "0";
  return {
    hour: parseInt(hourStr, 10) || 0,
    minute: parseInt(minStr, 10) || 0,
  };
}

function hashToNonNegative(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Stabiel “random” minuutslot 0-59 voor deze user op deze dag. */
export function scheduledMinuteForUserOnDay(userId: string, todayKey: string): number {
  return hashToNonNegative(`${userId}|${todayKey}|minute`) % 60;
}

export async function loadProfilesForDailyPrompt(max = 400): Promise<Profile[]> {
  return listDbProfiles(max);
}

/**
 * Max. 1× per kalenderdag (Europe/Amsterdam) per user: assistentbericht in een gekozen chat +
 * branding-mail met “Ga naar chat”. Vereist Postmark (`POSTMARK_SERVER_TOKEN`).
 */
export async function maybeSendDailyChatPromptForUser(
  user: UserRecord,
  profiles: Profile[],
  todayKey: string
): Promise<"sent" | "skipped" | "error"> {
  if (profiles.length === 0) return "skipped";
  if (!user.email?.trim()) return "skipped";
  if (isPlatform2User(user)) return "skipped";
  if (user.lastDailyChatPromptDay === todayKey) return "skipped";

  const token = process.env.POSTMARK_SERVER_TOKEN ?? process.env.POSTMARK_API_TOKEN ?? "";
  if (!token.trim()) {
    return "skipped";
  }

  const profileIdx = hashToNonNegative(`${user.id}|${todayKey}`) % profiles.length;
  const profile = profiles[profileIdx]!;
  const lineIdx = hashToNonNegative(`${user.email}|${todayKey}`) % DAILY_ASSISTANT_LINES.length;
  const content = DAILY_ASSISTANT_LINES[lineIdx] ?? DAILY_ASSISTANT_LINES[0]!;

  /**
   * Mail-previews: drie deterministisch "vandaag aangemelde" vrouwen op basis
   * van een dag-seed. Stabiel binnen één dag, varieert per dag.
   */
  const startSeed = hashToNonNegative(`mail|${user.id}|${todayKey}`) % profiles.length;
  const previewProfiles: Array<{ name: string; avatarUrl?: string | null }> = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < profiles.length && previewProfiles.length < 4; i++) {
    const p = profiles[(startSeed + i) % profiles.length];
    if (!p || seenIds.has(p.id)) continue;
    seenIds.add(p.id);
    previewProfiles.push({
      name: p.name,
      avatarUrl: p.photo && /^https?:\/\//i.test(p.photo) ? p.photo : null,
    });
  }

  try {
    await appendAssistantOutboundForOwner({
      ownerUserId: user.id,
      profileId: profile.id,
      content,
      skipOfflineAssistantEmail: true,
    });

    try {
      await sendDailyChatPromptEmail({
        to: user.email.trim().toLowerCase(),
        naam: user.naam,
        newProfiles: previewProfiles,
      });
    } catch (e) {
      console.error("[dailyChatPrompt] e-mail mislukt user=", user.id, e);
    }

    await updateUserLastDailyChatPromptDay(user.id, todayKey);
    return "sent";
  } catch (e) {
    console.error("[dailyChatPrompt] bericht mislukt user=", user.id, e);
    return "error";
  }
}
