import type { SurveyItem } from '../../../../../src/contracts/migration';
import { type MigrationSource, SourceError } from '../source';

/**
 * A look at what a HubSpot account has beyond what the fixed plan brings. It reads a little of
 * each thing: enough to say that it is there, roughly how much, and what it looks like. Nothing
 * here decides anything; it is what the model is shown, and what the person sees beside its
 * proposals. A thing the key may not read is reported as such, not treated as absent.
 */

type Listed = { results?: unknown[]; lists?: unknown[]; objects?: unknown[]; paging?: { next?: unknown }; 'has-more'?: boolean };

/** Kinds of record the fixed plan leaves alone. */
const RECORDS: Array<{ area: string; label: string; show: string[] }> = [
  { area: 'tickets', label: 'Tickets', show: ['subject', 'hs_pipeline_stage', 'hs_ticket_priority', 'content'] },
  { area: 'products', label: 'Products', show: ['name', 'price', 'hs_sku', 'description'] },
  { area: 'line_items', label: 'Line items on deals', show: ['name', 'quantity', 'price'] },
  { area: 'quotes', label: 'Quotes', show: ['hs_title', 'hs_status', 'hs_expiration_date'] },
  { area: 'communications', label: 'Logged messages (SMS, WhatsApp, LinkedIn)', show: ['hs_communication_channel_type', 'hs_communication_body'] },
  { area: 'postal_mail', label: 'Logged post', show: ['hs_postal_mail_body'] },
  { area: 'feedback_submissions', label: 'Survey responses', show: ['hs_survey_type', 'hs_value'] },
];

/** Things that are not records: how the account is set up to work. */
const SETUP: Array<{ area: string; label: string; path: string }> = [
  { area: 'workflows', label: 'Workflows', path: '/automation/v4/flows' },
  { area: 'forms', label: 'Forms', path: '/marketing/v3/forms' },
  { area: 'lists', label: 'Lists', path: '/contacts/v1/lists' },
  { area: 'marketing_emails', label: 'Marketing emails', path: '/marketing/v3/emails' },
  { area: 'ticket_pipelines', label: 'Ticket pipelines', path: '/crm/v3/pipelines/tickets' },
];

const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 80) : undefined);

/** What something is called, wherever HubSpot keeps its name. */
function nameOf(item: unknown, show: string[]): string | undefined {
  const entry = (item ?? {}) as Record<string, unknown>;
  const properties = (entry.properties ?? {}) as Record<string, unknown>;
  return show.map((field) => text(properties[field])).find(Boolean) ?? text(entry.name) ?? text(entry.label) ?? text(entry.subject);
}

async function probe(source: MigrationSource, area: string, label: string, path: string, query: Record<string, string>, show: string[]): Promise<SurveyItem | undefined> {
  try {
    const body = ((await source.get(path, query)) ?? {}) as Listed;
    const items = body.results ?? body.lists ?? body.objects ?? [];
    if (items.length === 0) return undefined;
    return { area, label, count: items.length, more: Boolean(body.paging?.next) || body['has-more'] === true, examples: [...new Set(items.map((item) => nameOf(item, show)).filter((name): name is string => Boolean(name)))].slice(0, 5) };
  } catch (error) {
    // Not there at all is nothing to report. Not allowed is worth saying: the account may well use it.
    const status = error instanceof SourceError ? error.status : undefined;
    if (status === 404 || status === 400) return undefined;
    if (status === 401) throw error;
    return { area, label, count: null, more: false, examples: [], note: status === 403 ? 'The key is not allowed to read these, so it is not known whether the account uses them.' : `Could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function surveyHubSpot(source: MigrationSource): Promise<SurveyItem[]> {
  const found: SurveyItem[] = [];
  for (const kind of RECORDS) {
    const item = await probe(source, kind.area, kind.label, `/crm/v3/objects/${kind.area}`, { limit: '20', properties: kind.show.join(',') }, kind.show);
    if (!item) continue;
    // The fields a step could map: the usual ones, and any the account added.
    const custom = await source.get(`/crm/v3/properties/${kind.area}`).then(
      (body) => ((body as { results?: Array<{ name: string; hubspotDefined?: boolean }> }).results ?? []).filter((property) => !property.hubspotDefined).map((property) => property.name),
      () => [] as string[],
    );
    found.push({ ...item, fields: [...new Set([...kind.show, ...custom])].slice(0, 60) });
  }
  for (const kind of SETUP) {
    const item = await probe(source, kind.area, kind.label, kind.path, { limit: '50' }, []);
    if (item) found.push(item);
  }
  return found;
}
