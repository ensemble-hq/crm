import { api } from '../api';
import type { Filter, ObjectDefinition, PropertyDefinition, PropertyValue, Sort, User } from '../contracts/metadata';
import type { Reference } from '../contracts/records';
import { toCsv } from './csv';

/** The most rows one export reads. The finished product exports everything, as a background job. */
export const EXPORT_LIMIT = 5_000;
const PAGE = 200;

/** A value as a person would read it in a spreadsheet: labels and names, not ids. */
function cell(value: PropertyValue | undefined, property: PropertyDefinition, references: Record<string, Reference>, users: User[]): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => property.options?.find((option) => option.id === item)?.label ?? item).join('; ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  switch (property.type) {
    case 'select':
      return property.options?.find((option) => option.id === value)?.label ?? value;
    case 'user':
      return users.find((user) => user.id === value)?.name ?? value;
    case 'reference':
      return references[value]?.label ?? value;
    default:
      return value;
  }
}

/** Reads a view's rows page by page and saves them as a CSV file. Returns how many rows it wrote, and how many there are. */
export async function exportRecords(input: { object: ObjectDefinition; columns: string[]; filters: Filter[]; search: string; sort?: Sort; users: User[]; fileName: string }): Promise<{ exported: number; total: number }> {
  const properties = input.columns.map((id) => input.object.properties.find((property) => property.id === id)).filter((property): property is PropertyDefinition => property !== undefined);
  const rows: string[][] = [properties.map((property) => property.label)];
  let total = 0;
  for (let page = 1; (page - 1) * PAGE < EXPORT_LIMIT; page += 1) {
    const result = await api.listRecords({ objectId: input.object.id, filters: input.filters, search: input.search, sort: input.sort, page, pageSize: PAGE });
    total = result.total;
    for (const record of result.records) rows.push(properties.map((property) => cell(record.properties[property.id], property, result.references, input.users)));
    if (page * PAGE >= result.total) break;
  }
  // The byte-order mark makes Excel read the file as UTF-8.
  const url = URL.createObjectURL(new Blob([`﻿${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = input.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return { exported: rows.length - 1, total };
}
