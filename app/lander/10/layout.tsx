import Script from 'next/script';
import type { Metadata } from 'next';
import { CLICKFLARE_LANDER_SCRIPT } from '@/components/ClickFlareLanderScript';

export const metadata: Metadata = {
  title: 'Steeds meer Nederlandse vrouwen gebruiken deze chat-app | NL Relatie Nieuws',
  description:
    'Vooral vrouwen tussen de 24 en 42 jaar kiezen steeds vaker voor online contact via nieuwe chatplatforms.',
};

export default function Lander10Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script id="clickflare-lander-10" strategy="beforeInteractive">
        {CLICKFLARE_LANDER_SCRIPT}
      </Script>
      {children}
    </>
  );
}
