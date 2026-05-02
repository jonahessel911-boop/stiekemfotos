'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Logo from './Logo';
import { Home, MessageCircle, Users, CreditCard, Bell } from 'lucide-react';
import { clearStoredUser, getStoredUser } from '@/lib/onboarding-client';

const navItems = [
  { icon: Home, label: 'Nieuwsfeed', href: '/nieuwsfeed' },
  { icon: MessageCircle, label: 'Berichten', href: '/berichten' },
  { icon: Users, label: 'Profielen', href: '/profielen' },
  { icon: CreditCard, label: 'Credits', href: '/credits' },
];

function labelForPathname(pathname: string): string | null {
  if (pathname === '/' || pathname.startsWith('/nieuwsfeed')) return 'Nieuwsfeed';
  if (pathname.startsWith('/berichten')) return 'Berichten';
  if (pathname.startsWith('/profielen')) return 'Profielen';
  if (pathname.startsWith('/credits')) return 'Credits';
  return null;
}

const MOBILE_TAB_SHORT: Record<string, string> = {
  Nieuwsfeed: 'Feed',
  Berichten: 'Chat',
  Profielen: 'Profielen',
  Credits: 'Credits',
};

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [activeItem, setActiveItem] = useState(() => labelForPathname(pathname) ?? 'Nieuwsfeed');
  const [naamKort, setNaamKort] = useState('Gast');
  const [initial, setInitial] = useState('G');

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        const d = (await r.json()) as { user?: { naam: string } };
        if (!cancel && d.user?.naam) {
          setNaamKort(d.user.naam.split(/\s+/)[0] ?? d.user.naam);
          setInitial(d.user.naam.charAt(0).toUpperCase());
          return;
        }
      } catch {
        /* fallback local */
      }
      if (cancel) return;
      const u = getStoredUser();
      if (u?.naam) {
        setNaamKort(u.naam.split(/\s+/)[0] ?? u.naam);
        setInitial(u.naam.charAt(0).toUpperCase());
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const label = labelForPathname(pathname);
    if (label) setActiveItem(label);
  }, [pathname]);

  const mobileBar = (
    <div
      className="md:hidden fixed bottom-0 left-0 right-0 z-[100] border-t border-gray-200/90 bg-[var(--surface-card)]/95 backdrop-blur-md pb-[env(safe-area-inset-bottom,0px)]"
      role="navigation"
      aria-label="Hoofdmenu mobiel"
    >
      <div className="flex max-w-7xl mx-auto items-stretch justify-between gap-0.5 px-1 pt-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeItem === item.label;
          const short = MOBILE_TAB_SHORT[item.label] ?? item.label;
          return (
            <a
              key={item.label}
              href={item.href}
              onClick={() => setActiveItem(item.label)}
              className={`flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-center transition-colors active:scale-[0.98] ${
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-gray-600 active:bg-gray-100'
              }`}
            >
              <Icon
                className={`h-7 w-7 shrink-0 ${isActive ? 'text-primary' : 'text-gray-500'}`}
                strokeWidth={isActive ? 2.25 : 2}
              />
              <span className="max-w-full truncate text-[10px] font-semibold leading-tight">
                {short}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 bg-[var(--surface-card)] border-b border-gray-200/80 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 h-12 sm:h-14 md:h-16 flex items-center justify-between gap-2">
          <div className="flex items-center min-w-0 flex-1 md:flex-initial">
            <Logo className="max-md:max-w-[min(100%,calc(100vw-8.5rem))]" />
          </div>

          <div className="hidden md:flex items-center gap-6 lg:gap-8 text-sm font-medium">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeItem === item.label;
              return (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={() => setActiveItem(item.label)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all hover:bg-gray-100 group ${
                    isActive
                      ? 'text-primary border-b-2 border-primary -mb-px'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${isActive ? 'text-primary' : 'group-hover:text-primary'}`} />
                  <span className="hidden lg:inline">{item.label}</span>
                </a>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2 md:gap-6">
            <button
              type="button"
              className="text-gray-500 hover:text-gray-700 transition-colors rounded-xl p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center md:p-2 md:min-h-0 md:min-w-0"
              aria-label="Meldingen"
            >
              <Bell className="w-5 h-5 md:w-5 md:h-5" />
            </button>

            <div className="flex items-center gap-1 sm:gap-2">
              <div className="flex items-center gap-2 cursor-default group">
                <div className="w-9 h-9 sm:w-8 sm:h-8 bg-primary text-white text-xs font-bold rounded-2xl flex items-center justify-center ring-2 ring-white shadow shrink-0">
                  {initial}
                </div>
                <div className="hidden md:block">
                  <div className="text-sm font-semibold text-gray-900">{naamKort}</div>
                  <div className="text-[10px] text-emerald-500 -mt-0.5">Online</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  void fetch('/api/auth/logout', {
                    method: 'POST',
                    credentials: 'include',
                  }).finally(() => {
                    clearStoredUser();
                    router.push('/start');
                    router.refresh();
                  });
                }}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm min-h-[40px] sm:min-h-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:shadow-none sm:underline sm:font-normal"
              >
                Uitloggen
              </button>
            </div>
          </div>
        </div>
      </nav>
      {mobileBar}
    </>
  );
}
