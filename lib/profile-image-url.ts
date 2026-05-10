import { resolveMediaUrl } from "./utils/resolveMediaUrl";

/**
 * Zorgt dat relatieve media-URL's (zoals /api/conversations/...) absolute URLs worden
 * zodat ze in browser én op Vercel correct ophalen.
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
  const resolved = resolveProfileMediaUrl(url) ?? url;
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
