import {
  SVL_CLICK_ID_COOKIE,
  SVL_CLICK_ID_QUERY_KEYS,
} from "@/lib/clickflare-postback";

export const CLICKFLARE_CLICK_URL = "https://911-for-me.com/cf/click";

/** ClickFlare campaign id cookie (lander tag). */
export const CF_CPID_COOKIE = "cf_cpid";

function readFirstParam(params: URLSearchParams, keys: ReadonlyArray<string>): string | null {
  for (const key of keys) {
    const raw = params.get(key);
    if (raw?.trim()) return raw.trim();
  }
  return null;
}

export type BuildClickflareClickRedirectOpts = {
  incomingSearch: URLSearchParams;
  /** Volledige URL van deze lander (incl. query), voor lpurl. */
  lpurl: string;
  referrer?: string | null;
  cpidCookie?: string | null;
  clickIdCookie?: string | null;
};

/**
 * Bouwt de 911 /cf/click URL met doorgegeven tracking (cpid, click_id, lp_ref, lpurl, …).
 */
export function buildClickflareClickRedirectUrl(opts: BuildClickflareClickRedirectOpts): string {
  const url = new URL(CLICKFLARE_CLICK_URL);

  opts.incomingSearch.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  const cpid =
    opts.incomingSearch.get("cpid")?.trim() ||
    opts.cpidCookie?.trim() ||
    readFirstParam(opts.incomingSearch, SVL_CLICK_ID_QUERY_KEYS);
  if (cpid) url.searchParams.set("cpid", cpid);

  const clickId =
    readFirstParam(opts.incomingSearch, SVL_CLICK_ID_QUERY_KEYS) || opts.clickIdCookie?.trim();
  if (clickId) url.searchParams.set("click_id", clickId);

  if (!url.searchParams.has("lp_ref")) {
    url.searchParams.set("lp_ref", opts.referrer?.trim() ?? "");
  }
  if (!url.searchParams.has("lpurl")) {
    url.searchParams.set("lpurl", opts.lpurl);
  }
  if (!url.searchParams.has("lpt")) {
    url.searchParams.set("lpt", "Lander redirect");
  }
  if (!url.searchParams.has("t")) {
    url.searchParams.set("t", String(Date.now()));
  }

  return url.toString();
}
