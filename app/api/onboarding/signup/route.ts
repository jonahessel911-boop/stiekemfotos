import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { readJson, writeJson } from "@/lib/server/store";
import { createUser } from "@/lib/server/users";
import { createSessionValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/server/session";
import { TIKTOK_ACCESS_TOKEN, TIKTOK_PIXEL_ID, TIKTOK_TRACK_URL } from "@/lib/tiktok";

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

function sha256LowerTrim(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

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
    // E-mailverificatie staat uit voor testing — geen Postmark-mail.

    // Server-side conversion fire zodat submit-events altijd mee gaan na geslaagde form-submit.
    try {
      const common = {
        event_time: Math.floor(Date.now() / 1000),
        user: {
          email: sha256LowerTrim(email),
          phone: null,
          external_id: sha256LowerTrim(user.id),
        },
        properties: {
          currency: null,
          content_type: "page",
        },
        page: {
          url: req.headers.get("origin") ?? null,
          referrer: req.headers.get("referer") ?? null,
        },
      };
      await fetch(TIKTOK_TRACK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Access-Token": TIKTOK_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          event_source: "web",
          event_source_id: TIKTOK_PIXEL_ID,
          pixel_code: TIKTOK_PIXEL_ID,
          data: [
            {
              event: "CompleteRegistration",
              ...common,
            },
            {
              event: "SubmitForm",
              ...common,
            },
          ],
        }),
        cache: "no-store",
      });
    } catch {
      // best effort tracking
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
