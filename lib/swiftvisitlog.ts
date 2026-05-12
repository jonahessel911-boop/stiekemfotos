export const SVL_POSTBACK_BASE_URL = "https://swiftvisitlog.com/cf/cv";

export const SVL_CLICK_ID_COOKIE = "svl_click_id";
export const SVL_PAYOUT_COOKIE = "svl_payout";
export const SVL_TXID_COOKIE = "svl_txid";

export const SVL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

export const SVL_CLICK_ID_QUERY_KEYS = [
  "click_id",
  "clickid",
  "cid",
  "sub_id",
  "subid",
  "sub1",
  "sub_1",
] as const;

export const SVL_PAYOUT_QUERY_KEYS = ["payout", "amount", "value"] as const;

export const SVL_TXID_QUERY_KEYS = ["txid", "tx_id"] as const;

export type BuildSvlPostbackOpts = {
  clickId: string;
  payout?: string | number | null;
  txid?: string | null;
};

/**
 * Build a Swift Visit Log postback URL.
 * Template: https://swiftvisitlog.com/cf/cv?click_id=REPLACE&payout=OPTIONAL&txid=OPTIONAL
 * - click_id is required (postback is skipped upstream when missing).
 * - payout and txid are only included when explicitly provided.
 */
export function buildSvlPostbackUrl(opts: BuildSvlPostbackOpts): string {
  const params = new URLSearchParams();
  params.set("click_id", String(opts.clickId).trim());
  if (opts.payout !== undefined && opts.payout !== null && String(opts.payout).trim() !== "") {
    params.set("payout", String(opts.payout).trim());
  }
  if (opts.txid !== undefined && opts.txid !== null && String(opts.txid).trim() !== "") {
    params.set("txid", String(opts.txid).trim());
  }
  return `${SVL_POSTBACK_BASE_URL}?${params.toString()}`;
}
