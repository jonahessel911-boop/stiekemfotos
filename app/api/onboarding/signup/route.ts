import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readJson, writeJson } from "@/lib/server/store";
import { createUser, findUserByEmail, persistClickIdOnUser } from "@/lib/server/users";
import { createSessionValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/server/session";
import { SVL_CLICK_ID_COOKIE } from "@/lib/clickflare-postback";

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
        const existing = await findUserByEmail(email);
        if (existing && clickIdCookie) {
          await persistClickIdOnUser(existing.id, clickIdCookie);
        }
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
    /** click_id staat op user.clickId — ClickFlare pas na betaling (zie ontmoetjongens-conversion). */

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
