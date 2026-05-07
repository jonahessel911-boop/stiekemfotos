import { NextResponse } from "next/server";
import { createPasswordResetRequest } from "@/lib/server/users";
import { sendPasswordResetEmail } from "@/lib/server/email";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Vul een geldig e-mailadres in." }, { status: 400 });
    }

    const reqResult = await createPasswordResetRequest(email);
    if (reqResult) {
      try {
        await sendPasswordResetEmail({
          to: reqResult.email,
          naam: reqResult.naam,
          resetToken: reqResult.token,
        });
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "E-mail versturen mislukt." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      message:
        "Als dit e-mailadres bij ons bekend is, ontvang je zo een mail met een link om je wachtwoord te resetten.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}
