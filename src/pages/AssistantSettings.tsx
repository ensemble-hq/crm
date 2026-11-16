import { Mark } from '../ui/Mark';
import { type FormEvent, useEffect, useState } from 'react';
import { api, useQuery } from '../api';
import { useWorkspace } from '../app/workspace';
import { ICON, cardTitle, small } from '../ui/styles';

/**
 * Which model the assistant runs on. The customer chooses the provider and the model and supplies
 * their own key or endpoint. The key can be set and replaced here but is never shown again.
 */
export function AssistantSettingsCard() {
  const { access, touch, user, revision } = useWorkspace();
  const settings = useQuery(() => api.getAssistantSettings(), []);
  const usage = useQuery(() => api.getAssistantUsage(), [revision]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const data = settings.data;

  // The form starts from what is stored.
  useEffect(() => {
    if (!data) return;
    setProvider(data.provider ?? '');
    setModel(data.model ?? '');
    setBaseUrl(data.baseUrl ?? '');
    setApiKey('');
  }, [data]);

  if (!data) return null;
  // On mock data there is no server to hold a key or call a model.
  if (data.providers.length === 0) return null;
  const chosen = data.providers.find((item) => item.id === provider);

  async function save(event: FormEvent, disconnect = false) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await api.saveAssistantSettings(disconnect ? { provider: null } : { provider, model: model || undefined, baseUrl: baseUrl || undefined, apiKey: apiKey || undefined });
      settings.reload();
      touch();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The settings could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="m-card" aria-label="Assistant">
      <form className="m-card-body m-stack" data-gap="3" onSubmit={(event) => void save(event)}>
        <div className="m-cluster" data-justify="between">
          <h2 className="m-cluster" data-gap="2" style={cardTitle}>
            <Mark size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden /> Assistant
          </h2>
          {data.configured ? (
            <span className="m-badge" data-tone="success">
              Running on {data.model}
            </span>
          ) : (
            <span className="m-badge">Demo assistant, no model connected</span>
          )}
        </div>
        <p style={{ ...small, margin: 0 }}>
          The assistant runs on a model you choose, with your own key or your own endpoint. It reads the CRM with the access of whoever is asking, and proposes changes as a plan that person approves; it never changes anything by itself.
        </p>
        {data.configured && usage.data ? (
          <div className="m-stack" data-gap="1">
            <p style={{ margin: 0 }}>
              <strong>{usage.data.turns.toLocaleString('en-US')}</strong> {usage.data.turns === 1 ? 'question' : 'questions'} in the last 30 days, using <strong>{(usage.data.inputTokens + usage.data.outputTokens).toLocaleString('en-US')}</strong> tokens
              {usage.data.failed > 0 ? `; ${usage.data.failed} failed` : ''}.
            </p>
            {usage.data.byPerson.length > 1 ? (
              <p style={{ ...small, margin: 0 }}>
                {usage.data.byPerson
                  .slice(0, 5)
                  .map((row) => `${user(row.userId)?.name ?? 'Someone'}: ${row.turns.toLocaleString('en-US')} (${row.tokens.toLocaleString('en-US')} tokens)`)
                  .join(' · ')}
              </p>
            ) : null}
            <p style={{ ...small, margin: 0 }}>Tokens are what your model provider bills for. This CRM does not add a charge of its own.</p>
          </div>
        ) : null}
        {access.manageSettings ? (
          <>
            <div className="m-field">
              <label className="m-field-label" htmlFor="assistant-provider">
                Model provider
              </label>
              <select
                className="m-select"
                id="assistant-provider"
                value={provider}
                onChange={(event) => {
                  setProvider(event.target.value);
                  setModel(data.providers.find((item) => item.id === event.target.value)?.defaultModel ?? '');
                }}
                required
              >
                <option value="" disabled>
                  Choose a provider…
                </option>
                {data.providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              {chosen ? <p className="m-field-hint">{chosen.hint}</p> : null}
            </div>
            {chosen ? (
              <>
                {chosen.needsBaseUrl ? (
                  <div className="m-field">
                    <label className="m-field-label" htmlFor="assistant-url">
                      Endpoint address
                    </label>
                    <input className="m-input" id="assistant-url" type="url" placeholder="https://models.example.com/v1" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required />
                  </div>
                ) : null}
                <div className="m-field">
                  <label className="m-field-label" htmlFor="assistant-model">
                    Model
                  </label>
                  <input className="m-input" id="assistant-model" value={model} placeholder={chosen.defaultModel || 'The model name your endpoint expects'} onChange={(event) => setModel(event.target.value)} required={!chosen.defaultModel} />
                </div>
                <div className="m-field">
                  <label className="m-field-label" htmlFor="assistant-key">
                    API key{chosen.needsKey ? '' : ' (if your endpoint needs one)'}
                  </label>
                  <input
                    className="m-input"
                    id="assistant-key"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    placeholder={data.hasKey && data.provider === provider ? 'A key is stored. Leave empty to keep it.' : ''}
                    onChange={(event) => setApiKey(event.target.value)}
                    required={chosen.needsKey && !(data.hasKey && data.provider === provider)}
                  />
                  <p className="m-field-hint">Stored encrypted on your server. It is never shown again and never sent to a browser.</p>
                </div>
              </>
            ) : null}
            {error ? (
              <p className="m-field-error" role="alert" style={{ margin: 0 }}>
                {error}
              </p>
            ) : null}
            <div className="m-cluster" data-gap="2">
              <button type="submit" className="m-button" data-variant="primary" data-size="sm" disabled={busy || !chosen}>
                {busy ? 'Saving…' : data.configured ? 'Save' : 'Connect the model'}
              </button>
              {data.configured ? (
                <button type="button" className="m-button" data-size="sm" disabled={busy} onClick={(event) => void save(event, true)}>
                  Disconnect
                </button>
              ) : null}
              {saved ? (
                <span style={small} role="status">
                  Saved.
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <p style={{ ...small, margin: 0 }}>Only someone who can manage settings can change the model.</p>
        )}
      </form>
    </section>
  );
}
