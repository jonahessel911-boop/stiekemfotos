import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import { Suspense } from "react";
import { headers } from "next/headers";
import { CreditsPricingProvider } from "@/components/CreditsPricingProvider";
import EmailVerificationGate from "@/components/EmailVerificationGate";
import TikTokPixel from "@/components/TikTokPixel";
import { I18nProvider } from "@/components/I18nProvider";
import { detectLocaleFromAcceptLanguage } from "@/lib/i18n";
import { nl } from "@/lib/messages/nl";
import { en } from "@/lib/messages/en";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: "Discreetemeisjes.nl",
    template: "%s · Discreetemeisjes.nl",
  },
  description: "Exclusieve ontmoetingen — discreet & betrouwbaar",
  icons: {
    icon: [{ url: "/logo-mark.png", type: "image/png", sizes: "any" }],
    apple: "/logo-mark.png",
  },
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
    <html lang={locale} className={poppins.variable}>
      <body
        className={`${poppins.className} min-h-screen overflow-x-hidden bg-[var(--surface)] font-sans text-gray-900 antialiased`}
      >
        <Suspense fallback={null}>
          <TikTokPixel />
        </Suspense>
        <Suspense fallback={null}>
          <EmailVerificationGate />
        </Suspense>
        <I18nProvider locale={locale} messages={messages}>
          {/* Desktop left sidebar lives in Navbar; offset content accordingly */}
          <div className="lg:pl-60">
            <CreditsPricingProvider>{children}</CreditsPricingProvider>
          </div>
        </I18nProvider>
      </body>
    </html>
  );
}
