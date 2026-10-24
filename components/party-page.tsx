'use client';

/**
 * Clients and suppliers are the same screen over the same row shape — the API returns
 * identical fields for both, with suppliers adding a category and a contact person. One
 * component means a fix to the table, the search or the form lands on both at once.
 *
 * All wording comes from the recovered `party.*` namespace, which already covers both sides
 * including the hints and placeholders.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

export type Party = {
  id: string;
  code: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxId: string | null;
  creditLimit: number;
  openingBalance: number;
  notes: string | null;
  balance: number | null;
  isActive: boolean;
  category?: string | null;
  contactPerson?: string | null;
};

type Draft = Partial<Party> & { name: string };

const EMPTY: Draft = {
  name: '', code: '', phone: '', email: '', address: '', taxId: '',
  creditLimit: 0, openingBalance: 0, notes: '', category: '', contactPerson: '',
};

export function PartyPage({
  kind,
  endpoint,
  titleKey,
  viewPerm,
  managePerm,
}: {
  kind: 'client' | 'supplier';
  endpoint: '/clients' | '/suppliers';
  titleKey: string;
  viewPerm: string;
  managePerm: string;
}) {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const [items, setItems] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);

  const editable = can(managePerm);
  const isSupplier = kind === 'supplier';

  const money = useCallback(
    (v: number) =>
      new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
        style: 'currency', currency: 'EGP', maximumFractionDigits: 0,
      }).format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // These two endpoints answer with a bare array, unlike the rest of the API, which
      // wraps its payload in { ok, ... }. Accept either so the page does not depend on
      // which convention a given route happens to follow.
      const res = await api<Party[] | { items?: Party[]; clients?: Party[]; suppliers?: Party[] }>(endpoint);
      const list = Array.isArray(res)
        ? res
        : res.items ?? res.clients ?? res.suppliers ?? [];
      setItems(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'party.loadFailed');
    } finally {
      setLoading(false);
    }
  }, [endpoint, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((p) =>
      [p.name, p.phone, p.email, p.code].some((f) => f?.toLowerCase().includes(q)),
    );
  }, [items, query]);

  /**
   * DELETE on these routes sets is_active = 0 rather than removing the row — a party with
   * invoices behind it cannot simply vanish. The system's own wording for that is
   * "deactivate", so that is what the button says.
   */
  async function setActive(p: Party, active: boolean) {
    if (active === false && !window.confirm(t('common.confirmDeactivate'))) return;
    setBusy(true);
    setError(null);
    try {
      if (active) await api(`${endpoint}/${p.id}`, { method: 'PATCH', body: { isActive: true } });
      else await api(`${endpoint}/${p.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'party.saveFailed');
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: draft.name.trim(),
        code: draft.code || null,
        phone: draft.phone || null,
        email: draft.email || null,
        address: draft.address || null,
        taxId: draft.taxId || null,
        creditLimit: Number(draft.creditLimit ?? 0),
        openingBalance: Number(draft.openingBalance ?? 0),
        notes: draft.notes || null,
      };
      if (isSupplier) {
        body.category = draft.category || null;
        body.contactPerson = draft.contactPerson || null;
      }
      if (draft.id) await api(`${endpoint}/${draft.id}`, { method: 'PATCH', body });
      else await api(endpoint, { method: 'POST', body });
      setDraft(null);
      setSaved(true);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'party.saveFailed');
    } finally {
      setBusy(false);
    }
  }

  const field = (
    key: keyof Draft,
    labelKey: string,
    opts: { type?: string; hint?: string; placeholder?: string; wide?: boolean } = {},
  ) => (
    <label className={`text-sm ${opts.wide ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block font-bold">{t(labelKey)}</span>
      <input
        type={opts.type ?? 'text'}
        value={(draft?.[key] as string | number | undefined) ?? ''}
        onChange={(e) => setDraft((d) => (d ? { ...d, [key]: e.target.value } : d))}
        placeholder={opts.placeholder ? t(opts.placeholder) : undefined}
        required={key === 'name'}
        dir={opts.type === 'email' || key === 'phone' ? 'ltr' : undefined}
        className="ae-input w-full"
      />
      {opts.hint && <span className="mt-1 block text-xs text-[var(--text-muted)]">{t(opts.hint)}</span>}
    </label>
  );

  return (
    <div className="ae-page">
      <PageHero
        title={t(titleKey)}
        actions={
          editable && !draft ? (
            <button type="button" className="ae-btn-primary" onClick={() => setDraft({ ...EMPTY })}>
              {t('party.addNew')}
            </button>
          ) : undefined
        }
      />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error.startsWith('party.') ? error : 'common.error')}</p>}
      {saved && <p className="ae-flash ae-flash--success mb-4">{t('party.saved')}</p>}

      {draft && (
        <Panel title={draft.id ? t('party.editData') : t('party.addNew')} className="ae-form-panel mb-4">
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            {field('name', 'party.name')}
            {field('code', 'party.code')}
            {field('phone', 'party.phone')}
            {field('email', 'party.email', { type: 'email' })}
            {isSupplier && field('category', 'party.category')}
            {isSupplier && field('contactPerson', 'party.contactPerson')}
            {field('taxId', 'party.taxId')}
            {field('creditLimit', 'party.creditLimit', {
              type: 'number', hint: 'party.creditLimitHint', placeholder: 'party.creditLimitPlaceholder',
            })}
            {field('openingBalance', 'party.openingBalance', { type: 'number', hint: 'party.openingBalanceHint' })}
            {field('address', 'party.address', { wide: true })}
            {field('notes', 'party.notes', { wide: true, placeholder: 'party.notesPlaceholder' })}

            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" disabled={busy} className="ae-btn-primary">
                {busy ? t('common.saving') : t('common.save')}
              </button>
              <button type="button" className="ae-btn-ghost" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </Panel>
      )}

      <Panel
        actions={
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('party.search')}
            className="ae-input w-full sm:w-72"
          />
        }
      >
        {loading ? (
          <Skeleton rows={5} />
        ) : shown.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            {query ? t('common.noResults') : t('common.noRecords')}
          </p>
        ) : (
          <div className="ae-table-wrap">
            <table className="ae-table ae-table--rows">
              <thead>
                <tr>
                  <th>{t('party.name')}</th>
                  <th>{t('party.phone')}</th>
                  {isSupplier && <th>{t('party.category')}</th>}
                  <th>{t('accounting.balance')}</th>
                  <th>{t('party.status')}</th>
                  {editable && <th>{t('party.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className={p.isActive ? undefined : 'opacity-60'}>
                    <td>
                      <span className="font-bold">{p.name}</span>
                      {p.code && (
                        <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{p.code}</span>
                      )}
                    </td>
                    <td dir="ltr">{p.phone ?? '—'}</td>
                    {isSupplier && <td>{p.category ?? '—'}</td>}
                    <td>
                      {p.balance === null ? '—' : (
                        <span className={p.balance > 0 ? 'ae-stat-value--warn' : undefined}>
                          {money(p.balance)}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`ae-badge ${p.isActive ? 'ae-badge-success' : 'ae-badge-muted'}`}>
                        {t(p.isActive ? 'common.active' : 'common.inactive')}
                      </span>
                    </td>
                    {editable && (
                      <td className="ae-actions-cell">
                        <span className="ae-action-icons">
                          <button
                            type="button"
                            className="ae-btn-ghost px-3 py-1 text-xs"
                            onClick={() => { setSaved(false); setDraft({ ...EMPTY, ...p }); }}
                          >
                            {t('common.edit')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="ae-btn-ghost px-3 py-1 text-xs"
                            onClick={() => setActive(p, !p.isActive)}
                          >
                            {t(p.isActive ? 'common.deactivate' : 'common.active')}
                          </button>
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
