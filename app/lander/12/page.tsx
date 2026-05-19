'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import ClickFlareCapture from '@/components/ClickFlareCapture';
import './lander-12.css';

const CTA_URL = 'https://911-for-me.com/cf/click';

type ProfileCard = {
  id: string;
  name: string;
  blurred: boolean;
  img: string;
};

const PROFILES: ProfileCard[] = [
  {
    id: '1',
    name: 'Sofie',
    blurred: true,
    img: '/lander/12/profile-1.png',
  },
  {
    id: '2',
    name: 'Sofie',
    blurred: false,
    img: '/lander/12/profile-1.png',
  },
  {
    id: '3',
    name: 'Lisa',
    blurred: true,
    img: '/lander/12/profile-2.png',
  },
  {
    id: '4',
    name: 'Lisa',
    blurred: false,
    img: '/lander/12/profile-2.png',
  },
  {
    id: '5',
    name: 'Emma',
    blurred: true,
    img: '/lander/12/profile-3.png',
  },
  {
    id: '6',
    name: 'Emma',
    blurred: false,
    img: '/lander/12/profile-3.png',
  },
];

export default function Lander12Page() {
  const hiddenOfferRef = useRef<HTMLAnchorElement>(null);
  const [selected, setSelected] = useState<ProfileCard | null>(null);

  const goToOffer = useCallback(() => {
    hiddenOfferRef.current?.click();
  }, []);

  const openChat = useCallback(() => {
    goToOffer();
  }, [goToOffer]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        const d = (await r.json()) as { user?: unknown };
        if (!cancel && d.user) {
          window.location.replace('/profielen');
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  return (
    <div className="lander-12 flex min-h-screen flex-col bg-[#F4F0FA] text-gray-900 antialiased">
      <ClickFlareCapture />

      <a ref={hiddenOfferRef} href={CTA_URL} className="sr-only" tabIndex={-1} aria-hidden>
        Offer
      </a>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-10 sm:max-w-xl sm:px-6">
        <header className="mb-8 text-center">
          <h1 className="text-balance text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
            Wat is jouw type?
          </h1>
          <p className="mt-3 text-sm font-medium text-gray-600 sm:text-base">
            Tik op een foto om direct te chatten
          </p>
        </header>

        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:overflow-visible sm:px-0">
          <div className="flex gap-3 sm:justify-center sm:gap-4">
            {PROFILES.map((profile, index) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => setSelected(profile)}
                style={
                  !profile.blurred
                    ? { animationDelay: `${(index % 3) * -1.1}s` }
                    : undefined
                }
                className={`group relative w-[108px] shrink-0 overflow-hidden rounded-2xl border-2 bg-white shadow-md transition-all hover:border-[#7B2CBF]/50 hover:shadow-lg active:scale-[0.97] sm:w-[120px] ${
                  profile.blurred ? 'border-gray-200' : 'border-[#7B2CBF]/35 profile-sway'
                }`}
                aria-label={`${profile.name}${profile.blurred ? ' — ontgrendel profiel' : ''}`}
              >
                <span className="relative block aspect-[3/4] w-full overflow-hidden bg-[#EDE7F6]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={profile.img}
                    alt=""
                    className={`h-full w-full object-cover ${
                      profile.blurred
                        ? 'scale-110 blur-xl brightness-90 saturate-50'
                        : 'scale-105'
                    }`}
                    loading="lazy"
                  />
                  {profile.blurred && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-[10px] font-bold uppercase tracking-wide text-white">
                      🔒
                    </span>
                  )}
                  {!profile.blurred && (
                    <span className="absolute bottom-2 left-0 right-0 text-center text-[10px] font-bold text-white drop-shadow-md">
                      Online
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-gray-500">
          6 profielen in jouw regio · 18+
        </p>
      </main>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-popup-title"
          onClick={() => setSelected(null)}
        >
          <div
            className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm"
              aria-label="Sluiten"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="relative aspect-[4/5] w-full bg-[#EDE7F6]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selected.img}
                alt=""
                className={`h-full w-full object-cover ${
                  selected.blurred ? 'blur-xl scale-110' : ''
                }`}
              />
              {selected.blurred && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-sm font-semibold text-white">
                  Profiel ontgrendelen na chat
                </span>
              )}
            </div>

            <div className="px-6 py-6 text-center">
              <p id="chat-popup-title" className="text-lg font-bold text-gray-900">
                {selected.name} wil met je chatten
              </p>
              <p className="mt-1 text-sm text-gray-500">Reageert meestal binnen 5 minuten</p>
              <button
                type="button"
                onClick={openChat}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#7B2CBF] px-6 py-4 text-base font-bold text-white shadow-lg transition hover:bg-[#6a24a8] active:scale-[0.98]"
              >
                <MessageCircle className="h-5 w-5" aria-hidden />
                Start chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
