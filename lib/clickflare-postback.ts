/**
 * ClickFlare postback helper.
 * Standaard postback-host: 911-for-me.com (ClickFlare /cf/cv).
 * Dedupliceert conversies op basis van click_id + txid + ct.
 *
 * Optionele env (alleen nodig om de URL of ct te overschrijven):
 *  - CLICKFLARE_POSTBACK_URL  (default: https://911-for-me.com/cf/cv)
 *  - CLICKFLARE_CONVERSION_TYPE (default: signup)
 */
const DEFAULT_CLICKFLARE_POSTBACK_BASE_URL = "https://911-for-me.com/cf/cv";

export const SVL_POSTBACK_BASE_URL =
  process.env.CLICKFLARE_POSTBACK_URL?.trim() || DEFAULT_CLICKFLARE_POSTBACK_BASE_URL;

export const SVL_CONVERSION_TYPE =
  process.env.CLICKFLARE_CONVERSION_TYPE?.trim() || "signup";

/** Cookie-namen blijven `svl_*` zodat bestaande bezoekers geen tracking verliezen. */
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
  /** ClickFlare conversion type — bij hergebruik van zelfde (click_id, txid, ct) wordt de conversie geüpdatet i.p.v. gedupliceerd. */
  ct?: string | null;
};

/**
 * Build a ClickFlare postback URL.
 * Template: <base>?click_id=REPLACE&payout=OPTIONAL&txid=OPTIONAL&ct=OPTIONAL
 * - click_id is required (postback is skipped upstream when missing).
 * - payout, txid, ct worden alleen toegevoegd als ze meegegeven zijn (payout=0 telt als waarde en wordt dus wél geschreven).
 */
export function buildSvlPostbackUrl(opts: BuildSvlPostbackOpts): string {
  const params = new URLSearchParams();
  params.set("click_id", String(opts.clickId).trim());
  if (opts.payout !== undefined && opts.payout !== null) {
    const payoutStr =
      typeof opts.payout === "number" ? opts.payout.toFixed(2) : String(opts.payout).trim();
    if (payoutStr !== "") params.set("payout", payoutStr);
  }
  if (opts.txid !== undefined && opts.txid !== null && String(opts.txid).trim() !== "") {
    params.set("txid", String(opts.txid).trim());
  }
  if (opts.ct !== undefined && opts.ct !== null && String(opts.ct).trim() !== "") {
    params.set("ct", String(opts.ct).trim());
  }
  return `${SVL_POSTBACK_BASE_URL}?${params.toString()}`;
}

/**
 * Format a Stripe amount (in cents) as a ClickFlare-friendly decimal payout.
 * 2499 → "24.99".  null/undefined → "0.00".
 */
export function formatPayoutFromCents(cents: number | null | undefined): string {
  const n = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  return (Math.max(0, n) / 100).toFixed(2);
}

/**
 * Build the txid for ClickFlare from an internal user id.
 * Uses the "user_" prefix so it is identifiable in ClickFlare reporting.
 */
export function buildSvlTxidForUser(userId: string): string {
  return `user_${userId}`;
}

export type SendSvlPostbackOpts = BuildSvlPostbackOpts & {
  /** Korte label voor logregels: bv. "signup" of "stripe_paid". */
  reason?: string;
  /** Abort timeout in ms (default 4000). */
  timeoutMs?: number;
};

export type SendSvlPostbackResult = {
  fired: boolean;
  ok?: boolean;
  status?: number;
  url?: string;
  error?: string;
};

/**
 * Fire a ClickFlare postback. Always best-effort: never throws, always logs.
 * Skips silently when click_id is missing.
 */
export async function sendSvlPostback(opts: SendSvlPostbackOpts): Promise<SendSvlPostbackResult> {
  const clickId = opts.clickId?.trim();
  const reason = opts.reason || "unknown";
  if (!clickId) {
    console.log(`[clickflare:${reason}] skipped — missing click_id`);
    return { fired: false };
  }
  let url: string;
  try {
    url = buildSvlPostbackUrl({
      clickId,
      payout: opts.payout ?? undefined,
      txid: opts.txid ?? undefined,
      ct: opts.ct ?? undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[clickflare:${reason}] build url failed: ${msg}`);
    return { fired: false, error: msg };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 4000);
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(
        `[clickflare:${reason}] postback non-OK status=${res.status} click_id=${clickId} url=${url}`
      );
      return { fired: true, ok: false, status: res.status, url };
    }
    console.log(
      `[clickflare:${reason}] postback ok click_id=${clickId} payout=${opts.payout ?? "(none)"} txid=${opts.txid ?? "(none)"} ct=${opts.ct ?? "(none)"}`
    );
    return { fired: true, ok: true, status: res.status, url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[clickflare:${reason}] postback fetch fout: ${msg} url=${url}`);
    return { fired: true, ok: false, error: msg, url };
  } finally {
    clearTimeout(timer);
  }
}
