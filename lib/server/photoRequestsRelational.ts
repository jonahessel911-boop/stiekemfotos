import type { SupabaseClient } from "@supabase/supabase-js";
import type { PhotoRequest } from "@/lib/types/photo-request";
import { resolveUserIdForSupabaseFk } from "@/lib/server/ensureUserRowForFk";

export async function loadPhotoRequestsRelational(
  supabase: SupabaseClient
): Promise<PhotoRequest[]> {
  const { data, error } = await supabase
    .from("photo_requests")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("[photoRequestsRelational] load:", error.message);
    return [];
  }
  const out: PhotoRequest[] = [];
  for (const row of data ?? []) {
    const payload = (row as { payload?: PhotoRequest }).payload;
    if (payload && typeof payload === "object" && "id" in payload) {
      out.push(payload as PhotoRequest);
    }
  }
  return out;
}

export async function savePhotoRequestsRelational(
  supabase: SupabaseClient,
  list: PhotoRequest[]
): Promise<void> {
  const keep = new Set(list.map((r) => r.id));
  const { data: existing } = await supabase.from("photo_requests").select("id");
  for (const r of existing ?? []) {
    const id = (r as { id: string }).id;
    if (!keep.has(id)) {
      const { error } = await supabase.from("photo_requests").delete().eq("id", id);
      if (error) console.error("[photoRequestsRelational] delete orphan:", error.message);
    }
  }
  const ownerFkCache = new Map<string, string>();

  for (const pr of list) {
    const rawOwner = pr.ownerUserId?.trim();
    if (!rawOwner) {
      throw new Error(`[photoRequestsRelational] owner ontbreekt voor request ${pr.id}`);
    }
    let ownerFk = ownerFkCache.get(rawOwner);
    if (ownerFk === undefined) {
      const fk = await resolveUserIdForSupabaseFk(rawOwner);
      if (!fk) {
        throw new Error(
          `[photoRequestsRelational] owner ${pr.ownerUserId} ontbreekt in Postgres/users-store voor request ${pr.id}`
        );
      }
      ownerFk = fk;
      ownerFkCache.set(rawOwner, ownerFk);
    }
    const { error } = await supabase.from("photo_requests").upsert(
      {
        id: pr.id,
        owner_user_id: ownerFk,
        payload: pr,
        created_at: pr.createdAt,
        updated_at: pr.updatedAt,
      },
      { onConflict: "id" }
    );
    if (error) {
      throw new Error(`[photoRequestsRelational] upsert ${pr.id}: ${error.message}`);
    }
  }
}
