import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";

// Inter is the primary interface typeface of the design system. Devanagari
// glyphs (Nepali) fall through to Noto Sans Devanagari per glyph.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto-devanagari",
});

export const metadata: Metadata = {
  title: "Safe Field Nepal - NASA Space Apps 2026",
  description: "Field-level screening and climate context for farmers in Nepal, with clear data sources, uncertainty and local-review guidance.",
  applicationName: "Safe Field Nepal",
  openGraph: {
    title: "Safe Field Nepal",
    description: "Understand field conditions with transparent Earth-observation and climate evidence.",
    type: "website",
    locale: "ne_NP",
  },
  icons: {
    icon: [
      { url: "/satellite-icon.png", sizes: "128x128", type: "image/png" },
      { url: "/satellite-icon-64.png", sizes: "64x64", type: "image/png" },
    ],
    shortcut: "/satellite-icon.png",
    apple: "/satellite-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1f5a3a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ne" className={`${inter.variable} ${notoDevanagari.variable}`}>
      <body className="bg-warm text-ink antialiased selection:bg-mint selection:text-forest">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:p-3 focus:bg-forest focus:text-white">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
