'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CheckSquare,
  Bot,
  FolderOpen,
  BookOpen,
  Clock,
  Activity,
  Settings,
} from 'lucide-react';

const navItems = [
  { icon: CheckSquare, label: 'Tasks', href: '/tasks' },
  { icon: Bot, label: 'Agents', href: '/agents' },
  { icon: FolderOpen, label: 'Projects', href: '/projects' },
  { icon: BookOpen, label: 'Skills', href: '/skills' },
  { icon: Clock, label: 'Scheduler', href: '/scheduler' },
  { icon: Activity, label: 'Activity', href: '/activity' },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/tasks') return pathname === '/' || pathname.startsWith('/tasks');
    return pathname.startsWith(href);
  };

  return (
    <aside
      className="sidebar flex flex-col shrink-0"
      style={{
        width: 'var(--sidebar-width, 220px)',
        minHeight: '100vh',
        background: 'var(--dark-surface)',
        borderRight: '1px solid var(--dark-border)',
      }}
    >
      {/* Logo */}
      <div
        className="px-4 py-5 border-b"
        style={{ borderColor: 'var(--dark-border)' }}
      >
        <Link href="/tasks" className="flex items-center gap-1">
          <span
            className="text-lg font-bold tracking-tight"
            style={{ color: '#ECEAE4', fontFamily: 'system-ui' }}
          >
            vela
          </span>
          <span style={{ color: '#F5A623', fontSize: '1.25rem', fontWeight: 700 }}>.</span>
        </Link>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {navItems.map(({ icon: Icon, label, href }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors"
              style={{
                background: active ? 'var(--dark-surface2)' : 'transparent',
                color: active ? '#ECEAE4' : 'var(--stone-400)',
                fontWeight: active ? 500 : 400,
              }}
            >
              <Icon
                size={16}
                strokeWidth={1.5}
                style={{ color: active ? '#F5A623' : 'var(--stone-500)' }}
              />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Settings at bottom */}
      <div
        className="px-2 py-3 border-t"
        style={{ borderColor: 'var(--dark-border)' }}
      >
        <Link
          href="/settings"
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors"
          style={{
            background: pathname.startsWith('/settings') ? 'var(--dark-surface2)' : 'transparent',
            color: pathname.startsWith('/settings') ? '#ECEAE4' : 'var(--stone-400)',
            fontWeight: pathname.startsWith('/settings') ? 500 : 400,
          }}
        >
          <Settings
            size={16}
            strokeWidth={1.5}
            style={{
              color: pathname.startsWith('/settings') ? '#F5A623' : 'var(--stone-500)',
            }}
          />
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
