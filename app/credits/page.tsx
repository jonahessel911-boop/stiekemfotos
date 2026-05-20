'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { CreditsPricingOffers } from '@/components/CreditsPricingOffers';
import {
  getCreditsBalance,
  getCreditPurchaseHistory,
  INITIAL_FREE_CREDITS,
  type CreditPurchaseRecord,
} from '@/lib/credits-client';
import { clearStoredUser } from '@/lib/onboarding-client';
import { useI18n } from '@/components/I18nProvider';
import { ArrowUpRight, LogOut, Wallet } from 'lucide-react';


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
  const { t } = useI18n();
  const [balance, setBalance] = useState(INITIAL_FREE_CREDITS);
  const [purchases, setPurchases] = useState<CreditPurchaseRecord[]>([]);
  const [loggingOut, setLoggingOut] = useState(false);

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

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      });
    } catch {
      /* netwerkfout negeren — client-side forceren we alsnog uitlog */
    }
    try {
      clearStoredUser();
    } catch {
      /* noop */
    }
    if (typeof window !== 'undefined') {
      window.location.href = '/start';
    }
  }, [loggingOut]);

  return (
    <div className="min-h-screen bg-[var(--surface)] pb-28 md:pb-10">
      <Navbar />
      <main className="pt-16 md:pt-20 max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-start gap-3 mb-8">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Wallet className="h-6 w-6" />
          </div>
          <div>
            <h1 className="platform-heading text-2xl">Credits</h1>
            <p className="text-sm text-gray-600 mt-1">
              Overzicht van je saldo.
            </p>
          </div>
        </div>

        <div className="mb-6 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Mijn foto&apos;s</p>
              <p className="text-xs text-gray-600">Bekijk al je gekochte / ontgrendelde foto&apos;s.</p>
            </div>
            <Link
              href="/mijn-fotos"
              className="inline-flex items-center rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-hover"
            >
              Open galerij
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200/80 bg-[var(--surface-card)] p-8 shadow-sm text-center mb-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-6">
            <Wallet className="h-8 w-8 text-primary" />
          </div>
          <p className="text-sm font-medium text-gray-500 mb-1">HUIDIG SALDO</p>
          <p className="text-6xl font-bold text-primary tabular-nums tracking-tighter">
            {balance}
          </p>
          <p className="text-sm text-gray-500 mt-1">credits over</p>
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
              Nog geen aankopen.
              <br />
              Koop hieronder credits bij om door te chatten.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 max-h-[min(420px,50vh)] overflow-y-auto">
              {purchases.map((p) => (
                <li key={p.id} className="px-4 py-4 flex gap-3 items-start">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary-deep">
                    <ArrowUpRight className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between">
                      <span className="font-medium text-gray-900">Credits gekocht</span>
                      <span className="text-primary font-bold tabular-nums">
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
            Koop credits om door te chatten. Elk bericht kost 10 credits.
          </p>
          <CreditsPricingOffers showIntro={false} onAfterPurchase={() => void refresh()} />
        </section>

        <div className="mt-10 flex justify-center">
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" />
            {loggingOut ? '…' : t('common.logout')}
          </button>
        </div>
      </main>
    </div>
  );
}
