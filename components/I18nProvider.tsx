"use client";

import React, { createContext, useContext, useMemo } from "react";
import type { Locale } from "@/lib/i18n";
import type { Messages } from "@/lib/messages/types";

type I18nContextValue = {
  locale: Locale;
  messages: Messages;
  t: (path: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function getByPath(obj: any, path: string): unknown {
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: React.ReactNode;
}) {
  const value = useMemo<I18nContextValue>(() => {
    return {
      locale,
      messages,
      t: (path: string) => {
        const v = getByPath(messages, path);
        return typeof v === "string" ? v : path;
      },
    };
  }, [locale, messages]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback: avoid crashing if used outside provider
    return {
      locale: "nl",
      messages: {} as Messages,
      t: (path: string) => path,
    };
  }
  return ctx;
}

