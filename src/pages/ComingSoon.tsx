import { Hammer } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Page } from '../app/Page';

/** A placeholder for the areas the mock doesn't cover yet. */
export function ComingSoon() {
  const { pathname } = useLocation();
  const segment = pathname.split('/')[1] ?? '';
  const title = segment ? `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}` : 'Page';
  return (
    <Page icon={Hammer} crumbs={[{ label: title }]}>
      <div className="m-stack" data-gap="2" style={{ minBlockSize: '50vh', justifyContent: 'center' }}>
        <h1 style={{ fontSize: 'var(--m-font-size-3xl)', fontWeight: 'var(--m-font-weight-medium)', letterSpacing: 'var(--m-font-tracking-tight)', lineHeight: 'var(--m-font-leading-tight)' }}>
          {title}
          <br />
          <span style={{ color: 'var(--m-color-fg-subtle)' }}>Not built yet</span>
        </h1>
        <p style={{ color: 'var(--m-color-fg-muted)', maxInlineSize: 416 }}>This area is on the list. Overview, contacts, companies and deals are the screens that work so far.</p>
      </div>
    </Page>
  );
}
