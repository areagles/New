'use client';

/**
 * Writing a supplier invoice — new or existing.
 *
 * The mirror of the sales editor, with three differences that come from the document being
 * theirs rather than ours:
 *
 * There is no ETA lock. A supplier invoice is filed by the supplier, not by us, so nothing
 * here is frozen by a submission to the tax authority.
 *
 * Lines carry no discount. `ae_purchase_lines` has no such column and the API's line
 * normalisation does not read one, so the field is absent rather than present and ignored.
 * Unit is shown instead, because what a supplier bills is usually measured in something.
 *
 * Withholding is the feature sales does not have. It is deducted from what the supplier is
 * actually paid but not from what they invoiced, and it only exists when the supplier is
 * marked subject to it *and* the tenant has it switched on — so the selector appears only
 * when both are true, rather than offering a choice that computes to nothing.
 *
 * As with sales, the totals shown while typing are the client's own arithmetic; the server
 * recomputes on save and its answer is the one that counts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { selectableParties } from '@/lib/parties';
import { Panel } from '@/components/page';

type Supplier = { id: string; name: string; isActive: boolean; withholdingSubject?: boolean };
type Currency = { code: string; label: string; isBase: boolean; isActive: boolean };
type TaxSettings = { withholdingEnabled?: boolean; withholdingRates?: Record<string, number>; vatRate?: number };

type Line = { description: string; quantity: string; unitPrice: string; unit: string };

/** The categories the API accepts, in the order settings lists their rates. */
const WITHHOLDING_CATEGORIES = ['goods', 'services', 'professional', 'rent'] as const;
type WithholdingCategory = (typeof WITHHOLDING_CATEGORIES)[number];

export type EditablePurchase = {
  id: string;
  supplierId: string;
  purchaseDate: string;
  dueDate: string;
  currencyCode: string;
  taxMode: 'TAX' | 'NORMAL';
  status: 'DRAFT' | 'DEFERRED' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  paidAmount: number;
  withholdingCategory: string | null;
  updatedAt: string;
  lines?: { description: string; quantity: number; unitPrice: number; unit: string | null }[];
};

const BLANK_LINE: Line = { description: '', quantity: '1', unitPrice: '', unit: '' };

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const ERROR_KEY: Record<string, string> = {
  conflict_stale_data: 'common.conflictStaleData',
  purchase_has_payments: 'returns.error.purchase_has_payments',
  purchase_cancelled: 'purchases.status.CANCELLED',
  lines_required: 'purchases.saveFailed',
};

export function PurchaseEditor({
  purchase,
  onClose,
  onSaved,
}: {
  purchase?: EditablePurchase;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const editing = purchase != null;

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [tax, setTax] = useState<TaxSettings>({});

  const [supplierId, setSupplierId] = useState(purchase?.supplierId ?? '');
  const [purchaseDate, setPurchaseDate] = useState(purchase?.purchaseDate ?? today());
  const [dueDate, setDueDate] = useState(purchase?.dueDate ?? plusDays(30));
  const [taxMode, setTaxMode] = useState<'TAX' | 'NORMAL'>(purchase?.taxMode ?? 'TAX');
  const [currencyCode, setCurrencyCode] = useState(purchase?.currencyCode ?? 'EGP');
  const [category, setCategory] = useState<WithholdingCategory>(
    (purchase?.withholdingCategory as WithholdingCategory) ?? 'services',
  );
  const [lines, setLines] = useState<Line[]>(
    purchase?.lines?.length
      ? purchase.lines.map((l) => ({
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          unit: l.unit ?? '',
        }))
      : [{ ...BLANK_LINE }],
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The API's two refusals, applied here so nothing can be typed then rejected. */
  const paid = editing && purchase.paidAmount > 0;
  const linesLocked = paid;
  const taxModeLocked = editing && purchase.status !== 'DRAFT';

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
        const [s, cur, settings] = await Promise.all([
          api<Supplier[]>('/suppliers'),
          api<Currency[]>('/currencies'),
          api<{ settings?: { tax?: TaxSettings }; tax?: TaxSettings }>('/settings'),
        ]);
        setSuppliers((Array.isArray(s) ? s : []).filter((x) => x.isActive));
        setCurrencies((Array.isArray(cur) ? cur : []).filter((x) => x.isActive));
        setTax(settings.settings?.tax ?? settings.tax ?? {});
      } catch {
        setError('common.error');
      }
    })();
  }, []);

  const supplier = suppliers.find((s) => s.id === supplierId);

  /** Both switches have to be on for a single pound to be withheld. */
  const withholdingApplies =
    tax.withholdingEnabled === true && supplier?.withholdingSubject === true;

  const totals = useMemo(() => {
    const subTotal = lines.reduce(
      (s, l) => s + Math.max(0, Number(l.quantity || 0) * Number(l.unitPrice || 0)),
      0,
    );
    const vat = taxMode === 'TAX' ? subTotal * ((tax.vatRate ?? 0) / 100) : 0;
    const rate = withholdingApplies ? (tax.withholdingRates?.[category] ?? 0) : 0;
    // Computed on the pre-tax amount, deducted from the gross — the rule the hint states.
    const withheld = subTotal * (rate / 100);
    return { subTotal, vat, withheld, total: subTotal + vat - withheld };
  }, [lines, taxMode, tax, withholdingApplies, category]);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  }

  const payloadLines = () =>
    lines
      .filter((l) => l.description.trim() !== '')
      .map((l) => ({
        description: l.description.trim(),
        quantity: Number(l.quantity || 0),
        unitPrice: Number(l.unitPrice || 0),
        unit: l.unit.trim() || null,
      }));

  async function save(status?: 'DRAFT' | 'DEFERRED') {
    setBusy(true);
    setError(null);
    try {
      const shared = {
        supplierId,
        purchaseDate,
        dueDate,
        ...(withholdingApplies ? { withholdingCategory: category } : {}),
      };
      if (editing) {
        await api(`/purchases/${purchase.id}`, {
          method: 'PATCH',
          body: {
            ...shared,
            ...(taxModeLocked ? {} : { taxMode }),
            ...(linesLocked ? {} : { lines: payloadLines() }),
            ...(status ? { status } : {}),
            expectedUpdatedAt: purchase.updatedAt,
          },
        });
      } else {
        await api('/purchases', {
          method: 'POST',
          body: { ...shared, taxMode, currencyCode, status, lines: payloadLines() },
        });
      }
      onSaved();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(ERROR_KEY[code] ?? 'purchases.saveFailed');
    } finally {
      setBusy(false);
    }
  }

  const ready = supplierId !== '' && lines.some((l) => l.description.trim() !== '' && Number(l.unitPrice) > 0);

  /**
   * The category labels carry their own rate — "خدمات (3%)" — but a tenant can change those
   * rates in settings, so the baked-in figure is dropped and the live one appended instead.
   */
  const categoryLabel = (key: WithholdingCategory) => {
    const name = t(`settings.withholding.${key}`).replace(/\s*\([^)]*\)\s*$/, '');
    const rate = tax.withholdingRates?.[key];
    return rate == null ? name : `${name} · ${rate}%`;
  };

  return (
    <Panel title={t(editing ? 'purchases.editTitle' : 'purchases.new')} className="ae-form-panel mb-4">
      {error && <p className="ae-flash ae-flash--error mb-3">{t(error)}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('purchases.supplier')}</span>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required className="ae-input w-full">
            <option value="" />
            {selectableParties(suppliers, supplierId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('purchases.date')}</span>
          <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)}
            className="ae-input w-full" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('purchases.dueDate')}</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="ae-input w-full" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('invoices.currency')}</span>
          {editing ? (
            // Fixed at the rate the purchase was recorded at; the PATCH endpoint does not read it.
            <input value={currencyCode} readOnly dir="ltr" className="ae-input w-full" />
          ) : (
            <select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} className="ae-input w-full">
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
            </select>
          )}
        </label>
      </div>

      <div className="mt-4">
        <span className="mb-1 block text-sm font-bold">{t('purchases.taxMode')}</span>
        <div className="ae-tab-pills">
          {(['TAX', 'NORMAL'] as const).map((m) => (
            <button key={m} type="button" disabled={taxModeLocked} onClick={() => setTaxMode(m)}
              className={`ae-tab-pill ${taxMode === m ? 'is-active' : ''}`}>
              {t(`purchases.taxMode.${m}`)}
            </button>
          ))}
        </div>
      </div>

      {withholdingApplies && (
        <div className="mt-4">
          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('purchases.withholdingCategory')}</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as WithholdingCategory)}
              className="ae-input w-full sm:w-72">
              {WITHHOLDING_CATEGORIES.map((k) => <option key={k} value={k}>{categoryLabel(k)}</option>)}
            </select>
          </label>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t('purchases.withholdingHint')}</p>
        </div>
      )}

      <div className="mt-5">
        <div className="ae-panel-head">
          <h3 className="ae-panel-title text-sm">{t('purchases.lines')}</h3>
          {!linesLocked && (
            <button type="button" className="ae-btn-ghost text-xs" onClick={() => setLines((l) => [...l, { ...BLANK_LINE }])}>
              {t('invoices.addLine')}
            </button>
          )}
        </div>

        {linesLocked && (
          <p className="ae-alert-pill ae-alert-pill--warn mt-2 block text-xs">
            {t('returns.error.purchase_has_payments')}
          </p>
        )}

        <div className="ae-table-wrap">
          <table className="ae-table ae-table--rows">
            <thead>
              <tr>
                <th>{t('invoices.description')}</th>
                <th>{t('invoices.quantity')}</th>
                <th>{t('inventory.unit')}</th>
                <th>{t('pricing.unitPrice')}</th>
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
                    <input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })}
                      disabled={linesLocked} className="ae-input w-24" />
                  </td>
                  <td>
                    <input type="number" min="0" step="any" value={l.unitPrice} disabled={linesLocked}
                      onChange={(e) => setLine(i, { unitPrice: e.target.value })} className="ae-input w-32" />
                  </td>
                  <td className="whitespace-nowrap">
                    {money(Math.max(0, Number(l.quantity || 0) * Number(l.unitPrice || 0)))}
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
            <span>{money(totals.vat)}</span>
          </div>
        )}
        {totals.withheld > 0 && (
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">{t('purchases.withholding')}</span>
            <span>−{money(totals.withheld)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-[var(--border)] pt-2 font-bold">
          <span>{t('purchases.total')}</span>
          <span>{money(totals.total)}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {editing ? (
          <>
            <button type="button" disabled={busy || !ready} className="ae-btn-primary" onClick={() => void save()}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
            {/* Recording it is a status change only a draft can still make. */}
            {purchase.status === 'DRAFT' && (
              <button type="button" disabled={busy || !ready} className="ae-btn-secondary"
                onClick={() => void save('DEFERRED')}>
                {t('purchases.statusOption.DEFERRED')}
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" disabled={busy || !ready} className="ae-btn-primary" onClick={() => void save('DEFERRED')}>
              {busy ? t('common.saving') : t('purchases.statusOption.DEFERRED')}
            </button>
            <button type="button" disabled={busy || !ready} className="ae-btn-secondary" onClick={() => void save('DRAFT')}>
              {t('purchases.statusOption.DRAFT')}
            </button>
          </>
        )}
        <button type="button" className="ae-btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </Panel>
  );
}
