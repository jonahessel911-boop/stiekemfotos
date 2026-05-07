export type EngagementSlot = { profileId: string; fireAt: string; sentAt?: string };

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function padToFourIds(ids: string[]): string[] {
  if (ids.length === 0) return [];
  const out = [...ids];
  while (out.length < 4) {
    out.push(ids[out.length % ids.length]!);
  }
  return out.slice(0, 4);
}

/** Vier profielen, verspreid over ~4 dagen; eerste slot 1–10 min na aanmaak. */
export function buildEngagementSlotsWithIds(
  createdAtIso: string,
  profileIds: string[]
): EngagementSlot[] {
  const base = new Date(createdAtIso).getTime();
  if (!Number.isFinite(base)) return [];
  const ids = padToFourIds(profileIds);
  if (ids.length < 4) return [];
  return [
    { profileId: ids[0]!, fireAt: new Date(base + randInt(60, 600) * 1000).toISOString() },
    {
      profileId: ids[1]!,
      fireAt: new Date(base + 24 * 3600 * 1000 + randInt(0, 7200) * 1000).toISOString(),
    },
    {
      profileId: ids[2]!,
      fireAt: new Date(base + 48 * 3600 * 1000 + randInt(0, 7200) * 1000).toISOString(),
    },
    {
      profileId: ids[3]!,
      fireAt: new Date(base + 72 * 3600 * 1000 + randInt(0, 7200) * 1000).toISOString(),
    },
  ];
}

/** Nieuwe accounts: bij Supabase alleen echte profiel-UUID’s; anders legacy 1–4. */
export async function resolveEngagementSlotsForNewUser(
  createdAtIso: string
): Promise<EngagementSlot[]> {
  const { listDbProfiles, isSupabaseProfilesEnabled } = await import(
    "@/lib/server/profilesDb"
  );
  if (isSupabaseProfilesEnabled()) {
    const profiles = await listDbProfiles(48);
    if (profiles.length >= 4) {
      const shuffled = shuffle(profiles.map((p) => p.id));
      return buildEngagementSlotsWithIds(createdAtIso, shuffled.slice(0, 4));
    }
    if (profiles.length > 0) {
      return buildEngagementSlotsWithIds(
        createdAtIso,
        padToFourIds(profiles.map((p) => p.id))
      );
    }
    return [];
  }
  return buildEngagementSlotsWithIds(createdAtIso, ["1", "2", "3", "4"]);
}

/** @deprecated gebruik resolveEngagementSlotsForNewUser */
export function buildEngagementSlots(createdAtIso: string): EngagementSlot[] {
  return buildEngagementSlotsWithIds(createdAtIso, ["1", "2", "3", "4"]);
}
