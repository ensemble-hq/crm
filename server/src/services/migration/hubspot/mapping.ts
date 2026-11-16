import type { ObjectDefinition, Option, PropertyDefinition, PropertyType, PropertyValue } from '../../../../../src/contracts/metadata';

/**
 * What HubSpot's own fields mean here. HubSpot's standard fields are mapped to the properties the
 * template already has; an account's custom fields are discovered by the `fields` step and become
 * properties of their own. Nothing in this file is particular to one account.
 */

/** One CRM property and the HubSpot field or fields that fill it. With `join`, the fields are put together with a space; otherwise the first that has a value is used. */
export type Standard = { to: string; from: string[]; join?: boolean };

export const STANDARD: Record<string, Standard[]> = {
  contacts: [
    { to: 'name', from: ['firstname', 'lastname'], join: true },
    { to: 'email', from: ['email'] },
    { to: 'phone', from: ['phone', 'mobilephone'] },
    { to: 'jobTitle', from: ['jobtitle'] },
    { to: 'city', from: ['city'] },
    { to: 'country', from: ['country'] },
    { to: 'lifecycleStage', from: ['lifecyclestage'] },
    { to: 'leadStatus', from: ['hs_lead_status'] },
    { to: 'owner', from: ['hubspot_owner_id'] },
  ],
  companies: [
    { to: 'name', from: ['name'] },
    { to: 'domain', from: ['domain', 'website'] },
    { to: 'industry', from: ['industry'] },
    { to: 'annualRevenue', from: ['annualrevenue'] },
    { to: 'city', from: ['city'] },
    { to: 'country', from: ['country'] },
    { to: 'type', from: ['type'] },
    { to: 'owner', from: ['hubspot_owner_id'] },
  ],
  deals: [
    { to: 'name', from: ['dealname'] },
    { to: 'amount', from: ['amount'] },
    { to: 'stage', from: ['dealstage'] },
    { to: 'closeDate', from: ['closedate'] },
    { to: 'priority', from: ['hs_priority'] },
    { to: 'owner', from: ['hubspot_owner_id'] },
  ],
};

/** HubSpot's standard fields that have no property in the template and are worth having: they become properties like a custom field does. */
export const ALSO_BRING: Record<string, string[]> = {
  companies: ['numberofemployees', 'description', 'phone', 'linkedin_company_page'],
  contacts: ['linkedinbio', 'hs_linkedin_url', 'address', 'zip', 'state'],
  deals: ['description', 'dealtype'],
};

/** Choices that mean the same thing under another name. Keyed by `<object>.<property>`. */
export const SAME_CHOICE: Record<string, Record<string, string>> = {
  'contacts.lifecycleStage': { marketingqualifiedlead: 'mql', salesqualifiedlead: 'sql' },
};

/** Fields whose choices another step looks after, or that are not choices here at all. */
export const NOT_CHOICES = new Set(['dealstage', 'pipeline', 'hubspot_owner_id']);

/** HubSpot object type ids for its own objects, as they appear in a custom object's associations. */
export const TYPE_IDS: Record<string, { type: string; property: string }> = {
  '0-1': { type: 'contacts', property: 'contact' },
  '0-2': { type: 'companies', property: 'company' },
  '0-3': { type: 'deals', property: 'deal' },
};

export type HubSpotProperty = {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  options?: Array<{ label: string; value: string; hidden?: boolean }>;
  hubspotDefined?: boolean;
  calculated?: boolean;
  archived?: boolean;
  hidden?: boolean;
};

/** The kind of property a HubSpot field becomes. Undefined for kinds with nothing to become. */
export function typeFor(property: HubSpotProperty): PropertyType | undefined {
  switch (property.type) {
    case 'string':
      return property.fieldType === 'phonenumber' ? 'phone' : 'text';
    case 'phone_number':
      return 'phone';
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'bool':
      return 'boolean';
    case 'enumeration':
      return property.fieldType === 'checkbox' ? 'multiselect' : property.fieldType === 'booleancheckbox' ? 'boolean' : 'select';
    default:
      return undefined;
  }
}

/** "Renewal date" becomes `renewal-date`: how the CRM makes an object's id from its name. */
export const slug = (text: string) => text.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join('-');

/** HubSpot writes dates as ISO text or as milliseconds since 1970. */
function instant(raw: string): Date | undefined {
  const date = /^\d{9,}$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export type Lookups = {
  /** HubSpot owner id to member id. */
  owners: Map<string, string>;
  /** For a choice property: HubSpot's value to the option's id. Calls `add` for a value with no option yet. */
  option(property: PropertyDefinition, raw: string): string;
};

/**
 * Turns HubSpot's text for a field into what a property holds. `undefined` means it could not be
 * understood; `null` means there is nothing to set (an owner who was not brought across).
 */
export function coerce(raw: string, property: PropertyDefinition, lookups: Lookups): PropertyValue | undefined {
  const value = raw.trim();
  switch (property.type) {
    case 'number':
    case 'currency': {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : instant(value)?.toISOString().slice(0, 10);
    case 'datetime':
      return instant(value)?.toISOString();
    case 'boolean':
      return value.toLowerCase() === 'true';
    case 'select':
      return lookups.option(property, value);
    case 'multiselect':
      return value.split(';').map((item) => item.trim()).filter(Boolean).map((item) => lookups.option(property, item));
    case 'user':
      return lookups.owners.get(value) ?? null;
    case 'reference':
      return null;
    default:
      return value;
  }
}

/** The option of a property that a HubSpot value plainly is: the same id, or the same words. */
export function sameOption(options: Option[] | undefined, value: string, label?: string): Option | undefined {
  const wanted = [value, label].filter((item): item is string => Boolean(item)).map((item) => item.trim().toLowerCase());
  return options?.find((option) => wanted.includes(option.id.toLowerCase()) || wanted.includes(option.label.trim().toLowerCase()));
}

export const propertyOf = (object: ObjectDefinition, propertyId: string) => object.properties.find((item) => item.id === propertyId);

/** Text from HubSpot's rich text: tags out, entities back to characters. */
export function plain(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<\s*(br|\/p|\/div|\/li)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
