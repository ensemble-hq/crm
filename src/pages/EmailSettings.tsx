import { Mail, MailWarning } from 'lucide-react';
import { Link } from 'react-router-dom';
import { type FormEvent, useEffect, useState } from 'react';
import { api, useQuery } from '../api';
import { useWorkspace } from '../app/workspace';
import { formatDateTime } from '../ui/PropertyValue';
import { ICON, cardTitle, figure, medium, plainList, rowDivider, small } from '../ui/styles';

/** The rules for email the CRM sends on its own: how often one person hears from you, and the address in the footer. */
export function EmailSettingsCard() {
  const { access } = useWorkspace();
  const settings = useQuery(() => api.getEmailSettings(), []);
  const [weeklyLimit, setWeeklyLimit] = useState('3');
  const [postalAddress, setPostalAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const data = settings.data;

  useEffect(() => {
    if (!data) return;
    setWeeklyLimit(String(data.weeklyLimit));
    setPostalAddress(data.postalAddress);
  }, [data]);

  // Only the server sends email.
  if (!import.meta.env.VITE_API_URL || !data) return null;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await api.saveEmailSettings({ weeklyLimit: Math.max(1, Math.round(Number(weeklyLimit) || 1)), postalAddress });
      settings.reload();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The settings could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="m-card" aria-label="Email">
      <form className="m-card-body m-stack" data-gap="3" onSubmit={(event) => void save(event)}>
        <h2 className="m-cluster" data-gap="2" style={cardTitle}>
          <Mail size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden /> Automated email
        </h2>
        <p style={{ ...small, margin: 0 }}>
          Email sent by a sequence or a workflow always carries an unsubscribe link, is never sent to someone who has unsubscribed, and is held to a weekly limit per person. Replies a person writes themselves are not counted or limited.
        </p>
        <div className="m-field">
          <label className="m-field-label" htmlFor="email-limit">
            Most automated emails to one person in a week
          </label>
          <input className="m-input" id="email-limit" type="number" min={1} max={50} value={weeklyLimit} disabled={!access.manageSettings} onChange={(event) => setWeeklyLimit(event.target.value)} style={{ maxInlineSize: 120 }} />
          <p className="m-field-hint">When someone has had this many, a sequence waits until there is room instead of sending.</p>
        </div>
        <div className="m-field">
          <label className="m-field-label" htmlFor="email-address">
            Your postal address
          </label>
          <textarea className="m-input" id="email-address" rows={2} value={postalAddress} disabled={!access.manageSettings} placeholder="Northwind Ltd, 1 Example Street, London" onChange={(event) => setPostalAddress(event.target.value)} />
          <p className="m-field-hint">Added to the foot of automated email. Many countries require it on commercial email.</p>
        </div>
        {error ? (
          <p className="m-field-error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}
        {access.manageSettings ? (
          <div className="m-cluster" data-gap="2">
            <button type="submit" className="m-button" data-variant="primary" data-size="sm" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {saved ? (
              <span style={small} role="status">
                Saved.
              </span>
            ) : null}
          </div>
        ) : null}
      </form>
    </section>
  );
}

const KINDS = { bounced: 'Bounced', complained: 'Marked as spam', failed: 'Not sent' } as const;
const share = (part: number, whole: number) => (whole === 0 ? '–' : `${Math.round((part / whole) * 1000) / 10}%`);

/** What became of the email sent in the last 30 days: how much arrived, and each message that did not, with why. */
export function EmailReportCard() {
  const report = useQuery(() => api.getEmailReport(), []);
  const data = report.data;
  // Only the server sends email.
  if (!import.meta.env.VITE_API_URL || !data) return null;
  const figures = [
    { label: 'Sent', value: String(data.sent), note: `${data.automated.sent} by sequences and workflows` },
    { label: 'Confirmed delivered', value: String(data.delivered), note: share(data.delivered, data.sent) },
    { label: 'Bounced', value: String(data.bounced), note: share(data.bounced, data.sent) },
    { label: 'Marked as spam', value: String(data.complained), note: share(data.complained, data.sent) },
    { label: 'Not sent', value: String(data.failed), note: 'Never accepted' },
  ];
  return (
    <section className="m-card" aria-label="Email delivery">
      <div className="m-card-body m-stack" data-gap="3">
        <h2 className="m-cluster" data-gap="2" style={cardTitle}>
          <MailWarning size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden /> Delivery, last 30 days
        </h2>
        <p style={{ ...small, margin: 0 }}>What the email service reported after accepting each message. An address that bounces, or whose owner marks an email as spam, is blocked for everyone from then on.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--m-space-3)' }}>
          {figures.map((item) => (
            <div key={item.label} className="m-stack" data-gap="0">
              <span style={small}>{item.label}</span>
              <span style={figure}>{item.value}</span>
              <span style={small}>{item.note}</span>
            </div>
          ))}
        </div>
        {data.problems.length === 0 ? (
          <p style={{ ...small, margin: 0 }}>Nothing has bounced or failed.</p>
        ) : (
          <ul style={plainList} aria-label="Messages that did not arrive">
            {data.problems.slice(0, 12).map((problem) => (
              <li key={problem.messageId} className="m-cluster" data-justify="between" data-gap="3" style={{ flexWrap: 'nowrap', paddingBlock: 'var(--m-space-2)', ...rowDivider }}>
                <span className="m-stack" data-gap="0" style={{ minInlineSize: 0 }}>
                  <Link to={`/inbox/${problem.conversationId}`} style={{ ...medium, color: 'inherit', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {problem.toEmail || 'Address not recorded'}
                  </Link>
                  <span style={{ ...small, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {KINDS[problem.kind]}
                    {problem.reason ? `: ${problem.reason}` : ''} · {problem.subject}
                  </span>
                </span>
                <span style={{ ...small, flexShrink: 0 }}>{formatDateTime(problem.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
