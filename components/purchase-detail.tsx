'use client';

/**
 * One supplier invoice, on its own URL.
 *
 * Addressed as `/purchases/?id=…`, the same convention the rest of the system uses for a
 * single record and the only form a static export can serve.
 *
 * The number is worth reading carefully: it is *ours*, not the supplier's. The API issues
 * `PUR-YYYY-NNNN` the moment the document leaves draft, which is why a draft has none.
 *
 * Cancelling voids the journal entry and re-syncs inventory rather than deleting anything, so
 * a cancelled purchase stays visible as history. It is withheld once money has been paid,
 * which the API refuses anyway.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { PurchaseEditor } from '@/components/purchase-editor';
import { useSession } from '@/lib/session';

type Line = {
  id: string;
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  lineTotal: number;
};

type Purchase = {
  id: string;
  number: string | null;
  supplierId: string;
  supplierName: string | null;
  supplierPhone: string | null;
  supplierTaxId: string | null;
  purchaseDate: string;
  dueDate: string;
  currencyCode: string;
  subTotal: number;
  taxTotal: number;
  withholdingAmount: number;
  withholdingRate: number | null;
  withholdingCategory: string | null;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: 'DRAFT' | 'DEFERRED' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  taxMode: 'TAX' | 'NORMAL';
  notes: string | null;
  updatedAt: string;
  lines?: Line[];
};

const STATUS_STYLE: Record<Purchase['status'], string> = {
  DRAFT: 'ae-badge-muted',
  DEFERRED: 'ae-badge-warn',
  PARTIAL: 'ae-badge-info',
  PAID: 'ae-badge-success',
  CANCELLED: 'ae-badge-danger',
};

export function PurchaseDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, lang } = useI18n();
  const { can } = useSession();
  const [reloadKey, setReloadKey] = useState(0);
  const [pur, setPur] = useState<Purchase | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const money = useCallback(
    (v: number, currency = 'EGP') =>
      new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
        style: 'currency', currency, maximumFractionDigits: 2,
      }).format(v),
    [lang],
  );

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await api<{ purchase?: Purchase } | Purchase>(`/purchases/${id}`);
        setPur(('purchase' in res ? res.purchase : res) as Purchase);
      } catch (err) {
        setFailed(err instanceof ApiError);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, reloadKey]);

  async function cancelPurchase() {
    if (!pur || !window.confirm(t('purchases.confirmCancel'))) return;
    setCancelling(true);
    setActionError(null);
    try {
      await api(`/purchases/${pur.id}`, {
        method: 'PATCH',
        body: { status: 'CANCELLED', expectedUpdatedAt: pur.updatedAt },
      });
      setReloadKey((k) => k + 1);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setActionError(
        code === 'conflict_stale_data' ? 'common.conflictStaleData'
          : code === 'purchase_has_payments' ? 'returns.error.purchase_has_payments'
            : 'common.error',
      );
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <div className="ae-page">
        <PageHero title={t('purchases.title')} />
        <Panel><Skeleton rows={6} /></Panel>
      </div>
    );
  }

  if (failed || !pur) {
    return (
      <div className="ae-page">
        <PageHero
          title={t('purchases.title')}
          actions={<button type="button" className="ae-btn-ghost" onClick={onBack}>{t('common.close')}</button>}
        />
        <p className="ae-flash ae-flash--error">{t('purchases.loadFailed')}</p>
      </div>
    );
  }

  const title = pur.number ?? t('purchases.noNumber');

  if (editing) {
    return (
      <div className="ae-page">
        <PageHero title={title} />
        <PurchaseEditor
          purchase={pur}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); setReloadKey((k) => k + 1); }}
        />
      </div>
    );
  }

  const manage = can('finance.purchases.manage');
  const cancelled = pur.status === 'CANCELLED';
  const canCancel = manage && !cancelled && pur.paidAmount <= 0;

  const cur = pur.currencyCode;
  const fact = (label: string, value: React.ReactNode) => (
    <div>
      <p className="ae-stat-label">{label}</p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );

  return (
    <div className="ae-page">
      <PageHero
        title={title}
        actions={
          <div className="flex flex-wrap gap-2">
            {manage && !cancelled && (
              <button type="button" className="ae-btn-primary" onClick={() => setEditing(true)}>
                {t('common.edit')}
              </button>
            )}
            {canCancel && (
              <button type="button" className="ae-btn-secondary" disabled={cancelling}
                onClick={() => void cancelPurchase()}>
                {t('audit.action.purchase_cancelled')}
              </button>
            )}
            <button type="button" className="ae-btn-ghost" onClick={onBack}>{t('common.close')}</button>
          </div>
        }
      />

      {actionError && <p className="ae-flash ae-flash--error mb-4">{t(actionError)}</p>}
      {/* No banner for a cancelled purchase: the only wording the system has for this is the
          status word itself, which the badge below already carries — and the actions
          disappearing says the rest. */}

      <Panel className="ae-form-panel mb-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {fact(t('purchases.supplier'), pur.supplierName ?? '—')}
          {fact(t('purchases.date'), <span dir="ltr">{pur.purchaseDate}</span>)}
          {fact(t('purchases.dueDate'), <span dir="ltr">{pur.dueDate}</span>)}
          {fact(t('purchases.taxMode'), t(`purchases.taxMode.${pur.taxMode}`))}
          {fact(
            t('purchases.status'),
            <span className={`ae-badge ${STATUS_STYLE[pur.status]}`}>{t(`purchases.status.${pur.status}`)}</span>,
          )}
          {fact(t('invoices.currency'), <span dir="ltr">{cur}</span>)}
          {pur.supplierTaxId && fact(t('party.taxId'), <span dir="ltr">{pur.supplierTaxId}</span>)}
          {pur.supplierPhone && fact(t('party.phone'), <span dir="ltr">{pur.supplierPhone}</span>)}
          {/* Only meaningful once something was actually withheld. */}
          {pur.withholdingAmount > 0 && pur.withholdingCategory && fact(
            t('purchases.withholdingCategory'),
            t(`settings.withholding.${pur.withholdingCategory}`, pur.withholdingCategory),
          )}
        </div>
      </Panel>

      <Panel title={t('purchases.lines')} className="mb-4">
        <div className="ae-table-wrap">
          <table className="ae-table ae-table--rows">
            <thead>
              <tr>
                <th>{t('invoices.description')}</th>
                <th>{t('invoices.quantity')}</th>
                <th>{t('pricing.unitPrice')}</th>
                <th>{t('invoices.lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {(pur.lines ?? []).map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td>{l.quantity}{l.unit ? ` ${l.unit}` : ''}</td>
                  <td>{money(l.unitPrice, cur)}</td>
                  <td>{money(l.lineTotal, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-2 text-sm sm:ms-auto sm:w-72">
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">{t('invoices.subTotal')}</span>
            <span>{money(pur.subTotal, cur)}</span>
          </div>
          {pur.taxTotal !== 0 && (
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">{t('invoices.tax')}</span>
              <span>{money(pur.taxTotal, cur)}</span>
            </div>
          )}
          {pur.withholdingAmount > 0 && (
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">
                {t('purchases.withholding')}
                {pur.withholdingRate ? ` · ${pur.withholdingRate}%` : ''}
              </span>
              <span>−{money(pur.withholdingAmount, cur)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-[var(--border)] pt-2 font-bold">
            <span>{t('purchases.total')}</span>
            <span>{money(pur.totalAmount, cur)}</span>
          </div>
          {pur.paidAmount > 0 && (
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">{t('invoices.paidAmount')}</span>
              <span>{money(pur.paidAmount, cur)}</span>
            </div>
          )}
          {pur.remainingAmount > 0 && (
            <div className="flex justify-between font-bold">
              <span>{t('purchases.remaining')}</span>
              <span className="ae-stat-value--warn">{money(pur.remainingAmount, cur)}</span>
            </div>
          )}
        </div>
      </Panel>

      {pur.notes && (
        <Panel title={t('invoices.detail.notes')} className="ae-form-panel">
          <p className="whitespace-pre-wrap text-sm">{pur.notes}</p>
        </Panel>
      )}
    </div>
  );
}
