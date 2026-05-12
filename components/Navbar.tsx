'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Logo from './Logo';
import { Home, MessageCircle, Users, CreditCard, LogOut, Images } from 'lucide-react';
import { clearStoredUser, getStoredUser } from '@/lib/onboarding-client';
import { useI18n } from '@/components/I18nProvider';
import { usePlatformOnboardingBlocking } from '@/components/PlatformOnboardingContext';

const navItems = [
  { icon: Users, key: 'profiles', href: '/profielen' },
  { icon: MessageCircle, key: 'messages', href: '/berichten' },
  { icon: Images, key: 'gallery', href: '/gallerij' },
  { icon: Home, key: 'feed', href: '/nieuwsfeed' },
  { icon: CreditCard, key: 'credits', href: '/credits' },
] as const;

type NavKey = (typeof navItems)[number]['key'];

function keyForPathname(pathname: string): NavKey | null {
  if (pathname === '/' || pathname.startsWith('/profielen')) return 'profiles';
  if (pathname.startsWith('/nieuwsfeed')) return 'feed';
  if (pathname.startsWith('/berichten')) return 'messages';
  if (pathname.startsWith('/gallerij') || pathname.startsWith('/mijn-fotos')) return 'gallery';
  if (pathname.startsWith('/credits')) return 'credits';
  return null;
}

const MOBILE_TAB_SHORT: Record<NavKey, string> = {
  profiles: 'Profielen',
  messages: 'Chat',
  gallery: 'Gallerij',
  feed: 'Verzoeken',
  credits: 'Credits',
};

export default function Navbar() {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const platformOnboardingBlocking = usePlatformOnboardingBlocking();
  /** Lege initiële staat: voorkomt hydration mismatch (SSR heeft geen localStorage). */
  const [activeItem, setActiveItem] = useState<NavKey>(() => keyForPathname(pathname) ?? 'profiles');
  const [naamKort, setNaamKort] = useState('');
  const [initial, setInitial] = useState('');

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
      // Geen "Gast"-fallback; toon alleen echte gebruikersnaam als die bekend is.
      const u = getStoredUser();
      if (u?.naam) {
        const short = u.naam.split(/\s+/)[0] ?? u.naam;
        setNaamKort(short);
        setInitial(short.charAt(0).toUpperCase());
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const key = keyForPathname(pathname);
    if (key) setActiveItem(key);
  }, [pathname]);

  const mobileBar = (
    <div
      className="md:hidden fixed bottom-0 left-0 right-0 z-[90] border-t border-white/20 bg-primary pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-8px_28px_rgba(198,0,63,0.35)]"
      role="navigation"
      aria-label="Hoofdmenu mobiel"
    >
      <div className="mx-auto flex max-w-7xl items-stretch justify-between gap-0.5 px-1 pt-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeItem === item.key;
          const short =
            locale === 'nl'
              ? (MOBILE_TAB_SHORT[item.key] ?? t(`nav.${item.key}`))
              : t(`nav.${item.key}`);
          return (
            <a
              key={item.key}
              href={item.href}
              onClick={() => setActiveItem(item.key)}
              className={`flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-center text-white transition-colors active:scale-[0.98] ${
                isActive ? 'bg-white/20 text-white' : 'text-white active:bg-white/10'
              }`}
            >
              <Icon
                className="h-7 w-7 shrink-0 text-white"
                strokeWidth={isActive ? 2.35 : 2}
              />
              <span className="max-w-full truncate text-[10px] font-semibold leading-tight text-white">
                {short}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );

  if (platformOnboardingBlocking) {
    return null;
  }

  return (
    <>
      {/* Desktop left navigation */}
      <aside className="hidden md:flex fixed left-0 top-12 sm:top-14 md:top-16 bottom-0 w-56 border-r border-gray-200/80 bg-[var(--surface-card)] z-40">
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 px-2 py-2">
            menu
          </div>
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeItem === item.key;
              return (
                <a
                  key={item.key}
                  href={item.href}
                  onClick={() => setActiveItem(item.key)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Icon className={`h-5 w-5 ${isActive ? 'text-primary' : 'text-gray-500'}`} />
                  <span className="truncate">{t(`nav.${item.key}`)}</span>
                </a>
              );
            })}
          </nav>
          <div className="mt-auto px-2 py-3 text-[11px] text-gray-500">
            {naamKort ? (
              <span className="truncate">ingelogd als {naamKort}</span>
            ) : (
              <span className="truncate">...</span>
            )}
          </div>
        </div>
      </aside>

      <nav className="fixed top-0 left-0 right-0 bg-[var(--surface-card)] border-b border-gray-200/80 z-50 shadow-sm">
        {/*
          Mobiel: max-w-7xl + mx-auto (gecentreerde container).
          Desktop (md+): full-width zodat het logo helemaal links uitlijnt met de
          fixed sidebar (die ook op left-0 zit). Geen mx-auto meer op md+.
        */}
        <div className="max-w-7xl mx-auto md:max-w-none md:mx-0 px-3 sm:px-4 md:px-6 h-12 sm:h-14 md:h-16 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center pr-1 md:flex-initial md:pr-0">
            <Logo />
          </div>

          {/* Desktop menu moved to left sidebar */}
          <div className="hidden md:flex items-center gap-6 lg:gap-8 text-sm font-medium opacity-0 pointer-events-none">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeItem === item.key;
              return (
                <a
                  key={item.key}
                  href={item.href}
                  onClick={() => setActiveItem(item.key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all hover:bg-gray-100 group ${
                    isActive
                      ? 'text-primary border-b-2 border-primary -mb-px'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${isActive ? 'text-primary' : 'group-hover:text-primary'}`} />
                  <span className="hidden lg:inline">{t(`nav.${item.key}`)}</span>
                </a>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center gap-0.5 sm:gap-2 md:gap-6">
            <div className="flex items-center gap-0.5 sm:gap-2">
              <div className="group flex cursor-default items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-primary text-[11px] font-bold text-white shadow ring-2 ring-white sm:h-8 sm:w-8 md:h-9 md:w-9 md:text-xs">
                  {initial || '•'}
                </div>
                <div className="hidden md:block">
                  <div className="text-sm font-semibold text-gray-900">
                    {naamKort || '...'}
                  </div>
                  <div className="-mt-0.5 text-[10px] text-primary">{t('common.online')}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  /**
                   * Hard logout: eerst wachten tot de server het session cookie
                   * heeft gewist (anders herstelt het beschermde server-rendered
                   * route de oude sessie alsnog), dan localStorage opschonen,
                   * dan een echte page-load naar /start zodat ALLE server state
                   * opnieuw zonder auth wordt opgehaald. `router.push` werkt hier
                   * onbetrouwbaar op productie omdat sommige routes server-side
                   * gecached blijven.
                   */
                  try {
                    await fetch('/api/auth/logout', {
                      method: 'POST',
                      credentials: 'include',
                      cache: 'no-store',
                    });
                  } catch {
                    /** Negeer netwerkfout — we forceren alsnog client-side logout. */
                  }
                  try {
                    clearStoredUser();
                  } catch {
                    /* noop */
                  }
                  if (typeof window !== 'undefined') {
                    window.location.href = '/start';
                  }
                }}
                className="inline-flex min-h-[40px] min-w-[40px] cursor-pointer items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 shadow-sm transition-colors hover:bg-gray-50 sm:min-h-0 sm:min-w-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:shadow-none sm:underline md:text-xs md:font-semibold"
                aria-label={t('common.logout')}
              >
                <LogOut className="h-[1.125rem] w-[1.125rem] sm:hidden" />
                <span className="hidden px-3 py-2 text-xs font-semibold sm:inline sm:px-0 sm:py-0 sm:text-sm sm:font-normal">
                  {t('common.logout')}
                </span>
              </button>
            </div>
          </div>
        </div>
      </nav>
      {mobileBar}
    </>
  );
}
