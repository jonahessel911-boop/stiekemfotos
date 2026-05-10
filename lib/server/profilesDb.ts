import { unstable_cache } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types/profile";
import { getSupabaseAdmin, stripEnvSecret } from "@/lib/server/supabaseAdmin";

type DbProfileRow = {
  id: string;
  slug: string;
  first_name: string;
  age: number;
  city: string;
  /** Ontbreken op oudere DB’s; niet in elke .select() opnemen i.v.m. schema-drift. */
  lengte_cm?: number | null;
  gewicht_kg?: number | null;
  cup_maat?: string | null;
  country: string;
  bio: string;
  interests: string[] | null;
  personality: string;
  system_prompt: string;
  avatar_url: string | null;
  photo_urls: string[] | null;
  voice_language: string;
  heritage: string | null;
  visual_identity_prompt: string | null;
  photo_unlock_credits: number | null;
  is_active: boolean;
};

function normalizeSupabaseUrl(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  return v.replace(/^https?:\/\/https?:\/\//i, "https://");
}

export function isSupabaseProfilesEnabled(): boolean {
  const url = normalizeSupabaseUrl(
    stripEnvSecret(process.env.SUPABASE_URL) ||
      stripEnvSecret(process.env.NEXT_PUBLIC_SUPABASE_URL)
  );
  const key =
    stripEnvSecret(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    stripEnvSecret(process.env.SUPABASE_SECRET_KEY) ||
    stripEnvSecret(process.env.SUPABASE_ANON_KEY) ||
    stripEnvSecret(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return Boolean(url && key);
}

let cachedProfilesClient: SupabaseClient | null | undefined;
function getSupabaseProfilesClient(): SupabaseClient | null {
  if (cachedProfilesClient !== undefined) return cachedProfilesClient;
  const admin = getSupabaseAdmin();
  if (admin) {
    cachedProfilesClient = admin;
    return cachedProfilesClient;
  }
  const url = normalizeSupabaseUrl(
    stripEnvSecret(process.env.SUPABASE_URL) ||
      stripEnvSecret(process.env.NEXT_PUBLIC_SUPABASE_URL)
  );
  const key =
    stripEnvSecret(process.env.SUPABASE_ANON_KEY) ||
    stripEnvSecret(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!url || !key) {
    cachedProfilesClient = null;
    return null;
  }
  cachedProfilesClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedProfilesClient;
}

function mapDbProfile(row: DbProfileRow, profileMediaUrls?: string[]): Profile {
  const jsonPhotos = Array.isArray(row.photo_urls) ? row.photo_urls.filter(Boolean) : [];
  const jsonOrdered = [row.avatar_url, ...jsonPhotos]
    .filter(Boolean)
    .map((u) => sanitizeStoredProfileImageUrl(String(u), row.id));
  const mediaOrdered = (profileMediaUrls ?? []).map((u) =>
    sanitizeStoredProfileImageUrl(String(u), row.id)
  );
  let ordered: string[];
  if (mediaOrdered.length > 0) {
    const seen = new Set(mediaOrdered);
    ordered = [...mediaOrdered, ...jsonOrdered.filter((u) => !seen.has(u))];
  } else {
    ordered = jsonOrdered;
  }
  const unique = [...new Set(ordered)];
  const primary = unique[0] ?? fallbackAvatarForProfile(row.id);
  return {
    id: row.id,
    slug: row.slug,
    name: row.first_name,
    age: row.age,
    location: row.city,
    lengte: row.lengte_cm ?? undefined,
    gewicht: row.gewicht_kg ?? undefined,
    cupMaat: row.cup_maat ?? undefined,
    heritage: row.heritage ?? row.country,
    visualIdentityPrompt: row.visual_identity_prompt?.trim() || undefined,
    personaStyle: "east_european",
    voiceLanguage: row.voice_language || "ro",
    photo: primary,
    photoUnlockCredits:
      typeof row.photo_unlock_credits === "number" && Number.isFinite(row.photo_unlock_credits)
        ? Math.max(1, Math.floor(row.photo_unlock_credits))
        : 100,
    photoGallery: unique.length > 0 ? unique : undefined,
    photosCount: Math.max(
      profileMediaUrls?.length ?? 0,
      jsonPhotos.length,
      unique.length,
      1
    ),
    videoCount: 0,
    isOnline: (row.age + row.first_name.length) % 2 === 0,
    bio: row.bio,
    interests: Array.isArray(row.interests) ? row.interests : [],
    onPlatformWhy: row.personality,
    communicationStyle:
      "kleine letters, korte zinnen, warm en direct. speels met een tikje mysterie.",
    speechStyle: "zachte oost-europese vibe, vrouwelijk en licht ondeugend.",
  };
}

function canonicalPhotoKey(url: string): string {
  const raw = url.trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    return u.toString();
  } catch {
    return raw;
  }
}

function fallbackAvatarForProfile(profileId: string): string {
  const seed = encodeURIComponent(`dm-${profileId}`);
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${seed}&backgroundColor=fce7f3`;
}

function sanitizeStoredProfileImageUrl(raw: string | null | undefined, profileId: string): string {
  const s = (raw ?? "").trim();
  if (!s) return fallbackAvatarForProfile(profileId);
  return s;
}

/** Haalt publieke foto-URL's uit `profile_media` (bron van waarheid na admin-seed). */
async function fetchProfileMediaUrlsByProfileIds(
  supabase: SupabaseClient,
  profileIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (profileIds.length === 0) return map;
  const client = getSupabaseAdmin();
  if (!client) {
    console.warn("[profilesDb] profile_media: geen SUPABASE_SERVICE_ROLE_KEY — kan geen media ophalen");
    return map;
  }
  const { data, error } = await client
    .from("profile_media")
    .select("profile_id, url, sort_order")
    .in("profile_id", profileIds);
  if (error) {
    console.warn("[profilesDb] profile_media:", error.message);
    return map;
  }
  type Row = { profile_id: string; url: string | null; sort_order: number | null };
  const grouped = new Map<string, Array<{ url: string; sort: number }>>();
  for (const raw of data ?? []) {
    const row = raw as Row;
    const pid = row.profile_id?.trim();
    const url = String(row.url ?? "").trim();
    if (!pid || !url) continue;
    const sort = typeof row.sort_order === "number" ? row.sort_order : 0;
    const arr = grouped.get(pid) ?? [];
    arr.push({ url, sort });
    grouped.set(pid, arr);
  }
  for (const [pid, arr] of grouped) {
    arr.sort((a, b) => a.sort - b.sort);
    map.set(
      pid,
      arr.map((x) => x.url)
    );
  }
  return map;
}

/** Zorgt dat de hoofdprofielfoto (avatar) nooit dubbel is tussen accounts. */
function enforceUniquePrimaryPhoto(profiles: Profile[]): Profile[] {
  const used = new Set<string>();
  return profiles.map((p) => {
    const candidates = [p.photo, ...(p.photoGallery ?? [])].filter(
      (x): x is string => Boolean(x && x.trim())
    );
    const uniqueCandidates: string[] = [];
    const seenLocal = new Set<string>();
    for (const c of candidates) {
      const key = canonicalPhotoKey(c);
      if (!key || seenLocal.has(key)) continue;
      seenLocal.add(key);
      uniqueCandidates.push(c);
    }

    let chosen =
      uniqueCandidates.find((c) => !used.has(canonicalPhotoKey(c))) ??
      fallbackAvatarForProfile(p.id);
    const chosenKey = canonicalPhotoKey(chosen);
    if (chosenKey) used.add(chosenKey);

    const gallery = [chosen, ...uniqueCandidates.filter((c) => canonicalPhotoKey(c) !== chosenKey)];
    return {
      ...p,
      photo: chosen,
      photoGallery: gallery,
      photosCount: Math.max(gallery.length, p.photosCount || 1),
    };
  });
}

async function listDbProfilesFromSupabase(limit: number): Promise<Profile[]> {
  const supabase = getSupabaseProfilesClient();
  if (!supabase) return [];
  // `select('*')`: voorkomt lege lijst op productie als oude DB’s nog geen lengte_cm e.d. hebben
  // (expliciete kolomlijst geeft dan PostgREST-fout PGRST204 / column does not exist).
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error(
      "[profilesDb] list profiles failed:",
      error.message,
      "code" in error ? (error as { code?: string }).code : "",
      "hint" in error ? (error as { hint?: string }).hint : ""
    );
    return [];
  }
  if (!data) return [];
  const rows = data as DbProfileRow[];
  const mediaMap = await fetchProfileMediaUrlsByProfileIds(
    supabase,
    rows.map((r) => r.id)
  );
  const mapped = rows.map((row) => mapDbProfile(row, mediaMap.get(row.id)));
  return enforceUniquePrimaryPhoto(mapped);
}

const listDbProfiles100Cached = unstable_cache(
  async () => listDbProfilesFromSupabase(100),
  ["supabase-profiles-active-100", "v2-profile-media"],
  { revalidate: 45 }
);

export async function listDbProfiles(limit = 100): Promise<Profile[]> {
  if (!isSupabaseProfilesEnabled()) {
    return [];
  }
  if (limit === 100) {
    const cached = await listDbProfiles100Cached();
    if (cached.length > 0) {
      return cached.slice(0, limit);
    }
    return await listDbProfilesFromSupabase(100);
  }
  return await listDbProfilesFromSupabase(limit);
}

export async function getDbProfileById(id: string): Promise<Profile | null> {
  if (!id.trim()) return null;
  if (!isSupabaseProfilesEnabled()) {
    return null;
  }
  const supabase = getSupabaseProfilesClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    console.error(
      "[profilesDb] get profile failed:",
      error.message,
      "code" in error ? (error as { code?: string }).code : ""
    );
    return null;
  }
  if (!data) {
    return null;
  }
  const row = data as DbProfileRow;
  const mediaMap = await fetchProfileMediaUrlsByProfileIds(supabase, [row.id]);
  return mapDbProfile(row, mediaMap.get(row.id));
}
