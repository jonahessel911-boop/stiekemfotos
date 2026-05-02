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
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credits-pricing-title"
    >
      <div className="bg-[var(--surface-card)] rounded-3xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-gray-200/80">
        <div className="sticky top-0 flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-[var(--surface-card)] rounded-t-3xl z-10">
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

        <div className="p-5">
          <CreditsPricingOffers showIntro onAfterPurchase={onClose} />
        </div>
      </div>
    </div>
  );
}
