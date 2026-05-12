import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { writeJsonBlob } from "@/lib/server/blobJson";
import { ADMIN_SESSION_COOKIE_NAME, parseAdminCookieValue } from "@/lib/server/adminAuth";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { writeJson } from "@/lib/server/store";

const BLOB_FILES_TO_CLEAR = [
  "users.json",
  "conversations.json",
  "stripe-checkouts.json",
  "onboarding-signups.json",
  "credit-ledger.json",
];

const SUPABASE_TABLES_TO_TRUNCATE: { table: string; column: string }[] = [
  // Volgorde respecteert foreign keys (kinderen eerst).
  { table: "messages", column: "id" },
  { table: "photo_requests", column: "id" },
  { table: "stripe_checkouts", column: "session_id" },
  { table: "conversations", column: "id" },
  { table: "credit_ledger", column: "id" },
  { table: "users", column: "id" },
];

type WipeReport = {
  blob: { file: string; ok: boolean; error?: string }[];
  /** Lokale `data/` (en /tmp op serverless) — o.a. onboarding-signups wordt door routes met readJson gelezen, niet via blob. */
  localJson: { file: string; ok: boolean; error?: string }[];
  supabase: { table: string; ok: boolean; error?: string }[];
};

export async function POST() {
  const jar = await cookies();
  const ok = parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const report: WipeReport = { blob: [], localJson: [], supabase: [] };

  for (const file of BLOB_FILES_TO_CLEAR) {
    try {
      await writeJsonBlob(file, []);
      report.blob.push({ file, ok: true });
    } catch (e) {
      report.blob.push({
        file,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  for (const file of BLOB_FILES_TO_CLEAR) {
    try {
      writeJson(file, []);
      report.localJson.push({ file, ok: true });
    } catch (e) {
      report.localJson.push({
        file,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const admin = getSupabaseAdmin();
  if (admin) {
    for (const { table, column } of SUPABASE_TABLES_TO_TRUNCATE) {
      try {
        // Supabase eist een filter — verwijder alles via `neq` op een niet-bestaande sentinel.
        const { error } = await admin.from(table).delete().neq(column, "__never__");
        if (error) {
          report.supabase.push({ table, ok: false, error: error.message });
        } else {
          report.supabase.push({ table, ok: true });
        }
      } catch (e) {
        report.supabase.push({
          table,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } else {
    report.supabase.push({
      table: "(service role)",
      ok: false,
      error: "Supabase service role niet geconfigureerd — alleen blob/JSON gewist.",
    });
  }

  return NextResponse.json({ ok: true, report });
}
