import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { CreditsPricingProvider } from "@/components/CreditsPricingProvider";
import TikTokPixel from "@/components/TikTokPixel";
import { I18nProvider } from "@/components/I18nProvider";
import ZoomLock from "@/components/ZoomLock";
import { detectLocaleFromAcceptLanguage } from "@/lib/i18n";
import { nl } from "@/lib/messages/nl";
import { en } from "@/lib/messages/en";
import "./globals.css";
import "./platform-theme.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#dc2626",
};

export const metadata: Metadata = {
  title: {
    default: "Ontmoetjongens",
    template: "%s · Ontmoetjongens",
  },
  description: "Ontmoet jongere mannen — discreet en persoonlijk",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const acceptLanguage = (await headers()).get("accept-language");
  const locale = detectLocaleFromAcceptLanguage(acceptLanguage);
  const messages = locale === "en" ? en : nl;

  return (
    <html lang={locale}>
      <head>
        {/* Preconnect naar Supabase Storage zodat de eerste image-request geen DNS+TLS hick-up heeft. */}
        <link
          rel="preconnect"
          href="https://vdytntxetjpokjwafrfd.supabase.co"
          crossOrigin=""
        />
        <link rel="dns-prefetch" href="https://vdytntxetjpokjwafrfd.supabase.co" />
        {/* Voorkomt zoomen op iOS bij inputs (font-size>=16 helpt extra; viewport meta dekt de rest). */}
      </head>
      <body className="platform-app min-h-screen bg-[var(--surface)] text-[#262626] antialiased">
        <Suspense fallback={null}>
          <TikTokPixel />
        </Suspense>
        <ZoomLock />
        <I18nProvider locale={locale} messages={messages}>
          {/* Desktop left sidebar lives in Navbar; offset content accordingly */}
          <div className="md:pl-56">
            <CreditsPricingProvider>{children}</CreditsPricingProvider>
          </div>
        </I18nProvider>
      </body>
    </html>
  );
}
