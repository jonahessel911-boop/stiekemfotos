'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import ClickFlareCapture from '@/components/ClickFlareCapture';
import './lander-6.css';

const CTA_URL = 'https://911-for-me.com/cf/click';

const VRAAG_1 =
  'Heb je behoefte aan chatten met nieuwsgierige en soms lustige vrouwen?';

const VRAAG_2 =
  'Als je zou moeten kiezen, welke type vrouw zou je het liefst mee chatten?';

const PROFIELEN = [
  { id: 'nina', naam: 'Nina', foto: '/lander/6/nina.png' },
  { id: 'sofie', naam: 'Sofie', foto: '/lander/6/sofie.png' },
] as const;

type Step = 'q1' | 'choose';

export default function Lander6Page() {
  const [step, setStep] = useState<Step>('q1');
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
    <div className="lander-6-theme flex flex-col">
      <ClickFlareCapture />
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-10 max-w-lg mx-auto w-full">
        <div className="w-full space-y-8 max-w-md mx-auto text-center">
          {step === 'q1' && (
            <>
              <h1 className="text-xl md:text-2xl font-semibold text-gray-900 leading-snug px-2">
                {VRAAG_1}
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
                  <button
                    type="button"
                    onClick={() => setStep('choose')}
                    className="btn-lander"
                  >
                    Ja
                    <ArrowRight className="w-5 h-5" />
                  </button>
                </div>
              )}
            </>
          )}

          {step === 'choose' && (
            <>
              <h1 className="text-xl md:text-2xl font-semibold text-gray-900 leading-snug px-2">
                {VRAAG_2}
              </h1>
              <div className="grid grid-cols-2 gap-4 pt-2 w-full">
                {PROFIELEN.map((p) => (
                  <a
                    key={p.id}
                    href={CTA_URL}
                    className="profile-cta"
                    aria-label={`Chat met ${p.naam}`}
                  >
                    <Image
                      src={p.foto}
                      alt={p.naam}
                      width={400}
                      height={533}
                      className="w-full"
                      priority
                    />
                    <p className="profile-name">{p.naam}</p>
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <footer className="footer-lander py-6 text-center text-xs text-gray-700 px-4">
        18+ · Vertrouwen &amp; discretie
      </footer>
    </div>
  );
}
