import Script from 'next/script';
import { CLICKFLARE_LANDER_SCRIPT } from '@/components/ClickFlareLanderScript';

export default function Lander7Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script id="clickflare-lander-7" strategy="beforeInteractive">
        {CLICKFLARE_LANDER_SCRIPT}
      </Script>
      {children}
    </>
  );
}
