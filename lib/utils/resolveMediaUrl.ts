export function resolveMediaUrl(
  url: string | null | undefined,
  fallback?: string
): string | null {
  const raw = (url ?? "").trim();
  if (!raw) {
    return fallback ?? null;
  }

  // Already absolute
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }

  // Relative path -> prefix with app origin / base URL
  const base =
    (typeof window !== "undefined" && window.location?.origin) ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "";

  if (!base) {
    // Fallback to relative if no base available (dev without env)
    return raw.startsWith("/") ? raw : `/${raw}`;
  }

  // Avoid double slash
  const separator = base.endsWith("/") ? "" : "/";
  const path = raw.startsWith("/") ? raw.slice(1) : raw;
  return `${base}${separator}${path}`;
}
