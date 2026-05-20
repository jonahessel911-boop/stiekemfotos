export const CLICKFLARE_CLICK_URL = "https://911-for-me.com/cf/click";

/** ClickFlare campaign id cookie (lander tag). */
export const CF_CPID_COOKIE = "cf_cpid";

const RESERVED_KEYS = new Set([
  "lp_ref",
  "lpurl",
  "lpt",
  "t",
  "cpid",
  "click_id",
  "clickid",
]);

import { extractClickIdFromSearchParams } from "@/lib/clickflare-click-id";

const UUID_KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPassthroughParamKey(key: string): boolean {
  const k = key.trim();
  if (!k || RESERVED_KEYS.has(k)) return false;
  if (k.includes("{") || k.includes("}")) return false;
  if (UUID_KEY.test(k)) return false;
  const lower = k.toLowerCase();
  if (lower === "cf_click_id" || lower === "{cf_click_id}") return false;
  if (lower.startsWith("utm_")) return true;
  if (/^sub\d*$/i.test(k) || k.startsWith("sub_")) return true;
  if (k === "cftmid") return true;
  return false;
}

export type BuildClickflareClickRedirectOpts = {
  incomingSearch: URLSearchParams;
  lpurl: string;
  referrer?: string | null;
  cpidCookie?: string | null;
  clickIdCookie?: string | null;
};

export function buildClickflareClickRedirectUrl(opts: BuildClickflareClickRedirectOpts): string {
  const url = new URL(CLICKFLARE_CLICK_URL);
  const incoming = opts.incomingSearch;

  const cpid = incoming.get("cpid")?.trim() || opts.cpidCookie?.trim() || "";
  if (cpid && !cpid.includes("{")) {
    url.searchParams.set("cpid", cpid);
  }

  const clickId =
    extractClickIdFromSearchParams(incoming) || opts.clickIdCookie?.trim() || "";
  if (clickId) {
    url.searchParams.set("click_id", clickId);
  }

  incoming.forEach((value, key) => {
    if (!isPassthroughParamKey(key)) return;
    const v = value.trim();
    if (v) url.searchParams.set(key, v);
  });

  url.searchParams.set("lp_ref", incoming.get("lp_ref")?.trim() || opts.referrer?.trim() || "");
  url.searchParams.set("lpurl", incoming.get("lpurl")?.trim() || opts.lpurl);
  url.searchParams.set("lpt", incoming.get("lpt")?.trim() || "Lander redirect");
  url.searchParams.set("t", incoming.get("t")?.trim() || String(Date.now()));

  return url.toString();
}
