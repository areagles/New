import type { Metadata } from 'next';
import { Cairo } from 'next/font/google';
import { I18nProvider } from '@/lib/i18n';
import { SessionProvider } from '@/lib/session';
import './globals.css';

// The system it replaces set --font-cairo; keeping the same face is most of why a screen
// reads as the same product.
const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  variable: '--font-cairo',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Arab Eagles',
  description: 'إدارة متكاملة لأعمالك',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // lang/dir are set here for the first paint and kept in sync by I18nProvider afterwards;
  // a static export has no request context to read the stored preference from.
  return (
    <html lang="ar" dir="rtl" data-theme="dark" className={cairo.variable}>
      <body style={{ fontFamily: 'var(--font-cairo), system-ui, sans-serif' }}>
        <I18nProvider>
          <SessionProvider>{children}</SessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
