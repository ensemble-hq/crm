import { Bookmark, Eye, House, Inbox, type LucideIcon, Monitor, Moon, PanelLeft, PanelLeftOpen, Search, Settings, Sun } from 'lucide-react';
import { Mark } from '../ui/Mark';
import { useSharedAssistant } from '../assistant/context';
import { type CSSProperties, useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, useQuery } from '../api';
import { AssistantBar } from '../assistant/AssistantBar';
import { AssistantProvider } from '../assistant/AssistantProvider';
import { objectIcon } from '../ui/icons';
import { ICON, initials } from '../ui/styles';
import { CommandPalette } from './CommandPalette';
import { AREAS } from './areas';
import { Notifications } from './Notifications';
import { type ColorMode, useColorMode } from './colorMode';
import { useWorkspace } from './workspace';

type NavItem = { to: string; label: string; icon: LucideIcon | typeof Mark; count?: number };

const FONT_FEATURES = "'calt' on, 'ss03' on, 'cv09' on, 'cv02' on, 'cv03' on, 'cv04' on";

/** Saved views pinned to the navigation. Later these come from the user's own pins. */
const pinned: NavItem[] = [
  { to: '/deals?view=mine', label: 'My open deals', icon: Bookmark },
  { to: '/deals?view=closing-this-month', label: 'Closing this month', icon: Bookmark },
  { to: '/contacts?view=unassigned', label: 'Unassigned contacts', icon: Bookmark },
];

function SidebarLink({ item, current, collapsed = false }: { item: NavItem; current: boolean; collapsed?: boolean }) {
  const Icon = item.icon;
  const assistant = useSharedAssistant();
  return (
    <li>
      <Link
        className="m-sidebar-link"
        to={item.to}
        aria-current={current ? 'page' : undefined}
        // Collapsed, the icon is all there is, so the name moves to a tooltip.
        title={collapsed ? item.label : undefined}
        style={{ ...(current ? { boxShadow: 'inset 0 0 0 1px var(--m-color-border-default)' } : {}), ...(collapsed ? { justifyContent: 'center' } : {}) }}
      >
        <span style={{ display: 'inline-flex', color: current ? 'inherit' : 'var(--m-color-fg-subtle)' }}>
          {/* The assistant's own link shows when it is working, wherever you are. */}
          {Icon === Mark ? <Mark size={ICON.nav + 2} busy={assistant.working} /> : <Icon size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden />}
        </span>
        <span className={collapsed ? 'm-sr-only' : undefined} style={collapsed ? undefined : { flex: 1 }}>
          {item.label}
        </span>
        {item.count && !collapsed ? <span className="m-sidebar-count">{item.count}</span> : null}
      </Link>
    </li>
  );
}

const SIDEBAR_WIDTH = 224;
const SIDEBAR_COLLAPSED = 56;
const COLLAPSED_KEY = 'crm-sidebar-collapsed';
const SHORTCUT = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘B' : 'Ctrl B';

const MODES: Record<ColorMode, { icon: LucideIcon; label: string }> = {
  auto: { icon: Monitor, label: 'Colours follow your system. Switch to light.' },
  light: { icon: Sun, label: 'Light mode. Switch to dark.' },
  dark: { icon: Moon, label: 'Dark mode. Switch to follow your system.' },
};

function Sidebar({ collapsed, onToggle, onSearch }: { collapsed: boolean; onToggle: () => void; onSearch: () => void }) {
  const workspace = useWorkspace();
  const { mode, cycle } = useColorMode();
  const ModeIcon = MODES[mode].icon;
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;

  // The sidebar is kept short on purpose: the day's work, the records, and two areas that gather the
  // tools. Tasks are worked from Today, which carries the count of what is due; set-up lists such as
  // products are reached by search. Objects come from the workspace's definitions, so a custom
  // object appears here by itself.
  const taskObject = workspace.objects.find((object) => object.completion);
  const due = useQuery(() => (taskObject ? api.listRecords({ objectId: taskObject.id, viewId: taskObject.views[0]?.id, page: 1, pageSize: 1 }) : Promise.resolve(undefined)), [taskObject?.id, workspace.revision]);
  const unread = useQuery(() => api.inboxCounts(), [workspace.revision]);
  const primary: NavItem[] = [
    { to: '/assistant', label: 'Assistant', icon: Mark },
    { to: '/', label: 'Today', icon: House, count: due.data?.total },
    { to: '/inbox', label: 'Inbox', icon: Inbox, count: unread.data?.mineUnread },
  ];
  const records: NavItem[] = workspace.objects.filter((object) => object !== taskObject && object.navigation !== 'search').map((object) => ({ to: `/${object.id}`, label: object.plural, icon: objectIcon(object.icon) }));
  const areas = AREAS.map((area) => ({ item: { to: area.tabs[0]?.to ?? '/', label: area.label, icon: area.icon }, paths: area.tabs.map((tab) => tab.to) }));

  const onPinned = pinned.some((item) => item.to === here);
  const isUnder = (to: string) => location.pathname === to || location.pathname.startsWith(`${to}/`);
  const isCurrent = (to: string) => {
    if (onPinned) return false;
    // Tasks are part of Today, so their pages keep Today lit.
    if (to === '/') return location.pathname === '/' || (taskObject !== undefined && isUnder(`/${taskObject.id}`));
    return isUnder(to);
  };

  return (
    <nav
      className="m-sidebar"
      data-theme="keel"
      data-mode="dark"
      aria-label="Main"
      style={
        {
          // The sidebar carries its own theme scope, which resets the layout tokens, so its width is set here
          // on the element itself as well as on the split around it.
          '--m-sidebar-width': `${collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH}px`,
          '--m-layout-split-side': `${collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH}px`,
          ...(collapsed ? { '--m-sidebar-padding': 'var(--m-space-2)' } : {}),
          background: 'var(--m-sidebar-bg)',
          justifyContent: 'space-between',
          position: 'sticky',
          insetBlockStart: 0,
          blockSize: '100vh',
          overflowY: 'auto',
          overflowX: 'hidden',
        } as CSSProperties
      }
    >
      <div className="m-stack" data-gap="3">
        <div className="m-cluster" data-justify={collapsed ? 'center' : 'between'} style={{ padding: 'var(--m-space-1) var(--m-space-1) 0' }}>
          {collapsed ? null : (
            <span className="m-cluster" data-gap="2" style={{ color: 'var(--m-color-fg-default)', fontWeight: 'var(--m-font-weight-medium)' }}>
              <span
                aria-hidden
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  inlineSize: 28,
                  blockSize: 28,
                }}
              >
                <Mark size={28} />
              </span>
              {workspace.name}
            </span>
          )}
          <button
            type="button"
            className="m-button"
            data-variant="ghost"
            data-size="sm"
            data-icon-only
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!collapsed}
            title={`${collapsed ? 'Expand' : 'Collapse'} navigation (${SHORTCUT})`}
            onClick={onToggle}
            style={{ color: 'var(--m-color-fg-muted)' }}
          >
            {collapsed ? <PanelLeftOpen size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden /> : <PanelLeft size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden />}
          </button>
        </div>
        <button
          type="button"
          className="m-button"
          data-size="sm"
          data-icon-only={collapsed ? '' : undefined}
          aria-label="Search"
          title={collapsed ? 'Search' : undefined}
          onClick={onSearch}
          style={
            {
              justifyContent: collapsed ? 'center' : 'flex-start',
              inlineSize: '100%',
              '--m-button-secondary-bg': 'var(--m-color-bg-raised)',
              '--m-button-secondary-fg': 'var(--m-color-fg-muted)',
              '--m-button-radius': 'var(--m-radius-md)',
            } as CSSProperties
          }
        >
          <Search size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
          {collapsed ? null : (
            <>
              <span style={{ flex: 1, textAlign: 'start', fontWeight: 'var(--m-font-weight-regular)' }}>Search</span>
              <kbd className="m-kbd">⌘K</kbd>
            </>
          )}
        </button>
        <div className="m-sidebar-section">
          <ul>
            {primary.map((item) => (
              <SidebarLink key={item.to} item={item} current={isCurrent(item.to)} collapsed={collapsed} />
            ))}
          </ul>
        </div>
        <div className="m-sidebar-section">
          {collapsed ? null : <h2 className="m-sidebar-heading">Records</h2>}
          <ul>
            {records.map((item) => (
              <SidebarLink key={item.to} item={item} current={isCurrent(item.to)} collapsed={collapsed} />
            ))}
          </ul>
        </div>
        <div className="m-sidebar-section">
          <ul>
            {areas.map((area) => (
              <SidebarLink key={area.item.to} item={area.item} current={!onPinned && area.paths.some(isUnder)} collapsed={collapsed} />
            ))}
          </ul>
        </div>
        {/* Pinned views all share one icon, so collapsed they would be indistinguishable; they are left out. */}
        {collapsed ? null : (
          <div className="m-sidebar-section">
            <h2 className="m-sidebar-heading">Pinned views</h2>
            <ul>
              {pinned.map((item) => (
                <SidebarLink key={item.to} item={item} current={item.to === here} />
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="m-stack" data-gap="1">
        <ul>
          <SidebarLink item={{ to: '/settings', label: 'Settings', icon: Settings }} current={isCurrent('/settings')} collapsed={collapsed} />
        </ul>
        <div className={collapsed ? 'm-stack' : 'm-cluster'} data-justify="between" data-gap={collapsed ? '1' : undefined} style={{ flexWrap: 'nowrap', alignItems: 'center', padding: 'var(--m-space-1) var(--m-space-2)' }}>
          <span className="m-cluster" data-gap="2" title={collapsed ? workspace.currentUser.name : undefined} style={{ flexWrap: 'nowrap', whiteSpace: 'nowrap', overflow: 'hidden', color: 'var(--m-sidebar-link-fg)' }}>
            <span className="m-avatar" data-size="sm" style={{ '--m-avatar-size-sm': '20px', fontSize: 'var(--m-font-size-xs)' } as CSSProperties}>
              {initials(workspace.currentUser.name)}
            </span>
            <span className={collapsed ? 'm-sr-only' : undefined}>{workspace.currentUser.name}</span>
          </span>
          <span className={collapsed ? 'm-stack' : 'm-cluster'} data-gap="0" style={{ flexWrap: 'nowrap' }}>
            <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={MODES[mode].label} title={MODES[mode].label} onClick={cycle} style={{ color: 'var(--m-color-fg-muted)' }}>
              <ModeIcon size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden />
            </button>
<Notifications offset={collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH} />
          </span>
        </div>
      </div>
    </nav>
  );
}

/** Shown across the top while an admin is looking at the CRM as someone else, with the way back. */
function ViewingAs() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  if (!workspace.access.viewedBy) return null;

  async function exit() {
    await api.viewAs(null);
    await workspace.reload();
    workspace.touch();
    navigate('/settings/people');
  }

  return (
    <output className="m-cluster" data-justify="between" data-gap="3" style={{ padding: 'var(--m-space-2) var(--m-space-3)', background: 'var(--m-color-warning-bg)', color: 'var(--m-color-warning-fg)' }}>
      <span className="m-cluster" data-gap="2">
        <Eye size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
        <span>
          You are viewing the CRM as <strong>{workspace.currentUser.name}</strong> ({workspace.access.roleName}). What you see and can change is what they can.
        </span>
      </span>
      <button type="button" className="m-button" data-size="sm" onClick={() => void exit()}>
        Back to yourself
      </button>
    </output>
  );
}

/** The app frame: a dark navigation rail around a white page, as the Keel design language sets out. */
export function Shell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const width = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH;

  useEffect(() => {
    try {
      if (collapsed) localStorage.setItem(COLLAPSED_KEY, '1');
      else localStorage.removeItem(COLLAPSED_KEY);
    } catch {
      // Not saved; the sidebar still stays as set until the page reloads.
    }
  }, [collapsed]);

  const [searching, setSearching] = useState(false);

  // Cmd/Ctrl+K opens search from anywhere.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearching(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Cmd/Ctrl+B toggles the sidebar, as in most editors.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setCollapsed((value) => !value);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <AssistantProvider>
    <div
      className="m-split"
      style={
        {
          '--m-layout-split-side': `${width}px`,
          '--m-layout-split-gap': '0',
          minBlockSize: '100vh',
          alignItems: 'flex-start',
          background: 'var(--m-sidebar-bg)',
          fontFeatureSettings: FONT_FEATURES,
        } as CSSProperties
      }
    >
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} onSearch={() => setSearching(true)} />
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
          <ViewingAs />
          <Outlet />
        </div>
      </div>
    </div>
      {/* Outside the split: its layout rules size its first and last child, and the bar must not be either. */}
      <AssistantBar offset={width} />
      <CommandPalette open={searching} onClose={() => setSearching(false)} />
    </AssistantProvider>
  );
}
