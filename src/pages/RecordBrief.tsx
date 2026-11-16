import { AlertTriangle, ArrowRight, CheckCircle2, History } from 'lucide-react';
import { Mark } from '../ui/Mark';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, useQuery } from '../api';
import { useWorkspace } from '../app/workspace';
import { useSharedAssistant } from '../assistant/context';
import { formatDate } from '../ui/PropertyValue';
import { ICON, cardTitle, medium, small } from '../ui/styles';

function when(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return days < 0 ? `${-days} days overdue` : `In ${days} days`;
}

function Column({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="m-stack" data-gap="1" style={{ minInlineSize: 0 }}>
      <h3 className="m-cluster" data-gap="1" style={{ ...cardTitle, color: 'var(--m-color-fg-muted)' }}>
        {icon} {title}
      </h3>
      {children}
    </div>
  );
}

/**
 * The first thing on a record page: where it stands in a sentence, then what last happened, what is
 * next and what to watch. The fields and the full history are below for when they are needed.
 */
export function RecordBrief({ recordId, onPlan }: { recordId: string; onPlan?: () => void }) {
  const { revision } = useWorkspace();
  const assistant = useSharedAssistant();
  const { data: brief } = useQuery(() => api.getBrief(recordId), [recordId, revision]);
  // Nothing is shown while it loads or for records with no story (a product): the page is complete without it.
  if (!brief) return null;

  const icon = { size: ICON.button, strokeWidth: ICON.strokeWidth, 'aria-hidden': true } as const;
  const act = () => {
    if (brief.suggestion === 'Plan the next step' && onPlan) onPlan();
    else assistant.send('Draft a follow-up email');
  };

  return (
    <section className="m-card" aria-label="Where this stands" style={{ padding: 'var(--m-space-4)' }}>
      <div className="m-stack" data-gap="4">
        <p style={{ margin: 0, fontSize: 'var(--m-font-size-lg)', lineHeight: 'var(--m-font-leading-snug, 1.4)' }}>{brief.summary}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--m-space-5)' }}>
          <Column icon={<History {...icon} />} title="Last">
            {brief.happened ? (
              <>
                <span style={medium}>{brief.happened.title}</span>
                {brief.happened.detail ? <span style={{ ...small, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{brief.happened.detail}</span> : null}
                <span style={small}>{formatDate(brief.happened.occurredAt)}</span>
              </>
            ) : (
              <span style={small}>Nothing logged yet.</span>
            )}
          </Column>
          <Column icon={<ArrowRight {...icon} />} title="Next">
            {brief.next ? (
              <>
                {brief.next.recordId && brief.next.objectId ? (
                  <Link to={`/${brief.next.objectId}/${brief.next.recordId}`} style={{ ...medium, color: 'inherit', textDecoration: 'none' }}>
                    {brief.next.title}
                  </Link>
                ) : (
                  <span style={medium}>{brief.next.title}</span>
                )}
                {brief.next.daysAway !== null ? <span style={{ ...small, ...(brief.next.daysAway < 0 ? { color: 'var(--m-color-danger-fg)' } : {}) }}>{when(brief.next.daysAway)}</span> : null}
              </>
            ) : brief.suggestion ? (
              <>
                <span style={small}>Nothing is planned.</span>
                <span>
                  <button type="button" className="m-button" data-size="sm" onClick={act}>
                    <Mark {...icon} /> {brief.suggestion}
                  </button>
                </span>
              </>
            ) : (
              <span style={small}>Nothing more to do.</span>
            )}
          </Column>
          <Column icon={<AlertTriangle {...icon} />} title="Watch">
            {brief.risks.length === 0 ? (
              <span className="m-cluster" data-gap="1" style={small}>
                <CheckCircle2 {...icon} /> Nothing to worry about.
              </span>
            ) : (
              brief.risks.map((risk) => (
                <span key={risk.text} style={{ color: risk.tone === 'danger' ? 'var(--m-color-danger-fg)' : 'var(--m-color-warning-fg)' }}>
                  {risk.text}
                </span>
              ))
            )}
          </Column>
        </div>
      </div>
    </section>
  );
}
