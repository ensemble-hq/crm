import { useState } from 'react';
import { api, useQuery } from '../api';
import type { ObjectDefinition, PropertyValue as Value } from '../contracts/metadata';
import { Modal } from '../ui/Modal';
import { PropertyValue } from '../ui/PropertyValue';
import { small } from '../ui/styles';

function isEmpty(value: Value | undefined): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * Merge two records into one. Where they agree there is nothing to decide; where they differ you
 * pick which value survives (a filled-in value is preferred over an empty one to start with).
 * Tasks, deals and anything else linked to the removed record move to the kept one, with its activity.
 */
export function MergeDialog({ object, ids, onClose, onDone }: { object: ObjectDefinition; ids: [string, string]; onClose: () => void; onDone: (message: string) => void }) {
  const pair = useQuery(() => Promise.all([api.getRecord(ids[0]), api.getRecord(ids[1])]), [ids[0], ids[1]]);
  const [keepFirst, setKeepFirst] = useState(true);
  const [picks, setPicks] = useState<Record<string, 0 | 1>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const records = pair.data?.map((detail) => detail.record);
  const references = { ...pair.data?.[0].references, ...pair.data?.[1].references };
  const name = (index: 0 | 1) => String(records?.[index]?.properties[object.primaryProperty] ?? 'Record');
  const differing = records ? object.properties.filter((property) => !property.system && JSON.stringify(records[0]?.properties[property.id] ?? null) !== JSON.stringify(records[1]?.properties[property.id] ?? null)) : [];
  const keepIndex: 0 | 1 = keepFirst ? 0 : 1;
  // Until the user chooses, take the kept record's value, unless it is empty and the other's is not.
  const pickFor = (propertyId: string): 0 | 1 => {
    if (picks[propertyId] !== undefined) return picks[propertyId] as 0 | 1;
    const other: 0 | 1 = keepIndex === 0 ? 1 : 0;
    return isEmpty(records?.[keepIndex]?.properties[propertyId]) && !isEmpty(records?.[other]?.properties[propertyId]) ? other : keepIndex;
  };

  async function merge() {
    if (!records) return;
    setBusy(true);
    setError(undefined);
    try {
      const properties: Record<string, Value> = {};
      for (const property of differing) properties[property.id] = records[pickFor(property.id)]?.properties[property.id] ?? null;
      await api.mergeRecords({ keepId: ids[keepIndex], mergeId: ids[keepIndex === 0 ? 1 : 0], properties });
      onDone(`Merged “${name(keepIndex === 0 ? 1 : 0)}” into “${name(keepIndex)}”.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The records could not be merged.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open size="lg" title={`Merge two ${object.plural.toLowerCase()}`} description="One record is kept and the other is folded into it. Anything linked to the other record, and its activity, moves across. This can't be undone." submitLabel="Merge" busy={busy} error={error} onClose={onClose} onSubmit={merge}>
      {!records ? (
        <span className="m-spinner" role="status" aria-label="Loading the two records" />
      ) : (
        <>
          <fieldset className="m-stack" data-gap="1" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="m-field-label">Keep</legend>
            {([0, 1] as const).map((index) => (
              <label key={index} className="m-field" data-layout="inline">
                <input className="m-radio" type="radio" name="merge-keep" checked={keepIndex === index} onChange={() => setKeepFirst(index === 0)} />
                {name(index)}
                <span style={small}>created {records[index]?.createdAt.slice(0, 10)}</span>
              </label>
            ))}
          </fieldset>
          {differing.length === 0 ? (
            <p style={{ ...small, margin: 0 }}>The two records hold the same values, so there is nothing to choose.</p>
          ) : (
            <div className="m-table-wrap">
              <table className="m-table">
                <thead>
                  <tr>
                    <th scope="col">Where they differ</th>
                    <th scope="col">{name(0)}</th>
                    <th scope="col">{name(1)}</th>
                  </tr>
                </thead>
                <tbody>
                  {differing.map((property) => (
                    <tr key={property.id}>
                      <th scope="row" style={{ fontWeight: 'var(--m-font-weight-regular)', color: 'var(--m-color-fg-muted)' }}>
                        {property.label}
                      </th>
                      {([0, 1] as const).map((index) => (
                        <td key={index}>
                          <label className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap' }}>
                            <input className="m-radio" type="radio" name={`merge-${property.id}`} checked={pickFor(property.id) === index} onChange={() => setPicks((previous) => ({ ...previous, [property.id]: index }))} aria-label={`Use ${name(index)}'s ${property.label}`} />
                            <PropertyValue property={property} value={records[index]?.properties[property.id]} references={references} />
                          </label>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
