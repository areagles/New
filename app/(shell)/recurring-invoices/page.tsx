'use client';

/**
 * الفواتير الدورية — the invoices nobody should have to remember to raise.
 *
 * A maintenance contract, a monthly retainer, a yearly licence: the same lines, the same client,
 * on a fixed rhythm. A schedule holds the lines and the cadence; the invoice itself is raised
 * from it, either by the scheduler or by hand from here.
 *
 * ── When it stops ─────────────────────────────────────────────────────────────────────────
 *
 * Two independent brakes, both optional: an end date and a maximum count. A schedule with
 * neither runs until somebody deactivates it, which is what an open-ended retainer is — so the
 * screen shows both, and shows how many have already gone out against the cap.
 *
 * ── Running by hand advances the schedule ─────────────────────────────────────────────────
 *
 * "إصدار الآن" is not a preview. It raises a real invoice, bumps the occurrence count and moves
 * the next run date forward by one period — the same thing the scheduler does, because there is
 * only one code path and a second one would drift. So it asks first, and names the invoice it
 * made afterwards rather than leaving a document to be discovered later.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { selectableParties } from '@/lib/parties';

type Line = { description: string; quantity: number; unit: string | null; unitPrice: number; lineTotal: number };
type Schedule = {
  id: string; clientId: string; clientName: string | null;
  currencyCode: string; taxMode: string; lines: Line[];
  frequency: string; nextRunAt: string; endDate: string | null;
  maxOccurrences: number | null; occurrencesGenerated: number;
  lastGeneratedAt: string | null; lastInvoiceId: string | null;
  isActive: boolean; notes: string | null;
};
type Client = { id: string; name: string; isActive?: boolean };

type FormLine = { description: string; quantity: string; unit: string; unitPrice: string };
const BLANK_LINE: FormLine = { description: '', quantity: '1', unit: '', unitPrice: '' };
const BLANK = {
  clientId: '', frequency: 'monthly', currencyCode: 'EGP', taxMode: 'TAX',
  startDate: new Date().toISOString().slice(0, 10), endDate: '', maxOccurrences: '', notes: '',
};

export default function RecurringInvoicesPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const manage = can('finance.invoices.manage');

  const [items, setItems] = useState<Schedule[]>([]);
  const [frequencies, setFrequencies] = useState<string[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<typeof BLANK & { id?: string }>({ ...BLANK });
  const [formLines, setFormLines] = useState<FormLine[]>([{ ...BLANK_LINE }]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([
        api<{ items?: Schedule[]; frequencies?: string[] }>('/recurring-invoices'),
        api<Client[]>('/clients').catch(() => [] as Client[]),
      ]);
      setItems(r.items ?? []);
      setFrequencies(r.frequencies ?? ['weekly', 'monthly', 'quarterly', 'yearly']);
      setClients(Array.isArray(c) ? c : []);
    } catch {
      setError('common.error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const money = useCallback(
    (v: number, currency = 'EGP') => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(v),
    [lang],
  );
  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG').format(v),
    [lang],
  );
  const date = useCallback(
    (v: string | null) => (v ? new Date(v.replace(' ', 'T')).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB') : '—'),
    [lang],
  );

  async function call(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: Record<string, unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await api<Record<string, unknown>>(path, { method, ...(body ? { body } : {}) });
      if (ok) setFlash(ok);
      await load();
      return res;
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code ? `recurringInvoices.error.${code}` : 'common.error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const previewTotal = useMemo(
    () => formLines.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0),
    [formLines],
  );

  const setLine = (i: number, patch: Partial<FormLine>) =>
    setFormLines((ls) => ls.map((l, x) => (x === i ? { ...l, ...patch } : l)));

  function openForm(s?: Schedule) {
    setEditing(true);
    setError(null);
    if (s) {
      setForm({
        id: s.id, clientId: s.clientId, frequency: s.frequency, currencyCode: s.currencyCode,
        taxMode: s.taxMode, startDate: s.nextRunAt.slice(0, 10), endDate: s.endDate ?? '',
        maxOccurrences: s.maxOccurrences !== null ? String(s.maxOccurrences) : '', notes: s.notes ?? '',
      });
      setFormLines(s.lines.map((l) => ({
        description: l.description, quantity: String(l.quantity),
        unit: l.unit ?? '', unitPrice: String(l.unitPrice),
      })));
    } else {
      setForm({ ...BLANK });
      setFormLines([{ ...BLANK_LINE }]);
    }
  }

  async function save() {
    const lines = formLines
      .filter((l) => l.description.trim() !== '')
      .map((l) => ({
        description: l.description.trim(),
        quantity: Number(l.quantity || 0),
        unit: l.unit.trim() || undefined,
        unitPrice: Number(l.unitPrice || 0),
      }));
    if (lines.length === 0) {
      setError('recurringInvoices.error.lines_required');
      return;
    }
    const body = {
      clientId: form.clientId,
      frequency: form.frequency,
      currencyCode: form.currencyCode,
      taxMode: form.taxMode,
      startDate: form.startDate,
      endDate: form.endDate || '',
      maxOccurrences: form.maxOccurrences,
      notes: form.notes.trim() || null,
      lines,
    };
    const res = form.id
      ? await call(`/recurring-invoices/${form.id}`, 'PATCH', body, 'recurringInvoices.updated')
      : await call('/recurring-invoices', 'POST', body, 'recurringInvoices.created');
    if (res) setEditing(false);
  }

  if (loading) {
    return (
      <div className="ae-page">
        <PageHero title={t('recurringInvoices.title')} subtitle={t('recurringInvoices.subtitle')} />
        <Panel><Skeleton rows={6} /></Panel>
      </div>
    );
  }

  return (
    <div className="ae-page">
      <PageHero title={t('recurringInvoices.title')} subtitle={t('recurringInvoices.subtitle')}
        actions={manage && (
          <button type="button" className="ae-btn-primary" onClick={() => openForm()}>
            {t('recurringInvoices.add')}
          </button>
        )} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash, flash)}</p>}

      {items.length === 0 ? (
        <Panel><p className="text-sm text-[var(--text-muted)]">{t('recurringInvoices.empty')}</p></Panel>
      ) : (
        <Panel>
          <div className="ae-table-wrap">
            <table className="ae-table">
              <thead>
                <tr>
                  <th>{t('recurringInvoices.client')}</th>
                  <th>{t('recurringInvoices.frequency')}</th>
                  <th>{t('recurringInvoices.nextRun')}</th>
                  <th>{t('recurringInvoices.occurrences')}</th>
                  <th>{t('recurringInvoices.previewTotal')}</th>
                  <th>{t('recurringInvoices.status')}</th>
                  <th aria-label={t('quotes.actions')} />
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const total = s.lines.reduce((sum, l) => sum + l.lineTotal, 0);
                  return (
                    <tr key={s.id}>
                      <td>{s.clientName ?? '—'}</td>
                      <td className="text-xs">{t(`recurringInvoices.frequency.${s.frequency}`, s.frequency)}</td>
                      <td className="text-xs">
                        {date(s.nextRunAt)}
                        {/* Both brakes shown, because either one can be the reason a schedule
                            is about to stop and only showing one hides the other. */}
                        {s.endDate && (
                          <span className="block text-[var(--text-muted)]">
                            {t('recurringInvoices.endDate')}: {date(s.endDate)}
                          </span>
                        )}
                      </td>
                      <td>
                        {num(s.occurrencesGenerated)}
                        {s.maxOccurrences !== null && ` / ${num(s.maxOccurrences)}`}
                      </td>
                      <td className="font-bold">{money(total, s.currencyCode)}</td>
                      <td>
                        <span className={`ae-badge ${s.isActive ? 'ae-badge-success' : 'ae-badge-muted'} text-xs`}>
                          {t(s.isActive ? 'common.active' : 'common.inactive')}
                        </span>
                      </td>
                      <td>
                        <span className="flex flex-wrap gap-1">
                          {manage && (
                            <>
                              <button type="button" className="ae-btn-ghost px-2 py-1 text-xs"
                                onClick={() => openForm(s)}>{t('recurringInvoices.edit')}</button>
                              <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                                onClick={async () => {
                                  // Not a preview: this raises a real invoice and moves the
                                  // schedule on by one period.
                                  if (!window.confirm(t('recurringInvoices.runNow'))) return;
                                  const res = await call(`/recurring-invoices/${s.id}/run`, 'POST', {}, undefined);
                                  if (res) {
                                    setFlash(t('recurringInvoices.runSuccess', { id: String(res.invoiceId ?? '') }));
                                  }
                                }}>
                                {t('recurringInvoices.runNow')}
                              </button>
                              <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                                onClick={() => void call(`/recurring-invoices/${s.id}`, 'PATCH',
                                  { isActive: !s.isActive }, 'recurringInvoices.updated')}>
                                {t(s.isActive ? 'common.deactivate' : 'users.reactivate')}
                              </button>
                              <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                                onClick={() => {
                                  if (!window.confirm(t('recurringInvoices.confirmDelete'))) return;
                                  void call(`/recurring-invoices/${s.id}`, 'DELETE', undefined, 'recurringInvoices.deleted');
                                }}>
                                {t('common.delete')}
                              </button>
                            </>
                          )}
                          {s.lastInvoiceId && (
                            <Link href={`/invoices?id=${s.lastInvoiceId}`} className="ae-btn-ghost px-2 py-1 text-xs">
                              {t('recurringInvoices.openInvoice')}
                            </Link>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {editing && (
        <Panel title={form.id ? t('recurringInvoices.edit') : t('recurringInvoices.add')} className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('recurringInvoices.client')}</span>
              <select className="ae-input" value={form.clientId}
                onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                <option value="">{t('jobs.selectClient')}</option>
                {selectableParties(clients, form.clientId).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('recurringInvoices.frequency')}</span>
              <select className="ae-input" value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                {frequencies.map((f) => (
                  <option key={f} value={f}>{t(`recurringInvoices.frequency.${f}`, f)}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('purchases.taxMode')}</span>
              <select className="ae-input" value={form.taxMode}
                onChange={(e) => setForm({ ...form, taxMode: e.target.value })}>
                {(['TAX', 'NORMAL'] as const).map((m) => (
                  <option key={m} value={m}>{t(`purchases.taxMode.${m}`)}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('recurringInvoices.startDate')}</span>
              <input type="date" className="ae-input" value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('recurringInvoices.endDate')}</span>
              <input type="date" className="ae-input" value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('recurringInvoices.maxOccurrences')}</span>
              <input type="number" min="1" step="1" className="ae-input" value={form.maxOccurrences}
                onChange={(e) => setForm({ ...form, maxOccurrences: e.target.value })} />
            </label>
          </div>

          <h4 className="mb-2 mt-4 text-sm font-bold">{t('recurringInvoices.lines')}</h4>
          <div className="grid gap-2">
            {formLines.map((l, i) => (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-bold">{t('invoices.description')}</span>
                  <input className="ae-input" value={l.description}
                    onChange={(e) => setLine(i, { description: e.target.value })} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-bold">{t('invoices.quantity')}</span>
                  <input type="number" min="0" step="any" className="ae-input" value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-bold">{t('inventory.unit')}</span>
                  <input className="ae-input" value={l.unit}
                    onChange={(e) => setLine(i, { unit: e.target.value })} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-bold">{t('pricing.unitPrice')}</span>
                  <input type="number" min="0" step="any" className="ae-input" value={l.unitPrice}
                    onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
                </label>
                <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={formLines.length <= 1}
                  onClick={() => setFormLines(formLines.filter((_, x) => x !== i))}>
                  {t('invoices.removeLine')}
                </button>
              </div>
            ))}
          </div>

          <label className="mt-3 block text-sm">
            <span className="mb-1 block font-bold">{t('invoices.notes')}</span>
            <textarea className="ae-input" rows={2} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>

          <p className="mt-3 text-sm">
            {t('recurringInvoices.previewTotal')}: <strong>{money(previewTotal, form.currencyCode)}</strong>
            <span className="ms-2 text-xs text-[var(--text-muted)]">{t('invoices.subTotal')}</span>
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="ae-btn-secondary text-xs"
              onClick={() => setFormLines([...formLines, { ...BLANK_LINE }])}>
              {t('invoices.addLine')}
            </button>
            <button type="button" className="ae-btn-primary" disabled={busy || form.clientId === ''}
              onClick={() => void save()}>
              {t('common.save')}
            </button>
            <button type="button" className="ae-btn-ghost" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}
