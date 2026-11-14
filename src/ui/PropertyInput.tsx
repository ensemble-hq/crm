import { useWorkspace } from '../app/workspace';
import type { PropertyDefinition, PropertyValue } from '../contracts/metadata';

const INPUT_TYPES: Partial<Record<PropertyDefinition['type'], string>> = {
  email: 'email',
  phone: 'tel',
  number: 'number',
  currency: 'number',
  date: 'date',
  datetime: 'datetime-local',
};

/** The form control for one property, chosen by its type. Forms are built from definitions with this. */
export function PropertyInput({
  id,
  property,
  value,
  onChange,
  required = false,
}: {
  id: string;
  property: PropertyDefinition;
  value: PropertyValue | undefined;
  onChange: (value: PropertyValue) => void;
  required?: boolean;
}) {
  const { users } = useWorkspace();

  if (property.type === 'select' || property.type === 'user') {
    const options = property.type === 'user' ? users.map((user) => ({ id: user.id, label: user.name })) : (property.options ?? []);
    return (
      <select className="m-select" id={id} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value || null)} required={required}>
        <option value="">{property.type === 'user' ? 'No owner' : 'Choose…'}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (property.type === 'boolean') {
    return <input className="m-checkbox" id={id} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />;
  }

  const numeric = property.type === 'number' || property.type === 'currency';
  return (
    <input
      className="m-input"
      id={id}
      type={INPUT_TYPES[property.type] ?? 'text'}
      value={value === null || value === undefined || Array.isArray(value) ? '' : String(value)}
      onChange={(event) => {
        const text = event.target.value;
        if (text === '') onChange(null);
        else onChange(numeric ? Number(text) : text);
      }}
      required={required}
    />
  );
}
