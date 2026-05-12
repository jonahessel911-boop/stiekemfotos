import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readJson, writeJson } from "@/lib/server/store";
import { createUser } from "@/lib/server/users";
import { createSessionValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/server/session";
import {
  buildSvlTxidForUser,
  sendSvlPostback,
  SVL_CLICK_ID_COOKIE,
  SVL_CONVERSION_TYPE,
  SVL_PAYOUT_COOKIE,
  SVL_TXID_COOKIE,
} from "@/lib/swiftvisitlog";

type SignupBody = {
  naam: string;
  email: string;
  leeftijd: number;
  wachtwoord: string;
  discreetAkkoord: boolean;
  voorwaardenAkkoord: boolean;
  zoekLeeftijdCategorie?: string;
  zoekEigenschappen?: string[];
  geschatteMatches?: number;
};

type StoredSignup = Omit<SignupBody, "wachtwoord"> & { createdAt: string };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<SignupBody>;
    const naam = String(body.naam ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const leeftijd = Number(body.leeftijd);
    const wachtwoord = String(body.wachtwoord ?? "");
    const discreetAkkoord = Boolean(body.discreetAkkoord);
    const voorwaardenAkkoord = Boolean(body.voorwaardenAkkoord);
    const zoekLeeftijdCategorie =
      typeof body.zoekLeeftijdCategorie === "string"
        ? body.zoekLeeftijdCategorie.trim()
        : undefined;
    const zoekEigenschappen = Array.isArray(body.zoekEigenschappen)
      ? body.zoekEigenschappen.filter((x) => typeof x === "string")
      : undefined;
    const geschatteMatches =
      typeof body.geschatteMatches === "number" &&
      Number.isFinite(body.geschatteMatches)
        ? Math.round(body.geschatteMatches)
        : undefined;

    if (!naam || !email || !Number.isFinite(leeftijd) || leeftijd < 18) {
      return NextResponse.json({ error: "Ongeldige gegevens." }, { status: 400 });
    }
    if (wachtwoord.length < 8) {
      return NextResponse.json(
        { error: "Kies een wachtwoord van minimaal 8 tekens." },
        { status: 400 }
      );
    }
    if (!discreetAkkoord || !voorwaardenAkkoord) {
      return NextResponse.json(
        { error: "Je moet beide vakjes aanvinken." },
        { status: 400 }
      );
    }

    const jar = await cookies();
    const clickIdCookie = jar.get(SVL_CLICK_ID_COOKIE)?.value?.trim();
    const payoutCookie = jar.get(SVL_PAYOUT_COOKIE)?.value?.trim();
    const txidCookie = jar.get(SVL_TXID_COOKIE)?.value?.trim();

    let user;
    try {
      user = await createUser({
        naam,
        email,
        leeftijd,
        password: wachtwoord,
        discreetAkkoord,
        voorwaardenAkkoord,
        ...(zoekLeeftijdCategorie ? { zoekLeeftijdCategorie } : {}),
        ...(zoekEigenschappen?.length ? { zoekEigenschappen } : {}),
        ...(geschatteMatches != null ? { geschatteMatches } : {}),
        ...(clickIdCookie ? { clickId: clickIdCookie } : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Fout";
      if (msg.includes("al geregistreerd")) {
        return NextResponse.json({ error: msg }, { status: 409 });
      }
      throw e;
    }

    const list = readJson<StoredSignup[]>("onboarding-signups.json", []);
    list.push({
      naam,
      email,
      leeftijd,
      discreetAkkoord,
      voorwaardenAkkoord,
      createdAt: new Date().toISOString(),
    });
    writeJson("onboarding-signups.json", list);
    /**
     * ClickFlare postback bij signup — initieel met payout=0 + ct=signup +
     * txid=user_<id>. Na een succesvolle Stripe-betaling wordt op dezelfde
     * (click_id, txid, ct) opnieuw geschoten met de geüpdatete payout (LTV)
     * en dedupliceert ClickFlare de conversion. Vervangt de eerdere
     * server-side TikTok fire.
     */
    if (clickIdCookie) {
      await sendSvlPostback({
        clickId: clickIdCookie,
        payout: payoutCookie || "0.00",
        txid: txidCookie || buildSvlTxidForUser(user.id),
        ct: SVL_CONVERSION_TYPE,
        reason: "signup",
      });
    } else {
      console.log("[clickflare:signup] skipped — missing click_id cookie");
    }

    const res = NextResponse.json({
      ok: true,
      needsEmailVerification: false,
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
