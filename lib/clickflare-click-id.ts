import { SVL_CLICK_ID_QUERY_KEYS } from "@/lib/clickflare-postback";

const PLACEHOLDER = /^\{[^}]+\}$/;
const UUID_KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ClickFlare click_id uit URL: standaard query keys, macro cf_click_id,
 * of UUID als alleen query-key (?<click-uuid> zonder value).
 */
export function extractClickIdFromSearchParams(params: URLSearchParams): string | null {
  for (const key of SVL_CLICK_ID_QUERY_KEYS) {
    const v = params.get(key)?.trim();
    if (v && !PLACEHOLDER.test(v)) return v;
  }

  const macroVal =
    params.get("{cf_click_id}")?.trim() || params.get("cf_click_id")?.trim();
  if (macroVal && !PLACEHOLDER.test(macroVal)) return macroVal;

  for (const [key, value] of params.entries()) {
    const k = key.trim();
    const v = value.trim();
    if (!v && UUID_KEY.test(k)) return k;
  }

  return null;
}
