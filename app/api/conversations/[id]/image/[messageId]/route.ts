import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import path from "path";
import { convImageDir } from "@/lib/server/convImageStore";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

/**
 * Image proxy/redirect voor profielmedia en chat-images.
 *
 * Lookup volgorde:
 *   1) Lokaal filesystem (`data/conv-images/<conversationId>/<messageId>.{jpg,jpeg,png}`)
 *      — alleen relevant in dev / warm-container scenario's; op Vercel ephemeral.
 *   2) Vercel Blob op het bekende profile-media prefix
 *      `stiekemefotos/profile-media/<conversationId>/<messageId>.{jpg,jpeg,png}`.
 *      Hierheen wordt geschreven door `persistConversationImageAsPublicUrl`
 *      (zie `lib/server/randomProfileFactory.ts`).
 *   3) Vercel Blob breder zoeken via `list({ prefix })` — voor het geval
 *      een ander extensie/sub-pad is gebruikt.
 *   4) Supabase `profile_media`: zoek een row waarvan `url` deze `messageId`
 *      bevat (admin-seed profielen schrijven daar de uiteindelijke publieke
 *      URL naartoe — vaak een Vercel Blob URL of Supabase Storage URL).
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string; messageId: string }> }
) {
  const { id: conversationId, messageId } = await context.params;
  if (
    !conversationId ||
    !messageId ||
    messageId.includes("..") ||
    messageId.includes("/") ||
    conversationId.includes("..") ||
    conversationId.includes("/")
  ) {
    return NextResponse.json({ error: "Ongeldig" }, { status: 400 });
  }

  // ── 1) Lokaal filesystem ────────────────────────────────────────────────
  const dir = convImageDir(conversationId);
  for (const ext of ["jpg", "jpeg", "png"] as const) {
    const filePath = path.join(dir, `${messageId}.${ext}`);
    try {
      const buf = await readFile(filePath);
      const type = ext === "png" ? "image/png" : "image/jpeg";
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": type,
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch {
      /* try next ext */
    }
  }

  // ── 2/3) Vercel Blob ────────────────────────────────────────────────────
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (blobToken) {
    try {
      const { list } = await import("@vercel/blob");
      const prefix = `stiekemefotos/profile-media/${conversationId}/${messageId}`;
      const result = await list({ prefix, token: blobToken, limit: 10 });
      const matches = (result.blobs ?? []).filter((b) =>
        /\.(jpe?g|png)$/i.test(b.pathname)
      );
      // Voorkeurs-extensievolgorde voor consistentie.
      const ordered = [...matches].sort((a, b) => {
        const order = (p: string): number => {
          const lp = p.toLowerCase();
          if (lp.endsWith(".jpg")) return 0;
          if (lp.endsWith(".jpeg")) return 1;
          if (lp.endsWith(".png")) return 2;
          return 3;
        };
        return order(a.pathname) - order(b.pathname);
      });
      const pick = ordered[0];
      if (pick?.url) {
        return NextResponse.redirect(pick.url, { status: 302 });
      }
    } catch (e) {
      console.warn(
        "[image] vercel blob lookup failed",
        e instanceof Error ? e.message : e
      );
    }
  }

  // ── 4) Supabase profile_media URL fallback ──────────────────────────────
  try {
    const admin = getSupabaseAdmin();
    if (admin) {
      const { data, error } = await admin
        .from("profile_media")
        .select("url")
        .ilike("url", `%${messageId}%`)
        .limit(1);
      if (!error) {
        const row = (data?.[0] as { url?: string | null } | undefined) ?? null;
        const url = (row?.url ?? "").trim();
        if (url && /^https?:\/\//i.test(url) && !url.includes(`/api/conversations/`)) {
          /** Alleen redirecten naar absolute externe URL; nooit naar deze route zelf (loop). */
          return NextResponse.redirect(url, { status: 302 });
        }
      }
    }
  } catch (e) {
    console.warn(
      "[image] supabase profile_media lookup failed",
      e instanceof Error ? e.message : e
    );
  }

  console.warn(
    `[image] not found conv=${conversationId} msg=${messageId} (fs+blob+db all miss)`
  );
  return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
}
