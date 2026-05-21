import { NextResponse } from "next/server";
import {
  completePasswordReset,
  completePlatformOnboarding,
  resolveAppUserById,
  touchUserSeen,
  toPublicUser,
} from "@/lib/server/users";
import { createSessionValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/server/session";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { token?: string; password?: string };
    const token = String(body.token ?? "").trim();
    const password = String(body.password ?? "");
    if (!token) {
      return NextResponse.json({ error: "Ontbrekende token." }, { status: 400 });
    }
    const result = await completePasswordReset(token, password);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    await completePlatformOnboarding(result.userId);
    await touchUserSeen(result.userId);

    const user = await resolveAppUserById(result.userId);
    const publicUser = user ? toPublicUser(user) : null;

    const res = NextResponse.json({
      ok: true,
      message: "Je wachtwoord is aangemaakt. Welkom op het platform!",
      user: publicUser,
    });
    res.cookies.set(SESSION_COOKIE_NAME, createSessionValue(result.userId), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}
