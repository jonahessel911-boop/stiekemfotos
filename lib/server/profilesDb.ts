import { unstable_cache } from "next/cache";
import type { Profile } from "@/lib/types/profile";
import { getProfileById as getStaticProfileById } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

type DbProfileRow = {
  id: string;
  first_name: string;
  age: number;
  city: string;
  lengte_cm: number | null;
  gewicht_kg: number | null;
  cup_maat: string | null;
  country: string;
  bio: string;
  interests: string[] | null;
  personality: string;
  system_prompt: string;
  avatar_url: string | null;
  photo_urls: string[] | null;
  voice_language: string;
  heritage: string | null;
  is_active: boolean;
};

export function isSupabaseProfilesEnabled(): boolean {
  return Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}

function mapDbProfile(row: DbProfileRow): Profile {
  const photos = Array.isArray(row.photo_urls) ? row.photo_urls.filter(Boolean) : [];
  const ordered = [row.avatar_url, ...photos].filter(Boolean) as string[];
  const unique = [...new Set(ordered)];
  const primary =
    unique[0] ?? photos[0] ?? "https://randomuser.me/api/portraits/women/1.jpg";
  return {
    id: row.id,
    name: row.first_name,
    age: row.age,
    location: row.city,
    lengte: row.lengte_cm ?? undefined,
    gewicht: row.gewicht_kg ?? undefined,
    cupMaat: row.cup_maat ?? undefined,
    heritage: row.heritage ?? row.country,
    personaStyle: "east_european",
    voiceLanguage: row.voice_language || "ro",
    photo: primary,
    photoGallery: unique.length > 0 ? unique : undefined,
    photosCount: Math.max(photos.length, unique.length, 1),
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
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, first_name, age, city, lengte_cm, gewicht_kg, cup_maat, country, bio, interests, personality, system_prompt, avatar_url, photo_urls, voice_language, heritage, is_active"
    )
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  const mapped = (data as DbProfileRow[]).map(mapDbProfile);
  return enforceUniquePrimaryPhoto(mapped);
}

const listDbProfiles100Cached = unstable_cache(
  async () => listDbProfilesFromSupabase(100),
  ["supabase-profiles-active-100"],
  { revalidate: 45 }
);

export async function listDbProfiles(limit = 100): Promise<Profile[]> {
  if (!isSupabaseProfilesEnabled()) return [];
  if (limit === 100) return listDbProfiles100Cached();
  return listDbProfilesFromSupabase(limit);
}

export async function getDbProfileById(id: string): Promise<Profile | null> {
  if (!id.trim()) return null;
  if (!isSupabaseProfilesEnabled()) return getStaticProfileById(id) ?? null;
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, first_name, age, city, lengte_cm, gewicht_kg, cup_maat, country, bio, interests, personality, system_prompt, avatar_url, photo_urls, voice_language, heritage, is_active"
    )
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;
  return mapDbProfile(data as DbProfileRow);
}
