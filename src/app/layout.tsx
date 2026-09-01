import type { Metadata } from 'next';
import './globals.css';
import { ThemeScript } from '@/components/ThemeScript';
import { ToastProvider } from '@/components/Toast';

export const metadata: Metadata = {
  title: 'Nexora — One dashboard. Every store.',
  description: 'Manage every connected store, order, product, and customer from a single control center.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
