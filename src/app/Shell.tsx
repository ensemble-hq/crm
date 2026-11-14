import { BarChart3, Bell, Bookmark, CheckSquare, House, Inbox, type LucideIcon, PanelLeft, Search, Send, Settings, Sparkles, Workflow } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { objectIcon } from '../ui/icons';
import { ICON, initials } from '../ui/styles';
import { useWorkspace } from './workspace';

type NavItem = { to: string; label: string; icon: LucideIcon; count?: number };

const FONT_FEATURES = "'calt' on, 'ss03' on, 'cv09' on, 'cv02' on, 'cv03' on, 'cv04' on";

/** Saved views pinned to the navigation. Later these come from the user's own pins. */
const pinned: NavItem[] = [
  { to: '/deals?view=mine', label: 'My open deals', icon: Bookmark },
  { to: '/deals?view=closing-this-month', label: 'Closing this month', icon: Bookmark },
  { to: '/contacts?view=unassigned', label: 'Unassigned contacts', icon: Bookmark },
];

function SidebarLink({ item, current }: { item: NavItem; current: boolean }) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        className="m-sidebar-link"
        to={item.to}
        aria-current={current ? 'page' : undefined}
        style={current ? { boxShadow: 'inset 0 0 0 1px var(--m-color-border-default)' } : undefined}
      >
        <span style={{ display: 'inline-flex', color: current ? 'inherit' : 'var(--m-color-fg-subtle)' }}>
          <Icon size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden />
        </span>
        <span style={{ flex: 1 }}>{item.label}</span>
        {item.count ? <span className="m-sidebar-count">{item.count}</span> : null}
      </Link>
    </li>
  );
}

function Sidebar() {
  const workspace = useWorkspace();
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;

  // Objects come from the workspace's definitions, so a custom object appears here by itself.
  const primary: NavItem[] = [
    { to: '/assistant', label: 'Assistant', icon: Sparkles },
    { to: '/', label: 'Overview', icon: House },
    { to: '/inbox', label: 'Inbox', icon: Inbox, count: 6 },
    { to: '/tasks', label: 'Tasks', icon: CheckSquare, count: 5 },
    ...workspace.objects.map((object) => ({ to: `/${object.id}`, label: object.plural, icon: objectIcon(object.icon) })),
    { to: '/sequences', label: 'Sequences', icon: Send },
    { to: '/workflows', label: 'Workflows', icon: Workflow },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
  ];

  const onPinned = pinned.some((item) => item.to === here);
  const isCurrent = (to: string) => {
    if (onPinned) return false;
    return to === '/' ? location.pathname === '/' : location.pathname === to || location.pathname.startsWith(`${to}/`);
  };

  return (
    <nav
      className="m-sidebar"
      data-theme="keel"
      data-mode="dark"
      aria-label="Main"
      style={{ background: 'var(--m-sidebar-bg)', justifyContent: 'space-between', position: 'sticky', insetBlockStart: 0, blockSize: '100vh', overflowY: 'auto' }}
    >
      <div className="m-stack" data-gap="3">
        <div className="m-cluster" data-justify="between" style={{ padding: 'var(--m-space-1) var(--m-space-1) 0' }}>
          <span className="m-cluster" data-gap="2" style={{ color: 'var(--m-color-fg-default)', fontWeight: 'var(--m-font-weight-medium)' }}>
            <span
              aria-hidden
              style={{
                display: 'grid',
                placeItems: 'center',
                inlineSize: 28,
                blockSize: 28,
                borderRadius: 'var(--m-radius-md)',
                background: 'var(--m-color-fg-default)',
                color: 'var(--m-color-bg-canvas)',
                fontWeight: 'var(--m-font-weight-semibold)',
              }}
            >
              {workspace.name.slice(0, 1)}
            </span>
            {workspace.name}
          </span>
          <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label="Collapse navigation" style={{ color: 'var(--m-color-fg-muted)' }}>
            <PanelLeft size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
        </div>
        <button
          type="button"
          className="m-button"
          data-size="sm"
          style={
            {
              justifyContent: 'flex-start',
              inlineSize: '100%',
              '--m-button-secondary-bg': 'var(--m-color-bg-raised)',
              '--m-button-secondary-fg': 'var(--m-color-fg-muted)',
              '--m-button-radius': 'var(--m-radius-md)',
            } as CSSProperties
          }
        >
          <Search size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
          <span style={{ flex: 1, textAlign: 'start', fontWeight: 'var(--m-font-weight-regular)' }}>Search</span>
          <kbd className="m-kbd">⌘K</kbd>
        </button>
        <div className="m-sidebar-section">
          <ul>
            {primary.map((item) => (
              <SidebarLink key={item.to} item={item} current={isCurrent(item.to)} />
            ))}
          </ul>
        </div>
        <div className="m-sidebar-section">
          <h2 className="m-sidebar-heading">Pinned views</h2>
          <ul>
            {pinned.map((item) => (
              <SidebarLink key={item.to} item={item} current={item.to === here} />
            ))}
          </ul>
        </div>
      </div>
      <div className="m-stack" data-gap="1">
        <ul>
          <SidebarLink item={{ to: '/settings', label: 'Settings', icon: Settings }} current={isCurrent('/settings')} />
        </ul>
        <div className="m-cluster" data-justify="between" style={{ flexWrap: 'nowrap', padding: 'var(--m-space-1) var(--m-space-2)' }}>
          <span className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap', whiteSpace: 'nowrap', overflow: 'hidden', color: 'var(--m-sidebar-link-fg)' }}>
            <span className="m-avatar" data-size="sm" style={{ '--m-avatar-size-sm': '20px', fontSize: 'var(--m-font-size-xs)' } as CSSProperties}>
              {initials(workspace.currentUser.name)}
            </span>
            {workspace.currentUser.name}
          </span>
          <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label="Notifications" style={{ color: 'var(--m-color-fg-muted)' }}>
            <Bell size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
        </div>
      </div>
    </nav>
  );
}

/** The app frame: a dark navigation rail around a white page, as the Keel design language sets out. */
export function Shell() {
  return (
    <div
      className="m-split"
      style={
        {
          '--m-layout-split-side': '224px',
          '--m-layout-split-gap': '0',
          minBlockSize: '100vh',
          alignItems: 'flex-start',
          background: 'var(--m-sidebar-bg)',
          fontFeatureSettings: FONT_FEATURES,
        } as CSSProperties
      }
    >
      <Sidebar />
      <div style={{ padding: 'var(--m-space-2) var(--m-space-2) var(--m-space-2) 0', minInlineSize: 0, minBlockSize: '100vh', display: 'flex' }}>
        <div
          className="m-stack"
          data-gap="0"
          style={{
            flex: 1,
            minInlineSize: 0,
            background: 'var(--m-color-bg-canvas)',
            borderRadius: 'calc(var(--m-radius-md) + 2px)',
            boxShadow: 'var(--m-shadow-sm)',
            overflow: 'clip',
          }}
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
}
