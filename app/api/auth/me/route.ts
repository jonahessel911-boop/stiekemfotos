import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { findUserById, toPublicUser } from "@/lib/server/users";

/**
 * Lichte endpoint: geen inbox-/engagement-werk (dat zit op GET /api/conversations).
 * Geen touchUserSeen hier: dat zou "altijd online" geven voor offline e-mailnotificaties.
 */
export async function GET() {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE_NAME)?.value;
  const userId = parseSessionValue(raw);
  if (!userId) {
    return NextResponse.json({ user: null });
  }
  const user = await findUserById(userId);
  if (!user) {
    return NextResponse.json({ user: null });
  }
  return NextResponse.json({ user: toPublicUser(user) });
}
