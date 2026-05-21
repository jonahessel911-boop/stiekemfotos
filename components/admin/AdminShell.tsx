'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAdmin } from '@/components/admin/AdminProvider';
import { countOpenChats } from '@/lib/admin/chat-open';

const NAV = [
  { href: '/admin', label: 'Reporting', exact: true },
  { href: '/admin/chats', label: 'Chats' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/signups', label: 'Signups' },
  { href: '/admin/purchases', label: 'Aankopen' },
  { href: '/admin/images', label: 'Profielen & AI' },
  { href: '/admin/tools', label: 'Tools' },
] as const;

const TITLES: Record<string, string> = {
  '/admin': 'Reporting',
  '/admin/chats': 'Chats',
  '/admin/users': 'Users',
  '/admin/signups': 'Signups',
  '/admin/purchases': 'Aankopen',
  '/admin/images': 'Profielen & AI',
  '/admin/tools': 'Tools',
};

function navActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { refreshing, error, data, load, logout, resetBusy } = useAdmin();
  const title = TITLES[pathname] ?? 'Admin';
  const openChats = useMemo(
    () => data?.stats.openChats ?? countOpenChats(data?.conversationsByUser ?? []),
    [data]
  );

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          Stiekemfotos
          <small>Admin backoffice</small>
        </div>
        <ul className="admin-nav">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={
                  navActive(pathname, item.href, 'exact' in item && item.exact)
                    ? 'is-active'
                    : undefined
                }
              >
                {item.label}
                {item.href === '/admin/chats' && openChats > 0 ? (
                  <span className="admin-nav-badge">{openChats}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
        <div className="admin-sidebar-foot">v2 · old-school UI</div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <h1>{title}</h1>
          <div className="admin-topbar-actions">
            <button
              type="button"
              className="admin-btn"
              disabled={refreshing || resetBusy}
              onClick={() => void load()}
            >
              Vernieuwen
            </button>
            <button type="button" className="admin-btn" onClick={() => void logout()}>
              Uitloggen
            </button>
          </div>
        </header>

        <div className="admin-content">
          {error ? <div className="admin-alert admin-alert-error">{error}</div> : null}
          {children}
        </div>
      </div>
    </div>
  );
}
