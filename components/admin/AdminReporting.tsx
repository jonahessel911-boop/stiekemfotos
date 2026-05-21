'use client';

import React from 'react';
import { useAdmin } from '@/components/admin/AdminProvider';
import { fmt, formatEur, formatPct } from '@/components/admin/admin-utils';
import type { PeriodOverview } from '@/lib/admin/types';

export default function AdminReporting() {
  const { data, overview, overviewError, loading } = useAdmin();
  const stats = data?.stats;
  const analytics = data?.analytics;

  return (
    <>
      <div className="admin-kpi-row">
        <div className="admin-kpi">
          <div className="admin-kpi-label">Users</div>
          <div className="admin-kpi-value">{stats?.users ?? '—'}</div>
        </div>
        <div className="admin-kpi">
          <div className="admin-kpi-label">Signups</div>
          <div className="admin-kpi-value">{stats?.signups ?? '—'}</div>
        </div>
        <div className="admin-kpi">
          <div className="admin-kpi-label">Gesprekken</div>
          <div className="admin-kpi-value">{stats?.conversations ?? '—'}</div>
        </div>
        <div className="admin-kpi" style={{ borderColor: '#f5a623' }}>
          <div className="admin-kpi-label">Open chats</div>
          <div className="admin-kpi-value" style={{ color: '#b45309' }}>
            {stats?.openChats ?? '—'}
          </div>
        </div>
        <div className="admin-kpi">
          <div className="admin-kpi-label">Aankopen</div>
          <div className="admin-kpi-value">{stats?.purchases ?? '—'}</div>
        </div>
        <div className="admin-kpi">
          <div className="admin-kpi-label">Omzet totaal</div>
          <div className="admin-kpi-value" style={{ fontSize: 18 }}>
            € {analytics ? formatEur(analytics.revenueEurTotal) : '—'}
          </div>
        </div>
        <div className="admin-kpi">
          <div className="admin-kpi-label">Credits verkocht</div>
          <div className="admin-kpi-value" style={{ fontSize: 18 }}>
            {analytics?.totalCreditsPurchased ?? '—'}
          </div>
        </div>
      </div>

      <PeriodOverviewTable overview={overview} overviewError={overviewError} loading={loading} />
    </>
  );
}

function PeriodOverviewTable({
  overview,
  overviewError,
  loading,
}: {
  overview: PeriodOverview | null;
  overviewError: string | null;
  loading: boolean;
}) {
  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        Periode-overzicht
        {overview ? (
          <small>
            Totaal € {formatEur(overview.totals.revenueEur)} · {overview.totals.signups} signups ·{' '}
            {formatPct(overview.totals.signupToPaidPct)} signup→paid
          </small>
        ) : null}
      </div>
      {overviewError ? (
        <div className="admin-alert admin-alert-error" style={{ margin: 10 }}>
          {overviewError}
        </div>
      ) : null}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Maand</th>
              <th className="num">Omzet</th>
              <th className="num">Signups</th>
              <th className="num">Aankopen</th>
              <th className="num">Signup→Chat</th>
              <th className="num">Chat→Unlock (Free)</th>
              <th className="num">Chat→Unlock (Paid)</th>
              <th className="num">Signup→Paid</th>
              <th className="num">Re-sign</th>
              <th className="num">100 cr. used</th>
              <th className="num">300 cr. used</th>
            </tr>
          </thead>
          <tbody>
            {overview && overview.periods.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: 24, color: '#666' }}>
                  {loading ? 'Laden…' : 'Nog geen data.'}
                </td>
              </tr>
            ) : null}
            {(overview?.periods ?? []).map((row, idx) => (
              <tr key={row.key} style={idx === 0 ? { background: '#fff8e6' } : undefined}>
                <td>
                  <strong>{row.label}</strong>
                  {idx === 0 ? (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 10,
                        background: '#ffe0a0',
                        padding: '1px 5px',
                      }}
                    >
                      HUIDIG
                    </span>
                  ) : null}
                </td>
                <td className="num">€ {formatEur(row.revenueEur)}</td>
                <td className="num">{row.signups}</td>
                <td className="num">{row.conversions}</td>
                <td className="num">{formatPct(row.signupToUserChatPct)}</td>
                <td className="num">{formatPct(row.userChatToUnlockFreePct)}</td>
                <td className="num">{formatPct(row.userChatToUnlockPaidPct)}</td>
                <td className="num">
                  <strong>{formatPct(row.signupToPaidPct)}</strong>
                </td>
                <td className="num">{formatPct(row.reSignPct)}</td>
                <td className="num">{formatPct(row.used100CreditsPct)}</td>
                <td className="num">{formatPct(row.usedFreeCreditsPct)}</td>
              </tr>
            ))}
            {overview ? (
              <tr style={{ background: '#2d3e50', color: '#fff' }}>
                <td>
                  <strong>Totaal</strong>
                </td>
                <td className="num">€ {formatEur(overview.totals.revenueEur)}</td>
                <td className="num">{overview.totals.signups}</td>
                <td className="num">{overview.totals.conversions}</td>
                <td className="num">{formatPct(overview.totals.signupToUserChatPct)}</td>
                <td className="num">{formatPct(overview.totals.userChatToUnlockFreePct)}</td>
                <td className="num">{formatPct(overview.totals.userChatToUnlockPaidPct)}</td>
                <td className="num">{formatPct(overview.totals.signupToPaidPct)}</td>
                <td className="num">{formatPct(overview.totals.reSignPct)}</td>
                <td className="num">{formatPct(overview.totals.used100CreditsPct)}</td>
                <td className="num">{formatPct(overview.totals.usedFreeCreditsPct)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
