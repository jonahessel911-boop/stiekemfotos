import { NextResponse } from "next/server";
import { readAiSettings, writeAiSettings } from "@/lib/server/aiSettings";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/aiDefaults";

function checkPin(req: Request, body?: { pin?: string }): boolean {
  const pin = process.env.INSTELLINGEN_PIN;
  if (!pin) return true;
  const headerPin = req.headers.get("x-settings-pin");
  if (headerPin === pin) return true;
  if (body?.pin === pin) return true;
  return false;
}

export async function GET() {
  const s = readAiSettings();
  return NextResponse.json({
    systemPrompt: s.systemPrompt,
    defaultPrompt: DEFAULT_SYSTEM_PROMPT,
    hasPin: Boolean(process.env.INSTELLINGEN_PIN),
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { systemPrompt?: string; pin?: string };
  if (!checkPin(req, body)) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  if (body.systemPrompt === undefined || body.systemPrompt === null) {
    return NextResponse.json({ error: "systemPrompt ontbreekt" }, { status: 400 });
  }
  writeAiSettings({ systemPrompt: body.systemPrompt });
  return NextResponse.json({ ok: true, systemPrompt: body.systemPrompt });
}
