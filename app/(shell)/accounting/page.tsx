'use client';

/**
 * المحاسبة — the ledger everything else eventually lands in.
 *
 * Seven views of one thing. شجرة الحسابات is the structure; دفتر الأستاذ is one account's
 * movement; ميزان المراجعة is every account's balance at a date and the proof that debits equal
 * credits. إقفال الفترات freezes a month so nobody posts into it afterwards. الميزانيات sets a
 * monthly target per account and measures the actual against it. The last two tabs are audits:
 * تدقيق الترحيل finds documents with no journal entry behind them, تدقيق البيانات finds
 * documents whose own arithmetic does not hold.
 *
 * ── Nothing on this page is invented ──────────────────────────────────────────────────────
 *
 * Every figure comes from POSTED journal entries. A draft entry contributes nothing to a
 * balance, a trial balance, or a budget actual — which is exactly why the server filters
 * `status = 'POSTED'` inside the join rather than after it, and why the same discipline holds
 * here: this screen adds nothing up that the API did not already add up.
 *
 * ── The chart of accounts is not free-form ────────────────────────────────────────────────
 *
 * An account's code decides where it sits and its type decides which side of the balance sheet
 * it falls on. Both are set once at creation — the API lets the type be edited afterwards, but
 * changing an account's type after it carries postings silently rewrites the meaning of every
 * balance it has ever been part of, so the screen says so where that is offered.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { AccountingLedger } from '@/components/accounting-ledger';
import { AccountingTrial } from '@/components/accounting-trial';
import { AccountingPeriods } from '@/components/accounting-periods';
import { AccountingBudgets } from '@/components/accounting-budgets';
import { AccountingAudit } from '@/components/accounting-audit';

export type Account = {
  id: string; code: string; name: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  parentId: string | null; isActive: boolean;
};
type CostCenter = { id: string; code: string; name: string; isActive: boolean };

const TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
const TABS = ['accounts', 'ledger', 'trial', 'periods', 'budgets', 'postingAudit', 'integrity'] as const;
type Tab = (typeof TABS)[number];

export default function AccountingPage() {
  const { t } = useI18n();
  const { can } = useSession();

  const manage = can('accounting.manage');

  const [tab, setTab] = useState<Tab>('accounts');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [centers, setCenters] = useState<CostCenter[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [newAccount, setNewAccount] = useState({ code: '', name: '', accountType: 'ASSET', parentId: '' });
  const [newCenter, setNewCenter] = useState({ code: '', name: '' });
  /** Edits held per account until saved, so several rows can be corrected in one pass. */
  const [edits, setEdits] = useState<Record<string, { name: string; accountType: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, c] = await Promise.all([
        api<Account[]>(`/accounting/accounts${query ? `?q=${encodeURIComponent(query)}` : ''}`),
        api<CostCenter[]>('/accounting/cost-centers').catch(() => [] as CostCenter[]),
      ]);
      setAccounts(Array.isArray(a) ? a : []);
      setCenters(Array.isArray(c) ? c : []);
      setEdits({});
    } catch {
      setError('accounting.loadFailed');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await api(path, { method, body });
      setFlash(ok);
      await load();
      return true;
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code ? `accounting.error.${code}` : 'common.error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ae-page">
      <PageHero title={t('accounting.title')} subtitle={t('accounting.subtitle')} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash, flash)}</p>}

      <div className="ae-tab-pills mb-4">
        {TABS.map((k) => (
          <button key={k} type="button" className={`ae-tab-pill ${tab === k ? 'is-active' : ''}`}
            onClick={() => { setTab(k); setError(null); setFlash(null); }}>
            {t(`accounting.tab.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'accounts' && (
        loading ? <Panel><Skeleton rows={8} /></Panel> : (
          <div className="grid gap-4">
            <Panel title={t('accounting.tab.accounts')}>
              <form className="ae-toolbar mb-3" onSubmit={(e) => e.preventDefault()}>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('accounting.code')} / {t('accounting.name')}</span>
                  <input className="ae-input" value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
              </form>

              {manage && (
                <div className="ae-section-card mb-4 grid gap-3 sm:grid-cols-[8rem_1fr_10rem_1fr_auto] sm:items-end">
                  <label className="text-sm">
                    <span className="mb-1 block font-bold">{t('accounting.code')}</span>
                    <input className="ae-input" value={newAccount.code}
                      onChange={(e) => setNewAccount({ ...newAccount, code: e.target.value })} />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-bold">{t('accounting.name')}</span>
                    <input className="ae-input" value={newAccount.name}
                      onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })} />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-bold">{t('accounting.typeLabel')}</span>
                    <select className="ae-input" value={newAccount.accountType}
                      onChange={(e) => setNewAccount({ ...newAccount, accountType: e.target.value })}>
                      {TYPES.map((x) => <option key={x} value={x}>{t(`accounting.type.${x}`)}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-bold">{t('accounting.parent')}</span>
                    <select className="ae-input" value={newAccount.parentId}
                      onChange={(e) => setNewAccount({ ...newAccount, parentId: e.target.value })}>
                      <option value="">—</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                    </select>
                  </label>
                  <button type="button" className="ae-btn-secondary text-xs"
                    disabled={busy || newAccount.code.trim() === '' || newAccount.name.trim() === ''}
                    onClick={async () => {
                      const ok = await call('/accounting/accounts', 'POST', {
                        code: newAccount.code.trim(), name: newAccount.name.trim(),
                        accountType: newAccount.accountType, parentId: newAccount.parentId || null,
                      }, 'accounting.accountAdded');
                      if (ok) setNewAccount({ code: '', name: '', accountType: 'ASSET', parentId: '' });
                    }}>
                    {t('accounting.addAccount')}
                  </button>
                </div>
              )}

              {accounts.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
              ) : (
                <div className="ae-table-wrap">
                  <table className="ae-table">
                    <thead>
                      <tr>
                        <th>{t('accounting.code')}</th>
                        <th>{t('accounting.name')}</th>
                        <th>{t('accounting.typeLabel')}</th>
                        <th>{t('purchaseOrders.status')}</th>
                        {manage && <th aria-label={t('quotes.actions')} />}
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.map((a) => {
                        const e = edits[a.id] ?? { name: a.name, accountType: a.accountType };
                        const dirty = e.name !== a.name || e.accountType !== a.accountType;
                        return (
                          <tr key={a.id}>
                            <td className="font-mono text-xs">{a.code}</td>
                            <td>
                              {manage ? (
                                <input className="ae-input" value={e.name}
                                  onChange={(ev) => setEdits({ ...edits, [a.id]: { ...e, name: ev.target.value } })} />
                              ) : a.name}
                            </td>
                            <td>
                              {manage ? (
                                <select className="ae-input" value={e.accountType}
                                  onChange={(ev) => setEdits({ ...edits, [a.id]: { ...e, accountType: ev.target.value } })}>
                                  {TYPES.map((x) => <option key={x} value={x}>{t(`accounting.type.${x}`)}</option>)}
                                </select>
                              ) : t(`accounting.type.${a.accountType}`, a.accountType)}
                            </td>
                            <td>
                              <span className={`ae-badge ${a.isActive ? 'ae-badge-success' : 'ae-badge-muted'} text-xs`}>
                                {t(a.isActive ? 'common.active' : 'common.inactive')}
                              </span>
                            </td>
                            {manage && (
                              <td>
                                <span className="flex flex-wrap gap-1">
                                  <button type="button" className="ae-btn-ghost px-2 py-1 text-xs"
                                    disabled={busy || !dirty}
                                    onClick={() => {
                                      // Changing a type rewrites the meaning of every balance
                                      // this account has ever been part of.
                                      if (e.accountType !== a.accountType
                                        && !window.confirm(t('accounting.confirmTypeChange'))) return;
                                      void call(`/accounting/accounts/${a.id}`, 'PATCH',
                                        { name: e.name.trim(), accountType: e.accountType }, 'accounting.accountSaved');
                                    }}>
                                    {t('common.save')}
                                  </button>
                                  <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                                    onClick={() => void call(`/accounting/accounts/${a.id}`, 'PATCH',
                                      { isActive: !a.isActive }, 'accounting.accountSaved')}>
                                    {t(a.isActive ? 'common.deactivate' : 'users.reactivate')}
                                  </button>
                                </span>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title={t('accounting.costCenters')}>
              {manage && (
                <div className="ae-toolbar mb-3">
                  <label className="text-sm">
                    <span className="mb-1 block font-bold">{t('accounting.costCenterCode')}</span>
                    <input className="ae-input" value={newCenter.code}
                      onChange={(e) => setNewCenter({ ...newCenter, code: e.target.value })} />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-bold">{t('accounting.costCenterName')}</span>
                    <input className="ae-input" value={newCenter.name}
                      onChange={(e) => setNewCenter({ ...newCenter, name: e.target.value })} />
                  </label>
                  <button type="button" className="ae-btn-secondary self-end text-xs"
                    disabled={busy || newCenter.code.trim() === '' || newCenter.name.trim() === ''}
                    onClick={async () => {
                      const ok = await call('/accounting/cost-centers', 'POST',
                        { code: newCenter.code.trim(), name: newCenter.name.trim() }, 'accounting.costCenterSaved');
                      if (ok) setNewCenter({ code: '', name: '' });
                    }}>
                    {t('accounting.addCostCenter')}
                  </button>
                </div>
              )}

              {centers.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
              ) : (
                <ul className="grid gap-2 text-sm">
                  {centers.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span><span className="font-mono text-xs">{c.code}</span> · {c.name}</span>
                      <span className="flex items-center gap-2">
                        <span className={`ae-badge ${c.isActive ? 'ae-badge-success' : 'ae-badge-muted'} text-xs`}>
                          {t(c.isActive ? 'common.active' : 'common.inactive')}
                        </span>
                        {manage && (
                          <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                            onClick={() => {
                              if (c.isActive && !window.confirm(t('accounting.confirmDeactivateCostCenter'))) return;
                              // The endpoint rewrites code and name from the payload, so both
                              // are resent — omitting them would blank the record.
                              void call(`/accounting/cost-centers/${c.id}`, 'PATCH',
                                { code: c.code, name: c.name, isActive: !c.isActive },
                                c.isActive ? 'accounting.costCenterDeactivated' : 'accounting.costCenterUpdated');
                            }}>
                            {t(c.isActive ? 'common.deactivate' : 'users.reactivate')}
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        )
      )}

      {tab === 'ledger' && <AccountingLedger accounts={accounts} />}
      {tab === 'trial' && <AccountingTrial />}
      {tab === 'periods' && <AccountingPeriods manage={manage} />}
      {tab === 'budgets' && <AccountingBudgets accounts={accounts} manage={manage} />}
      {tab === 'postingAudit' && <AccountingAudit mode="posting" manage={manage} />}
      {tab === 'integrity' && <AccountingAudit mode="integrity" manage={manage} />}
    </div>
  );
}
