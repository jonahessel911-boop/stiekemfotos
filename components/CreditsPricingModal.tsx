'use client';

import React from 'react';
import { X } from 'lucide-react';
import { CreditsPricingOffers } from '@/components/CreditsPricingOffers';

type Props = {
  open: boolean;
  onClose: () => void;
};

export function CreditsPricingModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-stretch justify-center bg-black/60 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credits-pricing-title"
    >
      <div className="flex h-full w-full flex-col overflow-y-auto bg-[var(--surface-card)]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-[var(--surface-card)] px-5 py-4">
          <h2 id="credits-pricing-title" className="text-lg font-bold text-gray-900">
            Prijzen
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-gray-100 text-gray-600"
            aria-label="Sluiten"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mx-auto w-full max-w-6xl p-5 md:p-8">
          <CreditsPricingOffers showIntro onAfterPurchase={onClose} />
        </div>
      </div>
    </div>
  );
}
