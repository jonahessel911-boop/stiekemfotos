import { NextResponse } from "next/server";
import { processDueAbandonmentOfferEmails } from "@/lib/server/abandonmentOffer";

export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const expected = process.env.ENGAGEMENT_CRON_SECRET?.trim();
  if (!expected) return false;
  const incoming = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  return incoming.length > 0 && incoming === expected;
}

/** Verstuurt abandonment-mails (1 uur na start-lead, nog niet betaald). */
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await processDueAbandonmentOfferEmails();
  return NextResponse.json({ ok: true, ...result });
}
