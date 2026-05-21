import type { Profile } from "@/lib/types/profile";
import { amsterdamCalendarDay } from "@/lib/server/dailyChatPrompt";
import { sendPlatform2OnlinePromptEmail } from "@/lib/server/email";
import { isPlatform2User } from "@/lib/server/platform2-user";
import { listDbProfiles } from "@/lib/server/profilesDb";
import { patchUserRecord, type UserRecord } from "@/lib/server/users";

const MAX_PER_DAY = 3;

function hashToNonNegative(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

function pickProfilesForSlot(
  userId: string,
  todayKey: string,
  slotIndex: number,
  profiles: Profile[],
  count = 3
): Array<{ name: string; age: number }> {
  if (profiles.length === 0) return [];
  const start =
    hashToNonNegative(`${userId}|${todayKey}|online|${slotIndex}`) % profiles.length;
  const out: Array<{ name: string; age: number }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < profiles.length && out.length < count; i++) {
    const p = profiles[(start + i) % profiles.length];
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ name: p.name, age: p.age });
  }
  return out;
}

function slotCountForUser(user: UserRecord, todayKey: string): number {
  if (user.platform2OnlineEmailDay !== todayKey) return 0;
  return Math.min(MAX_PER_DAY, user.platform2OnlineEmailCount ?? 0);
}

/**
 * Verstuurt max. 3× per kalenderdag (Amsterdam) per platform/2-user.
 */
export async function maybeSendPlatform2OnlinePromptForUser(
  user: UserRecord,
  profiles: Profile[],
  todayKey: string
): Promise<"sent" | "skipped" | "error"> {
  if (!isPlatform2User(user)) return "skipped";
  if (!user.email?.trim()) return "skipped";
  if (!user.platform2WelcomeEmailSentAt) return "skipped";

  const sentToday = slotCountForUser(user, todayKey);
  if (sentToday >= MAX_PER_DAY) return "skipped";

  const token =
    process.env.POSTMARK_SERVER_TOKEN ?? process.env.POSTMARK_API_TOKEN ?? "";
  if (!token.trim()) return "skipped";

  const profileLines = pickProfilesForSlot(
    user.id,
    todayKey,
    sentToday,
    profiles,
    3
  );
  if (profileLines.length === 0) return "skipped";

  const ctaUrl =
    "/platform/2/berichten?utm_source=email&utm_medium=online&utm_campaign=platform2";

  try {
    await sendPlatform2OnlinePromptEmail({
      to: user.email.trim().toLowerCase(),
      naam: user.naam,
      profiles: profileLines,
      ctaUrl,
    });
    await patchUserRecord(user.id, {
      platform2OnlineEmailDay: todayKey,
      platform2OnlineEmailCount: sentToday + 1,
    });
    return "sent";
  } catch (e) {
    console.error("[platform2-online] mail mislukt user=", user.id, e);
    return "error";
  }
}

export async function processPlatform2OnlinePromptEmails(): Promise<{
  todayKey: string;
  sent: number;
  skipped: number;
  errors: number;
}> {
  const todayKey = amsterdamCalendarDay();
  const { listUsers } = await import("@/lib/server/users");
  const users = await listUsers();
  const profiles = await listDbProfiles(400);

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of users) {
    if (!isPlatform2User(user)) continue;
    try {
      const r = await maybeSendPlatform2OnlinePromptForUser(user, profiles, todayKey);
      if (r === "sent") sent += 1;
      else if (r === "error") errors += 1;
      else skipped += 1;
    } catch {
      errors += 1;
    }
  }

  return { todayKey, sent, skipped, errors };
}
