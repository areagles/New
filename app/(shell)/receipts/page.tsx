'use client';

/**
 * Receipts — money in and money out.
 *
 * Three things this list keeps visible because they change what a row means:
 *
 * Direction. IN is collected from a client, OUT is paid to a supplier or an employee. The
 * same table holds both, so the sign is stated rather than inferred from which column is
 * filled.
 *
 * Allocation. A receipt can sit unallocated against any invoice — an advance, or a payment
 * that arrived before the invoice did. That is a normal state, not an error, but it is the
 * difference between money received and a debt settled.
 *
 * Cheques. A cheque is not money until it clears, and it can bounce back out again. Its own
 * status is shown next to the payment method rather than folded into the receipt's.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { ReceiptEditor } from '@/components/receipt-editor';
import { useSession } from '@/lib/session';

type Receipt = {
  id: string;
  number: string | null;
  type: 'IN' | 'OUT';
  receiptDate: string;
  clientName: string | null;
  supplierName: string | null;
  employeeName: string | null;
  amount: number;
  currencyCode: string;
  paymentMethod: 'CASH' | 'CHEQUE' | 'TRANSFER' | 'CARD';
  chequeNumber: string | null;
  chequeStatus: 'UNDER_COLLECTION' | 'CLEARED' | 'BOUNCED' | null;
  allocatedAmount?: number;
  description: string | null;
};

const CHEQUE_STYLE: Record<NonNullable<Receipt['chequeStatus']>, string> = {
  UNDER_COLLECTION: 'ae-badge-warn',
  CLEARED: 'ae-badge-success',
  BOUNCED: 'ae-badge-danger',
};

export default function ReceiptsPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'' | 'IN' | 'OUT'>('');

  const money = useCallback(
    (v: number, currency = 'EGP') =>
      new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
        style: 'currency', currency, maximumFractionDigits: 0,
      }).format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api<Receipt[] | { items?: Receipt[] }>('/receipts');
      setItems(Array.isArray(res) ? res : res.items ?? []);
    } catch (err) {
      setFailed(err instanceof ApiError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const party = (r: Receipt) => r.clientName ?? r.supplierName ?? r.employeeName ?? '—';

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((r) => {
      if (type && r.type !== type) return false;
      if (!q) return true;
      return [r.number, party(r)].some((f) => f?.toLowerCase().includes(q));
    });
  }, [items, query, type]);

  // A bounced cheque never became money, so it is left out of both totals.
  const counted = shown.filter((r) => r.chequeStatus !== 'BOUNCED');
  const totalIn = counted.filter((r) => r.type === 'IN').reduce((s, r) => s + r.amount, 0);
  const totalOut = counted.filter((r) => r.type === 'OUT').reduce((s, r) => s + r.amount, 0);

  return (
    <div className="ae-page">
      <PageHero
        title={t('receipts.title')}
        actions={
          can('finance.receipts.manage') && !creating ? (
            <button type="button" className="ae-btn-primary" onClick={() => setCreating(true)}>
              {t('receipts.new')}
            </button>
          ) : undefined
        }
      />

      {creating && (
        <ReceiptEditor
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); void load(); }}
        />
      )}

      {failed && <p className="ae-flash ae-flash--error mb-4">{t('receipts.loadFailed')}</p>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="ae-stat-card p-4">
          <p className="ae-stat-label">{t('receipts.type.IN')}</p>
          <p className="ae-stat-value ae-stat-value--success">{money(totalIn)}</p>
        </div>
        <div className="ae-stat-card p-4">
          <p className="ae-stat-label">{t('receipts.type.OUT')}</p>
          <p className="ae-stat-value">{money(totalOut)}</p>
        </div>
      </div>

      <Panel
        actions={
          <div className="ae-toolbar">
            <div className="ae-tab-pills">
              {(['', 'IN', 'OUT'] as const).map((v) => (
                <button key={v || 'all'} type="button" onClick={() => setType(v)}
                  className={`ae-tab-pill ${type === v ? 'is-active' : ''}`}>
                  {v ? t(`receipts.type.${v}`) : t('common.all')}
                </button>
              ))}
            </div>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t('receipts.search')} className="ae-input" />
          </div>
        }
      >
        {loading ? (
          <Skeleton rows={6} />
        ) : shown.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            {items.length === 0 ? t('receipts.noRecords') : t('common.noResults')}
          </p>
        ) : (
          <div className="ae-table-wrap">
            <table className="ae-table ae-table--rows">
              <thead>
                <tr>
                  <th>{t('receipts.type')}</th>
                  <th>{t('invoices.number')}</th>
                  <th>{t('receipts.party')}</th>
                  <th>{t('receipts.date')}</th>
                  <th>{t('receipts.amount')}</th>
                  <th>{t('receipts.paymentMethod')}</th>
                  <th>{t('receipts.allocationStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const allocated = r.allocatedAmount ?? 0;
                  const allocationKey =
                    allocated <= 0 ? 'notAllocated'
                      : allocated + 0.005 < r.amount ? 'partiallyAllocated'
                        : 'fullyAllocated';
                  return (
                    <tr key={r.id} className={r.chequeStatus === 'BOUNCED' ? 'opacity-60' : undefined}>
                      <td>
                        <span className={`ae-badge ${r.type === 'IN' ? 'ae-badge-success' : 'ae-badge-info'}`}>
                          {t(`receipts.type.${r.type}`)}
                        </span>
                      </td>
                      <td dir="ltr">{r.number ?? '—'}</td>
                      <td>
                        {party(r)}
                        {r.description && (
                          <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{r.description}</span>
                        )}
                      </td>
                      <td dir="ltr">{r.receiptDate}</td>
                      <td>{money(r.amount, r.currencyCode)}</td>
                      <td>
                        {t(`receipts.paymentMethod.${r.paymentMethod}`)}
                        {r.paymentMethod === 'CHEQUE' && r.chequeStatus && (
                          <span className={`ae-badge ${CHEQUE_STYLE[r.chequeStatus]} mt-1 block w-fit`}>
                            {t(`receipts.cheque.status.${r.chequeStatus}`)}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`ae-badge ${
                          allocationKey === 'fullyAllocated' ? 'ae-badge-success'
                            : allocationKey === 'partiallyAllocated' ? 'ae-badge-warn'
                              : 'ae-badge-muted'}`}>
                          {t(`receipts.${allocationKey}`)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
