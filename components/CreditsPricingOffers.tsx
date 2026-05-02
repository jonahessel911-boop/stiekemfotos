'use client';

import React from 'react';
import { Sparkles, Zap } from 'lucide-react';
import {
  addCredits,
  CREDITS_PER_MESSAGE,
  INITIAL_FREE_CREDITS,
} from '@/lib/credits-client';
import {
  FEATURED_DEAL_CREDITS,
  FEATURED_DEAL_PRICE_LABEL,
  FEATURED_DEAL_WAS_PRICE_LABEL,
  FEATURED_DEAL_DISCOUNT_PERCENT,
} from '@/lib/credit-packages';

/** „Express”-opties: opzettelijk slechtere prijs per credit (decoy). */
const DECOY_EXPRESS = [
  { label: 'Express', price: '€59,99', credits: 800, tag: 'Veel duurder per bericht' },
  { label: 'Express plus', price: '€44,99', credits: 500, tag: 'Ook veel duurder' },
] as const;

type Props = {
  showIntro?: boolean;
  onAfterPurchase?: () => void;
};

export function CreditsPricingOffers({ showIntro = true, onAfterPurchase }: Props) {
  const handleBuyFeatured = () => {
    addCredits(
      FEATURED_DEAL_CREDITS,
      `${FEATURED_DEAL_PRICE_LABEL} · ${FEATURED_DEAL_CREDITS.toLocaleString('nl-NL')} credits`
    );
    onAfterPurchase?.();
  };

  return (
    <div className="space-y-5">
      {showIntro ? (
        <p className="text-sm text-gray-600 leading-relaxed">
          Je eerste <strong>{INITIAL_FREE_CREDITS} credits</strong> waren gratis. Elk bericht dat je
          stuurt kost <strong>{CREDITS_PER_MESSAGE} credits</strong>. Kies hieronder een pakket om
          verder te gaan.
        </p>
      ) : null}

      <div className="relative rounded-2xl border-2 border-primary bg-primary/[0.06] p-5 shadow-md ring-2 ring-primary/20">
        <div className="absolute -top-2.5 left-4 flex flex-wrap gap-1.5">
          <span className="bg-primary text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Beste deal
          </span>
          <span className="bg-amber-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full">
            Tijdelijk {FEATURED_DEAL_DISCOUNT_PERCENT}% korting
          </span>
        </div>
        <div className="flex justify-between items-start gap-3 mt-8">
          <div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-lg text-gray-400 line-through decoration-gray-400">
                {FEATURED_DEAL_WAS_PRICE_LABEL}
              </span>
              <span className="text-2xl font-bold text-gray-900">{FEATURED_DEAL_PRICE_LABEL}</span>
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Je betaalt nu {100 - FEATURED_DEAL_DISCOUNT_PERCENT}% — actieprijs i.p.v. adviesprijs.
            </p>
            <div className="text-primary font-semibold text-sm mt-2">
              {FEATURED_DEAL_CREDITS.toLocaleString('nl-NL')} credits
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-600 mt-4 leading-relaxed border-t border-primary/15 pt-3">
          Op je bankafschrift komt wat een andere naam te staan om ook jouw privacy te beschermen.
        </p>
        <button
          type="button"
          onClick={handleBuyFeatured}
          className="w-full mt-4 py-3.5 rounded-2xl bg-primary text-white font-bold text-base hover:bg-primary-hover shadow-lg shadow-primary/25 transition-colors"
        >
          Koop {FEATURED_DEAL_CREDITS.toLocaleString('nl-NL')} credits — {FEATURED_DEAL_PRICE_LABEL}
        </button>
        <p className="text-[11px] text-gray-500 text-center mt-2">Demo: geen echte betaling</p>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Sneller / express — veel duurder
        </p>
        <div className="space-y-2">
          {DECOY_EXPRESS.map((d) => (
            <div
              key={d.label}
              className="rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3 flex items-center justify-between gap-3 opacity-80"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Zap className="w-4 h-4 text-amber-600 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold text-gray-800 text-sm">{d.label}</div>
                  <div className="text-[11px] text-amber-800/90">{d.tag}</div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-bold text-gray-900">{d.price}</div>
                <div className="text-xs text-gray-500">{d.credits} credits</div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          Deze express-opties zijn bewust minder voordelig — het standaardpakket hierboven is het
          scherpst geprijsd.
        </p>
      </div>
    </div>
  );
}
