'use client';

import React from 'react';

/** Alleen 7 → 6 voor de countdown-animatie. */
const SPOTS_COUNTDOWN = [7, 6] as const;

type SpotsProps = {
  spotsLeft: number;
};

export function Start5RollingSpots({ spotsLeft }: SpotsProps) {
  const index = spotsLeft <= 6 ? 1 : 0;
  const label = spotsLeft === 1 ? 'plek beschikbaar' : 'plekken beschikbaar';

  return (
    <p
      className="start-spots-available mt-4 text-center"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="inline-flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1">
        <span className="start-spots-countdown-digit-wrap">
          <span className="start-spots-countdown-window" aria-hidden>
            <span
              className={`start-spots-countdown-strip ${index === 1 ? 'start-spots-countdown-strip--at-six' : ''}`}
            >
              {SPOTS_COUNTDOWN.map((n) => (
                <span key={n} className="start-spots-countdown-num">
                  {n}
                </span>
              ))}
            </span>
          </span>
        </span>
        <span className="start-spots-countdown-label underline decoration-[#dc2626] decoration-2 underline-offset-4">
          {label}
        </span>
      </span>
    </p>
  );
}

type PopupProps = {
  visible: boolean;
};

export function Start5SignupPopup({ visible }: PopupProps) {
  if (!visible) return null;

  return (
    <div role="status" aria-live="polite" className="start-signup-popup w-full">
      <div className="rounded-sm border-2 border-[#dc2626] bg-white px-4 py-3 shadow-md">
        <p className="text-sm font-bold text-gray-900">Dierderik heeft zich zojuist aangemeld</p>
      </div>
    </div>
  );
}
