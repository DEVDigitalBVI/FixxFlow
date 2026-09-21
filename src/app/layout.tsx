import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

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
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        {children}
      </body>
    </html>
  );
}
