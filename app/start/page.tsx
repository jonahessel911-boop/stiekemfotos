'use client';

import React, { useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import { ArrowRight } from 'lucide-react';
import ClickFlareCapture from '@/components/ClickFlareCapture';
import ClickFlareLanderScript from '@/components/ClickFlareLanderScript';

const CTA_URL = 'https://911-for-me.com/cf/click';

function randomMatchCount(): number {
  return Math.floor(11 + Math.random() * (50 - 11 + 1));
}

export default function StartPage() {
  const [matchCount] = useState(() => randomMatchCount());

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        const d = (await r.json()) as { user?: unknown };
        if (!cancel && d.user) {
          window.location.replace('/profielen');
          return;
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[var(--onboarding-bg)] flex flex-col">
      <ClickFlareCapture />
      <ClickFlareLanderScript />
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-10 max-w-lg mx-auto w-full">
        <div className="w-full space-y-8 max-w-md mx-auto px-1 text-center">
          <div className="flex justify-center">
            <Logo variant="hero" className="scale-90" />
          </div>
          <p className="text-balance text-2xl md:text-3xl font-extrabold leading-tight tracking-tight text-gray-900 px-2">
            Er zijn{' '}
            <span className="text-primary tabular-nums">{matchCount}</span>{' '}
            vrouwen die wachten om benaderd te worden door mannen als jij.
          </p>
          <a
            href={CTA_URL}
            className="w-full flex items-center justify-center gap-3 py-5 px-8 rounded-full bg-primary text-white font-semibold text-lg shadow-lg shadow-primary/30 hover:bg-primary-hover active:scale-[0.99] transition-all"
          >
            Bekijk vrouwen
            <ArrowRight className="w-5 h-5" />
          </a>
        </div>
      </div>

      <footer className="py-6 text-center text-xs text-gray-600 px-4 border-t border-primary/15 bg-[var(--onboarding-footer-bg)]">
        stiekemefotos.nl · 18+ · Vertrouwen &amp; discretie
      </footer>
    </div>
  );
}
