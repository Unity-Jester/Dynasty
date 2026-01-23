'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/matchups', label: 'Matchups' },
  { href: '/trades', label: 'Trades' },
  { href: '/history', label: 'History' },
  { href: '/settings', label: 'Settings' },
];

export default function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="bg-sleeper-darker border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-sleeper-accent rounded-lg flex items-center justify-center">
                <span className="text-sleeper-dark font-bold text-lg">S</span>
              </div>
              <span className="text-white font-semibold text-lg hidden sm:block">
                Sleeper League
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'px-3 py-2 rounded-md text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-sleeper-accent text-sleeper-dark'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
