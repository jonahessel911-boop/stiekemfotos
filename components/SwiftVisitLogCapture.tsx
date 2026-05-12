"use client";

import { useEffect } from "react";
import {
  SVL_CLICK_ID_COOKIE,
  SVL_CLICK_ID_QUERY_KEYS,
  SVL_COOKIE_MAX_AGE_SECONDS,
  SVL_PAYOUT_COOKIE,
  SVL_PAYOUT_QUERY_KEYS,
  SVL_TXID_COOKIE,
  SVL_TXID_QUERY_KEYS,
} from "@/lib/swiftvisitlog";

function setCookie(name: string, value: string): void {
  if (!value) return;
  const enc = encodeURIComponent(value);
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${enc}; Max-Age=${SVL_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

function readFirstParam(params: URLSearchParams, keys: ReadonlyArray<string>): string | null {
  for (const key of keys) {
    const raw = params.get(key);
    if (raw && raw.trim()) return raw.trim();
  }
  return null;
}

/**
 * Captures Swift Visit Log tracking params from the current URL and stores
 * them in cookies so the server can fire the postback after form submit.
 */
export default function SwiftVisitLogCapture(): null {
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const clickId = readFirstParam(params, SVL_CLICK_ID_QUERY_KEYS);
      const payout = readFirstParam(params, SVL_PAYOUT_QUERY_KEYS);
      const txid = readFirstParam(params, SVL_TXID_QUERY_KEYS);
      if (clickId) setCookie(SVL_CLICK_ID_COOKIE, clickId);
      if (payout) setCookie(SVL_PAYOUT_COOKIE, payout);
      if (txid) setCookie(SVL_TXID_COOKIE, txid);
    } catch {
      // best effort
    }
  }, []);
  return null;
}
