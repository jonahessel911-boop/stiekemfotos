'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { CreditsPricingOffers } from '@/components/CreditsPricingOffers';
import {
  addCredits,
  getCreditsBalance,
  getCreditPurchaseHistory,
  CREDITS_PER_PHOTO_UNLOCK,
  type CreditPurchaseRecord,
} from '@/lib/credits-client';
import { ArrowUpRight, Wallet } from 'lucide-react';


function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString('nl-NL', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function CreditsPage() {
  const [balance, setBalance] = useState(0);
  const [purchases, setPurchases] = useState<CreditPurchaseRecord[]>([]);
  const [claimingFreeCredits, setClaimingFreeCredits] = useState(false);

  const refresh = useCallback(async () => {
    setBalance(getCreditsBalance());
    setPurchases(getCreditPurchaseHistory());
  }, []);

  useEffect(() => {
    void refresh();
    const onUp = () => void refresh();
    window.addEventListener('dm-credits-updated', onUp);
    return () => window.removeEventListener('dm-credits-updated', onUp);
  }, [refresh]);

  const claimFreeCredits = useCallback(() => {
    setClaimingFreeCredits(true);
    addCredits(CREDITS_PER_PHOTO_UNLOCK, `Test: +${CREDITS_PER_PHOTO_UNLOCK} credits`);
    void refresh().finally(() => setClaimingFreeCredits(false));
  }, [refresh]);

  return (
    <div className="min-h-screen bg-[var(--surface)] pb-28 lg:pb-10">
      <Navbar />
      <main className="mx-auto w-full max-w-screen-xl px-4 py-8 pt-16 sm:px-6 lg:px-8 lg:pt-20">
        <div className="flex items-start gap-3 mb-8">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Wallet className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Credits</h1>
            <p className="text-sm text-gray-600 mt-1">
              Chatten is gratis. Je gebruikt credits om foto’s van vrouwen te ontgrendelen — 1 foto = {CREDITS_PER_PHOTO_UNLOCK} credits.
            </p>
          </div>
        </div>

        <div className="mb-8 rounded-2xl border border-gray-200/80 bg-[var(--surface-card)] p-5 text-center shadow-sm sm:p-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-6">
            <Wallet className="h-8 w-8 text-primary" />
          </div>
          <p className="text-sm font-medium text-gray-500 mb-1">HUIDIG SALDO</p>
          <p className="text-5xl font-bold tracking-tighter text-primary tabular-nums sm:text-6xl">
            {balance}
          </p>
          <p className="text-sm text-gray-500 mt-1">credits over</p>
          <p className="text-xs text-gray-400 mt-6">
            1 foto ontgrendelen kost {CREDITS_PER_PHOTO_UNLOCK} credits
          </p>
        </div>

        <section className="rounded-2xl border border-gray-200/80 bg-white shadow-sm overflow-hidden mb-10">
          <div className="px-4 py-3 border-b border-gray-100 bg-[var(--surface-card)]">
            <h2 className="font-semibold text-gray-900">Aankopen</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Je aankoopgeschiedenis (nieuwste eerst)
            </p>
          </div>
          {purchases.length === 0 ? (
            <p className="px-4 py-16 text-center text-sm text-gray-500">
              Nog geen aankopen.<br />
              Koop credits hieronder om foto’s te ontgrendelen.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 max-h-[min(420px,50vh)] overflow-y-auto">
              {purchases.map((p) => (
                <li key={p.id} className="px-4 py-4 flex gap-3 items-start">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-700">
                    <ArrowUpRight className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between">
                      <span className="font-medium text-gray-900">Credits gekocht</span>
                      <span className="text-emerald-600 font-bold tabular-nums">
                        +{p.credits}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{formatWhen(p.at)}</p>
                    <p className="text-xs text-gray-600 mt-1">{p.priceLabel}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200/80 bg-[var(--surface-card)] p-5 md:p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-1">Credits bijkopen</h2>
          <p className="text-sm text-gray-600 mb-6">
            Chatten is gratis. Koop credits om foto’s van de vrouwen te ontgrendelen — 1 foto kost {CREDITS_PER_PHOTO_UNLOCK} credits.
          </p>
          <div className="mb-5 rounded-xl border border-dashed border-primary/35 bg-primary/[0.05] p-4">
            <p className="text-sm font-semibold text-gray-900">Testmodus</p>
            <p className="mt-1 text-xs text-gray-600">
              Voor development kun je gratis {CREDITS_PER_PHOTO_UNLOCK} credits toevoegen
              (genoeg voor 1 foto).
            </p>
            <button
              type="button"
              onClick={claimFreeCredits}
              disabled={claimingFreeCredits}
              className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
            >
              {claimingFreeCredits ? 'Bezig…' : `+${CREDITS_PER_PHOTO_UNLOCK} test credits`}
            </button>
          </div>
          <CreditsPricingOffers showIntro={false} onAfterPurchase={() => void refresh()} />
        </section>
      </main>
    </div>
  );
}
