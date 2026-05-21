import './admin.css';
import AdminProvider from '@/components/admin/AdminProvider';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-layout-shell">
      <AdminProvider>{children}</AdminProvider>
    </div>
  );
}
