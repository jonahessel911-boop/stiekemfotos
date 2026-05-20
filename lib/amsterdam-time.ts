export type AmsterdamDagdeel = "ochtend" | "middag" | "avond" | "nacht";

export function getAmsterdamHour(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "12", 10);
  return Number.isFinite(hour) ? hour : 12;
}

export function getAmsterdamDagdeel(now = new Date()): AmsterdamDagdeel {
  const hour = getAmsterdamHour(now);
  if (hour >= 5 && hour < 12) return "ochtend";
  if (hour >= 12 && hour < 18) return "middag";
  if (hour >= 18 && hour < 24) return "avond";
  return "nacht";
}

/** ~22:00–05:59 Amsterdam — slaap-gerelateerde copy mag. */
export function isAmsterdamNight(now = new Date()): boolean {
  const hour = getAmsterdamHour(now);
  return hour >= 22 || hour < 6;
}

/** Vanaf 18:00 — “vanavond” is logisch. */
export function isAmsterdamEveningOrLater(now = new Date()): boolean {
  return getAmsterdamHour(now) >= 18;
}

/** Verwijder regels die niet passen bij het lokale dagdeel. */
export function filterChatLinesForAmsterdamTime(
  lines: readonly string[],
  now = new Date()
): string[] {
  const night = isAmsterdamNight(now);
  const evening = isAmsterdamEveningOrLater(now);
  return lines.filter((line) => {
    const t = line.toLowerCase();
    if (!night && /\b(slaap|slapen|slapend)\b/.test(t)) return false;
    if (!evening && /\bvanavond\b/.test(t)) return false;
    return true;
  });
}
