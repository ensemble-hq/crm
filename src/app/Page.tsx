import { ChevronLeft, type LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ICON, toolbarButton } from '../ui/styles';
import { AREAS } from './areas';

export type Crumb = { label: string; to?: string };

/**
 * The white page inside the frame: a top bar with the breadcrumb and the page's actions, then the
 * content. `wide` lets tables and boards use the full width.
 */
export function Page({
  icon: Icon,
  crumbs,
  actions,
  wide = false,
  children,
}: {
  icon: LucideIcon;
  crumbs: Crumb[];
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // On the front page of a tool that shares an area, the area's other tools are one tab away.
  const area = AREAS.find((item) => item.tabs.some((tab) => tab.to === pathname));
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : undefined;
  return (
    <>
      <div className="m-cluster" data-justify="between" style={{ padding: 'var(--m-space-2) var(--m-space-3)' }}>
        <div className="m-cluster" data-gap="2">
          {parent?.to ? (
            <button type="button" className="m-button" data-size="sm" data-icon-only aria-label={`Back to ${parent.label}`} style={toolbarButton} onClick={() => navigate(parent.to ?? '/')}>
              <ChevronLeft size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
            </button>
          ) : null}
          <nav className="m-breadcrumb" aria-label="Breadcrumb">
            <ol>
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1;
                return (
                  <li key={crumb.label} className="m-cluster" data-gap="1">
                    {index === 0 ? (
                      <span style={{ display: 'inline-flex', color: 'var(--m-color-fg-subtle)' }}>
                        <Icon size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                      </span>
                    ) : null}
                    {last || !crumb.to ? <span aria-current={last ? 'page' : undefined}>{crumb.label}</span> : <Link to={crumb.to}>{crumb.label}</Link>}
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
        <div className="m-cluster" data-gap="2">
          {actions}
        </div>
      </div>
      {area ? (
        <nav className="m-tabs" aria-label={area.label} style={{ paddingInline: 'var(--m-space-3)' }}>
          <div className="m-tab-list">
            {area.tabs.map((tab) => (
              <Link key={tab.to} className="m-tab" to={tab.to} aria-selected={tab.to === pathname} aria-current={tab.to === pathname ? 'page' : undefined} style={{ textDecoration: 'none' }}>
                {tab.label}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
      <main
        className="m-container"
        style={
          {
            // Room at the bottom so the last rows scroll clear of the assistant bar.
            paddingBlock: 'var(--m-space-4) calc(var(--m-space-12) + 56px)',
            ...(wide ? { maxInlineSize: 'none', inlineSize: '100%' } : {}),
          } as CSSProperties
        }
      >
        {children}
      </main>
    </>
  );
}
