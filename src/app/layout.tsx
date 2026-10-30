import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import { WebAnalytics } from '@/features/product-analytics/web-analytics';
import { themeScript } from '@/features/theme/theme';
import { ThemeController } from '@/features/theme/theme-control';

import './globals.css';

import productStyles from './product.module.css';

// Inter for headings and body text, self-hosted so browsers never request Google Fonts.
const inter = localFont({
  src: [
    {
      path: '../../public/brand/fixxflow/fonts/InterVariable.woff2',
      style: 'normal',
      weight: '100 900',
    },
    {
      path: '../../public/brand/fixxflow/fonts/InterVariable-Italic.woff2',
      style: 'italic',
      weight: '100 900',
    },
  ],
  display: 'swap',
  // Keep text visible and load only the font faces used by the page (no unused italic preload).
  preload: false,
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'FixxFlow',
    template: '%s | FixxFlow',
  },
  description: 'IT Support in Motion',
  manifest: '/brand/fixxflow/site.webmanifest',
  icons: {
    icon: [
      { url: '/brand/fixxflow/favicon/favicon.ico?v=red-navy-clear-20261030' },
      {
        url: '/brand/fixxflow/favicon/favicon-32x32.png?v=red-navy-clear-20261030',
        sizes: '32x32',
        type: 'image/png',
      },
    ],
    apple: '/brand/fixxflow/favicon/apple-touch-icon.png?v=red-navy-clear-20261030',
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={productStyles.scope}>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
        <ThemeController />
        <SpeedInsights />
        <WebAnalytics />
      </body>
    </html>
  );
}
