import { Suspense } from 'react';

export default function KortingLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="min-h-screen bg-[#fff0f0]" />}>{children}</Suspense>;
}
