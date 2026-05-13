'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import type { Profile } from '@/lib/types/profile';
import { profilePhotoSrc, resolveProfileImageUrl } from '@/lib/profile-image-url';
import { isProfileDisplayedOnline } from '@/lib/profile-display-online';
import {
  DEFAULT_PHOTO_REQUEST_DRAFT,
  PROFILE_PHOTO_REQUEST_NAV_KEY,
  type ProfilePhotoRequestNavPayload,
} from '@/lib/profile-photo-request';
import { ChevronLeft, ChevronRight, Heart, MapPin, Mic, X } from 'lucide-react';

const SWIPE_THRESHOLD = 110;

function uniquePhotosForProfile(p: Profile): string[] {
  const raw = [p.photo, ...(p.photoGallery ?? [])].filter(Boolean) as string[];
  return [...new Set(raw)];
}

function persistPhotoRequestPayload(profileId: string) {
  try {
    const payload: ProfilePhotoRequestNavPayload = {
      profileId,
      draft: DEFAULT_PHOTO_REQUEST_DRAFT,
    };
    sessionStorage.setItem(PROFILE_PHOTO_REQUEST_NAV_KEY, JSON.stringify(payload));
  } catch {
    /* best effort */
  }
}

export default function SwipePage() {
  const router = useRouter();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [photoIndexByProfile, setPhotoIndexByProfile] = useState<Record<string, number>>({});
  const [drag, setDrag] = useState<{ dx: number; active: boolean; pointerId: number | null }>({
    dx: 0,
    active: false,
    pointerId: null,
  });
  const [flyOff, setFlyOff] = useState<'left' | 'right' | null>(null);

  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch('/api/profiles', {
          credentials: 'include',
          cache: 'no-store',
        });
        const data = (await res.json()) as { profiles?: Profile[]; error?: string };
        if (cancel) return;
        if (!res.ok) {
          setLoadError(data.error || 'Profielen laden mislukt.');
          setProfiles([]);
        } else {
          const list = Array.isArray(data.profiles) ? data.profiles : [];
          /** Lichte shuffle zodat opeenvolgende swipes niet altijd dezelfde volgorde tonen. */
          const shuffled = list
            .map((p) => ({ p, k: Math.random() }))
            .sort((a, b) => a.k - b.k)
            .map((x) => x.p);
          setProfiles(shuffled);
        }
      } catch {
        if (!cancel) {
          setLoadError('Netwerkfout bij laden van profielen.');
          setProfiles([]);
        }
      } finally {
        if (!cancel) setLoaded(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const current = profiles[index];
  const upcoming = profiles[index + 1];

  const currentPhotos = useMemo(
    () => (current ? uniquePhotosForProfile(current) : []),
    [current]
  );
  const currentPhotoIndex = current ? photoIndexByProfile[current.id] ?? 0 : 0;
  const currentPhotoUrl =
    currentPhotos[Math.min(currentPhotoIndex, Math.max(0, currentPhotos.length - 1))] ??
    current?.photo ??
    '';

  const upcomingPhotos = useMemo(
    () => (upcoming ? uniquePhotosForProfile(upcoming) : []),
    [upcoming]
  );

  const advance = useCallback(() => {
    setFlyOff(null);
    setDrag({ dx: 0, active: false, pointerId: null });
    dragStartRef.current = null;
    setIndex((i) => i + 1);
  }, []);

  const startChatWith = useCallback(
    (profileId: string) => {
      persistPhotoRequestPayload(profileId);
      router.push(`/berichten?profile=${encodeURIComponent(profileId)}`);
    },
    [router]
  );

  const triggerSwipe = useCallback(
    (direction: 'left' | 'right') => {
      if (!current || flyOff) return;
      setFlyOff(direction);
      if (direction === 'right') {
        startChatWith(current.id);
      } else {
        window.setTimeout(advance, 220);
      }
    },
    [advance, current, flyOff, startChatWith]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (flyOff || !current) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ dx: 0, active: true, pointerId: e.pointerId });
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.active || drag.pointerId !== e.pointerId || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    setDrag((d) => ({ ...d, dx }));
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.active || drag.pointerId !== e.pointerId) return;
    const dx = drag.dx;
    setDrag({ dx: 0, active: false, pointerId: null });
    dragStartRef.current = null;
    if (dx > SWIPE_THRESHOLD) {
      triggerSwipe('right');
    } else if (dx < -SWIPE_THRESHOLD) {
      triggerSwipe('left');
    }
  };

  const setPhotoIndex = (profileId: string, next: number) => {
    setPhotoIndexByProfile((m) => ({ ...m, [profileId]: next }));
  };

  const showPrevPhoto = () => {
    if (!current || currentPhotos.length <= 1) return;
    const next = (currentPhotoIndex - 1 + currentPhotos.length) % currentPhotos.length;
    setPhotoIndex(current.id, next);
  };
  const showNextPhoto = () => {
    if (!current || currentPhotos.length <= 1) return;
    const next = (currentPhotoIndex + 1) % currentPhotos.length;
    setPhotoIndex(current.id, next);
  };

  const swipeStyle: React.CSSProperties = (() => {
    if (flyOff) {
      const off = flyOff === 'right' ? 700 : -700;
      const rot = flyOff === 'right' ? 22 : -22;
      return {
        transform: `translate3d(${off}px, 0, 0) rotate(${rot}deg)`,
        transition: 'transform 220ms ease-out',
        opacity: 0,
      };
    }
    if (drag.active) {
      const rotate = Math.max(-18, Math.min(18, drag.dx / 14));
      return {
        transform: `translate3d(${drag.dx}px, 0, 0) rotate(${rotate}deg)`,
        transition: 'transform 0ms',
      };
    }
    return {
      transform: 'translate3d(0,0,0) rotate(0deg)',
      transition: 'transform 200ms ease-out',
    };
  })();

  const directionOverlay = (() => {
    if (flyOff === 'right' || (drag.active && drag.dx > 40))
      return { side: 'right' as const, intensity: Math.min(1, Math.abs(drag.dx) / 160) };
    if (flyOff === 'left' || (drag.active && drag.dx < -40))
      return { side: 'left' as const, intensity: Math.min(1, Math.abs(drag.dx) / 160) };
    return null;
  })();

  const exhausted = loaded && profiles.length > 0 && index >= profiles.length;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[var(--surface)] pb-28 md:pb-12">
      <Navbar />

      <div className="mx-auto w-full max-w-2xl flex-1 px-3 pt-14 sm:pt-16 md:pt-20">
        {/* Tekst boven de stack */}
        <div className="rounded-3xl border border-rose-100 bg-gradient-to-br from-rose-50 via-white to-white p-4 shadow-sm sm:p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-500">
            Account voltooien
          </p>
          <h1 className="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">
            Start je eerste chat om je account te voltooien
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">
            Swipe <span className="font-semibold text-gray-900">naar links</span> om over te slaan,
            en <span className="font-semibold text-rose-600">naar rechts</span> om direct een chat
            te starten met een meisje.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">
            Zeg ze precies wat jij wilt zien — ze maken graag persoonlijke foto&apos;s voor je. Of
            spreek wat in en maak ze gek.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => current && startChatWith(current.id)}
              disabled={!current || !!flyOff}
              className="inline-flex items-center justify-center rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-50"
            >
              Start chat
            </button>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-[12px] font-medium text-rose-700 ring-1 ring-inset ring-rose-100">
              <Mic className="h-3.5 w-3.5" /> Spraakberichten werken ook
            </span>
          </div>
        </div>

        {/* Card stack */}
        <div className="relative mx-auto mt-5 aspect-[3/4] w-full max-w-md select-none sm:mt-6">
          {!loaded ? (
            <div className="absolute inset-0 grid place-items-center rounded-3xl border border-gray-200 bg-white text-gray-500">
              Laden…
            </div>
          ) : loadError ? (
            <div className="absolute inset-0 grid place-items-center rounded-3xl border border-red-200 bg-red-50 px-6 text-center text-sm text-red-700">
              {loadError}
            </div>
          ) : profiles.length === 0 ? (
            <div className="absolute inset-0 grid place-items-center rounded-3xl border border-gray-200 bg-white px-6 text-center text-sm text-gray-600">
              Nog geen profielen beschikbaar.
            </div>
          ) : exhausted ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-3xl border border-gray-200 bg-white px-6 text-center">
              <p className="text-base font-semibold text-gray-900">Je hebt alle profielen gezien</p>
              <p className="text-sm text-gray-600">
                Bekijk de volledige lijst of begin met de profielen die je al leuk vond.
              </p>
              <Link
                href="/profielen"
                className="rounded-2xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
              >
                Naar alle profielen
              </Link>
            </div>
          ) : (
            <>
              {upcoming ? (
                <div className="absolute inset-0 origin-bottom scale-[0.96] transform overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
                  <img
                    src={profilePhotoSrc(upcomingPhotos[0] ?? upcoming.photo, {
                      widthCss: 520,
                      heightCss: 690,
                    })}
                    alt=""
                    className="h-full w-full object-cover object-top opacity-90"
                  />
                </div>
              ) : null}

              {current ? (
                <div
                  className="absolute inset-0 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-lg"
                  style={swipeStyle}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                >
                  <img
                    src={profilePhotoSrc(currentPhotoUrl, { widthCss: 520, heightCss: 690 })}
                    alt={current.name}
                    className="h-full w-full object-cover object-top"
                    draggable={false}
                  />

                  {/* Tap zones voor foto wisselen — alleen wanneer er meerdere foto's zijn. */}
                  {currentPhotos.length > 1 ? (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          showPrevPhoto();
                        }}
                        aria-label="Vorige foto"
                        className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white opacity-0 transition group-hover:opacity-100"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          showNextPhoto();
                        }}
                        aria-label="Volgende foto"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white opacity-0 transition group-hover:opacity-100"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                      <div className="pointer-events-none absolute inset-x-0 top-0 flex gap-1 p-2">
                        {currentPhotos.map((_, idx) => (
                          <span
                            key={idx}
                            className={`h-1.5 flex-1 rounded-full ${
                              idx === currentPhotoIndex ? 'bg-white' : 'bg-white/40'
                            }`}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          showPrevPhoto();
                        }}
                        aria-label="Vorige foto (tap)"
                        className="absolute inset-y-0 left-0 z-10 w-1/3 cursor-pointer"
                        style={{ background: 'transparent' }}
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          showNextPhoto();
                        }}
                        aria-label="Volgende foto (tap)"
                        className="absolute inset-y-0 right-0 z-10 w-1/3 cursor-pointer"
                        style={{ background: 'transparent' }}
                      />
                    </>
                  ) : null}

                  {/* Swipe overlay */}
                  {directionOverlay ? (
                    <div
                      className={`pointer-events-none absolute top-6 z-20 ${
                        directionOverlay.side === 'right' ? 'left-6 -rotate-12' : 'right-6 rotate-12'
                      }`}
                      style={{ opacity: directionOverlay.intensity }}
                    >
                      <span
                        className={`rounded-2xl border-4 px-4 py-2 text-xl font-extrabold uppercase tracking-wider ${
                          directionOverlay.side === 'right'
                            ? 'border-rose-500 text-rose-500'
                            : 'border-gray-500 text-gray-500'
                        }`}
                      >
                        {directionOverlay.side === 'right' ? 'Chat' : 'Skip'}
                      </span>
                    </div>
                  ) : null}

                  {/* Info onderaan: alleen naam/leeftijd, stad, hobby's */}
                  <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-4 text-white">
                    <div className="flex items-center gap-2">
                      <h2 className="text-2xl font-bold leading-tight">
                        {current.name}, {current.age}
                      </h2>
                      {isProfileDisplayedOnline(current.id) ? (
                        <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
                      ) : null}
                    </div>
                    <p className="mt-1 flex items-center gap-1 text-sm text-white/90">
                      <MapPin className="h-3.5 w-3.5" />
                      {current.location}
                    </p>
                    {current.interests?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {current.interests.slice(0, 6).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Actie-knoppen onder de stack */}
        {loaded && !loadError && profiles.length > 0 && !exhausted ? (
          <div className="mt-5 flex items-center justify-center gap-5 sm:mt-6">
            <button
              type="button"
              onClick={() => triggerSwipe('left')}
              disabled={!current || !!flyOff}
              aria-label="Overslaan"
              className="flex h-14 w-14 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm transition hover:scale-105 hover:text-gray-800 disabled:opacity-50"
            >
              <X className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => triggerSwipe('right')}
              disabled={!current || !!flyOff}
              aria-label="Start chat"
              className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-600 text-white shadow-md transition hover:scale-105 hover:bg-rose-700 disabled:opacity-50"
            >
              <Heart className="h-7 w-7" />
            </button>
          </div>
        ) : null}

        <p className="mt-4 px-2 text-center text-xs leading-relaxed text-gray-500">
          Vraag ze precies wat jij geil vindt — ze maken graag persoonlijke foto&apos;s voor je. Of
          stuur een spraakbericht en maak ze gek.
        </p>
      </div>
    </div>
  );
}
