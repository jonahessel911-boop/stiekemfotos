import './platform-2.css';
import ClickFlareCapture from '@/components/ClickFlareCapture';

/** Eigen shell: geen hoofd-app sidebar-offset (md:pl-56). */
export default function Platform2Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="platform2-layout-shell">
      <ClickFlareCapture />
      {children}
    </div>
  );
}
