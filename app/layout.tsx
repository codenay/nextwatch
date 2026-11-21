import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import "./cinema-theme.css";

// The wordmark typeface. Self-hosted at build time, so visitors never fetch from Google.
const wordmarkFont = Plus_Jakarta_Sans({ subsets: ["latin"], weight: "800", variable: "--font-wordmark", display: "swap" });

export const metadata: Metadata = {
  title: "NextWatch — Movies and series for right now",
  description: "Explore movie and TV-series recommendations shaped by your taste and mood on an infinite cinematic canvas.",
  openGraph: {
    type: "website",
    siteName: "NextWatch",
    title: "NextWatch — Movies and series for right now",
    description: "Start from today’s most-watched title and drift to the ones most like it.",
  },
  twitter: { card: "summary", title: "NextWatch — Movies and series for right now", description: "Start from today’s most-watched title and drift to the ones most like it." },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#101010",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={wordmarkFont.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
