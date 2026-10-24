'use client';

/**
 * Writing a quote — new or existing.
 *
 * The start of the chain: a quote becomes a job, the job becomes an invoice. It is the only
 * one of the three that is a proposal rather than a record, which is why it is the only one
 * that can be freely rewritten — until it has been acted on. Once it is converted, rejected or
 * superseded by a newer version the API refuses to touch it, and so does this form.
 *
 * ── Sending is not always sending ─────────────────────────────────────────────────────────
 *
 * A tenant sets an internal approval threshold. Above it, the API takes a quote marked SENT,
 * silently turns it back into a DRAFT with `internalApprovalStatus = PENDING`, opens an
 * approval request and issues no number. That is correct behaviour — a large quote should not
 * leave the building unreviewed — but a person who pressed "إرسال" and was handed an unnumbered
 * draft with no explanation would reasonably think it had failed. So the saved status is read
 * back and the outcome is stated.
 *
 * Totals shown while typing are the client's own arithmetic; the server recomputes on save and
 * its answer is the one that counts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { selectableParties } from '@/lib/parties';
import { Panel } from '@/components/page';

type Client = { id: string; name: string; isActive: boolean };
type TaxType = { id: string; label: string; mode: 'ADDITIVE' | 'SUBTRACTIVE'; rate: number; isActive: boolean; isDefault?: boolean };
type Currency = { code: string; label: string; isActive: boolean };

type Line = { description: string; quantity: string; unitPrice: string; discount: string; unit: string };

export type EditableQuote = {
  id: string;
  clientId: string;
  quoteDate: string;
  validUntil: string | null;
  currencyCode: string;
  taxMode: 'TAX' | 'NORMAL';
  status: string;
  notes: string | null;
  updatedAt: string;
  taxItems?: { taxTypeId: string }[];
  lines?: { description: string; quantity: number; unitPrice: number; discount: number; unit: string | null }[];
};

const BLANK_LINE: Line = { description: '', quantity: '1', unitPrice: '', discount: '', unit: '' };

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const ERROR_KEY: Record<string, string> = {
  conflict_stale_data: 'common.conflictStaleData',
  quote_locked: 'quotes.saveFailed',
  lines_required: 'quotes.saveFailed',
  invalid_quote: 'quotes.saveFailed',
};

export function QuoteEditor({
  quote,
  onClose,
  onSaved,
}: {
  quote?: EditableQuote;
  onClose: () => void;
  /** `heldForApproval` is true when the server turned a send into a pending draft. */
  onSaved: (heldForApproval: boolean) => void;
}) {
  const { t, lang } = useI18n();
  const editing = quote != null;

  const [clients, setClients] = useState<Client[]>([]);
  const [taxTypes, setTaxTypes] = useState<TaxType[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);

  const [clientId, setClientId] = useState(quote?.clientId ?? '');
  const [quoteDate, setQuoteDate] = useState(quote?.quoteDate ?? today());
  const [validUntil, setValidUntil] = useState(quote?.validUntil ?? plusDays(20));
  const [taxMode, setTaxMode] = useState<'TAX' | 'NORMAL'>(quote?.taxMode ?? 'TAX');
  const [currencyCode, setCurrencyCode] = useState(quote?.currencyCode ?? 'EGP');
  const [notes, setNotes] = useState(quote?.notes ?? '');
  const [taxTypeIds, setTaxTypeIds] = useState<string[]>(quote?.taxItems?.map((x) => x.taxTypeId) ?? []);
  const [lines, setLines] = useState<Line[]>(
    quote?.lines?.length
      ? quote.lines.map((l) => ({
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
        setClients((Array.isArray(c) ? c : []).filter((x) => x.isActive));
        const active = (tt.items ?? []).filter((x) => x.isActive);
        setTaxTypes(active);
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

  async function save(status: 'DRAFT' | 'SENT') {
    setBusy(true);
    setError(null);
    try {
      const body = {
        clientId,
        quoteDate,
        validUntil,
        status,
        taxMode,
        ...(taxMode === 'TAX' ? { taxTypeIds } : {}),
        notes: notes.trim() || null,
        lines: lines
          .filter((l) => l.description.trim() !== '')
          .map((l) => ({
            description: l.description.trim(),
            quantity: Number(l.quantity || 0),
            unitPrice: Number(l.unitPrice || 0),
            discount: Number(l.discount || 0),
            unit: l.unit.trim() || null,
          })),
      };

      const res = editing
        ? await api<{ quote?: { status?: string; internalApprovalStatus?: string } }>(
            `/quotes/${quote.id}`,
            { method: 'PATCH', body: { ...body, expectedUpdatedAt: quote.updatedAt } },
          )
        : await api<{ quote?: { status?: string; internalApprovalStatus?: string } }>(
            '/quotes',
            { method: 'POST', body: { ...body, currencyCode } },
          );

      // Asked to send, got back a draft awaiting sign-off — say so rather than let it look
      // like the save half-worked.
      const held =
        status === 'SENT' && res.quote?.internalApprovalStatus === 'PENDING';
      onSaved(held);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(ERROR_KEY[code] ?? 'quotes.saveFailed');
    } finally {
      setBusy(false);
    }
  }

  const ready = clientId !== '' && lines.some((l) => l.description.trim() !== '' && Number(l.unitPrice) > 0);

  return (
    <Panel title={t(editing ? 'quotes.editTitle' : 'quotes.new')} className="ae-form-panel mb-4">
      {error && <p className="ae-flash ae-flash--error mb-3">{t(error)}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('quotes.client')}</span>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} required className="ae-input">
            <option value="">{t('quotes.selectClient')}</option>
            {selectableParties(clients, clientId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('quotes.quoteDate')}</span>
          <input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} className="ae-input" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('quotes.validUntil')}</span>
          <input type="date" value={validUntil ?? ''} onChange={(e) => setValidUntil(e.target.value)} className="ae-input" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('invoices.currency')}</span>
          {editing ? (
            // Fixed at the rate the quote was priced at; the PATCH endpoint does not read it.
            <input value={currencyCode} readOnly dir="ltr" className="ae-input" />
          ) : (
            <select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} className="ae-input">
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
            </select>
          )}
        </label>
      </div>

      <div className="mt-4">
        <span className="mb-1 block text-sm font-bold">{t('invoices.taxMode')}</span>
        <div className="ae-tab-pills">
          {(['TAX', 'NORMAL'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setTaxMode(m)}
              className={`ae-tab-pill ${taxMode === m ? 'is-active' : ''}`}>
              {t(`invoices.taxMode.${m}`)}
            </button>
          ))}
        </div>
      </div>

      {taxMode === 'TAX' && taxTypes.length > 0 && (
        <div className="mt-4">
          <span className="mb-1 block text-sm font-bold">{t('invoices.taxTypes')}</span>
          <div className="flex flex-wrap gap-3">
            {taxTypes.map((x) => (
              <label key={x.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={taxTypeIds.includes(x.id)}
                  onChange={(e) =>
                    setTaxTypeIds((ids) => (e.target.checked ? [...ids, x.id] : ids.filter((i) => i !== x.id)))} />
                <span>{x.label} · {x.rate}%{x.mode === 'SUBTRACTIVE' ? ' −' : ''}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5">
        <div className="ae-panel-head">
          <h3 className="ae-panel-title text-sm">{t('quotes.lines')}</h3>
          <button type="button" className="ae-btn-ghost text-xs"
            onClick={() => setLines((l) => [...l, { ...BLANK_LINE }])}>
            {t('quotes.addLine')}
          </button>
        </div>
        <div className="ae-table-wrap">
          <table className="ae-table ae-table--rows">
            <thead>
              <tr>
                <th>{t('quotes.description')}</th>
                <th>{t('quotes.quantity')}</th>
                <th>{t('quotes.unit')}</th>
                <th>{t('quotes.price')}</th>
                <th>{t('invoices.discount')}</th>
                <th>{t('invoices.lineTotal')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td><input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className="ae-input" /></td>
                  <td><input type="number" min="0" step="any" value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })} className="ae-input w-24" /></td>
                  <td><input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} className="ae-input w-24" /></td>
                  <td><input type="number" min="0" step="any" value={l.unitPrice}
                    onChange={(e) => setLine(i, { unitPrice: e.target.value })} className="ae-input w-32" /></td>
                  <td><input type="number" min="0" step="any" value={l.discount}
                    onChange={(e) => setLine(i, { discount: e.target.value })} className="ae-input w-28" /></td>
                  <td className="whitespace-nowrap">
                    {money(Math.max(0, Number(l.quantity || 0) * Number(l.unitPrice || 0) - Number(l.discount || 0)))}
                  </td>
                  <td className="ae-actions-cell">
                    {lines.length > 1 && (
                      <button type="button" aria-label={t('common.delete')} className="ae-icon-btn ae-icon-btn-danger"
                        onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <label className="mt-4 block text-sm">
        <span className="mb-1 block font-bold">{t('quotes.notes')}</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className="ae-input" />
      </label>

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
          <span>{t('quotes.total')}</span>
          <span>{money(totals.total)}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !ready} className="ae-btn-primary" onClick={() => void save('SENT')}>
          {busy ? t('common.saving') : t('quotes.statusOption.SENT')}
        </button>
        <button type="button" disabled={busy || !ready} className="ae-btn-secondary" onClick={() => void save('DRAFT')}>
          {t('quotes.statusOption.DRAFT')}
        </button>
        <button type="button" className="ae-btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </Panel>
  );
}
