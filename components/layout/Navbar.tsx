'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/courses', label: 'รายวิชา', icon: '📚' },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-white/10 px-6 py-2">
      <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname === '/dashboard';
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${
                isActive
                  ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-semibold'
                  : 'text-[var(--color-text-muted)] hover:bg-white/5 hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
