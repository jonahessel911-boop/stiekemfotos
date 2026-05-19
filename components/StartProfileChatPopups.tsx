'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import type { Profile } from '@/lib/types/profile';
import { profilePhotoSrc } from '@/lib/profile-image-url';

const ROTATE_MS = 4500;
const SHOW_DELAY_MS = 2200;

type PopupStatus = 'online' | 'wants_chat';

function pickPhoto(profile: Profile): string {
  const urls = [profile.photo, ...(profile.photoGallery ?? [])].filter(Boolean) as string[];
  if (urls.length === 0) return profile.photo;
  return urls[Math.floor(Math.random() * urls.length)]!;
}

function pickRandomProfile(profiles: Profile[]): Profile {
  return profiles[Math.floor(Math.random() * profiles.length)]!;
}

function pickStatus(): PopupStatus {
  return Math.random() < 0.5 ? 'online' : 'wants_chat';
}

function OnlineDot() {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary ring-2 ring-white" />
    </span>
  );
}

export default function StartProfileChatPopups() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [swapKey, setSwapKey] = useState(0);
  const [active, setActive] = useState<{ profile: Profile; photo: string; status: PopupStatus } | null>(
    null
  );

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch('/api/profiles', { cache: 'no-store' });
        const d = (await r.json()) as { profiles?: Profile[] };
        if (!cancel && Array.isArray(d.profiles) && d.profiles.length > 0) {
          setProfiles(d.profiles);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const rotate = useCallback(() => {
    if (profiles.length === 0) return;
    const profile = pickRandomProfile(profiles);
    setActive({
      profile,
      photo: pickPhoto(profile),
      status: pickStatus(),
    });
    setSwapKey((k) => k + 1);
  }, [profiles]);

  useEffect(() => {
    if (profiles.length === 0 || dismissed) return;
    const showTimer = window.setTimeout(() => {
      rotate();
      setVisible(true);
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(showTimer);
  }, [profiles, dismissed, rotate]);

  useEffect(() => {
    if (!visible || dismissed || profiles.length === 0) return;
    const id = window.setInterval(rotate, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [visible, dismissed, profiles.length, rotate]);

  const statusLabel = useMemo(() => {
    if (!active) return '';
    return active.status === 'online' ? 'Is online' : 'Wilt nu chatten';
  }, [active]);

  if (dismissed || !visible || !active) return null;

  const imgSrc = profilePhotoSrc(active.photo, { widthCss: 48, heightCss: 48 });

  return (
    <div
      className="start-chat-popup pointer-events-auto fixed bottom-6 left-4 right-4 z-50 mx-auto max-w-[300px] sm:left-auto sm:right-6"
      role="status"
      aria-live="polite"
    >
      <div className="start-chat-popup-card relative rounded-2xl border-2 border-primary/40 bg-white p-3 shadow-xl shadow-primary/20">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-white shadow-md ring-2 ring-white"
          aria-label="Sluiten"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <p className="mb-2.5 text-center text-sm font-bold text-gray-900">Wilt chat sturen</p>

        <div key={swapKey} className="start-chat-popup-swap flex items-center gap-3">
          <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full ring-2 ring-primary">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgSrc} alt="" className="h-full w-full object-cover" />
            {active.status === 'online' && (
              <span className="absolute -bottom-0.5 -right-0.5">
                <OnlineDot />
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-gray-900">
              {active.profile.name}, {active.profile.age}
            </p>
            <p
              className={`mt-0.5 flex items-center gap-1 text-xs font-semibold ${
                active.status === 'online' ? 'text-emerald-600' : 'text-primary'
              }`}
            >
              {active.status === 'wants_chat' && (
                <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              {statusLabel}
            </p>
          </span>
        </div>
      </div>
    </div>
  );
}
