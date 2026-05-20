'use client';

import React, { useCallback, useEffect, useState } from 'react';
import OntmoetjongensBrand from '@/components/OntmoetjongensBrand';
import { CircularLoader } from '@/components/CircularLoader';
import { Clock } from 'lucide-react';
import ClickFlareCapture from '@/components/ClickFlareCapture';
import OntmoetjongensPaidReturn from '@/components/OntmoetjongensPaidReturn';
import StartProfileSlideshow from '@/components/StartProfileSlideshow';
import StartProvinceMeetingMap from '@/components/StartProvinceMeetingMap';
import { Start5RollingSpots, Start5SignupPopup } from '@/components/Start5PaymentSpots';
import { startProfileSlides } from '@/lib/start-profile-slides';
import { startOntmoetjongensCheckout } from '@/lib/start-ontmoetjongens-checkout';

const PROFILE_SLIDES = startProfileSlides('/start/5');

type Step = 'q1' | 'q2' | 'province' | 'loading' | 'spots' | 'discretion' | 'payment' | 'paid';

const PAYMENT_TIMER_SECONDS = 60;
const LOADING_MS = 4000;
const SIGNUP_POPUP_DELAY_MS = 3000;
const SIGNUP_POPUP_VISIBLE_MS = 3000;

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function JaNeeButtons({ onAnswer }: { onAnswer: (ja: boolean) => void }) {
  return (
    <div className="flex flex-col gap-3 pt-2 max-w-md mx-auto w-full">
      <button
        type="button"
        onClick={() => onAnswer(true)}
        className="start-btn start-btn-primary w-full py-4 px-6 text-left"
      >
        Ja
      </button>
      <button
        type="button"
        onClick={() => onAnswer(false)}
        className="start-btn start-btn-secondary w-full py-4 px-6 text-left"
      >
        Nee
      </button>
    </div>
  );
}

export default function Start5Page() {
  const [step, setStep] = useState<Step>('q1');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(PAYMENT_TIMER_SECONDS);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupPopupVisible, setSignupPopupVisible] = useState(false);
  const [spotsLeft, setSpotsLeft] = useState(7);

  useEffect(() => {
    if (step !== 'loading') return;
    setLoadingProgress(0);
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const p = Math.min(100, Math.round((elapsed / LOADING_MS) * 100));
      setLoadingProgress(p);
      if (elapsed < LOADING_MS) requestAnimationFrame(tick);
      else setStep('spots');
    };
    requestAnimationFrame(tick);
  }, [step]);

  useEffect(() => {
    if (step !== 'payment') return;
    setSecondsLeft(PAYMENT_TIMER_SECONDS);
    setSignupPopupVisible(false);
    setSpotsLeft(7);
    const deadline = Date.now() + PAYMENT_TIMER_SECONDS * 1000;
    const id = window.setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      setSecondsLeft(Math.max(0, left));
    }, 250);
    const popupTimer = window.setTimeout(() => {
      setSignupPopupVisible(true);
      setSpotsLeft(6);
    }, SIGNUP_POPUP_DELAY_MS);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(popupTimer);
    };
  }, [step]);

  useEffect(() => {
    if (!signupPopupVisible) return;
    const hideTimer = window.setTimeout(() => {
      setSignupPopupVisible(false);
    }, SIGNUP_POPUP_VISIBLE_MS);
    return () => window.clearTimeout(hideTimer);
  }, [signupPopupVisible]);

  const startCheckout = useCallback(async () => {
    setError(null);
    setCheckoutBusy(true);
    try {
      await startOntmoetjongensCheckout('/start/5');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Account voltooien mislukt');
      setCheckoutBusy(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-[var(--onboarding-bg)] flex flex-col">
      <ClickFlareCapture />
      <OntmoetjongensPaidReturn onPaid={() => setStep('paid')} />
      <div
        className={`flex-1 flex flex-col items-center px-4 max-w-lg mx-auto w-full ${
          step === 'payment' ? 'justify-start py-4' : 'justify-center py-8'
        }`}
      >
        <div className={`w-full max-w-md mx-auto ${step === 'payment' ? 'space-y-3' : 'space-y-6'}`}>
          {step !== 'payment' && step !== 'paid' && (
            <div className="flex justify-center border-b-2 border-[#dc2626] pb-4">
              <OntmoetjongensBrand variant="hero" />
            </div>
          )}

          {step === 'q1' && (
            <div className="space-y-5">
              <h2 className="text-center text-xl md:text-2xl text-gray-900 px-1">
                Dit is een platform waarop vooral oudere mannen jongere mannen willen ontmoeten, ben je
                daar op de hoogte van?
              </h2>
              <JaNeeButtons onAnswer={() => setStep('q2')} />
            </div>
          )}

          {step === 'q2' && (
            <div className="space-y-5">
              <h2 className="text-center text-xl md:text-2xl text-gray-900 px-1">
                Deze jonge mannen willen vaak snel afspreken op een discrete plek. Ben je daar oke mee?
              </h2>
              <JaNeeButtons onAnswer={() => setStep('province')} />
            </div>
          )}

          {step === 'province' && (
            <StartProvinceMeetingMap
              profileSlides={PROFILE_SLIDES}
              onContinue={() => setStep('loading')}
            />
          )}

          {step === 'loading' && (
            <div className="text-center space-y-6">
              <CircularLoader progress={loadingProgress} variant="start" />
              <p className="text-lg font-bold text-gray-900 px-2">
                Bekijken of er nog plek is….
              </p>
            </div>
          )}

          {step === 'spots' && (
            <div className="space-y-5 text-center">
              <p className="text-xl md:text-2xl font-bold text-gray-900 leading-snug">
                Gefeliciteerd! Er zijn nog 7 plekken beschikbaar voor u om zich aan te melden en direct
                contact te hebben met jonge mannen.
              </p>
              <button
                type="button"
                onClick={() => setStep('discretion')}
                className="start-btn start-btn-primary w-full py-4 px-6"
              >
                Verder
              </button>
            </div>
          )}

          {step === 'discretion' && (
            <div className="space-y-5 text-center">
              <p className="text-lg md:text-xl text-gray-900 leading-relaxed">
                Op deze site waarderen deze mannen hun discretie. Ben je er oke mee geen foto&apos;s te
                maken van de mannen?
              </p>
              <button
                type="button"
                onClick={() => setStep('payment')}
                className="start-btn start-btn-primary w-full py-4 px-6"
              >
                Ja, dat is oke.
              </button>
            </div>
          )}

          {step === 'payment' && (
            <div className="start-payment flex flex-col text-left">
              <section className="start-payment-block">
                <div className="start-payment-brand flex justify-center">
                  <OntmoetjongensBrand variant="compact" />
                </div>
                <p className="start-online-badge mb-2 mt-2 flex items-center gap-1.5">
                  <span className="start-online-dot" aria-hidden />
                  Nu online
                </p>
                <StartProfileSlideshow slides={PROFILE_SLIDES} />
              </section>

              <section className="start-payment-block start-payment-value">
                <p className="start-payment-label">Uw toegang</p>
                <h2 className="text-xl text-gray-900 leading-snug">
                  Direct privé chatten en afspreken met jonge mannen
                </h2>
                <p className="mt-2 text-sm text-gray-800 leading-relaxed">
                  Na het voltooien van uw account krijgt u meteen toegang tot het platform.
                </p>
              </section>

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
                {error && <p className="start-error mb-3 text-sm px-4 py-2">{error}</p>}
                <button
                  type="button"
                  disabled={checkoutBusy}
                  onClick={startCheckout}
                  className="start-btn start-btn-primary w-full py-4 px-6 text-lg text-center"
                >
                  {checkoutBusy ? 'Even geduld…' : 'Voltooi account'}
                </button>
                <Start5RollingSpots spotsLeft={spotsLeft} />
                <Start5SignupPopup visible={signupPopupVisible} />
              </section>
            </div>
          )}

          {step === 'paid' && (
            <div className="space-y-5 text-center">
              <p className="text-xl font-bold text-gray-900">Betaling ontvangen</p>
              <p className="text-gray-800">
                Bedankt! Je ontvangt binnen 1 week een e-mail met de toegang.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
