'use client';

/**
 * One invoice, on its own URL.
 *
 * Addressed as `/invoices/?id=…` rather than `/invoices/[id]`, which is the convention this
 * system already uses for opening a single record — the approvals inbox links to
 * `/quotes?id=`, `/journals?id=` and so on. It is also the only form a static export can
 * serve, since a path segment would need every id known at build time.
 *
 * Editing opens the same form that wrote the invoice, in place. Cancelling voids the journal
 * entry rather than deleting the record, so a cancelled invoice stays visible as history.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { InvoiceEta } from '@/components/invoice-eta';
import { InvoiceEditor } from '@/components/invoice-editor';
import { DocumentShare } from '@/components/document-share';
import { useSession } from '@/lib/session';

type Line = {
  id: string;
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  discount: number;
  lineTotal: number;
};

type Invoice = {
  id: string;
  number: string | null;
  clientId: string;
  updatedAt: string;
  shareToken: string | null;
  shareEnabled: boolean | null;
  taxItems?: { taxTypeId: string }[];
  clientName: string | null;
  clientPhone: string | null;
  clientTaxId: string | null;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  subTotal: number;
  taxTotal: number;
  withholdingAmount: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: 'DRAFT' | 'DEFERRED' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  taxMode: 'TAX' | 'NORMAL';
  etaStatus: 'NONE' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'FAILED' | 'CANCELLED';
  etaUuid: string | null;
  etaLastError: string | null;
  notes: string | null;
  lines?: Line[];
};

const STATUS_STYLE: Record<Invoice['status'], string> = {
  DRAFT: 'ae-badge-muted',
  DEFERRED: 'ae-badge-warn',
  PARTIAL: 'ae-badge-info',
  PAID: 'ae-badge-success',
  CANCELLED: 'ae-badge-danger',
};

export function InvoiceDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, lang } = useI18n();
  const { can } = useSession();
  const [reloadKey, setReloadKey] = useState(0);
  const [inv, setInv] = useState<Invoice | null>(null);
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
        const res = await api<{ invoice?: Invoice } | Invoice>(`/invoices/${id}`);
        setInv(('invoice' in res ? res.invoice : res) as Invoice);
      } catch (err) {
        setFailed(err instanceof ApiError);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, reloadKey]);

  async function cancelInvoice() {
    if (!inv || !window.confirm(t('invoices.confirmCancel'))) return;
    setCancelling(true);
    setActionError(null);
    try {
      await api(`/invoices/${inv.id}`, {
        method: 'PATCH',
        body: { status: 'CANCELLED', expectedUpdatedAt: inv.updatedAt },
      });
      setReloadKey((k) => k + 1);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setActionError(
        code === 'conflict_stale_data' ? 'common.conflictStaleData'
          : code === 'invoice_has_payments' ? 'returns.error.invoice_has_payments'
            // Refused because the authority holds this invoice as live; the reason has to
            // reach the person, or they will keep pressing the button.
            : code === 'invoice_locked_by_eta_submission' ? 'invoices.error.etaLocked'
              : 'common.error',
      );
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <div className="ae-page">
        <PageHero title={t('invoices.detail.title')} />
        <Panel><Skeleton rows={6} /></Panel>
      </div>
    );
  }

  if (failed || !inv) {
    return (
      <div className="ae-page">
        <PageHero
          title={t('invoices.detail.title')}
          actions={<button type="button" className="ae-btn-ghost" onClick={onBack}>{t('common.close')}</button>}
        />
        <p className="ae-flash ae-flash--error">{t('invoices.detail.loadFailed')}</p>
      </div>
    );
  }

  // The same form that wrote the invoice reopens it; it applies the API's own locks itself.
  if (editing) {
    return (
      <div className="ae-page">
        <PageHero title={inv.number ?? t('invoices.detail.title')} />
        <InvoiceEditor
          invoice={inv}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); setReloadKey((k) => k + 1); }}
        />
      </div>
    );
  }

  const manage = can('finance.invoices.manage');
  const cancelled = inv.status === 'CANCELLED';
  /**
   * Cancelling is withheld in two cases.
   *
   * With money against it, because the API refuses outright.
   *
   * And once the invoice has been filed, because the API does *not* refuse: it would mark the
   * document void here while the authority still holds it as valid, and nothing afterwards
   * would show the two had diverged. Withdrawing a filed invoice is an ETA operation, and the
   * panel below is where it belongs.
   */
  const etaFiled = ['SUBMITTED', 'ACCEPTED'].includes(inv.etaStatus);
  const canCancel = manage && !cancelled && inv.paidAmount <= 0 && !etaFiled;

  const cur = inv.currencyCode;
  const fact = (label: string, value: React.ReactNode) => (
    <div>
      <p className="ae-stat-label">{label}</p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );

  return (
    <div className="ae-page">
      <PageHero
        title={inv.number ?? t('invoices.detail.title')}
        actions={
          <div className="flex flex-wrap gap-2">
            {manage && !cancelled && (
              <button type="button" className="ae-btn-primary" onClick={() => setEditing(true)}>
                {t('common.edit')}
              </button>
            )}
            {canCancel && (
              <button type="button" className="ae-btn-secondary" disabled={cancelling}
                onClick={() => void cancelInvoice()}>
                {t('audit.action.invoice_cancelled')}
              </button>
            )}
            <button type="button" className="ae-btn-ghost" onClick={onBack}>{t('common.close')}</button>
          </div>
        }
      />

      {actionError && <p className="ae-flash ae-flash--error mb-4">{t(actionError)}</p>}
      {cancelled && <p className="ae-flash ae-flash--warn mb-4">{t('invoices.cancelled')}</p>}

      <Panel className="ae-form-panel mb-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {fact(t('invoices.client'), inv.clientName ?? '—')}
          {fact(t('invoices.date'), <span dir="ltr">{inv.invoiceDate}</span>)}
          {fact(t('invoices.dueDate'), <span dir="ltr">{inv.dueDate}</span>)}
          {fact(t('invoices.taxMode'), t(`invoices.taxMode.${inv.taxMode}`))}
          {fact(
            t('invoices.status'),
            <span className={`ae-badge ${STATUS_STYLE[inv.status]}`}>{t(`invoices.status.${inv.status}`)}</span>,
          )}
          {fact(t('invoices.currency'), <span dir="ltr">{cur}</span>)}
          {inv.clientTaxId && fact(t('party.taxId'), <span dir="ltr">{inv.clientTaxId}</span>)}
          {inv.clientPhone && fact(t('party.phone'), <span dir="ltr">{inv.clientPhone}</span>)}
        </div>
      </Panel>

      <Panel title={t('invoices.lines')} className="mb-4">
        <div className="ae-table-wrap">
          <table className="ae-table ae-table--rows">
            <thead>
              <tr>
                <th>{t('invoices.description')}</th>
                <th>{t('invoices.quantity')}</th>
                <th>{t('pricing.unitPrice')}</th>
                <th>{t('invoices.discount')}</th>
                <th>{t('invoices.lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {(inv.lines ?? []).map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td>{l.quantity}{l.unit ? ` ${l.unit}` : ''}</td>
                  <td>{money(l.unitPrice, cur)}</td>
                  <td>{l.discount > 0 ? money(l.discount, cur) : '—'}</td>
                  <td>{money(l.lineTotal, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-2 text-sm sm:ms-auto sm:w-72">
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">{t('invoices.subTotal')}</span>
            <span>{money(inv.subTotal, cur)}</span>
          </div>
          {inv.taxTotal !== 0 && (
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">{t('invoices.tax')}</span>
              <span>{money(inv.taxTotal, cur)}</span>
            </div>
          )}
          {inv.withholdingAmount > 0 && (
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">{t('party.withholdingSubject')}</span>
              <span>−{money(inv.withholdingAmount, cur)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-[var(--border)] pt-2 font-bold">
            <span>{t('invoices.total')}</span>
            <span>{money(inv.totalAmount, cur)}</span>
          </div>
          {inv.paidAmount > 0 && (
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">{t('invoices.paidAmount')}</span>
              <span>{money(inv.paidAmount, cur)}</span>
            </div>
          )}
          {inv.remainingAmount > 0 && (
            <div className="flex justify-between font-bold">
              <span>{t('invoices.remaining')}</span>
              <span className="ae-stat-value--warn">{money(inv.remainingAmount, cur)}</span>
            </div>
          )}
        </div>
      </Panel>

      {/* The link a client reads the invoice — and reports a payment — from. */}
      {manage && !cancelled && (
        <DocumentShare docType="invoice" docId={inv.id}
          initial={{ shareToken: inv.shareToken, shareEnabled: inv.shareEnabled }} />
      )}

      {/* A normal invoice never reaches ETA, so the panel is absent rather than empty. */}
      {inv.taxMode === 'TAX' && (
        <InvoiceEta
          invoiceId={inv.id}
          state={{ etaStatus: inv.etaStatus, etaUuid: inv.etaUuid, etaLastError: inv.etaLastError }}
          canManage={can('finance.invoices.manage', 'settings.manage')}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      )}

      {inv.notes && (
        <Panel title={t('invoices.detail.notes')} className="ae-form-panel">
          <p className="whitespace-pre-wrap text-sm">{inv.notes}</p>
        </Panel>
      )}
    </div>
  );
}
