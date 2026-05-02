import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { readJson, writeJson } from "@/lib/server/store";

export interface QualificationEntry {
  id: string;
  name: string;
  age: number;
  city: string;
  bio: string;
  lookingFor: string;
  createdAt: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<QualificationEntry>;
    const name = String(body.name ?? "").trim();
    const age = Number(body.age);
    const city = String(body.city ?? "").trim();
    const bio = String(body.bio ?? "").trim();
    const lookingFor = String(body.lookingFor ?? "").trim();

    if (!name || !city || !bio || !lookingFor || !Number.isFinite(age) || age < 18) {
      return NextResponse.json(
        { error: "Vul alle velden correct in (leeftijd minimaal 18)." },
        { status: 400 }
      );
    }

    const list = readJson<QualificationEntry[]>("qualifications.json", []);
    const entry: QualificationEntry = {
      id: randomUUID(),
      name,
      age,
      city,
      bio,
      lookingFor,
      createdAt: new Date().toISOString(),
    };
    list.push(entry);
    writeJson("qualifications.json", list);

    return NextResponse.json({ ok: true, id: entry.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}
