'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import OntmoetjongensBrand from '@/components/OntmoetjongensBrand';
import OntmoetjongensPaidReturn from '@/components/OntmoetjongensPaidReturn';
import ClickFlareCapture from '@/components/ClickFlareCapture';
import { startKortingCheckout } from '@/lib/korting-checkout-client';
import {
  KORTING_DISCOUNT_PERCENT,
  KORTING_PRICE_LABEL,
  KORTING_REFERENCE_LABEL,
} from '@/lib/korting-offer';

type Lookup = {
  found: boolean;
  naam: string | null;
  alreadyPaid: boolean;
};

export default function KortingPage() {
  const searchParams = useSearchParams();
  const emailFromUrl = searchParams.get('email')?.trim().toLowerCase() ?? '';

  const [email, setEmail] = useState(emailFromUrl);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    if (emailFromUrl) setEmail(emailFromUrl);
  }, [emailFromUrl]);

  useEffect(() => {
    const q = emailFromUrl || email.trim().toLowerCase();
    if (!q || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) {
      setLookup(null);
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/korting/lookup?email=${encodeURIComponent(q)}`, {
          credentials: 'include',
        });
        const data = (await res.json()) as Lookup & { error?: string };
        if (!cancel) {
          if (!res.ok) {
            setLookup(null);
            return;
          }
          setLookup({
            found: Boolean(data.found),
            naam: data.naam ?? null,
            alreadyPaid: Boolean(data.alreadyPaid),
          });
          if (data.alreadyPaid) setPaid(true);
        }
      } catch {
        if (!cancel) setLookup(null);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [emailFromUrl, email]);

  const handleCheckout = useCallback(async () => {
    const clean = email.trim().toLowerCase();
    if (!clean) {
      setError('Vul je e-mailadres in.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await startKortingCheckout(clean);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout mislukt');
      setBusy(false);
    }
  }, [email]);

  return (
    <div className="min-h-screen bg-[#fff0f0] flex flex-col">
      <ClickFlareCapture />
      <OntmoetjongensPaidReturn onPaid={() => setPaid(true)} />

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-10 max-w-lg mx-auto w-full">
        <div className="w-full max-w-md space-y-6">
          <div className="flex justify-center border-b-2 border-[#dc2626] pb-4">
            <OntmoetjongensBrand variant="hero" />
          </div>

          {paid || lookup?.alreadyPaid ? (
            <div className="rounded-sm border-2 border-[#dc2626] bg-white p-6 text-center space-y-3">
              <p className="text-lg font-bold text-gray-900">Je hebt al toegang</p>
              <p className="text-sm text-gray-700">
                Controleer je inbox voor de login-link, of log in als je je wachtwoord al hebt ingesteld.
              </p>
              <a
                href="/login"
                className="inline-block w-full rounded-sm border-2 border-[#7f1d1d] bg-[#dc2626] py-4 px-6 text-center text-lg font-bold text-white hover:bg-[#b91c1c]"
              >
                Naar inloggen
              </a>
            </div>
          ) : (
            <>
              <div className="text-center space-y-2">
                <p className="text-sm font-semibold uppercase tracking-wide text-[#dc2626]">
                  Tijdelijke aanbieding — 24 uur
                </p>
                <h1 className="text-2xl font-bold text-gray-900 leading-snug">
                  {KORTING_DISCOUNT_PERCENT}% korting op je toegang
                </h1>
                {lookup?.naam ? (
                  <p className="text-gray-800">
                    Hoi {lookup.naam}, dit is jouw persoonlijke aanbieding.
                  </p>
                ) : (
                  <p className="text-gray-800">Rond je account af met extra korting.</p>
                )}
              </div>

              <div className="rounded-sm border-2 border-[#dc2626] bg-white p-5 space-y-3">
                <p className="text-sm text-gray-600 line-through">Was {KORTING_REFERENCE_LABEL}</p>
                <p className="text-3xl font-bold text-[#dc2626]">{KORTING_PRICE_LABEL}</p>
                <p className="text-sm text-gray-800">
                  Platformtoegang + 100 credits-positionering — {KORTING_DISCOUNT_PERCENT}% korting t.o.v.{' '}
                  {KORTING_REFERENCE_LABEL}.
                </p>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-gray-800">E-mail</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="jouw@email.nl"
                  disabled={busy}
                  className="w-full rounded-sm border-2 border-gray-400 bg-white px-4 py-3 text-base text-gray-900 focus:border-[#dc2626] focus:outline-none disabled:opacity-60"
                />
                {lookup?.found ? (
                  <p className="mt-1.5 text-xs text-gray-600">Account herkend voor dit e-mailadres.</p>
                ) : null}
              </label>

              {error ? (
                <p className="text-sm text-[#7f1d1d] bg-[#fee2e2] border border-[#b91c1c] rounded-sm px-4 py-2">
                  {error}
                </p>
              ) : null}

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCheckout()}
                className="w-full rounded-sm border-2 border-[#7f1d1d] bg-[#dc2626] py-4 px-6 text-lg font-bold text-white hover:bg-[#b91c1c] disabled:opacity-60"
              >
                {busy ? 'Even geduld…' : 'Bekijk jouw aanbieding — afrekenen'}
              </button>

              <p className="text-center text-xs text-gray-600">
                Na betaling ontvang je direct een e-mail met toegang tot het platform.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
