'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import {
  startOntmoetjongensCheckout,
  type StartCheckoutPath,
} from '@/lib/start-ontmoetjongens-checkout';
import { readStoredStartEmail, storeStartEmail } from '@/lib/start-lead-client';

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

type Props = {
  startPath: StartCheckoutPath;
  secondsLeft: number;
  children?: React.ReactNode;
};

export default function StartPaymentCheckoutBlock({ startPath, secondsLeft, children }: Props) {
  const [email, setEmail] = useState('');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = readStoredStartEmail();
    if (stored) setEmail(stored);
  }, []);

  const startCheckout = useCallback(async () => {
    const clean = email.trim().toLowerCase();
    if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setError('Vul een geldig e-mailadres in.');
      return;
    }
    setError(null);
    setCheckoutBusy(true);
    try {
      storeStartEmail(clean);
      await startOntmoetjongensCheckout(startPath, clean);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Account voltooien mislukt');
      setCheckoutBusy(false);
    }
  }, [email, startPath]);

  return (
    <section className="start-payment-block" aria-live="polite">
      <div
        className="start-timer-box mb-3 flex w-full items-center justify-center gap-2 px-4 py-2.5"
        aria-label={`${formatCountdown(secondsLeft)} om uw plek te reserveren`}
      >
        <Clock className="h-4 w-4 shrink-0 text-[#dc2626]" aria-hidden />
        <span className="text-lg font-bold tabular-nums text-[#dc2626]">
          {formatCountdown(secondsLeft)}
        </span>
        <span className="text-sm text-gray-800">om uw plek te reserveren</span>
      </div>
      <label className="mb-3 block">
        <span className="mb-1.5 block text-sm font-semibold text-gray-800">E-mail</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          placeholder="jouw@email.nl"
          disabled={checkoutBusy}
          className="start-email-input w-full rounded-sm border-2 border-gray-400 bg-white px-4 py-3 text-base text-gray-900 placeholder:text-gray-500 focus:border-[#dc2626] focus:outline-none disabled:opacity-60"
        />
      </label>
      {error ? <p className="start-error mb-3 text-sm px-4 py-2">{error}</p> : null}
      <button
        type="button"
        disabled={checkoutBusy}
        onClick={() => void startCheckout()}
        className="start-btn start-btn-primary w-full py-4 px-6 text-lg text-center"
      >
        {checkoutBusy ? 'Even geduld…' : 'Voltooi account'}
      </button>
      {children}
    </section>
  );
}
