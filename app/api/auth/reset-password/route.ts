import { NextResponse } from "next/server";
import { completePasswordReset } from "@/lib/server/users";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { token?: string; password?: string };
    const token = String(body.token ?? "").trim();
    const password = String(body.password ?? "");
    if (!token) {
      return NextResponse.json({ error: "Ontbrekende token." }, { status: 400 });
    }
    const result = await completePasswordReset(token, password);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, message: "Je wachtwoord is bijgewerkt. Je kunt nu inloggen." });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}
