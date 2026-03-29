import type { Metadata } from "next";
import { Fraunces, Outfit, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { JsonLd } from "@/components/seo/JsonLd";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://tabulate-ai.com"),
  title: {
    template: "%s | TabulateAI",
    default: "TabulateAI — Crosstab Automation for Market Research",
  },
  description:
    "Automated crosstab software for market research teams. Upload SPSS survey data, get publication-ready cross tabulation tables with statistical testing. Excel, Q, and WinCross export.",
  keywords: [
    "crosstab automation",
    "market research software",
    "cross tabulation software",
    "SPSS data processing",
    "survey tabulation",
    "automated crosstabs",
    "market research data processing",
    "survey data automation",
    "data tabulation software",
    "banner tables",
    "AI crosstab generator",
  ],
  openGraph: {
    type: "website",
    siteName: "TabulateAI",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${outfit.variable} ${fraunces.variable} ${jetbrainsMono.variable} antialiased`}>
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "TabulateAI",
            url: "https://tabulate-ai.com",
            description:
              "Automated crosstab software for market research firms. Upload survey data, download publication-ready tables.",
            contactPoint: {
              "@type": "ContactPoint",
              contactType: "sales",
              url: "https://tabulate-ai.com/contact",
            },
          }}
        />
        <ConvexClientProvider>
          <ThemeProvider>
            <TooltipProvider>
              {children}
            </TooltipProvider>
            <Toaster />
          </ThemeProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
