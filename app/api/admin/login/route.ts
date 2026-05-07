import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_MAX_AGE,
  createAdminCookieValue,
  isValidAdminLogin,
} from "@/lib/server/adminAuth";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    const email = String(body.email ?? "");
    const password = String(body.password ?? "");
    if (!isValidAdminLogin(email, password)) {
      return NextResponse.json({ error: "Onjuiste admin login." }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_SESSION_COOKIE_NAME, createAdminCookieValue(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: ADMIN_SESSION_MAX_AGE,
      path: "/",
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Inloggen mislukt." }, { status: 400 });
  }
}
