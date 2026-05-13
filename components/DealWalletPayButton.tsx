'use client';

import { useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';

/** Zelfde API-versie als `lib/server/stripe.ts` (server-side Stripe client). */
const STRIPE_JS_API_VERSION = '2026-04-22.dahlia';

type Props = {
  publishableKey: string;
  amountCents: number;
  currency: string;
  totalLabel: string;
  onPaid: (credits: number, priceLabel: string) => void;
  onWalletError: (message: string) => void;
  disabled?: boolean;
};

/**
 * Apple Pay / Google Pay (Stripe Payment Request Button) voor de deal-pakketprijs.
 * @see https://docs.stripe.com/stripe-js/elements/payment-request-button
 */
export function DealWalletPayButton({
  publishableKey,
  amountCents,
  currency,
  totalLabel,
  onPaid,
  onWalletError,
  disabled,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'hidden'>('loading');
  const onPaidRef = useRef(onPaid);
  const onWalletErrorRef = useRef(onWalletError);
  onPaidRef.current = onPaid;
  onWalletErrorRef.current = onWalletError;

  useEffect(() => {
    if (!publishableKey?.trim() || disabled) {
      setStatus('hidden');
      return;
    }

    let cancelled = false;
    let unmountPr: (() => void) | null = null;

    (async () => {
      setStatus('loading');
      const mountEl = mountRef.current;
      if (!mountEl) {
        if (!cancelled) setStatus('hidden');
        return;
      }
      try {
        const res = await fetch('/api/stripe/payment-intent', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageId: 'middle' }),
        });
        const data = (await res.json()) as {
          error?: string;
          clientSecret?: string;
        };
        if (!res.ok || !data.clientSecret) {
          if (!cancelled) {
            setStatus('hidden');
            onWalletErrorRef.current(data.error || 'Wallet-betaling niet beschikbaar.');
          }
          return;
        }
        const clientSecret = data.clientSecret;

        const stripe = await loadStripe(publishableKey.trim(), {
          apiVersion: STRIPE_JS_API_VERSION,
        });
        if (!stripe || cancelled) {
          if (!cancelled) setStatus('hidden');
          return;
        }

        const paymentRequest = stripe.paymentRequest({
          country: 'NL',
          currency: currency.toLowerCase(),
          total: { label: totalLabel, amount: amountCents },
          requestPayerEmail: true,
        });

        const canPay = await paymentRequest.canMakePayment();
        if (cancelled || !canPay) {
          if (!cancelled) setStatus('hidden');
          return;
        }

        const elements = stripe.elements();
        const prButton = elements.create('paymentRequestButton', {
          paymentRequest,
          style: {
            paymentRequestButton: {
              type: 'buy',
              theme: 'light',
              height: '48px',
            },
          },
        });

        const onPaymentMethod = async (ev: {
          complete: (status: 'success' | 'fail') => void;
          paymentMethod: { id: string };
        }) => {
          try {
            const { error, paymentIntent } = await stripe.confirmCardPayment(
              clientSecret,
              { payment_method: ev.paymentMethod.id },
              { handleActions: true }
            );
            if (error || !paymentIntent || paymentIntent.status !== 'succeeded') {
              ev.complete('fail');
              onWalletErrorRef.current(error?.message || 'Betaling mislukt.');
              return;
            }
            ev.complete('success');

            let done = false;
            for (let attempt = 0; attempt < 8; attempt += 1) {
              const cr = await fetch('/api/stripe/confirm-payment-intent', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paymentIntentId: paymentIntent.id }),
              });
              const cd = (await cr.json()) as {
                error?: string;
                credits?: number;
                priceLabel?: string;
                alreadyProcessed?: boolean;
              };
              if (cr.status === 409 && attempt < 7) {
                await new Promise((r) => setTimeout(r, 650));
                continue;
              }
              if (!cr.ok) {
                onWalletErrorRef.current(cd.error || 'Bevestigen mislukt.');
                done = true;
                break;
              }
              if (cd.credits && cd.priceLabel && !cd.alreadyProcessed) {
                onPaidRef.current(cd.credits, cd.priceLabel);
              }
              done = true;
              break;
            }
            if (!done) {
              onWalletErrorRef.current('Even vernieuwen — je betaling wordt verwerkt.');
            }
          } catch (e) {
            try {
              ev.complete('fail');
            } catch {
              /* ignore */
            }
            onWalletErrorRef.current(e instanceof Error ? e.message : 'Betaling mislukt');
          }
        };

        paymentRequest.on('paymentmethod', onPaymentMethod);
        prButton.mount(mountEl);
        unmountPr = () => {
          try {
            prButton.unmount();
          } catch {
            /* ignore */
          }
          paymentRequest.off('paymentmethod', onPaymentMethod);
        };
        if (!cancelled) setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setStatus('hidden');
          onWalletErrorRef.current(e instanceof Error ? e.message : 'Wallet start mislukt.');
        }
      }
    })();

    return () => {
      cancelled = true;
      unmountPr?.();
    };
  }, [publishableKey, disabled, amountCents, currency, totalLabel]);

  if (!publishableKey?.trim() || disabled) return null;
  if (status === 'hidden') return null;

  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        Of direct met Apple Pay / Google Pay
      </p>
      {status === 'loading' ? (
        <p className="text-center text-xs text-gray-500">Wallet laden…</p>
      ) : null}
      <div
        ref={mountRef}
        className={`min-h-[48px] w-full ${status === 'ready' ? 'opacity-100' : 'opacity-70'}`}
      />
    </div>
  );
}
