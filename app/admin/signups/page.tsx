'use client';

import AdminTable from '@/components/admin/AdminTable';
import { useAdmin } from '@/components/admin/AdminProvider';
import { fmt } from '@/components/admin/admin-utils';

export default function AdminSignupsPage() {
  const { data } = useAdmin();
  const signups = data?.signups ?? [];

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        Signups <small>{signups.length} registraties</small>
      </div>
      <AdminTable
        headers={['Naam', 'E-mail', 'Leeftijd', 'Credits gebruikt', 'Aangemaakt']}
        rows={signups.map((s) => [
          s.naam,
          s.email,
          String(s.leeftijd),
          String(s.creditsSpent ?? 0),
          fmt(s.createdAt),
        ])}
        numericCols={[2, 3]}
      />
    </div>
  );
}
