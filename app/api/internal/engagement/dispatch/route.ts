import { NextResponse } from "next/server";
import { ensureUserInboxForOwner, listSummaries } from "@/lib/server/conversations";
import { maybeSendEngagementNudges } from "@/lib/server/engagementNudges";
import { listUsers } from "@/lib/server/users";

export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const expected = process.env.ENGAGEMENT_CRON_SECRET?.trim();
  if (!expected) return false;
  const incoming = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  return incoming.length > 0 && incoming === expected;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const users = await listUsers();
  let processed = 0;
  for (const user of users) {
    if (!user.id) continue;
    try {
      await ensureUserInboxForOwner(user.id);
      await maybeSendEngagementNudges(user.id);
      await listSummaries(user.id);
      processed += 1;
    } catch {
      // best effort per user
    }
  }
  return NextResponse.json({ ok: true, processed });
}
