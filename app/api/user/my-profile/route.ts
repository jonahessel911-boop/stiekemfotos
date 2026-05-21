import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import {
  findUserById,
  parseHobbiesInput,
  patchUserRecord,
  resolveAppUserById,
  toUserMyProfile,
} from "@/lib/server/users";

async function requireUserId(): Promise<string | NextResponse> {
  const jar = await cookies();
  const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
  if (!userId) {
    return NextResponse.json({ error: "Log in om je profiel te beheren." }, { status: 401 });
  }
  return userId;
}

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const user = await resolveAppUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "Account niet gevonden." }, { status: 404 });
  }
  return NextResponse.json({ profile: toUserMyProfile(user) });
}

export async function PATCH(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const body = (await req.json()) as {
      naam?: string;
      leeftijd?: number;
      profileBio?: string;
      profileHobbies?: string[] | string;
      profileLocation?: string;
    };

    const existing = await findUserById(userId);
    if (!existing) {
      return NextResponse.json({ error: "Account niet gevonden." }, { status: 404 });
    }

    const patch: Parameters<typeof patchUserRecord>[1] = {};

    if (body.naam !== undefined) {
      const naam = String(body.naam).trim();
      if (!naam || naam.length > 40) {
        return NextResponse.json({ error: "Ongeldige gebruikersnaam." }, { status: 400 });
      }
      patch.naam = naam;
    }

    if (body.leeftijd !== undefined) {
      const leeftijd = Number(body.leeftijd);
      if (!Number.isFinite(leeftijd) || leeftijd < 18 || leeftijd > 99) {
        return NextResponse.json({ error: "Leeftijd moet tussen 18 en 99 zijn." }, { status: 400 });
      }
      patch.leeftijd = Math.round(leeftijd);
    }

    if (body.profileBio !== undefined) {
      patch.profileBio = String(body.profileBio).trim().slice(0, 2000);
    }

    if (body.profileHobbies !== undefined) {
      patch.profileHobbies = parseHobbiesInput(body.profileHobbies);
    }

    if (body.profileLocation !== undefined) {
      patch.profileLocation = String(body.profileLocation).trim().slice(0, 80);
    }

    const updated = await patchUserRecord(userId, patch);
    if (!updated) {
      return NextResponse.json({ error: "Opslaan mislukt." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, profile: toUserMyProfile(updated) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}
