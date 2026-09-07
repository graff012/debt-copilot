import type { Metadata } from 'next';
import { SiteNav } from '@/components/SiteNav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Debt Copilot — Collections',
  description: 'Who owes us money, how much, and what to do today.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-slate-100 font-sans text-slate-900 antialiased">
        <div className="flex min-h-screen">
          <aside className="hidden w-60 shrink-0 flex-col gap-1 bg-white p-4 shadow-sm md:flex">
            <div className="px-2 py-3">
              <p className="text-base font-bold">Debt Copilot</p>
              <p className="text-xs text-slate-500">Wholesale distribution</p>
            </div>
            <nav className="mt-2 flex flex-col gap-1">
              <SiteNav />
            </nav>
            <div className="mt-auto px-2 py-3 text-xs text-slate-500">
              <p>Tashkent HQ · UTC+5</p>
              <p className="mt-1">Demo data — no real debtors</p>
            </div>
          </aside>
          <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
