import Script from 'next/script';
import { CLICKFLARE_LANDER_SCRIPT } from '@/components/ClickFlareLanderScript';

/** ClickFlare lander tag — vroeg laden zodat CTA-links direct herschreven worden. */
export default function Lander6Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script id="clickflare-lander-6" strategy="beforeInteractive">
        {CLICKFLARE_LANDER_SCRIPT}
      </Script>
      {children}
    </>
  );
}
