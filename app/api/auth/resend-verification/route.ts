import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import {
  ensureUserEmailVerifyToken,
  findUserById,
  updateUserEmailForVerification,
} from "@/lib/server/users";
import { sendAccountVerificationEmail } from "@/lib/server/email";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const requestedEmail = String(body.email ?? "").trim().toLowerCase();
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) {
      return NextResponse.json({ error: "Log in vereist." }, { status: 401 });
    }
    const user = await findUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "Gebruiker niet gevonden." }, { status: 404 });
    }
    if (user.emailVerifiedAt) {
      return NextResponse.json({ ok: true, alreadyVerified: true });
    }

    let token: string | null = null;
    let targetEmail = user.email;
    if (requestedEmail) {
      const updated = await updateUserEmailForVerification(userId, requestedEmail);
      if (!updated.ok) {
        return NextResponse.json({ error: updated.reason }, { status: 400 });
      }
      token = updated.token;
      targetEmail = requestedEmail;
    } else {
      token = await ensureUserEmailVerifyToken(userId);
    }

    if (!token) {
      return NextResponse.json({ error: "Token maken mislukt." }, { status: 400 });
    }
    await sendAccountVerificationEmail({
      to: targetEmail,
      naam: user.naam,
      verifyToken: token,
    });
    return NextResponse.json({ ok: true, email: targetEmail });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Verificatiemail versturen mislukt." },
      { status: 500 }
    );
  }
}
