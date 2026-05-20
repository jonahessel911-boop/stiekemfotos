import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { registerStartLead } from "@/lib/server/startLead";
import { createSessionValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/server/session";
import { toPublicUser } from "@/lib/server/users";
import {
  buildSvlTxidForUser,
  sendSvlPostback,
  SVL_CLICK_ID_COOKIE,
  SVL_CONVERSION_TYPE,
  SVL_PAYOUT_COOKIE,
  SVL_TXID_COOKIE,
} from "@/lib/clickflare-postback";

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
    const payoutCookie = jar.get(SVL_PAYOUT_COOKIE)?.value?.trim();
    const txidCookie = jar.get(SVL_TXID_COOKIE)?.value?.trim();

    const { user, created } = await registerStartLead({
      email,
      startPath,
      clickId: clickId || clickIdCookie,
    });

    if (clickIdCookie) {
      await sendSvlPostback({
        clickId: clickIdCookie,
        payout: payoutCookie || "0.00",
        txid: txidCookie || buildSvlTxidForUser(user.id),
        ct: SVL_CONVERSION_TYPE,
        reason: "signup",
      });
    }

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
