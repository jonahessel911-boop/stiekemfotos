"use client";

import { useEffect, useMemo, useRef } from "react";
import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { TIKTOK_PIXEL_ID } from "@/lib/tiktok";

declare global {
  interface Window {
    ttq?: {
      page?: () => void;
      track?: (event: string, payload?: Record<string, unknown>) => void;
      load?: (id: string, options?: Record<string, unknown>) => void;
    };
  }
}

export default function TikTokPixel() {
  const pathname = usePathname();
  const search = useSearchParams();
  const lastTrackedRef = useRef<string>("");
  const skipFirstPageRef = useRef(true);
  const routeKey = useMemo(
    () => `${pathname ?? ""}${search?.toString() ? `?${search.toString()}` : ""}`,
    [pathname, search]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const href = window.location.href;
    if (!href || lastTrackedRef.current === href) return;
    lastTrackedRef.current = href;

    if (skipFirstPageRef.current) {
      skipFirstPageRef.current = false;
      return;
    }

    try {
      window.ttq?.page?.();
    } catch {
      // best effort
    }
  }, [routeKey]);

  return (
    <>
      <Script
        id="tiktok-pixel-base"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=r+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode&&a.parentNode.insertBefore(o,a)};ttq.load("${TIKTOK_PIXEL_ID}");ttq.page();}(window,document,"ttq");`,
        }}
      />
    </>
  );
}
