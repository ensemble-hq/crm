import { useState } from 'react';
import { api } from '../api';
import type { CrmRecord } from '../contracts/records';
import { Modal } from '../ui/Modal';

/**
 * Turn a qualified lead into records the team works with: a contact, their company, and usually a
 * deal. An existing contact with the same email, or a company with the same name, is reused.
 */
export function ConvertLeadDialog({ lead, onClose, onConverted }: { lead: CrmRecord; onClose: () => void; onConverted: (result: { contactId: string; dealId: string | null }) => void }) {
  const company = typeof lead.properties.companyName === 'string' ? lead.properties.companyName : '';
  const [createDeal, setCreateDeal] = useState(true);
  const [dealName, setDealName] = useState(`${company || String(lead.properties.name ?? 'New')}: new deal`);
  const [amount, setAmount] = useState(typeof lead.properties.estimatedValue === 'number' ? String(lead.properties.estimatedValue) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function convert() {
    setBusy(true);
    setError(undefined);
    try {
      onConverted(await api.convertLead({ leadId: lead.id, createDeal, dealName, amount: amount === '' ? undefined : Number(amount) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The lead could not be converted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`Convert ${String(lead.properties.name ?? 'this lead')}`}
      description={`Creates a contact${company ? ` and the company “${company}”` : ''}, reusing ones that already exist. The lead is kept, marked Qualified, and linked to what it became.`}
      submitLabel="Convert"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={convert}
    >
      <label className="m-field" data-layout="inline">
        <input className="m-checkbox" type="checkbox" checked={createDeal} onChange={(event) => setCreateDeal(event.target.checked)} /> Open a deal too
      </label>
      {createDeal ? (
        <>
          <div className="m-field">
            <label className="m-field-label" htmlFor="convert-deal-name">
              Deal name
            </label>
            <input className="m-input" id="convert-deal-name" value={dealName} onChange={(event) => setDealName(event.target.value)} required />
          </div>
          <div className="m-field">
            <label className="m-field-label" htmlFor="convert-amount">
              Amount
            </label>
            <input className="m-input" id="convert-amount" type="number" min={0} value={amount} onChange={(event) => setAmount(event.target.value)} />
            <p className="m-field-hint">It starts in Qualified, closing in 45 days. Change either on the deal.</p>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
