import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseAdminCookieValue, ADMIN_SESSION_COOKIE_NAME } from "@/lib/server/adminAuth";
import {
  sendAbandonmentOfferEmailToUser,
} from "@/lib/server/abandonmentOffer";
import { resolveAppUserByEmail } from "@/lib/server/users";

/** Admin: abandonment-mail met 62% korting (zelfde als 1 uur na start zonder betaling). */
export async function POST(req: Request) {
  const jar = await cookies();
  const ok = parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await req.json()) as {
      userId?: string;
      email?: string;
      force?: boolean;
    };
    const userId = String(body.userId ?? "").trim();
    const email = String(body.email ?? "").trim();
    if (!userId && !email) {
      return NextResponse.json({ error: "userId of email ontbreekt." }, { status: 400 });
    }

    let targetUserId = userId;
    if (!targetUserId && email) {
      const byEmail = await resolveAppUserByEmail(email);
      if (!byEmail) {
        return NextResponse.json(
          { error: "User niet gevonden op e-mail.", reason: "user_not_found" },
          { status: 404 }
        );
      }
      targetUserId = byEmail.id;
    }

    const result = await sendAbandonmentOfferEmailToUser({
      userId: targetUserId,
      force: Boolean(body.force),
      admin: true,
    });

    if (!result.sent) {
      const messages: Record<string, string> = {
        user_not_found: "User niet gevonden.",
        already_paid: "User heeft al platformtoegang betaald.",
        has_credit_purchase: "User heeft al een credit-aankoop gedaan.",
        already_sent:
          "Korting-mail is al verstuurd. Gebruik opnieuw versturen als je een tweede mail wilt.",
      };
      const status =
        result.reason === "user_not_found"
          ? 404
          : result.reason === "already_sent"
            ? 409
            : 400;
      return NextResponse.json(
        { error: messages[result.reason] ?? "E-mail versturen mislukt.", reason: result.reason },
        { status }
      );
    }

    return NextResponse.json({
      ok: true,
      message: `Korting-e-mail verstuurd naar ${result.to} (${result.subject}).`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "E-mail versturen mislukt." },
      { status: 500 }
    );
  }
}
