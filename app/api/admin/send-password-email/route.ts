import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseAdminCookieValue, ADMIN_SESSION_COOKIE_NAME } from "@/lib/server/adminAuth";
import { sendPasswordResetEmail } from "@/lib/server/email";
import { createPasswordResetRequest, findUserById } from "@/lib/server/users";

export async function POST(req: Request) {
  const jar = await cookies();
  const ok = parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await req.json()) as { userId?: string };
    const userId = String(body.userId ?? "").trim();
    if (!userId) {
      return NextResponse.json({ error: "userId ontbreekt." }, { status: 400 });
    }

    const user = await findUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "User niet gevonden." }, { status: 404 });
    }

    const reset = await createPasswordResetRequest(user.email);
    if (!reset) {
      return NextResponse.json({ error: "Reset-token kon niet worden aangemaakt." }, { status: 500 });
    }

    await sendPasswordResetEmail({
      to: reset.email,
      naam: reset.naam,
      resetToken: reset.token,
    });

    console.info(`[admin send-password-email] verstuurd naar ${reset.email} (user=${userId})`);
    return NextResponse.json({
      ok: true,
      message: `Wachtwoord-reset e-mail verstuurd naar ${reset.email}.`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "E-mail versturen mislukt." },
      { status: 500 }
    );
  }
}
