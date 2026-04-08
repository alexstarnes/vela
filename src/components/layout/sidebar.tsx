'use client';

import { useEffect, useState } from 'react';
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
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

const navItems = [
  { icon: CheckSquare, label: 'Tasks', href: '/tasks' },
  { icon: Bot, label: 'Agents', href: '/agents' },
  { icon: FolderOpen, label: 'Projects', href: '/projects' },
  { icon: BookOpen, label: 'Skills', href: '/skills' },
  { icon: Clock, label: 'Scheduler', href: '/scheduler' },
  { icon: Activity, label: 'Activity', href: '/activity' },
] as const;

const SIDEBAR_STORAGE_KEY = 'vela-sidebar-collapsed';
const MOBILE_BREAKPOINT = '(max-width: 767px)';

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT);

    const syncSidebarState = (matchesMobile: boolean) => {
      setIsMobile(matchesMobile);

      if (matchesMobile) {
        setCollapsed(true);
        return;
      }

      const storedPreference = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
      setCollapsed(storedPreference === 'true');
    };

    syncSidebarState(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      syncSidebarState(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      if (!isMobile) {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      }
      return next;
    });
  }

  const isActive = (href: string) => {
    if (href === '/tasks') return pathname === '/' || pathname.startsWith('/tasks');
    return pathname.startsWith(href);
  };

  const sidebarWidth = collapsed ? 'var(--sidebar-width-collapsed, 72px)' : 'var(--sidebar-width, 220px)';
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const railPadding = collapsed ? 'px-2.5' : 'px-4';
  const navAlignment = collapsed ? 'justify-center' : '';
  const labelClass = collapsed ? 'sr-only' : '';

  return (
    <aside
      className="sidebar flex flex-col shrink-0 transition-[width] duration-200 ease-out"
      style={{
        width: sidebarWidth,
        minHeight: '100vh',
        background: 'var(--dark-surface)',
        borderRight: '1px solid var(--dark-border)',
      }}
    >
      <div
        className={`${railPadding} py-4 border-b`}
        style={{ borderColor: 'var(--dark-border)' }}
      >
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} gap-2`}>
          <Link
            href="/tasks"
            className={`flex items-center ${collapsed ? 'justify-center' : 'gap-1'} min-w-0`}
            title="Vela"
          >
            <span
              className="text-lg font-bold tracking-tight"
              style={{ color: '#ECEAE4', fontFamily: 'system-ui' }}
            >
              {collapsed ? 'v' : 'vela'}
            </span>
            <span style={{ color: '#F5A623', fontSize: '1.25rem', fontWeight: 700 }}>.</span>
          </Link>

          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors hover:bg-white/[0.04]"
            style={{
              borderColor: 'rgba(255,255,255,0.08)',
              color: collapsed ? '#B8B4A8' : '#ECEAE4',
            }}
          >
            <ToggleIcon size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {navItems.map(({ icon: Icon, label, href }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`flex items-center ${collapsed ? 'px-2 py-2.5' : 'gap-2.5 px-2.5 py-2'} rounded-md text-sm transition-colors ${navAlignment}`}
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
              <span className={labelClass}>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div
        className="px-2 py-3 border-t"
        style={{ borderColor: 'var(--dark-border)' }}
      >
        <Link
          href="/settings"
          title={collapsed ? 'Settings' : undefined}
          className={`flex items-center ${collapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-2.5 py-2'} rounded-md text-sm transition-colors`}
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
          <span className={labelClass}>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
