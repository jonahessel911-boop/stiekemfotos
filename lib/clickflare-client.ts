import { SVL_CLICK_ID_COOKIE } from "@/lib/clickflare-postback";
import { extractClickIdFromSearchParams } from "@/lib/clickflare-click-id";

const SVL_CLICK_ID_STORAGE = "svl_click_id";

export function persistClientClickId(clickId: string): void {
  if (typeof window === "undefined" || !clickId.trim()) return;
  const id = clickId.trim();
  try {
    localStorage.setItem(SVL_CLICK_ID_STORAGE, id);
  } catch {
    /* ignore */
  }
  try {
    const enc = encodeURIComponent(id);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${SVL_CLICK_ID_COOKIE}=${enc}; Max-Age=${60 * 60 * 24 * 90}; Path=/; SameSite=Lax${secure}`;
  } catch {
    /* ignore */
  }
}

/** click_id voor checkout + return na Stripe (URL, cookie, localStorage). */
export function getClientClickIdForCheckout(): string {
  if (typeof window === "undefined") return "";

  try {
    const fromUrl = extractClickIdFromSearchParams(
      new URLSearchParams(window.location.search)
    );
    if (fromUrl) return fromUrl;
  } catch {
    /* ignore */
  }

  try {
    const parts = document.cookie.split(";").map((c) => c.trim());
    const prefix = `${SVL_CLICK_ID_COOKIE}=`;
    const row = parts.find((p) => p.startsWith(prefix));
    if (row) return decodeURIComponent(row.slice(prefix.length)).trim();
  } catch {
    /* ignore */
  }

  try {
    const stored = localStorage.getItem(SVL_CLICK_ID_STORAGE)?.trim();
    if (stored) return stored;
  } catch {
    /* ignore */
  }

  return "";
}
