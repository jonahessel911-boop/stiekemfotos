import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ensureSeedConversations,
  ensureUserInboxForOwner,
  findOrCreateConversation,
  listSummaries,
} from "@/lib/server/conversations";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { isUserEmailVerified, touchUserSeen } from "@/lib/server/users";

export async function GET() {
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) {
      await ensureSeedConversations();
    } else {
      if (!(await isUserEmailVerified(userId))) {
        return NextResponse.json(
          { error: "Verifieer je e-mail die je hebt gekregen." },
          { status: 403 }
        );
      }
      await ensureUserInboxForOwner(userId);

      // Definitief opruimen van legacy "local" / seed chats (zonder ownerUserId)
      // zodat de inbox alleen echte, door de gebruiker gestarte gesprekken bevat.
      const { purgeLegacySeedConversations } = await import("@/lib/server/conversations");
      await purgeLegacySeedConversations(userId);

      /**
       * Belangrijk:
       * We sturen GEEN engagement-nudges meer tijdens inbox-laden.
       * Anders krijgt de gebruiker bij elke refresh/open nieuwe berichten,
       * wat als "database slaat niet goed op" voelt.
       *
       * Nudges moeten alleen via aparte trigger/cron komen, niet via GET inbox.
       */
    }
    const conversations = await listSummaries(userId);
    return NextResponse.json({ conversations });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) {
      return NextResponse.json({ error: "Log in om te chatten." }, { status: 401 });
    }
    if (!(await isUserEmailVerified(userId))) {
      return NextResponse.json({ error: "Verifieer eerst je e-mail." }, { status: 403 });
    }
    await touchUserSeen(userId);
    const body = (await req.json()) as { profileId?: string };
    if (!body.profileId) {
      return NextResponse.json({ error: "profileId is verplicht" }, { status: 400 });
    }
    const conversation = await findOrCreateConversation(body.profileId, userId);
    return NextResponse.json({ conversation });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 400 }
    );
  }
}
