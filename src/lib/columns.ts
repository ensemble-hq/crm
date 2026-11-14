import type { ObjectDefinition } from '../contracts/metadata';

/**
 * Guessing which property a spreadsheet column holds. A stand-in for the model, which will read the
 * header and the values together; this only reads the header.
 */

/** Other names people give a property's column, by property id. Covers HubSpot's export headers. */
const SYNONYMS: Record<string, string[]> = {
  name: ['name', 'full name', 'contact name', 'company name', 'deal name', 'first name', 'last name'],
  email: ['email', 'e-mail', 'email address', 'e-mail address'],
  phone: ['phone', 'phone number', 'mobile', 'mobile phone', 'mobile phone number', 'tel', 'telephone'],
  jobTitle: ['title', 'job title', 'role', 'position'],
  company: ['company', 'associated company', 'organisation', 'organization', 'account'],
  domain: ['website', 'website url', 'domain', 'company domain name', 'url'],
  owner: ['owner', 'contact owner', 'company owner', 'deal owner', 'assigned to'],
  lifecycleStage: ['lifecycle stage', 'lifecycle'],
  leadStatus: ['lead status'],
  source: ['source', 'lead source', 'original source'],
  amount: ['amount', 'deal amount', 'value', 'deal value'],
  closeDate: ['close date', 'closing date', 'expected close date'],
  stage: ['stage', 'deal stage'],
  industry: ['industry'],
  size: ['employees', 'number of employees', 'company size'],
  annualRevenue: ['annual revenue', 'revenue'],
  city: ['city', 'town'],
  country: ['country', 'country/region'],
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The property a column most likely belongs to, or null when nothing fits. */
export function matchColumn(header: string, object: ObjectDefinition): string | null {
  const wanted = normalize(header);
  if (!wanted) return null;
  const candidates = object.properties.filter((property) => !property.system);
  const exact = candidates.find((property) => normalize(property.label) === wanted || normalize(property.id) === wanted);
  if (exact) return exact.id;
  const synonym = candidates.find((property) => SYNONYMS[property.id]?.includes(wanted));
  if (synonym) return synonym.id;
  const partial = candidates.find((property) => {
    const label = normalize(property.label);
    return label.length > 3 && (wanted.includes(label) || label.includes(wanted));
  });
  return partial?.id ?? null;
}
