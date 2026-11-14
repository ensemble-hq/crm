import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, useQuery } from '../api';
import { PublicPage } from './Forms';

/**
 * Where the unsubscribe link in an email leads: `/u/<token>`. Opening the page changes nothing,
 * because mail scanners open links too; the person presses the button. They can undo it here if
 * they pressed by mistake.
 */
export function Unsubscribe() {
  const { token = '' } = useParams();
  const [version, setVersion] = useState(0);
  const page = useQuery(() => api.getUnsubscribePage(token), [token, version]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function change(resubscribe: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      await api.unsubscribe({ token, resubscribe });
      setVersion((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const data = page.data;
  return (
    <PublicPage>
      {page.error ? <p style={{ margin: 0 }}>This link is not valid. If you still want to stop these emails, reply to one and say so.</p> : null}
      {!data && !page.error ? <span className="m-spinner" role="status" aria-label="Loading" /> : null}
      {data ? (
        <div className="m-stack" data-gap="3">
          <h1 style={{ fontSize: 'var(--m-font-size-xl)', fontWeight: 'var(--m-font-weight-medium)', margin: 0 }}>
            {data.status === 'subscribed' ? `Stop emails from ${data.organization}?` : data.status === 'unsubscribed' ? 'You are unsubscribed' : 'This address is not emailed'}
          </h1>
          <p style={{ margin: 0 }}>
            {data.status === 'subscribed'
              ? `${data.email} will get no more automated email from ${data.organization}. Someone there may still reply to you personally if you write to them.`
              : data.status === 'unsubscribed'
                ? `${data.email} will get no more automated email from ${data.organization}.`
                : `${data.organization} does not send email to ${data.email}.`}
          </p>
          {error ? (
            <p className="m-field-error" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
          ) : null}
          {data.status === 'subscribed' ? (
            <button type="button" className="m-button" data-variant="primary" disabled={busy} onClick={() => void change(false)}>
              {busy ? 'Unsubscribing…' : 'Unsubscribe'}
            </button>
          ) : data.status === 'unsubscribed' ? (
            <button type="button" className="m-button" data-variant="ghost" data-size="sm" style={{ inlineSize: 'fit-content' }} disabled={busy} onClick={() => void change(true)}>
              That was a mistake, subscribe me again
            </button>
          ) : null}
        </div>
      ) : null}
    </PublicPage>
  );
}
