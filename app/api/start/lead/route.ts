import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { processDueAbandonmentOfferEmails } from "@/lib/server/abandonmentOffer";
import { registerStartLead } from "@/lib/server/startLead";
import { createSessionValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/server/session";
import { toPublicUser } from "@/lib/server/users";
import { SVL_CLICK_ID_COOKIE } from "@/lib/clickflare-postback";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      email?: string;
      startPath?: string;
      clickId?: string;
    };
    const email = String(body.email ?? "").trim();
    const startPath =
      typeof body.startPath === "string" ? body.startPath.trim() : undefined;
    const clickId =
      typeof body.clickId === "string" ? body.clickId.trim() : undefined;

    const jar = await cookies();
    const clickIdCookie = jar.get(SVL_CLICK_ID_COOKIE)?.value?.trim();

    const { user, created } = await registerStartLead({
      email,
      startPath,
      clickId: clickId || clickIdCookie,
    });

    void processDueAbandonmentOfferEmails().catch(() => {});

    const res = NextResponse.json({
      ok: true,
      created,
      user: toPublicUser(user),
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
    const msg = e instanceof Error ? e.message : "Fout";
    const status = msg.includes("geldig") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
