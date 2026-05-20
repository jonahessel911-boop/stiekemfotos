'use client';

import React, { useEffect, useState } from 'react';
import OntmoetjongensBrand from '@/components/OntmoetjongensBrand';
import { CircularLoader } from '@/components/CircularLoader';
import ClickFlareCapture from '@/components/ClickFlareCapture';
import OntmoetjongensPaidReturn from '@/components/OntmoetjongensPaidReturn';
import StartProfileSlideshow from '@/components/StartProfileSlideshow';
import StartPaymentCheckoutBlock from '@/components/StartPaymentCheckoutBlock';
import { startProfileSlides } from '@/lib/start-profile-slides';

const PROFILE_SLIDES = startProfileSlides('/start/3');

type Step = 'q1' | 'q2' | 'loading' | 'congrats' | 'discretion' | 'payment' | 'paid';

const PAYMENT_TIMER_SECONDS = 60;
const LOADING_MS = 4000;

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

export default function Start3Page() {
  const [step, setStep] = useState<Step>('q1');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(PAYMENT_TIMER_SECONDS);
  useEffect(() => {
    if (step !== 'loading') return;
    setLoadingProgress(0);
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const p = Math.min(100, Math.round((elapsed / LOADING_MS) * 100));
      setLoadingProgress(p);
      if (elapsed < LOADING_MS) requestAnimationFrame(tick);
      else setStep('congrats');
    };
    requestAnimationFrame(tick);
  }, [step]);

  useEffect(() => {
    if (step !== 'payment') return;
    setSecondsLeft(PAYMENT_TIMER_SECONDS);
    const deadline = Date.now() + PAYMENT_TIMER_SECONDS * 1000;
    const id = window.setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      setSecondsLeft(Math.max(0, left));
    }, 250);
    return () => window.clearInterval(id);
  }, [step]);

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
              <JaNeeButtons onAnswer={() => setStep('loading')} />
            </div>
          )}

          {step === 'loading' && (
            <div className="text-center space-y-6">
              <CircularLoader progress={loadingProgress} variant="start" />
              <p className="text-lg font-bold text-gray-900 px-2">
                Bekijken of er nog plek is….
              </p>
            </div>
          )}

          {step === 'congrats' && (
            <div className="space-y-5 text-center">
              <p className="text-xl md:text-2xl font-bold text-gray-900 leading-snug">
                Gefeliciteerd! Er is nog plek voor u om zich aan te melden en direct contact te hebben
                met jonge mannen.
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

              <StartPaymentCheckoutBlock startPath="/start/3" secondsLeft={secondsLeft} />
            </div>
          )}

          {step === 'paid' && (
            <div className="space-y-5 text-center">
              <p className="text-xl font-bold text-gray-900">Betaling ontvangen</p>
              <p className="text-gray-800">
                Bedankt! Je hebt zojuist een e-mail ontvangen met toegang tot het platform.
                Controleer ook je spamfolder als je niets ziet.
              </p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
