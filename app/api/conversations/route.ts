import { NextResponse } from "next/server";
import {
  ensureSeedConversations,
  findOrCreateConversation,
  listSummaries,
} from "@/lib/server/conversations";

export async function GET() {
  try {
    ensureSeedConversations();
    return NextResponse.json({ conversations: listSummaries() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { profileId?: string };
    if (!body.profileId) {
      return NextResponse.json({ error: "profileId is verplicht" }, { status: 400 });
    }
    const conversation = findOrCreateConversation(body.profileId);
    return NextResponse.json({ conversation });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 400 }
    );
  }
}
