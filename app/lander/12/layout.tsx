import Script from 'next/script';
import type { Metadata } from 'next';
import { CLICKFLARE_LANDER_SCRIPT } from '@/components/ClickFlareLanderScript';

export const metadata: Metadata = {
  title: 'Wat is jouw type?',
  description: 'Kies je type en start direct een chat.',
};

export default function Lander12Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script id="clickflare-lander-12" strategy="beforeInteractive">
        {CLICKFLARE_LANDER_SCRIPT}
      </Script>
      {children}
    </>
  );
}
