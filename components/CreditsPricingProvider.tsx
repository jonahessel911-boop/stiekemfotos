'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CreditsPricingModal } from '@/components/CreditsPricingModal';

type Ctx = { openPricing: () => void };

const CreditsPricingContext = createContext<Ctx>({ openPricing: () => {} });

export function useCreditsPricing() {
  return useContext(CreditsPricingContext);
}

export function CreditsPricingProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openPricing = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ openPricing }), [openPricing]);

  return (
    <CreditsPricingContext.Provider value={value}>
      {children}
      <CreditsPricingModal open={open} onClose={() => setOpen(false)} />
    </CreditsPricingContext.Provider>
  );
}
