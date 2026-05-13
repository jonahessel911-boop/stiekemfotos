import { NextResponse } from "next/server";
import {
  amsterdamCalendarDay,
  amsterdamHourMinute,
  loadProfilesForDailyPrompt,
  maybeSendDailyChatPromptForUser,
} from "@/lib/server/dailyChatPrompt";
import { listUsers } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/**
 * Hobby (Vercel): max. één cron-run per dag (geen elke-10-minuten-schema).
 * vercel.json triggert daarom 1× per dag rond 19:00 UTC; Vercel mag dat
 * binnen dat uur ± uitstellen (Hobby-precision).
 *
 * Avondvenster Europe/Amsterdam: uren 20–22 zodat zowel zomer (19 UTC ≈ 21)
 * als winter (19 UTC ≈ 20) in het venster valt. Binnen één run verwerken we
 * alle users die vandaag nog geen mail kregen (geen minuut-slots meer).
 */
function isAuthorized(req: Request): boolean {
  const expected = process.env.ENGAGEMENT_CRON_SECRET?.trim();
  if (!expected) return false;
  const incoming = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  return incoming.length > 0 && incoming === expected;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const todayKey = amsterdamCalendarDay();
  const { hour, minute } = amsterdamHourMinute();
  const force = new URL(req.url).searchParams.get("force") === "1";

  const inEveningWindow = hour >= 20 && hour <= 22;
  if (!force && !inEveningWindow) {
    return NextResponse.json({
      ok: true,
      skipped: "outside-window",
      todayKey,
      amsterdam: { hour, minute },
    });
  }

  const users = await listUsers();
  const profiles = await loadProfilesForDailyPrompt();

  let sent = 0;
  let skippedAlreadySent = 0;
  let skippedOther = 0;
  let errors = 0;

  for (const user of users) {
    if (!user.id) continue;
    if (user.lastDailyChatPromptDay === todayKey) {
      skippedAlreadySent += 1;
      continue;
    }
    try {
      const r = await maybeSendDailyChatPromptForUser(user, profiles, todayKey);
      if (r === "sent") sent += 1;
      else if (r === "skipped") skippedOther += 1;
      else errors += 1;
    } catch {
      errors += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    todayKey,
    amsterdam: { hour, minute },
    profilesLoaded: profiles.length,
    forced: force,
    sent,
    skippedAlreadySent,
    skippedOther,
    errors,
  });
}
