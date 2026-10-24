'use client';

/**
 * الأصول الثابتة — what the company owns, and what it is worth now.
 *
 * A press bought for 900,000 is not an expense of 900,000 in the month it arrived. It is an
 * asset that loses value over its working life, and the ledger has to say so every month. That
 * is the whole module: record the purchase, let it depreciate, and write it off when it goes.
 *
 * ── Everything here posts to the ledger ───────────────────────────────────────────────────
 *
 * Buying an asset posts an acquisition entry, running the month's depreciation posts a
 * depreciation entry, and disposing of one posts a disposal entry against the proceeds. Which
 * is why a closed accounting period refuses all three — the numbers for a closed month are
 * finished, and an asset run would rewrite them.
 *
 * The offset account is asked for rather than assumed: an asset bought in cash and one bought on
 * credit hit different accounts, and defaulting silently to the bank would quietly misstate the
 * supplier balance.
 *
 * ── Depreciation is per period, not per asset ─────────────────────────────────────────────
 *
 * The run takes a year and a month and depreciates everything active in one entry. So the
 * screen asks for a period and reports how many assets it touched, rather than offering a
 * button on each row that would post twelve separate entries for the same month.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

type Asset = {
  id: string; code: string | null; name: string; category: string | null;
  acquisitionDate: string; acquisitionCost: number; salvageValue: number;
  usefulLifeMonths: number; accumulatedDepreciation: number; bookValue: number;
  monthlyDepreciation: number; status: 'ACTIVE' | 'DISPOSED';
  disposalDate: string | null; disposalProceeds: number | null;
  acquisitionPosted: boolean; offsetAccountCode: string | null; notes: string | null;
};
type Depreciation = {
  id: string; assetId: string; assetName?: string | null;
  periodYear: number; periodMonth: number; amount: number; createdAt?: string;
};
type Summary = {
  activeCount: number; disposedCount: number;
  totalAcquisitionCost: number; totalAccumulatedDepreciation: number; totalBookValue: number;
};
type LedgerAccount = { id: string; code: string; name: string };

const BLANK = {
  code: '', name: '', category: '', acquisitionDate: new Date().toISOString().slice(0, 10),
  acquisitionCost: '', salvageValue: '', usefulLifeMonths: '60',
  offsetAccountCode: '1000', postAcquisition: true, notes: '',
};

export default function AssetsPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const manage = can('assets.manage');

  const [tab, setTab] = useState<'assets' | 'depreciation'>('assets');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [deps, setDeps] = useState<Depreciation[]>([]);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<typeof BLANK & { id?: string }>({ ...BLANK });
  const [disposing, setDisposing] = useState<{ id: string; date: string; proceeds: string; offset: string } | null>(null);

  const now = new Date();
  const [period, setPeriod] = useState({ year: String(now.getFullYear()), month: String(now.getMonth() + 1) });

  const money = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency: 'EGP', maximumFractionDigits: 2,
    }).format(v),
    [lang],
  );
  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG').format(v),
    [lang],
  );
  const plain = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', { useGrouping: false }).format(v),
    [lang],
  );
  const date = useCallback(
    (v: string | null) => (v ? new Date(v).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB') : '—'),
    [lang],
  );

  /**
   * The per-asset routes live under /assets/fixed/{id} — the router reads the segment after
   * `assets` as the resource name, so /assets/{id} falls through to not_found. Only the
   * collection itself answers at the bare path.
   */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, s, d, acc] = await Promise.all([
        api<Asset[]>('/assets'),
        api<Summary>('/assets/summary').catch(() => null),
        api<Depreciation[] | { items?: Depreciation[] }>('/assets/depreciations').catch(() => [] as Depreciation[]),
        api<LedgerAccount[]>('/accounting/accounts').catch(() => [] as LedgerAccount[]),
      ]);
      setAssets(Array.isArray(a) ? a : []);
      setSummary(s);
      setDeps(Array.isArray(d) ? d : (d.items ?? []));
      setAccounts(Array.isArray(acc) ? acc : []);
    } catch {
      setError('assets.loadFailed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await api<Record<string, unknown>>(path, { method, body });
      setFlash(ok);
      await load();
      return res;
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code ? `assets.error.${code}` : 'common.error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  function openForm(a?: Asset) {
    setEditing(true);
    setError(null);
    setForm(a ? {
      id: a.id, code: a.code ?? '', name: a.name, category: a.category ?? '',
      acquisitionDate: a.acquisitionDate, acquisitionCost: String(a.acquisitionCost),
      salvageValue: String(a.salvageValue), usefulLifeMonths: String(a.usefulLifeMonths),
      offsetAccountCode: a.offsetAccountCode ?? '1000', postAcquisition: a.acquisitionPosted,
      notes: a.notes ?? '',
    } : { ...BLANK });
  }

  async function save() {
    const body = {
      code: form.code.trim() || null,
      name: form.name.trim(),
      category: form.category.trim() || null,
      acquisitionDate: form.acquisitionDate,
      acquisitionCost: Number(form.acquisitionCost || 0),
      salvageValue: Number(form.salvageValue || 0),
      usefulLifeMonths: Number(form.usefulLifeMonths || 0),
      notes: form.notes.trim() || null,
      // Only meaningful when creating: the acquisition entry is posted once.
      ...(form.id ? {} : { offsetAccountCode: form.offsetAccountCode, postAcquisition: form.postAcquisition }),
    };
    const res = form.id
      ? await call(`/assets/fixed/${form.id}`, 'PATCH', body, 'assets.assetUpdated')
      : await call('/assets', 'POST', body, 'assets.assetSaved');
    if (res) setEditing(false);
  }

  return (
    <div className="ae-page">
      <PageHero title={t('assets.title')} subtitle={t('assets.subtitle')}
        actions={manage && tab === 'assets' && (
          <button type="button" className="ae-btn-primary" onClick={() => openForm()}>
            {t('assets.addAsset')}
          </button>
        )} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash, flash)}</p>}

      {summary && (
        <div className="ae-counter-grid mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="ae-counter">
            <span className="ae-counter-label">{t('assets.activeCount')}</span>
            <span className="ae-counter-value">{num(summary.activeCount)}</span>
          </div>
          <div className="ae-counter">
            <span className="ae-counter-label">{t('assets.totalCost')}</span>
            <span className="ae-counter-value">{money(summary.totalAcquisitionCost)}</span>
          </div>
          <div className="ae-counter">
            <span className="ae-counter-label">{t('assets.accumulatedDep')}</span>
            <span className="ae-counter-value">{money(summary.totalAccumulatedDepreciation)}</span>
          </div>
          <div className="ae-counter">
            <span className="ae-counter-label">{t('assets.bookValue')}</span>
            <span className="ae-counter-value">{money(summary.totalBookValue)}</span>
          </div>
        </div>
      )}

      <div className="ae-tab-pills mb-4">
        {(['assets', 'depreciation'] as const).map((k) => (
          <button key={k} type="button" className={`ae-tab-pill ${tab === k ? 'is-active' : ''}`}
            onClick={() => { setTab(k); setError(null); setFlash(null); }}>
            {t(`assets.tab.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'assets' && (
        <Panel>
          {loading ? <Skeleton rows={6} /> : assets.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
          ) : (
            <div className="ae-table-wrap">
              <table className="ae-table">
                <thead>
                  <tr>
                    <th>{t('assets.code')}</th>
                    <th>{t('assets.name')}</th>
                    <th>{t('assets.acquisitionDate')}</th>
                    <th>{t('assets.acquisitionCost')}</th>
                    <th>{t('assets.accumulatedDep')}</th>
                    <th>{t('assets.bookValue')}</th>
                    <th>{t('assets.monthlyDep')}</th>
                    <th>{t('purchaseOrders.status')}</th>
                    {manage && <th aria-label={t('quotes.actions')} />}
                  </tr>
                </thead>
                <tbody>
                  {assets.map((a) => (
                    <tr key={a.id}>
                      <td className="font-mono text-xs">{a.code ?? '—'}</td>
                      <td>
                        {a.name}
                        {a.category && <span className="block text-xs text-[var(--text-muted)]">{a.category}</span>}
                      </td>
                      <td className="text-xs">{date(a.acquisitionDate)}</td>
                      <td>{money(a.acquisitionCost)}</td>
                      <td>{money(a.accumulatedDepreciation)}</td>
                      <td className="font-bold">{money(a.bookValue)}</td>
                      <td className="text-xs">{money(a.monthlyDepreciation)}</td>
                      <td>
                        <span className={`ae-badge ${a.status === 'ACTIVE' ? 'ae-badge-success' : 'ae-badge-muted'} text-xs`}>
                          {t(`assets.status.${a.status}`)}
                        </span>
                        {a.status === 'DISPOSED' && a.disposalProceeds !== null && (
                          <span className="block text-xs text-[var(--text-muted)]">
                            {money(a.disposalProceeds)} · {date(a.disposalDate)}
                          </span>
                        )}
                      </td>
                      {manage && (
                        <td>
                          <span className="flex flex-wrap gap-1">
                            <button type="button" className="ae-btn-ghost px-2 py-1 text-xs"
                              onClick={() => openForm(a)}>{t('assets.editAsset')}</button>
                            {/* Only an active asset can be disposed of; the API refuses the rest
                                with asset_not_active, so the button is not offered. */}
                            {a.status === 'ACTIVE' && (
                              <button type="button" className="ae-btn-ghost px-2 py-1 text-xs"
                                onClick={() => setDisposing({
                                  id: a.id, date: new Date().toISOString().slice(0, 10),
                                  proceeds: '', offset: a.offsetAccountCode ?? '1000',
                                })}>
                                {t('assets.dispose')}
                              </button>
                            )}
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
      )}

      {tab === 'depreciation' && (
        <div className="grid gap-4">
          {manage && (
            <Panel title={t('assets.runDepreciation')}>
              <div className="ae-toolbar">
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('assets.periodYear')}</span>
                  <input type="number" min="2000" max="2100" step="1" className="ae-input w-28"
                    value={period.year} onChange={(e) => setPeriod({ ...period, year: e.target.value })} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('assets.periodMonth')}</span>
                  <select className="ae-input w-24" value={period.month}
                    onChange={(e) => setPeriod({ ...period, month: e.target.value })}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={String(m)}>{plain(m)}</option>
                    ))}
                  </select>
                </label>
                <button type="button" className="ae-btn-primary self-end" disabled={busy}
                  onClick={async () => {
                    if (!window.confirm(t('assets.confirmDepreciation'))) return;
                    const res = await call('/assets/depreciations/run', 'POST', {
                      periodYear: Number(period.year), periodMonth: Number(period.month),
                    }, undefined as unknown as string);
                    if (!res) return;
                    // Field names read off a real run: how many were posted, how many were
                    // skipped (already depreciated for that period), and the total posted.
                    setFlash(`${t('assets.depreciationDone')} · ${num(Number(res.postedCount ?? 0))}`
                      + ` · ${money(Number(res.totalAmount ?? 0))}`
                      + (Number(res.skippedCount ?? 0) > 0 ? ` · ${num(Number(res.skippedCount))}` : ''));
                  }}>
                  {t('assets.runDepreciation')}
                </button>
              </div>
            </Panel>
          )}

          <Panel title={t('assets.tab.depreciation')}>
            {loading ? <Skeleton rows={5} /> : deps.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
            ) : (
              <div className="ae-table-wrap">
                <table className="ae-table">
                  <thead>
                    <tr>
                      <th>{t('assets.period')}</th>
                      <th>{t('assets.name')}</th>
                      <th>{t('assets.depAmount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deps.map((d) => (
                      <tr key={d.id}>
                        <td>{plain(d.periodMonth)} / {plain(d.periodYear)}</td>
                        <td>{d.assetName ?? assets.find((a) => a.id === d.assetId)?.name ?? '—'}</td>
                        <td className="font-bold">{money(d.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}

      {editing && (
        <Panel title={form.id ? t('assets.editAsset') : t('assets.addAsset')} className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('assets.code')}</span>
              <input className="ae-input" value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('assets.name')}</span>
              <input className="ae-input" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('assets.category')}</span>
              <input className="ae-input" value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('assets.acquisitionDate')}</span>
              <input type="date" className="ae-input" value={form.acquisitionDate}
                onChange={(e) => setForm({ ...form, acquisitionDate: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('assets.acquisitionCost')}</span>
              <input type="number" min="0" step="any" className="ae-input" value={form.acquisitionCost}
                onChange={(e) => setForm({ ...form, acquisitionCost: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('assets.salvageValue')}</span>
              <input type="number" min="0" step="any" className="ae-input" value={form.salvageValue}
                onChange={(e) => setForm({ ...form, salvageValue: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('assets.usefulLifeMonths')}</span>
              <input type="number" min="1" step="1" className="ae-input" value={form.usefulLifeMonths}
                onChange={(e) => setForm({ ...form, usefulLifeMonths: e.target.value })} />
            </label>
            {!form.id && (
              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('assets.offsetAccount')}</span>
                <select className="ae-input" value={form.offsetAccountCode}
                  onChange={(e) => setForm({ ...form, offsetAccountCode: e.target.value })}>
                  {accounts.map((a) => <option key={a.id} value={a.code}>{a.code} · {a.name}</option>)}
                </select>
              </label>
            )}
          </div>

          {!form.id && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.postAcquisition}
                onChange={(e) => setForm({ ...form, postAcquisition: e.target.checked })} />
              <span>{t('assets.postAcquisition')}</span>
            </label>
          )}

          <label className="mt-3 block text-sm">
            <span className="mb-1 block font-bold">{t('assets.notes')}</span>
            <textarea className="ae-input" rows={2} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>

          <div className="mt-3 flex gap-2">
            <button type="button" className="ae-btn-primary"
              disabled={busy || form.name.trim() === '' || Number(form.acquisitionCost) <= 0}
              onClick={() => void save()}>
              {t('common.save')}
            </button>
            <button type="button" className="ae-btn-ghost" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </Panel>
      )}

      {disposing && (
        <Panel title={t('assets.dispose')} className="mt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('invoices.date')}</span>
              <input type="date" className="ae-input" value={disposing.date}
                onChange={(e) => setDisposing({ ...disposing, date: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('assets.disposalProceeds')}</span>
              <input type="number" min="0" step="any" className="ae-input" value={disposing.proceeds}
                onChange={(e) => setDisposing({ ...disposing, proceeds: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('assets.offsetAccount')}</span>
              <select className="ae-input" value={disposing.offset}
                onChange={(e) => setDisposing({ ...disposing, offset: e.target.value })}>
                {accounts.map((a) => <option key={a.id} value={a.code}>{a.code} · {a.name}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className="ae-btn-primary" disabled={busy}
              onClick={async () => {
                if (!window.confirm(t('assets.confirmDispose'))) return;
                const res = await call(`/assets/fixed/${disposing.id}/dispose`, 'POST', {
                  disposalDate: disposing.date,
                  disposalProceeds: Number(disposing.proceeds || 0),
                  offsetAccountCode: disposing.offset,
                }, 'assets.assetDisposed');
                if (res) setDisposing(null);
              }}>
              {t('assets.dispose')}
            </button>
            <button type="button" className="ae-btn-ghost" onClick={() => setDisposing(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}
