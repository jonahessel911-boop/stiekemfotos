import type { Profile } from "@/lib/types/profile";
import { appendAssistantOutboundForOwner } from "@/lib/server/conversations";
import { sendPlatform2WelcomeEmail } from "@/lib/server/email";
import { listDbProfiles } from "@/lib/server/profilesDb";
import { isPlatform2User } from "@/lib/server/platform2-user";
import { patchUserRecord, type UserRecord } from "@/lib/server/users";

const WELCOME_CHAT_LINE =
  "hey leuk dat je er bent ik wil graag met je chatten stuur maar iets als je zin hebt";

function hashToNonNegative(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

function pickWelcomeProfile(userId: string, profiles: Profile[]): Profile | null {
  if (profiles.length === 0) return null;
  return profiles[hashToNonNegative(`${userId}|welcome`) % profiles.length] ?? null;
}

/**
 * Gratis platform/2: welkomst-chat + één welkomstmail met inlog-knop (geen paid/setup-flow).
 */
export async function sendPlatform2WelcomeIfNeeded(user: UserRecord): Promise<{
  sent: boolean;
  reason: string;
}> {
  if (!isPlatform2User(user)) return { sent: false, reason: "not_platform2" };
  if (!user.email?.trim()) return { sent: false, reason: "no_email" };
  if (user.platform2WelcomeEmailSentAt) return { sent: false, reason: "already_sent" };

  const token =
    process.env.POSTMARK_SERVER_TOKEN ?? process.env.POSTMARK_API_TOKEN ?? "";
  if (!token.trim()) return { sent: false, reason: "no_postmark" };

  const profiles = await listDbProfiles(200);
  const profile = pickWelcomeProfile(user.id, profiles);

  if (profile) {
    try {
      await appendAssistantOutboundForOwner({
        ownerUserId: user.id,
        profileId: profile.id,
        content: WELCOME_CHAT_LINE,
        skipOfflineAssistantEmail: true,
      });
    } catch (e) {
      console.error("[platform2-welcome] chat mislukt user=", user.id, e);
    }
  }

  const loginUrl = "/platform/2/aanmelden?utm_source=email&utm_medium=welcome&utm_campaign=platform2";
  try {
    await sendPlatform2WelcomeEmail({
      to: user.email.trim().toLowerCase(),
      naam: user.naam,
      loginUrl,
    });
  } catch (e) {
    console.error("[platform2-welcome] mail mislukt user=", user.id, e);
    return { sent: false, reason: "email_failed" };
  }

  await patchUserRecord(user.id, {
    platform2WelcomeEmailSentAt: new Date().toISOString(),
  });
  return { sent: true, reason: "ok" };
}
