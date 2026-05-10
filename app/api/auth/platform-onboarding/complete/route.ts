import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { completePlatformOnboarding, findUserById, toPublicUser } from "@/lib/server/users";

export async function POST() {
  const jar = await cookies();
  const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
  if (!userId) {
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  }
  const existing = await findUserById(userId);
  if (!existing) {
    return NextResponse.json({ error: "Gebruiker niet gevonden." }, { status: 401 });
  }
  const updated = await completePlatformOnboarding(userId);
  if (!updated) {
    return NextResponse.json({ error: "Kon onboarding niet opslaan." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, user: toPublicUser(updated) });
}
