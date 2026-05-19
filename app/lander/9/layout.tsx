import Script from 'next/script';
import { CLICKFLARE_LANDER_SCRIPT } from '@/components/ClickFlareLanderScript';

export default function Lander9Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script id="clickflare-lander-9" strategy="beforeInteractive">
        {CLICKFLARE_LANDER_SCRIPT}
      </Script>
      {children}
    </>
  );
}
