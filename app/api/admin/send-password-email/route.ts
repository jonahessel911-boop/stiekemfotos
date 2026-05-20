import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseAdminCookieValue, ADMIN_SESSION_COOKIE_NAME } from "@/lib/server/adminAuth";
import { sendPlatformAccessEmailToUser } from "@/lib/server/ontmoetjongens-access-email";

/** Admin: zelfde toegangs-e-mail als na Stripe-betaling (voor testen). */
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

    const result = await sendPlatformAccessEmailToUser({ userId });
    if (!result.sent) {
      return NextResponse.json(
        { error: result.reason === "user_not_found" ? "User niet gevonden." : "E-mail versturen mislukt." },
        { status: result.reason === "user_not_found" ? 404 : 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: `Toegangs-e-mail verstuurd naar ${result.to ?? "ontvanger"}.`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "E-mail versturen mislukt." },
      { status: 500 }
    );
  }
}
