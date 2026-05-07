'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import {
  addCredits,
  CREDITS_PER_PHOTO_UNLOCK,
} from '@/lib/credits-client';

const PACKAGES = [
  { id: 'left', credits: 100, priceLabel: '€19,99', title: '1 foto', featured: false },
  { id: 'middle', credits: 300, priceLabel: '€49,99', title: '3 foto\u2019s', featured: true },
  { id: 'right', credits: 500, priceLabel: '€74,99', title: '5 foto\u2019s', featured: false },
] as const;

type Props = {
  showIntro?: boolean;
  onAfterPurchase?: () => void;
};

export function CreditsPricingOffers({ showIntro = true, onAfterPurchase }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = useState<string | null>(null);
  const search = useMemo(
    () => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search)),
    []
  );

  useEffect(() => {
    if (!search) return;
    const success = search.get('stripe_success');
    const sessionId = search.get('session_id');
    if (success !== '1' || !sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        let confirmed = false;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const res = await fetch('/api/stripe/confirm', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          });
          const data = (await res.json()) as {
            error?: string;
            alreadyProcessed?: boolean;
            credits?: number;
            priceLabel?: string;
          };
          if (res.status === 409 && attempt < 4) {
            await new Promise((resolve) => window.setTimeout(resolve, 900));
            continue;
          }
          if (!res.ok) throw new Error(data.error || 'Betaling bevestigen mislukt');
          if (!cancelled && !data.alreadyProcessed && data.credits && data.priceLabel) {
            addCredits(data.credits, data.priceLabel);
            onAfterPurchase?.();
            setPurchaseSuccess('Betaling succesvol, je credits zijn toegevoegd.');
          } else if (!cancelled) {
            setPurchaseSuccess('Betaling succesvol, je credits zijn toegevoegd.');
          }
          confirmed = true;
          break;
        }
        if (!confirmed && !cancelled) {
          throw new Error('Betaling wordt nog verwerkt, vernieuw de pagina zo opnieuw.');
        }
      } catch (e) {
        if (!cancelled) setPurchaseError(e instanceof Error ? e.message : 'Betaling mislukt');
      } finally {
        const u = new URL(window.location.href);
        u.searchParams.delete('stripe_success');
        u.searchParams.delete('stripe_canceled');
        u.searchParams.delete('session_id');
        window.history.replaceState({}, '', u.toString());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onAfterPurchase, search]);

  const handleBuy = async (pkgId: string) => {
    setPurchaseError(null);
    setPurchaseSuccess(null);
    setBusyId(pkgId);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: pkgId,
          returnUrl: window.location.href,
        }),
      });
      const data = (await res.json()) as { error?: string; url?: string };
      if (!res.ok || !data.url) throw new Error(data.error || 'Checkout starten mislukt');
      window.location.assign(data.url);
    } catch (e) {
      setPurchaseError(e instanceof Error ? e.message : 'Checkout fout');
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      {showIntro ? (
        <p className="text-sm text-gray-600 leading-relaxed">
          Chatten met de vrouwen is <strong>gratis</strong>. Wil je een foto van haar zien? Dat kost{' '}
          <strong>{CREDITS_PER_PHOTO_UNLOCK} credits per foto</strong>. Kies hieronder een pakket
          dat bij je past.{' '}
          <span className="font-semibold text-primary">
            Populair: 3 foto’s voor €49,99.
          </span>
        </p>
      ) : null}
      {purchaseError ? (
        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
          {purchaseError}
        </p>
      ) : null}
      {purchaseSuccess ? (
        <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {purchaseSuccess}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
        {PACKAGES.map((pkg) => (
          <div
            key={pkg.id}
            className={`relative rounded-2xl border p-5 shadow-sm ${
              pkg.featured
                ? 'border-primary bg-primary/[0.06] ring-2 ring-primary/25'
                : 'border-gray-200 bg-white'
            }`}
          >
            {pkg.featured ? (
              <span className="absolute -top-2.5 left-4 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                <Sparkles className="h-3 w-3" />
                Populair
              </span>
            ) : null}
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {pkg.title}
            </p>
            <div className="mt-2 text-3xl font-bold text-gray-900">{pkg.priceLabel}</div>
            <div className="mt-1 text-sm font-semibold text-primary">
              {pkg.credits.toLocaleString('nl-NL')} credits
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {Math.floor(pkg.credits / CREDITS_PER_PHOTO_UNLOCK)} foto
              {Math.floor(pkg.credits / CREDITS_PER_PHOTO_UNLOCK) === 1 ? '' : '’s'}{' '}
              ontgrendelen
            </p>
            <button
              type="button"
              onClick={() => void handleBuy(pkg.id)}
              disabled={busyId !== null}
              className={`mt-4 w-full rounded-2xl py-3 font-bold transition-colors ${
                pkg.featured
                  ? 'bg-primary text-white shadow-lg shadow-primary/25 hover:bg-primary-hover'
                  : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
              }`}
            >
              {busyId === pkg.id ? 'Even geduld…' : 'Koop nu'}
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
        <p className="text-xs text-gray-600">
          Op je bankafschrift kan een andere naam staan om jouw privacy te beschermen.
        </p>
        <p className="mt-1 text-[11px] text-gray-500">Veilig afrekenen via Stripe</p>
      </div>
    </div>
  );
}
