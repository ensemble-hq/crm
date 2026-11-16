import { type MigrationSource, SourceError } from '../src/services/migration/source';

/**
 * A HubSpot account held in memory, answering the parts of HubSpot's API the importer reads, in
 * the shapes HubSpot answers in. Tests fill it and hand it to the CRM in place of the real thing.
 */

export type FakeObject = { id: string; properties: Record<string, string | null>; createdAt?: string; archived?: boolean; associations?: Record<string, string[]> };
export type FakeProperty = { name: string; label: string; type: string; fieldType: string; groupName?: string; options?: Array<{ label: string; value: string }>; hubspotDefined?: boolean; calculated?: boolean };
export type FakeSchema = { objectTypeId: string; name: string; labels: { singular: string; plural: string }; primaryDisplayProperty: string; properties: FakeProperty[]; associations?: Array<{ toObjectTypeId: string }> };

const STANDARD: Record<string, FakeProperty[]> = {
  contacts: [
    { name: 'firstname', label: 'First name', type: 'string', fieldType: 'text', hubspotDefined: true },
    { name: 'lastname', label: 'Last name', type: 'string', fieldType: 'text', hubspotDefined: true },
    { name: 'email', label: 'Email', type: 'string', fieldType: 'text', hubspotDefined: true },
    { name: 'jobtitle', label: 'Job title', type: 'string', fieldType: 'text', hubspotDefined: true },
    {
      name: 'lifecyclestage',
      label: 'Lifecycle stage',
      type: 'enumeration',
      fieldType: 'radio',
      hubspotDefined: true,
      options: [
        { label: 'Subscriber', value: 'subscriber' },
        { label: 'Lead', value: 'lead' },
        { label: 'Marketing Qualified Lead', value: 'marketingqualifiedlead' },
        { label: 'Customer', value: 'customer' },
        { label: 'Evangelist', value: 'evangelist' },
      ],
    },
  ],
  companies: [
    { name: 'name', label: 'Name', type: 'string', fieldType: 'text', hubspotDefined: true },
    { name: 'domain', label: 'Domain', type: 'string', fieldType: 'text', hubspotDefined: true },
  ],
  deals: [
    { name: 'dealname', label: 'Deal name', type: 'string', fieldType: 'text', hubspotDefined: true },
    { name: 'amount', label: 'Amount', type: 'number', fieldType: 'number', hubspotDefined: true },
  ],
};

export class FakeHubSpot implements MigrationSource {
  owners: Array<{ id: string; email: string; firstName: string; lastName: string; archived?: boolean }> = [];
  properties: Record<string, FakeProperty[]> = structuredClone(STANDARD);
  pipelines: Array<{ id: string; label: string; stages: Array<{ id: string; label: string; metadata: { probability: string } }> }> = [
    {
      id: 'default',
      label: 'Sales Pipeline',
      stages: [
        { id: 'appointmentscheduled', label: 'Appointment Scheduled', metadata: { probability: '0.2' } },
        { id: 'qualifiedtobuy', label: 'Qualified To Buy', metadata: { probability: '0.4' } },
        { id: 'closedwon', label: 'Closed Won', metadata: { probability: '1.0' } },
        { id: 'closedlost', label: 'Closed Lost', metadata: { probability: '0.0' } },
      ],
    },
  ];
  schemas: FakeSchema[] = [];
  objects: Record<string, FakeObject[]> = { contacts: [], companies: [], deals: [], notes: [], calls: [], emails: [], meetings: [] };
  /** Every path asked for, in order. */
  asked: string[] = [];
  /** Set to make the next matching request fail once, the way HubSpot does when it is having a bad moment. */
  failOnce: { path: string; after?: string; status: number } | undefined;
  pageSize = 100;

  add(type: string, properties: Record<string, string | null>, more: Partial<Omit<FakeObject, 'properties'>> = {}): string {
    const list = (this.objects[type] ??= []);
    const id = more.id ?? `${type.slice(0, 2)}${1000 + list.length}`;
    list.push({ id, properties, createdAt: '2024-03-05T10:00:00.000Z', ...more });
    return id;
  }

  async get(path: string, query: Record<string, string> = {}): Promise<unknown> {
    this.asked.push(path);
    if (this.failOnce && this.failOnce.path === path && (this.failOnce.after === undefined || this.failOnce.after === query.after)) {
      const { status } = this.failOnce;
      this.failOnce = undefined;
      throw new SourceError(`HubSpot answered ${status}.`, status);
    }
    if (path === '/crm/v3/owners') return this.paged(this.owners.filter((owner) => Boolean(owner.archived) === (query.archived === 'true')), query);
    if (path === '/crm/v3/schemas') return { results: this.schemas };
    const properties = path.match(/^\/crm\/v3\/properties\/([^/]+)$/);
    if (properties) {
      const type = properties[1] as string;
      const schema = this.schemas.find((item) => item.objectTypeId === type);
      return { results: schema ? schema.properties : (this.properties[type] ?? []) };
    }
    if (path === '/crm/v3/pipelines/deals') return { results: this.pipelines };
    const objects = path.match(/^\/crm\/v3\/objects\/([^/]+)$/);
    if (objects) {
      const type = objects[1] as string;
      const wanted = query.properties ? query.properties.split(',') : [];
      const linked = query.associations ? query.associations.split(',') : [];
      const all = (this.objects[type] ?? []).filter((item) => !item.archived);
      const page = this.paged(all, query);
      return {
        ...page,
        results: (page.results as FakeObject[]).map((item) => ({
          id: item.id,
          createdAt: item.createdAt,
          archived: false,
          properties: Object.fromEntries(wanted.filter((name) => name in item.properties).map((name) => [name, item.properties[name]])),
          ...(linked.some((to) => item.associations?.[to]?.length) ? { associations: Object.fromEntries(linked.filter((to) => item.associations?.[to]?.length).map((to) => [to, { results: (item.associations?.[to] ?? []).map((id) => ({ id, type: `${type}_to_${to}` })) }])) } : {}),
        })),
      };
    }
    throw new SourceError(`HubSpot has nothing at ${path}.`, 404);
  }

  private paged<T>(all: T[], query: Record<string, string>): { results: T[]; paging?: { next: { after: string } } } {
    const start = query.after ? Number(query.after) : 0;
    const size = Math.min(Number(query.limit ?? this.pageSize), this.pageSize);
    const results = all.slice(start, start + size);
    return start + size < all.length ? { results, paging: { next: { after: String(start + size) } } } : { results };
  }
}
