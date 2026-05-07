import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import {
  findUserById,
  type ReactionNudge,
  updateUserReactionNudges,
} from "@/lib/server/users";

type Body = {
  profileId?: string;
  source?: "profile_like" | "post_like";
};

function randomDelayMs(): number {
  const min = 2 * 60 * 1000;
  const max = 10 * 60 * 1000;
  return min + Math.floor(Math.random() * (max - min + 1));
}

export async function POST(req: Request) {
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) return NextResponse.json({ ok: false }, { status: 401 });
    const user = await findUserById(userId);
    if (!user) return NextResponse.json({ ok: false }, { status: 404 });

    const body = (await req.json()) as Body;
    const source = body.source === "post_like" ? "post_like" : "profile_like";
    const profileId = String(body.profileId ?? "").trim();
    if (!profileId) {
      return NextResponse.json(
        { error: "profileId is verplicht voor like-notificaties." },
        { status: 400 }
      );
    }

    // Productafspraak: post-like triggert slechts in 50% van de gevallen
    // een follow-up bericht van het profiel.
    if (source === "post_like" && Math.random() >= 0.5) {
      return NextResponse.json({ ok: true, scheduled: false });
    }

    const nudges: ReactionNudge[] = [...(user.reactionNudges ?? [])];
    const existing = nudges.find(
      (n) => !n.sentAt && n.profileId === profileId && n.source === source
    );
    const fireAt = new Date(Date.now() + randomDelayMs()).toISOString();
    if (existing) {
      existing.fireAt = fireAt;
    } else {
      nudges.push({ profileId, source, fireAt });
    }
    await updateUserReactionNudges(userId, nudges);
    return NextResponse.json({ ok: true, scheduled: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}
