import { NextResponse } from "next/server";
import { processPlatform2OnlinePromptEmails } from "@/lib/server/platform2-online-prompt";

export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const expected = process.env.ENGAGEMENT_CRON_SECRET?.trim();
  if (!expected) return false;
  const incoming = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  return incoming.length > 0 && incoming === expected;
}

/** Max. 1 online-mail per run per user; vercel.json triggert 3× per dag. */
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processPlatform2OnlinePromptEmails();
  return NextResponse.json({ ok: true, ...result });
}
