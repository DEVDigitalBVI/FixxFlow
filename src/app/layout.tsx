import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { themeScript } from "@/features/theme/theme";
import { ThemeController } from "@/features/theme/theme-control";
import "./globals.css";

const inter = localFont({
  src: [
    {
      path: "../../public/brand/fixxflow/fonts/InterVariable.woff2",
      style: "normal",
      weight: "100 900",
    },
    {
      path: "../../public/brand/fixxflow/fonts/InterVariable-Italic.woff2",
      style: "italic",
      weight: "100 900",
    },
  ],
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "FixxFlow",
    template: "%s | FixxFlow",
  },
  description: "IT Support in Motion",
  manifest: "/brand/fixxflow/site.webmanifest",
  icons: {
    icon: [
      { url: "/brand/fixxflow/favicon/favicon.ico" },
      { url: "/brand/fixxflow/favicon/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/brand/fixxflow/favicon/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        {children}
        <ThemeController />
        <SpeedInsights />
      </body>
    </html>
  );
}
