'use client';

import { usePathname } from 'next/navigation';

/** Hoofd-app heeft sidebar-offset; /platform/2 gebruikt eigen chrome full-width. */
export default function PlatformLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPlatform2 = pathname?.startsWith('/platform/2') ?? false;

  if (isPlatform2) {
    return <>{children}</>;
  }

  return <div className="md:pl-56">{children}</div>;
}
