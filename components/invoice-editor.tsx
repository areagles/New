'use client';

/**
 * Writing an invoice — new or existing.
 *
 * The totals shown while typing are the client's own arithmetic, for feedback only — the
 * server recomputes everything on save and its answer is the one that counts. That matters
 * here more than usual: the API applies rounding, credit-limit checks and the tax types'
 * additive/subtractive modes, and a preview that quietly disagreed with the saved document
 * would be worse than no preview.
 *
 * Tax mode is a decision, not a detail. TAX puts the document into the tax reports and the
 * ETA filing; NORMAL keeps it out and no tax is applied at all, which is why the tax
 * selector disappears rather than emptying when it is chosen.
 *
 * ── Editing ──────────────────────────────────────────────────────────────────────────────
 *
 * An issued invoice is a financial record, not a draft, and the API guards it accordingly.
 * Rather than let someone fill in a form the server will reject, the same three rules are
 * applied here and each locked field says which one caught it:
 *
 *   once a payment has landed the lines are frozen — changing what was billed after money
 *   was received against it would leave the allocation describing something that no longer
 *   exists; once the invoice has been filed with the tax authority its client, date, lines
 *   and tax mode are all frozen, because the local copy would then diverge from the document
 *   that was legally submitted, and the correction for that is a credit note; and tax mode
 *   is settled the moment the invoice leaves draft, since it decides whether the document
 *   belongs to the tax reports at all.
 *
 * Currency is shown but never editable when editing: the PATCH endpoint keeps the exchange
 * rate the invoice was written at and ignores a new currency entirely, so offering the
 * choice would be offering something that silently does not happen.
 *
 * `expectedUpdatedAt` is sent with every edit. Two people on the same invoice is exactly
 * what it is for — the second save is refused rather than quietly overwriting the first.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { selectableParties } from '@/lib/parties';
import { Panel } from '@/components/page';

type Client = { id: string; name: string; isActive: boolean };
type TaxType = { id: string; key: string; label: string; mode: 'ADDITIVE' | 'SUBTRACTIVE'; rate: number; isActive: boolean; isDefault?: boolean };
type Currency = { code: string; label: string; isBase: boolean; isActive: boolean };

type Line = { description: string; quantity: string; unitPrice: string; discount: string; unit: string };

/** What an existing invoice has to carry for this form to reopen it faithfully. */
export type EditableInvoice = {
  id: string;
  clientId: string;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  taxMode: 'TAX' | 'NORMAL';
  status: 'DRAFT' | 'DEFERRED' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  etaStatus: 'NONE' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'FAILED' | 'CANCELLED';
  paidAmount: number;
  updatedAt: string;
  taxItems?: { taxTypeId: string }[];
  lines?: { description: string; quantity: number; unitPrice: number; discount: number; unit: string | null }[];
};

const BLANK_LINE: Line = { description: '', quantity: '1', unitPrice: '', discount: '', unit: '' };

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** Filed with the tax authority — the document exists outside this system now. */
const ETA_FILED = ['SUBMITTED', 'ACCEPTED'];

const ERROR_KEY: Record<string, string> = {
  credit_limit_exceeded: 'invoices.creditLimitExceeded',
  conflict_stale_data: 'common.conflictStaleData',
  invoice_has_payments: 'invoices.linesLockedByPayments',
  invoice_locked_by_eta_submission: 'invoices.lockedByEta',
  invoice_cancelled: 'invoices.cancelled',
  lines_required: 'invoices.saveFailed',
};

export function InvoiceEditor({
  invoice,
  onClose,
  onSaved,
}: {
  invoice?: EditableInvoice;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const editing = invoice != null;

  const [clients, setClients] = useState<Client[]>([]);
  const [taxTypes, setTaxTypes] = useState<TaxType[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);

  const [clientId, setClientId] = useState(invoice?.clientId ?? '');
  const [invoiceDate, setInvoiceDate] = useState(invoice?.invoiceDate ?? today());
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? plusDays(30));
  const [taxMode, setTaxMode] = useState<'TAX' | 'NORMAL'>(invoice?.taxMode ?? 'TAX');
  const [currencyCode, setCurrencyCode] = useState(invoice?.currencyCode ?? 'EGP');
  const [taxTypeIds, setTaxTypeIds] = useState<string[]>(
    invoice?.taxItems?.map((x) => x.taxTypeId) ?? [],
  );
  const [lines, setLines] = useState<Line[]>(
    invoice?.lines?.length
      ? invoice.lines.map((l) => ({
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          discount: l.discount ? String(l.discount) : '',
          unit: l.unit ?? '',
        }))
      : [{ ...BLANK_LINE }],
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Each lock mirrors one of the API's refusals, so nothing here can be typed then rejected. */
  const etaFiled = editing && ETA_FILED.includes(invoice.etaStatus);
  const paid = editing && invoice.paidAmount > 0;
  const linesLocked = paid || etaFiled;
  const partiesLocked = etaFiled;
  const taxModeLocked = etaFiled || (editing && invoice.status !== 'DRAFT');

  const money = useCallback(
    (v: number) =>
      new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
        style: 'currency', currency: currencyCode, maximumFractionDigits: 2,
      }).format(v),
    [lang, currencyCode],
  );

  useEffect(() => {
    void (async () => {
      try {
        const [c, tt, cur] = await Promise.all([
          api<Client[]>('/clients'),
          api<{ items?: TaxType[] }>('/settings/tax-types'),
          api<Currency[]>('/currencies'),
        ]);
        setClients(Array.isArray(c) ? c : []);
        const active = (tt.items ?? []).filter((x) => x.isActive);
        setTaxTypes(active);
        // An existing invoice already carries its selection; only a new one takes the defaults.
        if (!editing) setTaxTypeIds(active.filter((x) => x.isDefault).map((x) => x.id));
        setCurrencies((Array.isArray(cur) ? cur : []).filter((x) => x.isActive));
      } catch {
        setError('common.error');
      }
    })();
  }, [editing]);

  const totals = useMemo(() => {
    const subTotal = lines.reduce(
      (s, l) => s + Math.max(0, Number(l.quantity || 0) * Number(l.unitPrice || 0) - Number(l.discount || 0)),
      0,
    );
    const applied = taxMode === 'TAX' ? taxTypes.filter((x) => taxTypeIds.includes(x.id)) : [];
    const tax = applied.reduce(
      (s, x) => s + subTotal * (x.rate / 100) * (x.mode === 'SUBTRACTIVE' ? -1 : 1),
      0,
    );
    return { subTotal, tax, total: subTotal + tax };
  }, [lines, taxMode, taxTypes, taxTypeIds]);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  }

  const body = () => ({
    clientId,
    invoiceDate,
    dueDate,
    taxMode,
    ...(taxMode === 'TAX' ? { taxTypeIds } : {}),
    lines: lines
      .filter((l) => l.description.trim() !== '')
      .map((l) => ({
        description: l.description.trim(),
        quantity: Number(l.quantity || 0),
        unitPrice: Number(l.unitPrice || 0),
        discount: Number(l.discount || 0),
        unit: l.unit.trim() || null,
      })),
  });

  async function save(status?: 'DRAFT' | 'DEFERRED') {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        const { lines: nextLines, clientId: nextClient, invoiceDate: nextDate, taxMode: nextMode, ...rest } = body();
        await api(`/invoices/${invoice.id}`, {
          method: 'PATCH',
          body: {
            ...rest,
            // A locked field is left out of the payload entirely rather than sent unchanged:
            // the API refuses the *presence* of these keys once the document is filed.
            ...(partiesLocked ? {} : { clientId: nextClient, invoiceDate: nextDate }),
            ...(taxModeLocked ? {} : { taxMode: nextMode }),
            ...(linesLocked ? {} : { lines: nextLines }),
            ...(status ? { status } : {}),
            expectedUpdatedAt: invoice.updatedAt,
          },
        });
      } else {
        await api('/invoices', { method: 'POST', body: { ...body(), status, currencyCode } });
      }
      onSaved();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(ERROR_KEY[code] ?? 'invoices.saveFailed');
    } finally {
      setBusy(false);
    }
  }

  const ready = clientId !== '' && lines.some((l) => l.description.trim() !== '' && Number(l.unitPrice) > 0);

  /** Why a field is disabled, in the system's own words. */
  const lockNote = (locked: boolean, reason: 'eta' | 'payments') =>
    locked ? (
      <p className="ae-alert-pill ae-alert-pill--warn mt-2 block text-xs">
        {t(reason === 'eta' ? 'invoices.lockedByEta' : 'invoices.linesLockedByPayments')}
      </p>
    ) : null;

  return (
    <Panel title={t(editing ? 'invoices.editTitle' : 'invoices.new')} className="ae-form-panel mb-4">
      {error && <p className="ae-flash ae-flash--error mb-3">{t(error)}</p>}

      {lockNote(etaFiled, 'eta')}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('invoices.client')}</span>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}
            required disabled={partiesLocked} className="ae-input w-full">
            <option value="" />
            {selectableParties(clients, clientId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('invoices.date')}</span>
          <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)}
            disabled={partiesLocked} className="ae-input w-full" />
        </label>
        <label className="text-sm">
          {/* The due date is never locked — when something is owed is ours to decide, and
              it is not part of the document filed with the authority. */}
          <span className="mb-1 block font-bold">{t('invoices.dueDate')}</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
            className="ae-input w-full" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('invoices.currency')}</span>
          {editing ? (
            // Fixed at the rate the invoice was written at; the PATCH endpoint does not read it.
            <input value={currencyCode} readOnly dir="ltr" className="ae-input w-full" />
          ) : (
            <select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} className="ae-input w-full">
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
            </select>
          )}
        </label>
      </div>

      <div className="mt-4">
        <span className="mb-1 block text-sm font-bold">{t('invoices.taxMode')}</span>
        <div className="ae-tab-pills">
          {(['TAX', 'NORMAL'] as const).map((m) => (
            <button key={m} type="button" disabled={taxModeLocked} onClick={() => setTaxMode(m)}
              className={`ae-tab-pill ${taxMode === m ? 'is-active' : ''}`}>
              {t(`invoices.taxMode.${m}`)}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{t('invoices.taxModeHint')}</p>
      </div>

      {taxMode === 'TAX' && taxTypes.length > 0 && (
        <div className="mt-4">
          <span className="mb-1 block text-sm font-bold">{t('invoices.taxTypes')}</span>
          <div className="flex flex-wrap gap-3">
            {taxTypes.map((x) => (
              <label key={x.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={linesLocked}
                  checked={taxTypeIds.includes(x.id)}
                  onChange={(e) =>
                    setTaxTypeIds((ids) => (e.target.checked ? [...ids, x.id] : ids.filter((i) => i !== x.id)))
                  }
                />
                <span>{x.label} · {x.rate}%{x.mode === 'SUBTRACTIVE' ? ' −' : ''}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5">
        <div className="ae-panel-head">
          <h3 className="ae-panel-title text-sm">{t('invoices.lines')}</h3>
          {!linesLocked && (
            <button type="button" className="ae-btn-ghost text-xs" onClick={() => setLines((l) => [...l, { ...BLANK_LINE }])}>
              {t('invoices.addLine')}
            </button>
          )}
        </div>

        {lockNote(paid && !etaFiled, 'payments')}

        <div className="ae-table-wrap">
          <table className="ae-table ae-table--rows">
            <thead>
              <tr>
                <th>{t('invoices.description')}</th>
                <th>{t('invoices.quantity')}</th>
                <th>{t('pricing.unitPrice')}</th>
                <th>{t('invoices.discount')}</th>
                <th>{t('invoices.lineTotal')}</th>
                {!linesLocked && <th />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })}
                      disabled={linesLocked} className="ae-input w-full" />
                  </td>
                  <td>
                    <input type="number" min="0" step="any" value={l.quantity} disabled={linesLocked}
                      onChange={(e) => setLine(i, { quantity: e.target.value })} className="ae-input w-24" />
                  </td>
                  <td>
                    <input type="number" min="0" step="any" value={l.unitPrice} disabled={linesLocked}
                      onChange={(e) => setLine(i, { unitPrice: e.target.value })} className="ae-input w-32" />
                  </td>
                  <td>
                    <input type="number" min="0" step="any" value={l.discount} disabled={linesLocked}
                      onChange={(e) => setLine(i, { discount: e.target.value })} className="ae-input w-28" />
                  </td>
                  <td className="whitespace-nowrap">
                    {money(Math.max(0, Number(l.quantity || 0) * Number(l.unitPrice || 0) - Number(l.discount || 0)))}
                  </td>
                  {!linesLocked && (
                    <td className="ae-actions-cell">
                      {lines.length > 1 && (
                        <button type="button" aria-label={t('common.delete')}
                          className="ae-icon-btn ae-icon-btn-danger"
                          onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>
                          ✕
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:ms-auto sm:w-72 text-sm">
        <div className="flex justify-between">
          <span className="text-[var(--text-muted)]">{t('invoices.subTotal')}</span>
          <span>{money(totals.subTotal)}</span>
        </div>
        {taxMode === 'TAX' && (
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">{t('invoices.tax')}</span>
            <span>{money(totals.tax)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-[var(--border)] pt-2 font-bold">
          <span>{t('invoices.total')}</span>
          <span>{money(totals.total)}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {editing ? (
          <>
            <button type="button" disabled={busy || !ready} className="ae-btn-primary" onClick={() => void save()}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
            {/* Issuing is a status change only a draft can still make. */}
            {invoice.status === 'DRAFT' && (
              <button type="button" disabled={busy || !ready} className="ae-btn-secondary"
                onClick={() => void save('DEFERRED')}>
                {t('invoices.statusOption.DEFERRED')}
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" disabled={busy || !ready} className="ae-btn-primary" onClick={() => void save('DEFERRED')}>
              {busy ? t('common.saving') : t('invoices.saveDeferred')}
            </button>
            <button type="button" disabled={busy || !ready} className="ae-btn-secondary" onClick={() => void save('DRAFT')}>
              {t('invoices.status.DRAFT')}
            </button>
          </>
        )}
        <button type="button" className="ae-btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </Panel>
  );
}
