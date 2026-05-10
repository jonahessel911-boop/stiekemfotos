import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export type GalleryPrefsPayload = {
  folders: string[];
  folderMap: Record<string, string>;
};

export async function getGalleryPrefsForUser(userId: string): Promise<GalleryPrefsPayload> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return { folders: [], folderMap: {} };
  }
  const { data, error } = await admin
    .from("user_gallery_prefs")
    .select("folders, folder_map")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) {
    return { folders: [], folderMap: {} };
  }
  const foldersRaw = data.folders;
  const mapRaw = data.folder_map;
  const folders = Array.isArray(foldersRaw)
    ? foldersRaw.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const folderMap =
    mapRaw && typeof mapRaw === "object" && !Array.isArray(mapRaw)
      ? (mapRaw as Record<string, string>)
      : {};
  return { folders, folderMap };
}

export async function upsertGalleryPrefsForUser(
  userId: string,
  prefs: GalleryPrefsPayload
): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("Supabase service role niet geconfigureerd.");
  }
  const { error } = await admin.from("user_gallery_prefs").upsert(
    {
      user_id: userId,
      folders: prefs.folders,
      folder_map: prefs.folderMap,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) {
    throw new Error(error.message);
  }
}
