import { NextResponse } from "next/server";
import { findUserByEmail, touchUserSeen, verifyPassword } from "@/lib/server/users";
import { createSessionValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/server/session";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    if (!email || !password) {
      return NextResponse.json({ error: "E-mail en wachtwoord verplicht." }, { status: 400 });
    }

    const user = await findUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "Onjuiste inloggegevens." }, { status: 401 });
    }
    await touchUserSeen(user.id);

    const res = NextResponse.json({
      ok: true,
      needsEmailVerification: Boolean(user.emailVerifyToken && !user.emailVerifiedAt),
      user: {
        id: user.id,
        email: user.email,
        naam: user.naam,
        leeftijd: user.leeftijd,
        createdAt: user.createdAt,
      },
    });
    res.cookies.set(SESSION_COOKIE_NAME, createSessionValue(user.id), {
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
