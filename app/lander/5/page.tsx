'use client';

import React, { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import ClickFlareCapture from '@/components/ClickFlareCapture';
import './lander-5.css';

const CTA_URL = 'https://911-for-me.com/cf/click';

const VRAAG =
  'Heb je behoefte aan chatten met nieuwsgierige en soms lustige vrouwen?';

export default function Lander5Page() {
  const [declined, setDeclined] = useState(false);

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
    <div className="lander-5-theme flex flex-col">
      <ClickFlareCapture />
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-10 max-w-lg mx-auto w-full">
        <div className="w-full space-y-8 max-w-md mx-auto text-center">
          <h1 className="text-xl md:text-2xl font-semibold text-gray-900 leading-snug px-2">
            {VRAAG}
          </h1>

          {declined ? (
            <p className="text-gray-600 text-base px-2">
              Geen probleem. Als je later toch nieuwsgierig bent, kun je deze pagina opnieuw
              openen.
            </p>
          ) : (
            <div className="flex flex-col gap-4 pt-2 w-full">
              <button
                type="button"
                onClick={() => setDeclined(true)}
                className="btn-lander-outline"
              >
                Nee
              </button>
              <a href={CTA_URL} className="btn-lander">
                Ja
                <ArrowRight className="w-5 h-5" />
              </a>
            </div>
          )}
        </div>
      </div>

      <footer className="footer-lander py-6 text-center text-xs text-gray-700 px-4">
        18+ · Vertrouwen &amp; discretie
      </footer>
    </div>
  );
}
