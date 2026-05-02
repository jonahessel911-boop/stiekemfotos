'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { CreditsPricingOffers } from '@/components/CreditsPricingOffers';
import {
  getCreditsBalance,
  getCreditPurchaseHistory,
  CREDITS_PER_MESSAGE,
  INITIAL_FREE_CREDITS,
  type CreditPurchaseRecord,
} from '@/lib/credits-client';
import type { UserMessageCreditLine } from '@/lib/types/credit-usage';
import { ArrowDownRight, ArrowUpRight, Wallet } from 'lucide-react';

type MergedTx =
  | {
      key: string;
      kind: 'spend';
      at: string;
      credits: number;
      title: string;
      conversationId: string;
    }
  | {
      key: string;
      kind: 'purchase';
      at: string;
      credits: number;
      title: string;
      detail: string;
    };

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
  const [balance, setBalance] = useState(INITIAL_FREE_CREDITS);
  const [spendLines, setSpendLines] = useState<UserMessageCreditLine[]>([]);
  const [totalSpentServer, setTotalSpentServer] = useState(0);
  const [purchases, setPurchases] = useState<CreditPurchaseRecord[]>([]);

  const refresh = useCallback(async () => {
    setBalance(getCreditsBalance());
    setPurchases(getCreditPurchaseHistory());
    try {
      const r = await fetch('/api/credits/usage');
      const d = (await r.json()) as {
        messages?: UserMessageCreditLine[];
        totalSpent?: number;
      };
      setSpendLines(Array.isArray(d.messages) ? d.messages : []);
      setTotalSpentServer(typeof d.totalSpent === 'number' ? d.totalSpent : 0);
    } catch {
      setSpendLines([]);
      setTotalSpentServer(0);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUp = () => void refresh();
    window.addEventListener('dm-credits-updated', onUp);
    return () => window.removeEventListener('dm-credits-updated', onUp);
  }, [refresh]);

  const totalPurchased = useMemo(
    () => purchases.reduce((s, p) => s + p.credits, 0),
    [purchases]
  );

  const transactions = useMemo(() => {
    const spend: MergedTx[] = spendLines.map((m) => ({
      key: `s-${m.messageId}`,
      kind: 'spend' as const,
      at: m.createdAt,
      credits: m.credits,
      title: `Bericht naar ${m.profileName}`,
      conversationId: m.conversationId,
    }));
    const buy: MergedTx[] = purchases.map((p) => ({
      key: `p-${p.id}`,
      kind: 'purchase' as const,
      at: p.at,
      credits: p.credits,
      title: 'Credits gekocht',
      detail: p.priceLabel,
    }));
    return [...spend, ...buy].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
    );
  }, [spendLines, purchases]);

  return (
    <div className="min-h-screen bg-[var(--surface)] pb-28 md:pb-10">
      <Navbar />
      <main className="pt-16 md:pt-20 max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-start gap-3 mb-8">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Wallet className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Credits</h1>
            <p className="text-sm text-gray-600 mt-1">
              Overzicht van je saldo, verbruik per bericht ({CREDITS_PER_MESSAGE} credits) en
              aankopen.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mb-8">
          <div className="rounded-2xl border border-gray-200/80 bg-[var(--surface-card)] p-4 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Huidig saldo</p>
            <p className="text-2xl font-bold text-primary mt-1 tabular-nums">
              {balance.toLocaleString('nl-NL')}
            </p>
            <p className="text-xs text-gray-500 mt-1">credits</p>
          </div>
          <div className="rounded-2xl border border-gray-200/80 bg-[var(--surface-card)] p-4 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Verbruikt (chat)
            </p>
            <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">
              {totalSpentServer.toLocaleString('nl-NL')}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {spendLines.length} bericht{spendLines.length === 1 ? '' : 'en'}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200/80 bg-[var(--surface-card)] p-4 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Gekocht</p>
            <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">
              {totalPurchased.toLocaleString('nl-NL')}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {purchases.length} aankoop{purchases.length === 1 ? '' : 'en'}
            </p>
          </div>
        </div>

        <section className="rounded-2xl border border-gray-200/80 bg-white shadow-sm overflow-hidden mb-10">
          <div className="px-4 py-3 border-b border-gray-100 bg-[var(--surface-card)]">
            <h2 className="font-semibold text-gray-900">Transacties</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Per verstuurd bericht en per creditaankoop (nieuwste eerst).
            </p>
          </div>
          {transactions.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-gray-500">
              Nog geen transacties. Stuur een bericht in{' '}
              <Link href="/berichten" className="text-primary font-semibold underline">
                Berichten
              </Link>{' '}
              of koop credits hieronder.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 max-h-[min(420px,50vh)] overflow-y-auto">
              {transactions.map((tx) => (
                <li key={tx.key} className="px-4 py-3 flex gap-3 items-start">
                  <div
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                      tx.kind === 'purchase'
                        ? 'bg-emerald-500/12 text-emerald-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {tx.kind === 'purchase' ? (
                      <ArrowUpRight className="h-4 w-4" />
                    ) : (
                      <ArrowDownRight className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                      <span className="font-medium text-gray-900 text-sm">{tx.title}</span>
                      <span
                        className={`text-sm font-bold tabular-nums shrink-0 ${
                          tx.kind === 'purchase' ? 'text-emerald-600' : 'text-gray-800'
                        }`}
                      >
                        {tx.kind === 'purchase' ? '+' : '−'}
                        {tx.credits.toLocaleString('nl-NL')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{formatWhen(tx.at)}</p>
                    {tx.kind === 'purchase' ? (
                      <p className="text-xs text-gray-600 mt-1 line-clamp-2">{tx.detail}</p>
                    ) : null}
                    {tx.kind === 'spend' ? (
                      <Link
                        href={`/berichten?chat=${encodeURIComponent(tx.conversationId)}`}
                        className="text-xs text-primary font-medium mt-1 inline-block hover:underline"
                      >
                        Open gesprek
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200/80 bg-[var(--surface-card)] p-5 md:p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-1">Credits bijkopen</h2>
          <p className="text-sm text-gray-600 mb-5">
            Zelfde prijzen als in de app — je eerste {INITIAL_FREE_CREDITS} credits waren gratis.
          </p>
          <CreditsPricingOffers showIntro={false} onAfterPurchase={() => void refresh()} />
        </section>
      </main>
    </div>
  );
}
