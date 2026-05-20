import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseAdminCookieValue, ADMIN_SESSION_COOKIE_NAME } from "@/lib/server/adminAuth";
import {
  TEST_USER_10K_EMAIL,
  TEST_USER_10K_PASSWORD,
} from "@/lib/test-user-10k";
import { upsertTestUser10kCredits } from "@/lib/server/testUser10k";

export async function POST() {
  const jar = await cookies();
  const ok = parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const user = await upsertTestUser10kCredits();
    return NextResponse.json({
      ok: true,
      message: `Testaccount klaar. Log in op /login met ${TEST_USER_10K_EMAIL} / ${TEST_USER_10K_PASSWORD}`,
      user: { id: user.id, email: user.email },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Seed mislukt." },
      { status: 500 }
    );
  }
}
