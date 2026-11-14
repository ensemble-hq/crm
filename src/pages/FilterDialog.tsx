import { useState } from 'react';
import { useWorkspace } from '../app/workspace';
import type { Filter, FilterOperator, ObjectDefinition } from '../contracts/metadata';
import { Modal } from '../ui/Modal';
import { OPERATORS, emptyValue, isComplete, isDateType, isNumberType, operatorLabel } from '../ui/filters';

/** Add or change one filter: which property, how to compare, and against what. */
export function FilterDialog({ object, initial, onClose, onSave }: { object: ObjectDefinition; initial?: Filter; onClose: () => void; onSave: (filter: Filter) => void }) {
  const { users } = useWorkspace();
  const first = object.properties[0];
  const [filter, setFilter] = useState<Filter>(() => {
    if (initial) return initial;
    const operator = first ? (OPERATORS[first.type][0] ?? 'notEmpty') : 'notEmpty';
    return { property: first?.id ?? '', operator, value: first ? emptyValue(operator, first.type) : undefined };
  });
  const property = object.properties.find((item) => item.id === filter.property);
  const operators = property ? OPERATORS[property.type] : [];

  function pickProperty(propertyId: string) {
    const next = object.properties.find((item) => item.id === propertyId);
    if (!next) return;
    const operator = OPERATORS[next.type][0] ?? 'notEmpty';
    setFilter({ property: propertyId, operator, value: emptyValue(operator, next.type) });
  }

  function pickOperator(operator: FilterOperator) {
    if (property) setFilter({ property: property.id, operator, value: emptyValue(operator, property.type) });
  }

  const choices =
    property?.type === 'user'
      ? [{ id: '$me', label: 'Me' }, ...users.map((user) => ({ id: user.id, label: user.name }))]
      : (property?.options ?? []).map((option) => ({ id: option.id, label: option.label }));
  const chosen = Array.isArray(filter.value) ? filter.value : [];
  const range = Array.isArray(filter.value) ? filter.value : ['', ''];
  const inputType = property && isDateType(property.type) ? 'date' : property && isNumberType(property.type) ? 'number' : 'text';

  return (
    <Modal open size="sm" title={initial ? 'Change filter' : 'Add a filter'} submitLabel={initial ? 'Apply' : 'Add filter'} onClose={onClose} onSubmit={() => isComplete(filter, property) && onSave(filter)}>
      <div className="m-field">
        <label className="m-field-label" htmlFor="filter-property">
          Show {object.plural.toLowerCase()} where
        </label>
        <select className="m-select" id="filter-property" value={filter.property} onChange={(event) => pickProperty(event.target.value)}>
          {object.properties.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <div className="m-field">
        <label className="m-sr-only" htmlFor="filter-operator">
          Comparison
        </label>
        <select className="m-select" id="filter-operator" value={filter.operator} onChange={(event) => pickOperator(event.target.value as FilterOperator)}>
          {operators.map((operator) => (
            <option key={operator} value={operator}>
              {property ? operatorLabel(operator, property.type) : operator}
            </option>
          ))}
        </select>
      </div>
      {filter.operator === 'empty' || filter.operator === 'notEmpty' || !property ? null : filter.operator === 'in' ? (
        <fieldset className="m-stack" data-gap="1" style={{ border: 0, padding: 0, margin: 0, maxBlockSize: 220, overflowY: 'auto' }}>
          <legend className="m-sr-only">Values</legend>
          {choices.map((choice) => (
            <label key={choice.id} className="m-field" data-layout="inline">
              <input
                className="m-checkbox"
                type="checkbox"
                checked={chosen.includes(choice.id)}
                onChange={(event) => setFilter({ ...filter, value: event.target.checked ? [...chosen, choice.id] : chosen.filter((id) => id !== choice.id) })}
              />
              {choice.label}
            </label>
          ))}
        </fieldset>
      ) : filter.operator === 'between' ? (
        <div className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap' }}>
          <input className="m-input" type="date" aria-label="From" value={range[0] ?? ''} onChange={(event) => setFilter({ ...filter, value: [event.target.value, range[1] ?? ''] })} />
          <span>and</span>
          <input className="m-input" type="date" aria-label="To" value={range[1] ?? ''} onChange={(event) => setFilter({ ...filter, value: [range[0] ?? '', event.target.value] })} />
        </div>
      ) : property.type === 'boolean' ? (
        <select className="m-select" aria-label="Value" value={filter.value === false ? 'no' : 'yes'} onChange={(event) => setFilter({ ...filter, value: event.target.value === 'yes' })}>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      ) : property.type === 'multiselect' ? (
        <select className="m-select" aria-label="Value" value={typeof filter.value === 'string' ? filter.value : ''} onChange={(event) => setFilter({ ...filter, value: event.target.value })}>
          <option value="">Choose…</option>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="m-input"
          type={inputType}
          aria-label="Value"
          value={filter.value === null || filter.value === undefined || Array.isArray(filter.value) ? '' : String(filter.value)}
          onChange={(event) => setFilter({ ...filter, value: inputType === 'number' ? (event.target.value === '' ? null : Number(event.target.value)) : event.target.value })}
        />
      )}
    </Modal>
  );
}
