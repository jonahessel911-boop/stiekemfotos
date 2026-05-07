'use client';

import React, { useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import { getStoredUser } from '@/lib/onboarding-client';
import { clearWelcomeModalFlag, shouldShowWelcomeModal } from '@/lib/welcome-modal-client';

export function WelcomeHouseRulesModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(shouldShowWelcomeModal());
  }, []);

  const onBegin = () => {
    try {
      const href = typeof window !== 'undefined' ? window.location.href : '';
      const referrer = typeof document !== 'undefined' ? document.referrer || undefined : undefined;
      const su = getStoredUser();
      const w = window as Window & { ttq?: { track?: (e: string) => void } };
      w.ttq?.track?.('SubmitApplication');

      const payload = JSON.stringify({
        event: 'SubmitApplication' as const,
        url: href || undefined,
        referrer,
        ...(su?.email ? { email: su.email.trim().toLowerCase() } : {}),
      });
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon('/api/tiktok/track', new Blob([payload], { type: 'application/json' }));
      } else {
        void fetch('/api/tiktok/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        });
      }
    } catch {
      /* tracking best-effort */
    }
    clearWelcomeModalFlag();
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-rules-title"
    >
      <div className="bg-[var(--surface-card)] max-w-md w-full rounded-3xl border-2 border-gray-300/90 shadow-2xl p-6 md:p-8 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-center mb-6">
          <Logo variant="hero" className="scale-90" />
        </div>
        <h2
          id="welcome-rules-title"
          className="text-xl font-bold text-center text-gray-900 mb-2"
        >
          Hoe het werkt
        </h2>
        <p className="text-sm text-center text-gray-600 mb-6">
          Even de afspraken — daarna ga je direct naar je feed.
        </p>
        <ul className="space-y-3 text-sm text-gray-800 leading-relaxed mb-8">
          <li className="flex gap-2">
            <span className="text-primary font-bold shrink-0">•</span>
            <span>
              <strong>Chatten is gratis.</strong> Stuur zoveel berichten als je wilt naar
              meerdere vrouwen tegelijk.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary font-bold shrink-0">•</span>
            <span>
              Wil je een foto van haar zien? <strong>1 foto = 100 credits</strong> (≈ €19,99).
              Vraag haar wat je wilt zien — ze maakt er eentje speciaal voor jou.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary font-bold shrink-0">•</span>
            <span>
              De vrouwen zijn vaak <strong>heel geil en seksueel ingesteld</strong>. Speel
              mee, wees respectvol en neem geen contact op buiten de app.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary font-bold shrink-0">•</span>
            <span>Platform is 18+. Geen intimidatie of ongewenst gedrag.</span>
          </li>
        </ul>
        <button
          type="button"
          onClick={onBegin}
          className="w-full py-5 md:py-6 rounded-2xl bg-primary text-primary-foreground font-bold text-lg shadow-lg shadow-primary/25 hover:bg-primary-hover active:scale-[0.99] transition-all"
        >
          Begin ontdekken
        </button>
      </div>
    </div>
  );
}
