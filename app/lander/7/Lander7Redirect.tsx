'use client';

import { useEffect, useRef } from 'react';
import ClickFlareCapture from '@/components/ClickFlareCapture';
import {
  buildClickflareClickRedirectUrl,
  CF_CPID_COOKIE,
} from '@/lib/clickflare-redirect';
import { SVL_CLICK_ID_COOKIE } from '@/lib/clickflare-postback';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${encodeURIComponent(name)}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export default function Lander7Redirect() {
  const redirected = useRef(false);

  useEffect(() => {
    if (redirected.current) return;
    redirected.current = true;

    const incoming = new URLSearchParams(window.location.search);
    const lpurl = window.location.href;

    const target = buildClickflareClickRedirectUrl({
      incomingSearch: incoming,
      lpurl,
      referrer: document.referrer || null,
      cpidCookie: readCookie(CF_CPID_COOKIE),
      clickIdCookie: readCookie(SVL_CLICK_ID_COOKIE),
    });

    window.location.replace(target);
  }, []);

  return (
    <>
      <ClickFlareCapture />
      <div className="min-h-screen bg-[#f5f0ff]" aria-busy="true" />
    </>
  );
}
