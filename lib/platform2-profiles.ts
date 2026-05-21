import type { Profile } from '@/lib/types/profile';

/** Vaste 3 profielen zonder foto op platform/2 (stabiel op id). */
export function pickNoPhotoProfileIds(profiles: Profile[], count = 3): Set<string> {
  const sorted = [...profiles].sort((a, b) => a.id.localeCompare(b.id));
  return new Set(sorted.slice(0, count).map((p) => p.id));
}

export function profileShowsPhoto(profileId: string, noPhotoIds: Set<string>): boolean {
  return !noPhotoIds.has(profileId);
}
