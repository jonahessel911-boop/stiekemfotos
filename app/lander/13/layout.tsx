import Script from 'next/script';
import type { Metadata } from 'next';
import { CLICKFLARE_LANDER_SCRIPT } from '@/components/ClickFlareLanderScript';

export const metadata: Metadata = {
  title: 'Selecteer je provincie | NL Dating',
  description: 'Kies waar je vrouwen wilt ontmoeten — bekijk wie er nu online is.',
};

export default function Lander13Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script id="clickflare-lander-13" strategy="beforeInteractive">
        {CLICKFLARE_LANDER_SCRIPT}
      </Script>
      {children}
    </>
  );
}
