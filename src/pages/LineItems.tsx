import { Plus, Trash2 } from 'lucide-react';
import { type CSSProperties, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useQuery } from '../api';
import { useWorkspace } from '../app/workspace';
import type { CrmRecord } from '../contracts/records';
import type { LineItem } from '../contracts/sales';
import { RecordPicker } from '../ui/RecordPicker';
import { ICON, cardTitle, currency, medium, small } from '../ui/styles';

function total(item: LineItem): number {
  return item.quantity * item.unitPrice * (1 - item.discountPercent / 100);
}

/**
 * What a deal is made of: products from the library, each with a quantity, a price and a discount.
 * Saving can set the deal's amount to the total, so the two never drift apart.
 */
export function LineItems({ deal, onSaved }: { deal: CrmRecord; onSaved: () => void }) {
  const { revision } = useWorkspace();
  const saved = useQuery(() => api.listLineItems(deal.id), [deal.id, revision]);
  const [items, setItems] = useState<LineItem[]>();
  const [adding, setAdding] = useState(false);
  const [setAmount, setSetAmount] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // A different deal starts from its own saved items.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the deal changes
  useEffect(() => {
    setItems(undefined);
    setAdding(false);
  }, [deal.id]);

  const rows = items ?? saved.data ?? [];
  const sum = rows.reduce((value, item) => value + total(item), 0);
  const amount = typeof deal.properties.amount === 'number' ? deal.properties.amount : undefined;
  const change = (id: string, changes: Partial<LineItem>) => setItems(rows.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  async function addProduct(productId: string | null) {
    if (!productId) return;
    const { record } = await api.getRecord(productId);
    setItems([...rows, { id: `li_${Date.now().toString(36)}`, productId, name: String(record.properties.name ?? 'Product'), quantity: 1, unitPrice: typeof record.properties.price === 'number' ? record.properties.price : 0, discountPercent: 0 }]);
    setAdding(false);
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await api.saveLineItems({ dealId: deal.id, items: rows, setAmount });
      setItems(undefined);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The line items could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="m-card" aria-label="Line items" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="m-cluster" data-justify="between" style={{ padding: 'var(--m-space-3) var(--m-space-4)' }}>
        <h2 style={cardTitle}>
          Line items <span style={{ ...small, fontVariantNumeric: 'tabular-nums' }}>{rows.length > 0 ? currency(Math.round(sum)) : ''}</span>
        </h2>
        <span className="m-cluster" data-gap="3">
          <Link to="/products" style={{ ...small, textDecoration: 'none' }}>
            Product library
          </Link>
          <button type="button" className="m-button" data-size="sm" onClick={() => setAdding(true)}>
            <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Product
          </button>
        </span>
      </div>
      {rows.length > 0 ? (
        <div className="m-table-wrap" style={{ '--m-table-wrap-shadow': 'none', '--m-table-wrap-radius': '0' } as CSSProperties}>
          <table className="m-table">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" style={{ inlineSize: 88 }}>
                  Quantity
                </th>
                <th scope="col" style={{ inlineSize: 120 }}>
                  Unit price
                </th>
                <th scope="col" style={{ inlineSize: 96 }}>
                  Discount %
                </th>
                <th scope="col" data-numeric="">
                  Total
                </th>
                <th scope="col" style={{ inlineSize: 40 }}>
                  <span className="m-sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id}>
                  <td style={medium}>{item.name}</td>
                  <td>
                    <input className="m-input" data-size="sm" type="number" min={0} aria-label={`Quantity of ${item.name}`} value={item.quantity} onChange={(event) => change(item.id, { quantity: Math.max(0, Number(event.target.value) || 0) })} />
                  </td>
                  <td>
                    <input className="m-input" data-size="sm" type="number" min={0} aria-label={`Unit price of ${item.name}`} value={item.unitPrice} onChange={(event) => change(item.id, { unitPrice: Math.max(0, Number(event.target.value) || 0) })} />
                  </td>
                  <td>
                    <input className="m-input" data-size="sm" type="number" min={0} max={100} aria-label={`Discount on ${item.name}`} value={item.discountPercent} onChange={(event) => change(item.id, { discountPercent: Math.min(100, Math.max(0, Number(event.target.value) || 0)) })} />
                  </td>
                  <td data-numeric="">{currency(Math.round(total(item)))}</td>
                  <td>
                    <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Remove ${item.name}`} onClick={() => setItems(rows.filter((row) => row.id !== item.id))}>
                      <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !adding ? (
        <p style={{ ...small, margin: 0, padding: '0 var(--m-space-4) var(--m-space-3)' }}>None yet. The amount on this deal was entered by hand.</p>
      ) : null}
      {adding ? (
        <div style={{ padding: 'var(--m-space-2) var(--m-space-4) var(--m-space-3)', maxInlineSize: 360 }}>
          <label className="m-sr-only" htmlFor="line-item-product">
            Product to add
          </label>
          <RecordPicker id="line-item-product" objectId="products" value={null} browse onChange={(productId) => void addProduct(productId)} />
        </div>
      ) : null}
      {items ? (
        <div className="m-cluster" data-justify="between" data-gap="3" style={{ padding: 'var(--m-space-3) var(--m-space-4)', borderBlockStart: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
          <label className="m-field" data-layout="inline">
            <input className="m-checkbox" type="checkbox" checked={setAmount} onChange={(event) => setSetAmount(event.target.checked)} />
            Set the deal amount to {currency(Math.round(sum))}
            {amount !== undefined && Math.round(sum) !== amount ? <span style={small}>(now {currency(amount)})</span> : null}
          </label>
          <span className="m-cluster" data-gap="2">
            {error ? (
              <span className="m-field-error" role="alert">
                {error}
              </span>
            ) : null}
            <button type="button" className="m-button" data-size="sm" onClick={() => setItems(undefined)}>
              Discard
            </button>
            <button type="button" className="m-button" data-variant="primary" data-size="sm" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save line items'}
            </button>
          </span>
        </div>
      ) : null}
    </section>
  );
}
