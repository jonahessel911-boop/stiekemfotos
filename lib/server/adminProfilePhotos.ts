import { randomUUID } from "crypto";
import { revalidateTag } from "next/cache";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { IMAGE_BUCKET, uploadImageToStorage } from "@/lib/server/imageStorage";

export type AdminProfilePhoto = {
  id: string;
  url: string;
  sortOrder: number;
  isAvatar: boolean;
};

const PROFILES_CACHE_TAG = "v2-profile-media";

function storagePathFromPublicUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  const marker = `/object/public/${IMAGE_BUCKET}/`;
  const idx = raw.indexOf(marker);
  if (idx >= 0) return decodeURIComponent(raw.slice(idx + marker.length).split("?")[0] ?? "");
  return null;
}

async function syncProfilePhotoFields(profileId: string): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase service role ontbreekt");

  const { data: media, error: mediaErr } = await supabase
    .from("profile_media")
    .select("url, sort_order")
    .eq("profile_id", profileId)
    .order("sort_order", { ascending: true });
  if (mediaErr) throw new Error(mediaErr.message);

  const urls = (media ?? [])
    .map((r) => String((r as { url?: string }).url ?? "").trim())
    .filter(Boolean);
  const avatarUrl = urls[0] ?? null;

  const { error: upErr } = await supabase
    .from("profiles")
    .update({
      avatar_url: avatarUrl,
      photo_urls: urls,
      is_active: urls.length > 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", profileId);
  if (upErr) throw new Error(upErr.message);

  revalidateTag(PROFILES_CACHE_TAG);
  return urls;
}

export async function listAdminProfilePhotos(profileId: string): Promise<{
  photos: AdminProfilePhoto[];
  avatarUrl: string | null;
}> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase service role ontbreekt");

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("id, avatar_url")
    .eq("id", profileId)
    .maybeSingle();
  if (profErr) throw new Error(profErr.message);
  if (!profile) throw new Error("Profiel niet gevonden");

  const avatarUrl = String((profile as { avatar_url?: string }).avatar_url ?? "").trim() || null;

  let { data: rows, error } = await supabase
    .from("profile_media")
    .select("id, url, sort_order")
    .eq("profile_id", profileId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);

  if (!rows || rows.length === 0) {
    const { data: legacy, error: legErr } = await supabase
      .from("profiles")
      .select("avatar_url, photo_urls")
      .eq("id", profileId)
      .single();
    if (!legErr && legacy) {
      const avatar = String((legacy as { avatar_url?: string }).avatar_url ?? "").trim();
      const json = (legacy as { photo_urls?: string[] }).photo_urls;
      const fromJson = Array.isArray(json) ? json.map((u) => String(u).trim()).filter(Boolean) : [];
      const ordered = [...new Set([avatar, ...fromJson].filter(Boolean))];
      if (ordered.length > 0) {
        const { error: seedErr } = await supabase.from("profile_media").insert(
          ordered.map((url, idx) => ({
            profile_id: profileId,
            media_type: "image",
            url,
            sort_order: idx,
          }))
        );
        if (!seedErr) {
          const again = await supabase
            .from("profile_media")
            .select("id, url, sort_order")
            .eq("profile_id", profileId)
            .order("sort_order", { ascending: true });
          rows = again.data;
        }
      }
    }
  }

  const photos: AdminProfilePhoto[] = (rows ?? []).map((raw) => {
    const row = raw as { id: string; url: string; sort_order: number | null };
    const url = String(row.url ?? "").trim();
    return {
      id: row.id,
      url,
      sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
      isAvatar: Boolean(avatarUrl && url && url === avatarUrl),
    };
  });

  return { photos, avatarUrl };
}

export async function uploadAdminProfilePhoto(
  profileId: string,
  buffer: Buffer,
  mime: string
): Promise<AdminProfilePhoto> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase service role ontbreekt");

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("id, slug")
    .eq("id", profileId)
    .maybeSingle();
  if (profErr) throw new Error(profErr.message);
  if (!profile) throw new Error("Profiel niet gevonden");

  const { count, error: countErr } = await supabase
    .from("profile_media")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId);
  if (countErr) throw new Error(countErr.message);
  const sortOrder = typeof count === "number" ? count : 0;

  const fileId = randomUUID();
  const slug = String((profile as { slug?: string }).slug ?? profileId).trim() || profileId;
  const uploaded = await uploadImageToStorage({
    pathSegments: ["admin-uploads", slug, `${fileId}`],
    buffer,
    mime,
    upsert: false,
  });

  const { data: inserted, error: insErr } = await supabase
    .from("profile_media")
    .insert({
      profile_id: profileId,
      media_type: "image",
      url: uploaded.publicUrl,
      sort_order: sortOrder,
    })
    .select("id, url, sort_order")
    .single();
  if (insErr || !inserted) throw new Error(insErr?.message ?? "Insert mislukt");

  const urls = await syncProfilePhotoFields(profileId);
  const url = String((inserted as { url: string }).url).trim();
  const avatarUrl = urls[0] ?? null;

  return {
    id: (inserted as { id: string }).id,
    url,
    sortOrder: typeof (inserted as { sort_order?: number }).sort_order === "number"
      ? (inserted as { sort_order: number }).sort_order
      : sortOrder,
    isAvatar: Boolean(avatarUrl && url === avatarUrl),
  };
}

export async function deleteAdminProfilePhoto(
  profileId: string,
  mediaId: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase service role ontbreekt");

  const { data: row, error: fetchErr } = await supabase
    .from("profile_media")
    .select("id, url, profile_id")
    .eq("id", mediaId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (!row) throw new Error("Foto niet gevonden");

  const url = String((row as { url?: string }).url ?? "").trim();
  const storagePath = storagePathFromPublicUrl(url);
  if (storagePath) {
    const { error: rmErr } = await supabase.storage.from(IMAGE_BUCKET).remove([storagePath]);
    if (rmErr) {
      console.warn("[adminProfilePhotos] storage remove failed:", rmErr.message, storagePath);
    }
  }

  const { error: delErr } = await supabase.from("profile_media").delete().eq("id", mediaId);
  if (delErr) throw new Error(delErr.message);

  const { data: remaining, error: remErr } = await supabase
    .from("profile_media")
    .select("id, url, sort_order")
    .eq("profile_id", profileId)
    .order("sort_order", { ascending: true });
  if (remErr) throw new Error(remErr.message);

  const rows = remaining ?? [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i] as { id: string; sort_order: number | null };
    if (r.sort_order !== i) {
      await supabase.from("profile_media").update({ sort_order: i }).eq("id", r.id);
    }
  }

  await syncProfilePhotoFields(profileId);
}
