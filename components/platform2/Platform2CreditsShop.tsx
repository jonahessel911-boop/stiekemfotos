'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  addCredits,
  getCreditsBalance,
  getCreditPurchaseHistory,
  INITIAL_FREE_CREDITS,
  type CreditPurchaseRecord,
} from '@/lib/credits-client';
import {
  PLATFORM2_CREDIT_PACKAGE_LIST,
  type Platform2CreditPackageId,
} from '@/lib/platform2-credit-packages';

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

export default function Platform2CreditsShop() {
  const [balance, setBalance] = useState(INITIAL_FREE_CREDITS);
  const [purchases, setPurchases] = useState<CreditPurchaseRecord[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setBalance(getCreditsBalance());
    setPurchases(getCreditPurchaseHistory());
  }, []);

  useEffect(() => {
    refresh();
    const onUp = () => refresh();
    window.addEventListener('dm-credits-updated', onUp);
    return () => window.removeEventListener('dm-credits-updated', onUp);
  }, [refresh]);

  const search = useMemo(
    () => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search)),
    []
  );

  useEffect(() => {
    if (!search) return;
    const ok = search.get('stripe_success');
    const sessionId = search.get('session_id');
    if (ok !== '1' || !sessionId) return;
    let cancelled = false;
    (async () => {
      try {
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
            await new Promise((r) => setTimeout(r, 900));
            continue;
          }
          if (!res.ok) throw new Error(data.error || 'Betaling bevestigen mislukt');
          if (!cancelled && !data.alreadyProcessed && data.credits && data.priceLabel) {
            addCredits(data.credits, data.priceLabel);
            refresh();
          }
          if (!cancelled) {
            setSuccess('Betaling gelukt. Je credits zijn bijgeschreven.');
          }
          break;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Betaling mislukt');
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
  }, [refresh, search]);

  const buy = async (packageId: Platform2CreditPackageId) => {
    setError(null);
    setSuccess(null);
    setBusyId(packageId);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId,
          returnUrl: window.location.href,
        }),
      });
      const data = (await res.json()) as { error?: string; url?: string };
      if (res.status === 401) {
        window.location.href = `/platform/2/aanmelden?next=${encodeURIComponent('/platform/2/credits')}`;
        return;
      }
      if (!res.ok || !data.url) throw new Error(data.error || 'Checkout starten mislukt');
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout fout');
      setBusyId(null);
    }
  };

  return (
    <>
      <h1 className="platform2-page-title">Credits kopen</h1>
      <p className="platform2-page-sub">
        Kies een pakket en betaal via Stripe. Elk bericht kost 10 credits.{' '}
        <Link href="/platform/2/berichten">Terug naar berichten</Link>
      </p>

      {error ? <div className="platform2-error">{error}</div> : null}
      {success ? <div className="platform2-success">{success}</div> : null}
      {search?.get('stripe_canceled') === '1' ? (
        <div className="platform2-error">Betaling geannuleerd.</div>
      ) : null}

      <div className="platform2-panel">
        <div className="platform2-panel-head">
          <strong>Jouw saldo</strong>
        </div>
        <div className="platform2-panel-body platform2-credits-saldo">
          <span className="platform2-credits-saldo-num">{balance}</span>
          <span>credits beschikbaar</span>
        </div>
      </div>

      <div className="platform2-panel">
        <div className="platform2-panel-head">
          <strong>Pakketten</strong>
        </div>
        <table className="platform2-table platform2-credits-table">
          <thead>
            <tr>
              <th>Credits</th>
              <th>Prijs</th>
              <th>&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {PLATFORM2_CREDIT_PACKAGE_LIST.map((pkg) => (
              <tr key={pkg.id}>
                <td>
                  <strong>{pkg.credits.toLocaleString('nl-NL')}</strong> credits
                </td>
                <td className="platform2-credits-price">{pkg.priceLabel}</td>
                <td className="platform2-credits-action">
                  <button
                    type="button"
                    className="platform2-btn"
                    disabled={busyId !== null}
                    onClick={() => void buy(pkg.id)}
                  >
                    {busyId === pkg.id ? 'Doorsturen…' : 'Kopen'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="platform2-panel">
        <div className="platform2-panel-head">
          <strong>Aankoopgeschiedenis</strong>
        </div>
        {purchases.length === 0 ? (
          <p className="platform2-panel-body platform2-panel-empty">Nog geen aankopen.</p>
        ) : (
          <table className="platform2-table">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Credits</th>
                <th>Bedrag</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id}>
                  <td>{formatWhen(p.at)}</td>
                  <td>+{p.credits}</td>
                  <td>{p.priceLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
