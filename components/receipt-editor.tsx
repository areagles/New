'use client';

/**
 * Registering a receipt.
 *
 * The API constrains which combinations are legal, and the form follows the same rules so a
 * person cannot assemble something it will refuse:
 *
 *   a credit note is always money in, a debit note always out, and a refund is money out but
 *   goes back to a *client*, not a supplier — so the party selector switches sides for it.
 *
 * Allocation is deliberately not offered here. Left alone, the server applies the receipt to
 * that party's open invoices in the same currency by itself, which is right almost every time;
 * splitting one payment across specific invoices by hand is a different, rarer job than
 * recording that money arrived.
 *
 * Payment method is part of this. A cheque is not money yet: the API stamps one
 * UNDER_COLLECTION on creation, and only clearing it later makes it real — which is why the
 * bank, number and due date are asked for here and nowhere else. Everything else settles
 * immediately and carries none of those fields, so they appear only for a cheque.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { selectableParties } from '@/lib/parties';
import { Panel } from '@/components/page';

type Party = { id: string; name: string; isActive: boolean };
type Currency = { code: string; label: string; isActive: boolean };

type Kind = 'PAYMENT' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'REFUND';
type Method = 'CASH' | 'CHEQUE' | 'TRANSFER' | 'CARD';

/** Which direction each kind is allowed to be, per the API's own checks. */
const KIND_DIRECTION: Record<Kind, 'IN' | 'OUT' | null> = {
  PAYMENT: null,        // either
  CREDIT_NOTE: 'IN',
  DEBIT_NOTE: 'OUT',
  REFUND: 'OUT',
};

const ERROR_KEY: Record<string, string> = {
  client_required: 'receipts.selectClient',
  supplier_required: 'receipts.selectSupplier',
  refund_exceeds_available_credit: 'party.refund.exceedsAvailable',
};

export function ReceiptEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();

  const [clients, setClients] = useState<Party[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);

  const [type, setType] = useState<'IN' | 'OUT'>('IN');
  const [kind, setKind] = useState<Kind>('PAYMENT');
  const [partyId, setPartyId] = useState('');
  const [amount, setAmount] = useState('');
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [currencyCode, setCurrencyCode] = useState('EGP');
  const [paymentMethod, setPaymentMethod] = useState<Method>('CASH');
  const [cheque, setCheque] = useState({ number: '', bankName: '', accountNumber: '', dueDate: '' });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [c, s, cur] = await Promise.all([
          api<Party[]>('/clients'),
          api<Party[]>('/suppliers'),
          api<Currency[]>('/currencies'),
        ]);
        setClients((Array.isArray(c) ? c : []).filter((x) => x.isActive));
        setSuppliers((Array.isArray(s) ? s : []).filter((x) => x.isActive));
        setCurrencies((Array.isArray(cur) ? cur : []).filter((x) => x.isActive));
      } catch {
        setError('receipts.loadFailed');
      }
    })();
  }, []);

  /** A refund is money out, but it goes back to the client who overpaid. */
  const wantsClient = type === 'IN' || kind === 'REFUND';
  const parties = wantsClient ? clients : suppliers;

  const chooseKind = useCallback((next: Kind) => {
    setKind(next);
    const forced = KIND_DIRECTION[next];
    if (forced && forced !== type) {
      setType(forced);
      setPartyId('');
    } else if (next === 'REFUND' || (next === 'PAYMENT' && kind === 'REFUND')) {
      // The party list is about to switch sides.
      setPartyId('');
    }
  }, [type, kind]);

  const chooseType = useCallback((next: 'IN' | 'OUT') => {
    setType(next);
    setPartyId('');
    // Drop a kind that cannot exist in this direction.
    const forced = KIND_DIRECTION[kind];
    if (forced && forced !== next) setKind('PAYMENT');
  }, [kind]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/receipts', {
        method: 'POST',
        body: {
          type,
          receiptKind: kind,
          amount: Number(amount),
          receiptDate,
          currencyCode,
          paymentMethod,
          // Only a cheque carries these, and the API ignores them for anything else.
          ...(paymentMethod === 'CHEQUE' ? {
            chequeNumber: cheque.number.trim() || null,
            chequeBankName: cheque.bankName.trim() || null,
            chequeAccountNumber: cheque.accountNumber.trim() || null,
            chequeDueDate: cheque.dueDate || null,
          } : {}),
          ...(wantsClient ? { clientId: partyId } : { supplierId: partyId }),
        },
      });
      onSaved();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(ERROR_KEY[code] ?? 'receipts.saveFailed');
    } finally {
      setBusy(false);
    }
  }

  const ready = partyId !== '' && Number(amount) > 0;

  return (
    <Panel title={t('receipts.new')} className="ae-form-panel mb-4">
      {error && <p className="ae-flash ae-flash--error mb-3">{t(error)}</p>}

      <form onSubmit={save}>
        <div className="mb-4">
          <span className="mb-1 block text-sm font-bold">{t('receipts.type')}</span>
          <div className="ae-tab-pills">
            {(['IN', 'OUT'] as const).map((v) => (
              <button key={v} type="button" onClick={() => chooseType(v)}
                className={`ae-tab-pill ${type === v ? 'is-active' : ''}`}>
                {t(`receipts.type.${v}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('receipts.kind')}</span>
            <select value={kind} onChange={(e) => chooseKind(e.target.value as Kind)} className="ae-input w-full">
              {(Object.keys(KIND_DIRECTION) as Kind[])
                // Only kinds that can exist in the chosen direction.
                .filter((k) => KIND_DIRECTION[k] === null || KIND_DIRECTION[k] === type)
                .map((k) => <option key={k} value={k}>{t(`receipts.kind.${k}`)}</option>)}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-bold">
              {t(wantsClient ? 'receipts.client' : 'receipts.supplier')}
            </span>
            <select value={partyId} onChange={(e) => setPartyId(e.target.value)} required className="ae-input w-full">
              <option value="">{t(wantsClient ? 'receipts.selectClient' : 'receipts.selectSupplier')}</option>
              {selectableParties(parties, partyId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('receipts.amount')}</span>
            <input type="number" min="0" step="0.01" inputMode="decimal" required
              value={amount} onChange={(e) => setAmount(e.target.value)} className="ae-input w-full" />
            <span className="mt-1 block text-xs text-[var(--text-muted)]">
              {t('receipts.amountDecimalHint')}
            </span>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('receipts.date')}</span>
            <input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)}
              className="ae-input w-full" />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('invoices.currency')}</span>
            <select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} className="ae-input w-full">
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-4">
          <span className="mb-1 block text-sm font-bold">{t('receipts.paymentMethod')}</span>
          <div className="ae-tab-pills">
            {(['CASH', 'CHEQUE', 'TRANSFER', 'CARD'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setPaymentMethod(m)}
                className={`ae-tab-pill ${paymentMethod === m ? 'is-active' : ''}`}>
                {t(`receipts.paymentMethod.${m}`)}
              </button>
            ))}
          </div>
        </div>

        {/* A cheque is the one method that is not settled on the day it is recorded. */}
        {paymentMethod === 'CHEQUE' && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ['number', 'receipts.cheque.number', 'text'],
              ['bankName', 'receipts.cheque.bankName', 'text'],
              ['accountNumber', 'receipts.cheque.accountNumber', 'text'],
              ['dueDate', 'receipts.cheque.dueDate', 'date'],
            ] as const).map(([field, label, type]) => (
              <label key={field} className="text-sm">
                <span className="mb-1 block font-bold">{t(label)}</span>
                <input type={type} value={cheque[field]} dir={type === 'text' ? 'ltr' : undefined}
                  onChange={(e) => setCheque({ ...cheque, [field]: e.target.value })} className="ae-input" />
              </label>
            ))}
          </div>
        )}

        <p className="ae-alert-pill ae-alert-pill--info mt-4 inline-block text-xs">
          {t(wantsClient ? 'receipts.autoAllocateHint' : 'receipts.autoAllocateHintSupplier')}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="submit" disabled={busy || !ready} className="ae-btn-primary">
            {busy ? t('common.saving') : t('receipts.register')}
          </button>
          <button type="button" className="ae-btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Panel>
  );
}
