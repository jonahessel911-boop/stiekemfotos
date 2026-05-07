import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readJsonBlob } from "@/lib/server/blobJson";
import { ADMIN_SESSION_COOKIE_NAME, parseAdminCookieValue } from "@/lib/server/adminAuth";
import { completeChat } from "@/lib/grok";
import type { Conversation } from "@/lib/types/chat";

type UserRow = {
  id: string;
  email: string;
  naam: string;
  leeftijd: number;
  createdAt: string;
  personalFacts?: unknown;
};

export const maxDuration = 240;

export async function POST(req: Request) {
  const jar = await cookies();
  const ok = parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await req.json()) as { userId?: string; question?: string };
    const userId = String(body.userId ?? "").trim();
    const question = String(body.question ?? "").trim();
    if (!userId) return NextResponse.json({ error: "Kies een user." }, { status: 400 });
    if (!question) return NextResponse.json({ error: "Vul een vraag in." }, { status: 400 });

    const [users, conversations] = await Promise.all([
      readJsonBlob<UserRow[]>("users.json", []),
      readJsonBlob<Conversation[]>("conversations.json", []),
    ]);

    const user = users.find((u) => u.id === userId);
    if (!user) return NextResponse.json({ error: "User niet gevonden." }, { status: 404 });

    const userConvs = conversations
      .filter((c) => c.ownerUserId === user.id)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const conversationDigest = userConvs
      .slice(0, 12)
      .map((c, idx) => {
        const recent = c.messages.slice(-16);
        const history = recent
          .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content || "(leeg)"}`)
          .join("\n");
        return `[#${idx + 1}] Profiel: ${c.profileName}\nUpdated: ${c.updatedAt}\nBerichten: ${c.messages.length}\n${history}`;
      })
      .join("\n\n---\n\n");

    const prompt = [
      "Je bent een admin intelligence assistent voor discreetemeisjes.",
      "Geef precies antwoord op de vraag op basis van de data hieronder.",
      "Als iets niet zeker is, zeg dat expliciet.",
      "",
      "=== USER ===",
      `id: ${user.id}`,
      `naam: ${user.naam}`,
      `email: ${user.email}`,
      `leeftijd: ${user.leeftijd}`,
      `createdAt: ${user.createdAt}`,
      `personalFacts: ${JSON.stringify(user.personalFacts ?? null)}`,
      "",
      "=== CONVERSATION DIGEST ===",
      conversationDigest || "(geen gesprekken)",
    ].join("\n");

    const answer = await completeChat([
      {
        role: "system",
        content:
          "Je bent scherp, feitelijk en kort. Nooit data verzinnen. Gebruik alleen aangeleverde context.",
      },
      { role: "user", content: `${prompt}\n\nVraag van admin:\n${question}` },
    ]);

    return NextResponse.json({ answer });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 400 }
    );
  }
}
