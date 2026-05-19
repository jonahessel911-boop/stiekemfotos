import Script from 'next/script';
import type { Metadata } from 'next';
import { CLICKFLARE_LANDER_SCRIPT } from '@/components/ClickFlareLanderScript';

export const metadata: Metadata = {
  title: 'Vrouwen in jouw buurt — ontgrendel profielen',
  description: 'Bekijk wie online is en start een chat in jouw regio.',
};

export default function Lander11Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script id="clickflare-lander-11" strategy="beforeInteractive">
        {CLICKFLARE_LANDER_SCRIPT}
      </Script>
      {children}
    </>
  );
}
