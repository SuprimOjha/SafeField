import type { Metadata } from "next";
import { Noto_Sans, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";

const notoSans = Noto_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-noto-sans",
});

const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["400", "600", "700"],
  variable: "--font-noto-devanagari",
});

export const metadata: Metadata = {
  title: "Safe Field Nepal - NASA Space Apps 2026",
  description: "Decision support for fertilizer timing using NASA Earth observations and climate evidence.",
  icons: {
    icon: "/partner-logo.png",
    shortcut: "/partner-logo.png",
    apple: "/partner-logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${notoSans.variable} ${notoDevanagari.variable}`}>
      <body className="bg-[#f4f7f2] text-[#1c2821] antialiased selection:bg-emerald-200">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:p-3 focus:bg-emerald-700 focus:text-white">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}