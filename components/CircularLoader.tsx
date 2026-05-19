'use client';

import React from 'react';

/** Cirkelvormige voortgang (0–100), geen procenttekst. */
export function CircularLoader({
  progress,
  variant = 'default',
}: {
  progress: number;
  variant?: 'default' | 'start';
}) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, progress)) / 100);

  return (
    <div className="relative w-40 h-40 mx-auto">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120" aria-hidden>
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={variant === 'start' ? undefined : '#fecaca'}
          className={variant === 'start' ? 'start-loader-track' : undefined}
          strokeWidth="10"
        />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={variant === 'start' ? undefined : 'var(--brand, #dc2626)'}
          className={
            variant === 'start'
              ? 'start-loader-progress transition-[stroke-dashoffset] duration-150 ease-linear'
              : 'transition-[stroke-dashoffset] duration-150 ease-linear'
          }
          strokeWidth="10"
          strokeLinecap={variant === 'start' ? 'butt' : 'round'}
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
    </div>
  );
}
