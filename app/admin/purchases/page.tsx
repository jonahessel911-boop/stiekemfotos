'use client';

import AdminTable from '@/components/admin/AdminTable';
import { useAdmin } from '@/components/admin/AdminProvider';
import { fmt } from '@/components/admin/admin-utils';

export default function AdminPurchasesPage() {
  const { data } = useAdmin();
  const purchases = data?.purchases ?? [];

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        Aankopen <small>{purchases.length} betaald</small>
      </div>
      <AdminTable
        headers={['User e-mail', 'Credits', 'Prijs', 'Betaald op', 'Fulfilled']}
        rows={purchases.map((p) => [
          p.userEmail,
          String(p.credits),
          p.priceLabel,
          fmt(p.paidAt),
          p.fulfilledAt ? fmt(p.fulfilledAt) : 'nee',
        ])}
        numericCols={[1]}
      />
    </div>
  );
}
