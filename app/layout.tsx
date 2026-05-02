import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { CreditsPricingProvider } from "@/components/CreditsPricingProvider";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl" className={poppins.variable}>
      <body
        className={`${poppins.className} font-sans antialiased text-gray-900 bg-[var(--surface)] min-h-screen`}
      >
        <CreditsPricingProvider>{children}</CreditsPricingProvider>
      </body>
    </html>
  );
}
