'use client';

import React, { useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import { clearWelcomeModalFlag, shouldShowWelcomeModal } from '@/lib/welcome-modal-client';

export function WelcomeHouseRulesModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(shouldShowWelcomeModal());
  }, []);

  const onBegin = () => {
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
          Huisregels
        </h2>
        <p className="text-sm text-center text-gray-600 mb-6">
          Even de afspraken — daarna ga je direct naar je feed.
        </p>
        <ul className="space-y-3 text-sm text-gray-800 leading-relaxed mb-8">
          <li className="flex gap-2">
            <span className="text-primary font-bold shrink-0">•</span>
            <span>Wees discreet met de vrouwen en respecteer hun privacy.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary font-bold shrink-0">•</span>
            <span>Wees eerlijk over je intenties; veel vrouwen houden van open contact.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary font-bold shrink-0">•</span>
            <span>Hoe meer je over jezelf vertelt, hoe sneller er contact is.</span>
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
