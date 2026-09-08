'use client';

import { usePathname } from 'next/navigation';

const ROUTES = [
  { label: 'Dashboard', href: '/' },
  { label: 'Customers', href: '/customers' },
  { label: 'Promises', href: '/promises' },
  { label: 'Import', href: '/import' },
];

const SOON = ['Team', 'Settings'];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav className="mt-2 flex flex-col gap-1">
      {ROUTES.map((item) => (
        <a
          key={item.label}
          href={item.href}
          aria-current={isActive(pathname, item.href) ? 'page' : undefined}
          className={`rounded-lg px-3 py-2 text-sm font-medium ${
            isActive(pathname, item.href)
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {item.label}
        </a>
      ))}
      {SOON.map((label) => (
        <span
          key={label}
          aria-disabled="true"
          title="Coming in port tasks"
          className="cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium text-slate-400"
        >
          {label}
        </span>
      ))}
    </nav>
  );
}
