import { NextResponse } from "next/server";
import {
  amsterdamCalendarDay,
  amsterdamHourMinute,
  loadProfilesForDailyPrompt,
  maybeSendDailyChatPromptForUser,
  scheduledMinuteForUserOnDay,
} from "@/lib/server/dailyChatPrompt";
import { listUsers } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/**
 * Doelvenster: 21:00–22:00 Europe/Amsterdam (winter en zomertijd allebei).
 * Vercel cron draait in UTC; deze route checkt zelf de Amsterdam-tijd, dus de
 * crontab in `vercel.json` mag het venster ruim afdekken (we slaan binnen de
 * route alles buiten 21:xx Amsterdam over).
 *
 * Elke user krijgt 1 stabiele “random” minuutslot 0-59. Op de cron-run waarbij
 * `currentAmsterdamMinute >= slot` (en de mail vandaag nog niet ging),
 * wordt verstuurd.
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

  if (!force && hour !== 21) {
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
  let skippedNotDue = 0;
  let skippedAlreadySent = 0;
  let skippedOther = 0;
  let errors = 0;

  for (const user of users) {
    if (!user.id) continue;
    if (user.lastDailyChatPromptDay === todayKey) {
      skippedAlreadySent += 1;
      continue;
    }
    if (!force) {
      const slot = scheduledMinuteForUserOnDay(user.id, todayKey);
      if (minute < slot) {
        skippedNotDue += 1;
        continue;
      }
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
    skippedNotDue,
    skippedOther,
    errors,
  });
}
