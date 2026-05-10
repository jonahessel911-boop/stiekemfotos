"use client";

import React, { createContext, useContext, useMemo, useState } from "react";

type Ctx = {
  platformOnboardingActive: boolean;
  setPlatformOnboardingActive: (active: boolean) => void;
};

const PlatformOnboardingContext = createContext<Ctx | null>(null);

export function PlatformOnboardingProvider({ children }: { children: React.ReactNode }) {
  const [platformOnboardingActive, setPlatformOnboardingActive] = useState(false);

  const value = useMemo(
    () => ({ platformOnboardingActive, setPlatformOnboardingActive }),
    [platformOnboardingActive]
  );

  return (
    <PlatformOnboardingContext.Provider value={value}>{children}</PlatformOnboardingContext.Provider>
  );
}

/** True zolang het fullscreen onboarding‑scherm open is → Navbar verborgen houden. */
export function usePlatformOnboardingBlocking(): boolean {
  const ctx = useContext(PlatformOnboardingContext);
  return ctx?.platformOnboardingActive ?? false;
}

export function usePlatformOnboardingControls(): Ctx {
  const ctx = useContext(PlatformOnboardingContext);
  if (!ctx) {
    throw new Error("PlatformOnboardingProvider ontbreekt");
  }
  return ctx;
}
