import { resolveMediaUrl } from "./utils/resolveMediaUrl";

/**
 * Zet ALLEEN `/api/...` paden om naar een absolute URL (via NEXT_PUBLIC_APP_URL of
 * window.location.origin). Logo's, andere statische assets (bv. `/logo-mark.png`)
 * en externe `https://` URLs blijven ongemoeid.
 *
 * Specifiek voor profielafbeeldingen — gebruik dit i.p.v. de generieke
 * `resolveMediaUrl` zodat we niet per ongeluk relatieve static-asset paden gaan
 * vervolledigen.
 */
export function resolveProfileImageUrl(url: string | null | undefined): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";

  /** Absolute URLs: gewoon doorgeven (externe Unsplash/Supabase/etc). */
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }

  /** Alleen onze server image proxy (`/api/...`) moet absoluut worden. */
  if (raw.startsWith("/api/")) {
    return resolveMediaUrl(raw) ?? raw;
  }

  /** Static assets onder /public (`/logo.png`, `/animations/...`) blijven relatief. */
  return raw;
}

/**
 * @deprecated Gebruik `resolveProfileImageUrl` voor profielafbeeldingen.
 * Behouden voor backwards-compat met andere call-sites.
 */
export function resolveProfileMediaUrl(url: string | null | undefined): string | null {
  return resolveMediaUrl(url);
}

/**
 * Scherpere profielfoto's op kleine UI: vraag ~2× de CSS-pixels op (retina),
 * voor hosts waar resize-parameters worden ondersteund (o.a. Unsplash).
 */
export function profilePhotoSrc(
  url: string,
  opts: { widthCss: number; heightCss?: number }
): string {
  /** Stricte resolver: alleen `/api/...` wordt absoluut, rest blijft. */
  const resolved = resolveProfileImageUrl(url) || url;
  if (!resolved?.trim()) return resolved || "";

  const dpr = 2;
  const w = Math.min(1920, Math.max(64, Math.ceil(opts.widthCss * dpr)));
  const h = Math.min(1920, Math.max(64, Math.ceil((opts.heightCss ?? opts.widthCss) * dpr)));

  try {
    const u = new URL(resolved);
    if (u.hostname === "images.unsplash.com" || u.hostname.endsWith(".unsplash.com")) {
      u.searchParams.set("w", String(w));
      u.searchParams.set("h", String(h));
      u.searchParams.set("fit", "crop");
      u.searchParams.set("crop", "faces");
      u.searchParams.set("auto", "format");
      u.searchParams.set("q", "88");
      return u.toString();
    }
  } catch {
    return resolved;
  }
  return resolved;
}
