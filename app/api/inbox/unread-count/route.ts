import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  flushInboxAutomationsForOwner,
  listSummaries,
} from "@/lib/server/conversations";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { isUserEmailVerified } from "@/lib/server/users";

/**
 * Lightweight endpoint dat alleen het TOTAAL aantal ongelezen profiel-berichten
 * teruggeeft, zodat de Navbar een badge kan tonen zonder de hele inbox-summary
 * te hoeven hydrateren in de UI. Polling-vriendelijk (kleine payload).
 */
export async function GET() {
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) {
      return NextResponse.json({ total: 0 });
    }
    if (!(await isUserEmailVerified(userId))) {
      return NextResponse.json({ total: 0 });
    }
    // Flush queued profiel-replies zodat ze meetellen in unread zodra de timer
    // verstreken is — ook als de user niet op /berichten is.
    await flushInboxAutomationsForOwner(userId).catch(() => {});
    const list = await listSummaries(userId);
    const total = list.reduce((acc, s) => acc + (Number.isFinite(s.unread) ? s.unread : 0), 0);
    return NextResponse.json({ total });
  } catch {
    return NextResponse.json({ total: 0 });
  }
}
