import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import { Suspense } from "react";
import { headers } from "next/headers";
import { CreditsPricingProvider } from "@/components/CreditsPricingProvider";
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
    default: "Stiekemefotos.nl",
    template: "%s · Stiekemefotos.nl",
  },
  description: "Dé site waarop vrouwen bijverdienen met stiekeme fotos",
  icons: {
    icon: [{ url: "/logo-stiekemefotos.png", type: "image/png", sizes: "any" }],
    apple: "/logo-stiekemefotos.png",
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
        className={`${poppins.className} font-sans antialiased text-gray-900 bg-[var(--surface)] min-h-screen`}
      >
        <Suspense fallback={null}>
          <TikTokPixel />
        </Suspense>
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
