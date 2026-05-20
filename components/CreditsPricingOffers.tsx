'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Flame, Sparkles } from 'lucide-react';
import { addCredits } from '@/lib/credits-client';
import {
  CREDIT_DEAL,
  CREDIT_PACKAGE_DEFINITIONS,
  creditsPriceEurCents,
  creditsWasPriceEurCents,
  formatPriceLabelFromCents,
  type CreditPackageId,
} from '@/lib/credit-packages';
import { DealWalletPayButton } from '@/components/DealWalletPayButton';

const PACKAGES = (Object.entries(CREDIT_PACKAGE_DEFINITIONS) as Array<
  [CreditPackageId, (typeof CREDIT_PACKAGE_DEFINITIONS)[CreditPackageId]]
>).map(([id, def]) => {
  const priceEurCents = creditsPriceEurCents(def.credits);
  const wasPriceEurCents = creditsWasPriceEurCents(def.credits);
  return {
    id,
    credits: def.credits,
    priceLabel: formatPriceLabelFromCents(priceEurCents),
    wasPriceLabel: formatPriceLabelFromCents(wasPriceEurCents),
    discountPercent: CREDIT_DEAL.discountPercent,
    featured: def.featured,
    priceEurCents,
  };
});

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

  const featured = PACKAGES.find((p) => p.featured);

  return (
    <div className="space-y-5">
      {showIntro ? (
        <p className="text-sm text-gray-600 leading-relaxed">
          Koop credits om door te chatten. Elk bericht kost 10 credits. Je start met 100 gratis credits.{' '}
          {featured ? (
            <span className="font-semibold text-primary">
              Speciale aanbieding: {featured.credits} credits voor {featured.priceLabel} —{' '}
              {featured.discountPercent}% korting (was {featured.wasPriceLabel}).
            </span>
          ) : null}
        </p>
      ) : null}
      {purchaseError ? (
        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
          {purchaseError}
        </p>
      ) : null}
      {purchaseSuccess ? (
        <p className="rounded-xl border border-primary/15 bg-primary/5 px-3 py-2 text-xs text-primary-deep">
          {purchaseSuccess}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
        {PACKAGES.map((pkg) => (
          <div
            key={pkg.id}
            className={`relative rounded-2xl p-5 shadow-sm ${
              pkg.featured
                ? 'border-4 border-primary bg-gradient-to-br from-primary/[0.08] via-red-50 to-white ring-4 ring-primary/40 shadow-xl shadow-primary/15 lg:scale-[1.03]'
                : 'border border-gray-200 bg-white'
            }`}
          >
            {pkg.featured ? (
              <>
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-3 -top-3 z-10 flex h-16 w-16 rotate-12 items-center justify-center rounded-full bg-primary text-center text-[11px] font-extrabold uppercase leading-tight tracking-tight text-white shadow-lg shadow-primary/40 ring-2 ring-white"
                >
                  <span className="flex flex-col items-center">
                    <span className="text-base leading-none">{pkg.discountPercent}%</span>
                    <span className="text-[9px] leading-tight">korting</span>
                  </span>
                </span>
                <span className="absolute -top-3 left-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-md shadow-primary/30">
                  <Flame className="h-3.5 w-3.5" />
                  Speciale aanbieding
                </span>
              </>
            ) : null}
            <div
              className={`flex flex-wrap items-baseline gap-x-2 gap-y-0 ${pkg.featured ? 'pt-4' : 'mt-2'}`}
            >
              <span
                className={`font-bold ${pkg.featured ? 'text-4xl text-primary' : 'text-3xl text-gray-900'}`}
              >
                {pkg.priceLabel}
              </span>
              <span className="text-lg font-semibold text-gray-400 line-through">
                {pkg.wasPriceLabel}
              </span>
            </div>
            <div
              className={`mt-1 text-sm font-semibold ${pkg.featured ? 'text-primary-deep' : 'text-primary'}`}
            >
              {pkg.credits.toLocaleString('nl-NL')} credits
            </div>
            {pkg.featured ? (
              <p className="mt-1 text-xs text-gray-700">
                <Sparkles className="-mt-0.5 mr-0.5 inline h-3 w-3 text-primary" />
                <span className="font-semibold text-primary-deep">
                  Beste deal — bespaar {pkg.discountPercent}% nu.
                </span>
              </p>
            ) : null}
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
              {busyId === pkg.id ? 'Even geduld…' : pkg.featured ? 'Pak deze deal' : 'Koop nu'}
            </button>
            {pkg.featured ? (
              <DealWalletPayButton
                publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''}
                amountCents={pkg.priceEurCents}
                currency="eur"
                totalLabel={`${pkg.credits} credits — speciale deal ${pkg.priceLabel}`}
                disabled={busyId !== null}
                onPaid={(credits, priceLabel) => {
                  addCredits(credits, priceLabel);
                  onAfterPurchase?.();
                  setPurchaseSuccess('Betaling succesvol, je credits zijn toegevoegd.');
                  setPurchaseError(null);
                }}
                onWalletError={(msg) => {
                  setPurchaseError(msg);
                }}
              />
            ) : null}
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
