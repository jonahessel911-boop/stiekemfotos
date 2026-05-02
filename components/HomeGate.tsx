'use client';

import React, { useEffect } from 'react';
import { hasCompletedStartup } from '@/lib/onboarding-client';

/** `/` — stuurt door naar onboarding of direct naar de feed. */
export default function HomeGate() {
  useEffect(() => {
    if (!hasCompletedStartup()) {
      window.location.replace('/start');
      return;
    }
    window.location.replace('/nieuwsfeed');
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--surface)] gap-4">
      <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-gray-500">Laden…</p>
    </div>
  );
}
