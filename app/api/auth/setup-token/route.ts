import { NextResponse } from "next/server";
import { findUserByPasswordResetToken } from "@/lib/server/users";

/** Valideert setup-token uit toegangs-mail (geen wachtwoord teruggeven). */
export async function GET(req: Request) {
  try {
    const token = new URL(req.url).searchParams.get("token")?.trim() ?? "";
    if (!token) {
      return NextResponse.json({ error: "Token ontbreekt." }, { status: 400 });
    }

    const user = await findUserByPasswordResetToken(token);
    if (!user) {
      return NextResponse.json(
        { error: "Ongeldige of verlopen link. Vraag een nieuwe toegangs-mail aan." },
        { status: 404 }
      );
    }

    const exp = user.passwordResetExpiresAt
      ? new Date(user.passwordResetExpiresAt).getTime()
      : 0;
    if (!exp || Date.now() > exp) {
      return NextResponse.json(
        { error: "Deze link is verlopen. Vraag een nieuwe toegangs-mail aan." },
        { status: 410 }
      );
    }

    return NextResponse.json({
      ok: true,
      email: user.email,
      naam: user.naam,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}
