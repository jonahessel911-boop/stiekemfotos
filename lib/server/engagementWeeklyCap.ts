/** Hard maximum: automatische berichten van max. dit aantal verschillende profielen per rolling week. */
export const ENGAGEMENT_MAX_PROFILES_PER_ROLLING_WEEK = 3;

export const ENGAGEMENT_ROLLING_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type EngagementOutboundEntry = {
  profileId: string;
  sentAt: string;
};

export function pruneEngagementOutboundLog(
  log: EngagementOutboundEntry[] | undefined,
  nowMs = Date.now()
): EngagementOutboundEntry[] {
  const cutoff = nowMs - ENGAGEMENT_ROLLING_WEEK_MS;
  return (log ?? []).filter((e) => new Date(e.sentAt).getTime() > cutoff);
}

/** Na een prune: unieke profielen die al minstens één automatisch bericht stuurden in dit venster. */
export function distinctOutboundProfilesThisWeek(
  log: EngagementOutboundEntry[] | undefined,
  nowMs = Date.now()
): Set<string> {
  const pruned = pruneEngagementOutboundLog(log, nowMs);
  return new Set(pruned.map((e) => e.profileId.trim()).filter(Boolean));
}

/**
 * Mag dit profiel nu nog een automatisch outreach-bericht sturen?
 * Zelfde profiel vervolg (al in set) blijft toegestaan; nieuwe profielen alleen als &lt; max.
 */
export function canSendAutomatedProfileOutreach(
  log: EngagementOutboundEntry[] | undefined,
  profileId: string,
  nowMs = Date.now()
): boolean {
  const pid = profileId.trim();
  if (!pid) return false;
  const distinct = distinctOutboundProfilesThisWeek(log, nowMs);
  if (distinct.has(pid)) return true;
  return distinct.size < ENGAGEMENT_MAX_PROFILES_PER_ROLLING_WEEK;
}

export function appendEngagementOutboundEntry(
  log: EngagementOutboundEntry[] | undefined,
  profileId: string,
  nowIso = new Date().toISOString()
): EngagementOutboundEntry[] {
  const pruned = pruneEngagementOutboundLog(log);
  return [...pruned, { profileId: profileId.trim(), sentAt: nowIso }];
}

/** Bij cap: opnieuw proberen na ±24 uur (rolling window kan dan ruimte geven). */
export const ENGAGEMENT_DEFER_MS = 24 * 60 * 60 * 1000;
