import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Debt Copilot — Collections',
  description: 'Who owes us money, how much, and what to do today.',
};

const NAV = [
  { label: 'Dashboard', href: '/', active: true },
  { label: 'Customers', href: '/customers', active: false },
  { label: 'Promises', href: '/promises', active: false },
  { label: 'Import', href: '/import', active: false },
  { label: 'Team', href: '/team', active: false },
  { label: 'Settings', href: '/settings', active: false },
];

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
              {NAV.map((item) =>
                item.active ? (
                  <a
                    key={item.label}
                    href={item.href}
                    aria-current="page"
                    className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                  >
                    {item.label}
                  </a>
                ) : (
                  <span
                    key={item.label}
                    aria-disabled="true"
                    title="Coming in port tasks"
                    className="cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium text-slate-400"
                  >
                    {item.label}
                  </span>
                ),
              )}
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
