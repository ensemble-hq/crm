import { MailX } from 'lucide-react';
import { useState } from 'react';
import { api, useQuery } from '../api';
import { useWorkspace } from '../app/workspace';
import { formatDate } from './PropertyValue';
import { ICON, small } from './styles';

/**
 * Whether a contact may be emailed, on their record: unsubscribed or blocked, why, any consent on
 * file, and how much automated email they have had this week. Nothing is shown on mock data.
 */
export function EmailPreference({ email }: { email: string }) {
  const { revision, touch } = useWorkspace();
  const [version, setVersion] = useState(0);
  const preference = useQuery(() => api.getEmailPreference(email), [email, revision, version]);
  const [error, setError] = useState<string>();
  const data = preference.data;
  if (!import.meta.env.VITE_API_URL || !data) return null;

  async function set(status: 'subscribed' | 'unsubscribed') {
    setError(undefined);
    const reason = status === 'subscribed' ? (window.prompt('Why is it right to email this person again? This is kept on record.') ?? '') : 'Asked a member of the team to stop';
    if (status === 'subscribed' && !reason.trim()) return;
    try {
      await api.setEmailPreference({ email, status, reason });
      setVersion((value) => value + 1);
      touch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That could not be changed.');
    }
  }

  const stopped = data.status !== 'subscribed';
  return (
    <div className="m-stack" data-gap="1">
      <div className="m-cluster" data-justify="between" data-gap="2">
        <span className="m-cluster" data-gap="1">
          {stopped ? <MailX size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> : null}
          <span className="m-badge" data-tone={data.status === 'blocked' ? 'danger' : data.status === 'unsubscribed' ? 'warning' : undefined}>
            {data.status === 'blocked' ? 'Cannot be emailed' : data.status === 'unsubscribed' ? 'Unsubscribed' : 'Can be emailed'}
          </span>
        </span>
        <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => void set(stopped ? 'subscribed' : 'unsubscribed')}>
          {stopped ? 'Email again…' : 'Stop automated email'}
        </button>
      </div>
      <span style={small}>
        {data.status === 'blocked'
          ? `Nothing is sent to this address${data.reason ? `: ${data.reason}` : '.'}`
          : data.status === 'unsubscribed'
            ? `No sequences or workflow emails${data.source === 'recipient' ? '; they unsubscribed themselves' : ''}${data.changedAt ? ` on ${formatDate(data.changedAt)}` : ''}. You can still reply to them yourself.`
            : `${data.sentThisWeek} of ${data.weeklyLimit} automated emails this week.`}
        {data.consent ? ` Agreed to email on ${formatDate(data.consent.at)}, on ${data.consent.source}.` : ''}
      </span>
      {error ? (
        <span className="m-field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
