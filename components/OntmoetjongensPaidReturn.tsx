'use client';

import { useEffect, useRef } from 'react';
import { getClientClickIdForCheckout } from '@/lib/clickflare-client';

type Props = {
  onPaid: () => void;
};

/**
 * Na Stripe success: ClickFlare postback (fallback naast webhook), daarna paid-stap.
 */
export default function OntmoetjongensPaidReturn({ onPaid }: Props) {
  const ran = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || ran.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('ontmoetjongens_paid') !== '1') return;
    ran.current = true;

    const sessionId = params.get('session_id')?.trim() ?? '';
    const clickId = getClientClickIdForCheckout();

    const cleanUrl = () => {
      const u = new URL(window.location.href);
      u.searchParams.delete('ontmoetjongens_paid');
      u.searchParams.delete('session_id');
      window.history.replaceState({}, '', u.pathname + (u.search || ''));
      onPaid();
    };

    if (!sessionId) {
      cleanUrl();
      return;
    }

    fetch('/api/stripe/ontmoetjongens-conversion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sessionId, clickId }),
    }).catch(() => {}).finally(cleanUrl);
  }, [onPaid]);

  return null;
}
