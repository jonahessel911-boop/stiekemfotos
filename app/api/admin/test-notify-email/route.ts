import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE_NAME, parseAdminCookieValue } from "@/lib/server/adminAuth";
import { getAdminNotifyEmail, sendAdminNewUserMessageEmail } from "@/lib/server/email";

export async function POST() {
  const jar = await cookies();
  if (!parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const to = getAdminNotifyEmail();
  if (!to) {
    return NextResponse.json({ error: "ADMIN_NOTIFY_EMAIL ontbreekt" }, { status: 500 });
  }

  try {
    await sendAdminNewUserMessageEmail({
      to,
      profileName: "Marcin",
      userName: "Test gebruiker",
      userEmail: "test@stiekemefotos.nl",
      preview: "Dit is een testmail — admin notificatie bij nieuw user-bericht.",
      conversationId: "test-admin-notify",
    });
    return NextResponse.json({ ok: true, to });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Versturen mislukt";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
