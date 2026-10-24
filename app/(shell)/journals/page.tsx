'use client';

/**
 * Journal entries.
 *
 * Almost every entry here was written by the system, not by a person: an invoice, a receipt, a
 * treasury move and a supplier payment each post their own, and the tax review reconciles
 * against the balances they produce. So the first job of this screen is to make those visible —
 * `refType` says which document an entry came from, and an automatic entry is not editable by
 * hand, because the document is the source of truth and the entry is its consequence.
 *
 * The second job is the manual entry, which is the only kind a person writes, and which the
 * API guards with maker–checker: DRAFT → submit → approve → POSTED, and
 * `self_approval_not_allowed` refuses the same person doing both. That is the control, so the
 * buttons follow the status rather than all being present and mostly failing.
 *
 * ── Balance ───────────────────────────────────────────────────────────────────────────────
 *
 * An entry that does not balance is not an entry. The editor sums both sides as it is typed
 * and will not offer to save until they match — the API refuses it anyway, but finding out
 * after filling in six lines is the worst moment to be told.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

type Status = 'DRAFT' | 'PENDING_APPROVAL' | 'POSTED' | 'VOID';

type Account = { id: string; code: string; name: string; accountType: string; isActive: boolean };

type Line = {
  id?: string; accountId: string; accountCode?: string; accountName?: string;
  debit: number; credit: number; description: string | null;
};

type Entry = {
  id: string; number: string; entryDate: string; description: string | null;
  status: Status; refType: string | null; refId: string | null;
  currencyCode: string; totalDebit: number; totalCredit: number;
  rejectionReason: string | null; lines: Line[];
};

const STATUS_STYLE: Record<Status, string> = {
  DRAFT: 'ae-badge-muted',
  PENDING_APPROVAL: 'ae-badge-warn',
  POSTED: 'ae-badge-success',
  VOID: 'ae-badge-danger',
};

const STATUSES: ('' | Status)[] = ['', 'DRAFT', 'PENDING_APPROVAL', 'POSTED', 'VOID'];

const ERROR_KEY: Record<string, string> = {
  forbidden: 'accounting.journals.error.forbidden',
  journal_locked: 'accounting.journals.error.journal_locked',
  journal_auto_locked: 'accounting.journals.reverseAutoNotAllowed',
  journal_not_pending: 'accounting.journals.error.journal_not_pending',
  self_approval_not_allowed: 'accounting.journals.selfApprovalBlocked',
  period_closed: 'accounting.journals.periodClosed',
  unbalanced: 'accounting.journalBalanceError',
};

const BLANK: Line = { accountId: '', debit: 0, credit: 0, description: '' };

export default function JournalsPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const [entries, setEntries] = useState<Entry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [trial, setTrial] = useState<{ rows: { code: string; name: string; debit: number; credit: number }[]; totalDebit: number; totalCredit: number; balanced: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [status, setStatus] = useState<'' | Status>('');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<'journals' | 'trial'>('journals');

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    entryDate: new Date().toISOString().slice(0, 10),
    description: '',
    lines: [{ ...BLANK }, { ...BLANK }] as Line[],
  });

  const money = useCallback(
    (v: number, cur = 'EGP') =>
      new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
        style: 'currency', currency: cur, maximumFractionDigits: 2,
      }).format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (status) params.set('status', status);
      if (query.trim()) params.set('q', query.trim());
      const [j, a] = await Promise.all([
        api<{ items?: Entry[] }>(`/accounting/journals?${params}`),
        accounts.length ? Promise.resolve(accounts) : api<Account[]>('/accounting/accounts'),
      ]);
      setEntries(j.items ?? []);
      setAccounts(Array.isArray(a) ? a.filter((x) => x.isActive) : accounts);
    } catch (err) {
      setError(err instanceof ApiError ? 'common.error' : null);
    } finally {
      setLoading(false);
    }
  }, [status, query, accounts]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, query]);

  useEffect(() => {
    if (tab !== 'trial' || trial) return;
    void api<typeof trial>('/accounting/trial-balance').then(setTrial).catch(() => setError('accounting.trialFailed'));
  }, [tab, trial]);

  async function run(fn: () => Promise<void>, flashKey: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await fn();
      setFlash(flashKey);
      setTrial(null);
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(ERROR_KEY[code] ?? 'common.error');
    } finally {
      setBusy(false);
    }
  }

  const totals = useMemo(() => {
    const debit = form.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const credit = form.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 && debit > 0 };
  }, [form.lines]);

  const setLine = (i: number, patch: Partial<Line>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) }));

  const create = can('accounting.journals.create', 'accounting.manage');
  const approve = can('accounting.journals.approve', 'accounting.manage');
  /**
   * `accounting.manage` is exempt from `self_approval_not_allowed` — the same shape as the
   * job manager's exemption from stage preconditions. The control is real for a
   * journal_maker or journal_checker; someone holding it should know they are outside it
   * rather than conclude it does not exist.
   */
  const directPost = can('accounting.manage');

  const accountLabel = (l: Line) =>
    l.accountCode ? `${l.accountCode} · ${l.accountName}` : accounts.find((a) => a.id === l.accountId)?.name ?? '—';

  return (
    <div className="ae-page">
      <PageHero
        title={t('accounting.journals.title')}
        actions={
          create && tab === 'journals' && !creating ? (
            <button type="button" className="ae-btn-primary" onClick={() => setCreating(true)}>
              {t('accounting.journals.new')}
            </button>
          ) : undefined
        }
      />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error)}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash)}</p>}

      <div className="ae-tab-pills mb-4">
        {(['journals', 'trial'] as const).map((x) => (
          <button key={x} type="button" onClick={() => { setTab(x); setError(null); setFlash(null); }}
            className={`ae-tab-pill ${tab === x ? 'is-active' : ''}`}>
            {t(x === 'journals' ? 'accounting.journals.title' : 'reports.accounting.trialBalance')}
          </button>
        ))}
      </div>

      {tab === 'journals' && directPost && (
        <p className="ae-alert-pill ae-alert-pill--warn mb-4 block text-xs">
          {t('accounting.journals.directPostNote')}
        </p>
      )}

      {tab === 'journals' && creating && (
        <Panel title={t('accounting.journals.new')} className="ae-form-panel mb-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('accounting.journals.date')}</span>
              <input type="date" value={form.entryDate}
                onChange={(e) => setForm({ ...form, entryDate: e.target.value })} className="ae-input" />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-bold">{t('accounting.journals.description')}</span>
              <input value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} className="ae-input" />
            </label>
          </div>

          <div className="mt-4">
            <div className="ae-panel-head">
              <h3 className="ae-panel-title text-sm">{t('accounting.journals.showLines')}</h3>
              <button type="button" className="ae-btn-ghost text-xs"
                onClick={() => setForm({ ...form, lines: [...form.lines, { ...BLANK }] })}>
                {t('accounting.journals.addLine')}
              </button>
            </div>
            <div className="ae-table-wrap">
              <table className="ae-table ae-table--rows">
                <thead>
                  <tr>
                    <th>{t('accounting.journals.selectAccount')}</th>
                    <th>{t('accounting.debit')}</th>
                    <th>{t('accounting.credit')}</th>
                    <th>{t('accounting.journals.lineDescription')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        <select value={l.accountId} onChange={(e) => setLine(i, { accountId: e.target.value })}
                          className="ae-input">
                          <option value="">{t('accounting.journals.selectAccount')}</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {/* A line is one side or the other; typing in one clears the other. */}
                        <input type="number" min="0" step="any" value={l.debit || ''}
                          onChange={(e) => setLine(i, { debit: Number(e.target.value), credit: 0 })}
                          className="ae-input w-32" />
                      </td>
                      <td>
                        <input type="number" min="0" step="any" value={l.credit || ''}
                          onChange={(e) => setLine(i, { credit: Number(e.target.value), debit: 0 })}
                          className="ae-input w-32" />
                      </td>
                      <td>
                        <input value={l.description ?? ''} onChange={(e) => setLine(i, { description: e.target.value })}
                          className="ae-input" />
                      </td>
                      <td className="ae-actions-cell">
                        {form.lines.length > 2 && (
                          <button type="button" aria-label={t('common.delete')} className="ae-icon-btn ae-icon-btn-danger"
                            onClick={() => setForm({ ...form, lines: form.lines.filter((_, n) => n !== i) })}>✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>{t('accounting.journals.totals')}</th>
                    <th>{money(totals.debit)}</th>
                    <th>{money(totals.credit)}</th>
                    <th colSpan={2}>
                      {!totals.balanced && (
                        <span className="ae-stat-value--danger text-xs">{t('accounting.journalBalanceError')}</span>
                      )}
                    </th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="ae-btn-primary"
              disabled={busy || !totals.balanced || form.lines.some((l) => l.accountId === '' && (l.debit || l.credit))}
              onClick={() => void run(async () => {
                await api('/accounting/journals', {
                  method: 'POST',
                  body: {
                    entryDate: form.entryDate,
                    description: form.description,
                    currencyCode: 'EGP',
                    lines: form.lines.filter((l) => l.accountId !== ''),
                  },
                });
                setCreating(false);
                setForm({ entryDate: new Date().toISOString().slice(0, 10), description: '', lines: [{ ...BLANK }, { ...BLANK }] });
              }, 'accounting.journals.added')}>
              {busy ? t('common.saving') : t('accounting.journals.saveDraft')}
            </button>
            <button type="button" className="ae-btn-ghost" onClick={() => setCreating(false)}>{t('common.cancel')}</button>
          </div>
        </Panel>
      )}

      {tab === 'journals' && (
        <Panel
          actions={
            <div className="ae-toolbar">
              <select value={status} onChange={(e) => setStatus(e.target.value as '' | Status)} className="ae-input">
                {STATUSES.map((s) => (
                  <option key={s || 'all'} value={s}>
                    {s ? t(`accounting.journals.status.${s}`) : t('accounting.journals.filterStatus')}
                  </option>
                ))}
              </select>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={t('accounting.journals.search')} className="ae-input" />
            </div>
          }
        >
          {loading ? (
            <Skeleton rows={6} />
          ) : entries.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
          ) : (
            <div className="ae-table-wrap">
              <table className="ae-table ae-table--rows">
                <thead>
                  <tr>
                    <th>{t('accounting.journals.number')}</th>
                    <th>{t('accounting.journals.date')}</th>
                    <th>{t('accounting.journals.description')}</th>
                    <th>{t('accounting.journals.totals')}</th>
                    <th>{t('accounting.journals.status')}</th>
                    <th>{t('users.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    // An entry the system wrote is the consequence of a document, not a thing
                    // to edit — the API locks it and the buttons stay off it.
                    const auto = e.refType != null;
                    return (
                      <>
                        <tr key={e.id}>
                          <td>
                            <button type="button" className="font-bold underline" dir="ltr"
                              onClick={() => setOpenId(openId === e.id ? null : e.id)}>
                              {e.number}
                            </button>
                            {auto && (
                              <span className="ae-badge ae-badge-info mt-1 block w-fit">
                                {t(`accounting.journals.ref.${e.refType}`, e.refType!)}
                              </span>
                            )}
                          </td>
                          <td dir="ltr">{e.entryDate}</td>
                          <td>{e.description ?? '—'}</td>
                          <td className="whitespace-nowrap">{money(e.totalDebit, e.currencyCode)}</td>
                          <td>
                            <span className={`ae-badge ${STATUS_STYLE[e.status]}`}>
                              {t(`accounting.journals.status.${e.status}`)}
                            </span>
                          </td>
                          <td className="ae-actions-cell whitespace-nowrap">
                            <span className="ae-action-icons">
                              {create && !auto && e.status === 'DRAFT' && (
                                <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                                  onClick={() => void run(
                                    () => api(`/accounting/journals/${e.id}/submit`, { method: 'POST' }).then(() => undefined),
                                    'accounting.journals.submitted')}>
                                  {t('accounting.journals.submit')}
                                </button>
                              )}
                              {approve && e.status === 'PENDING_APPROVAL' && (
                                <>
                                  <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                                    onClick={() => {
                                      if (!window.confirm(t('accounting.journals.confirmApprove'))) return;
                                      void run(
                                        () => api(`/accounting/journals/${e.id}/approve`, { method: 'POST' }).then(() => undefined),
                                        'accounting.journals.approved');
                                    }}>
                                    {t('accounting.journals.approve')}
                                  </button>
                                  <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                                    onClick={() => {
                                      const reason = window.prompt(t('accounting.journals.rejectReason')) ?? '';
                                      void run(
                                        () => api(`/accounting/journals/${e.id}/reject`, { method: 'POST', body: { reason } }).then(() => undefined),
                                        'accounting.journals.rejected');
                                    }}>
                                    {t('accounting.journals.reject')}
                                  </button>
                                </>
                              )}
                              {approve && !auto && e.status === 'POSTED' && (
                                <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                                  onClick={() => {
                                    if (!window.confirm(t('accounting.journals.confirmReverse'))) return;
                                    void run(
                                      () => api(`/accounting/journals/${e.id}/reverse`, { method: 'POST' }).then(() => undefined),
                                      'accounting.journals.reversed');
                                  }}>
                                  {t('accounting.journals.reverse')}
                                </button>
                              )}
                              {create && !auto && e.status === 'DRAFT' && (
                                <button type="button" aria-label={t('common.delete')} disabled={busy}
                                  className="ae-icon-btn ae-icon-btn-danger"
                                  onClick={() => {
                                    if (!window.confirm(t('accounting.journals.confirmDelete'))) return;
                                    void run(
                                      () => api(`/accounting/journals/${e.id}`, { method: 'DELETE' }).then(() => undefined),
                                      'accounting.journals.deleted');
                                  }}>✕</button>
                              )}
                            </span>
                          </td>
                        </tr>

                        {openId === e.id && e.lines.map((l, i) => (
                          <tr key={`${e.id}-${i}`} className="text-xs">
                            <td colSpan={2}>{accountLabel(l)}</td>
                            <td>{l.debit > 0 ? money(l.debit, e.currencyCode) : '—'}</td>
                            <td>{l.credit > 0 ? money(l.credit, e.currencyCode) : '—'}</td>
                            <td colSpan={2}>{l.description ?? '—'}</td>
                          </tr>
                        ))}
                        {openId === e.id && e.rejectionReason && (
                          <tr key={`${e.id}-reason`}>
                            <td colSpan={6}>
                              <span className="ae-alert-pill ae-alert-pill--warn block text-xs">{e.rejectionReason}</span>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {tab === 'trial' && (
        <Panel title={t('reports.accounting.trialBalance')}>
          {!trial ? (
            <Skeleton rows={6} />
          ) : (
            <>
              {/* The one check the whole ledger rests on. */}
              <p className={`ae-flash mb-4 ${trial.balanced ? 'ae-flash--success' : 'ae-flash--error'}`}>
                {trial.balanced
                  ? `${t('accounting.debit')} ${money(trial.totalDebit)} = ${t('accounting.credit')} ${money(trial.totalCredit)}`
                  : t('reports.accounting.trialUnbalanced')}
              </p>

              <div className="ae-table-wrap">
                <table className="ae-table ae-table--rows">
                  <thead>
                    <tr>
                      <th>{t('accounting.journals.number')}</th>
                      <th>{t('accounting.name', t('users.name'))}</th>
                      <th>{t('accounting.debit')}</th>
                      <th>{t('accounting.credit')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trial.rows.map((r) => (
                      <tr key={r.code}>
                        <td dir="ltr">{r.code}</td>
                        <td>{r.name}</td>
                        <td>{r.debit > 0 ? money(r.debit) : '—'}</td>
                        <td>{r.credit > 0 ? money(r.credit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={2}>{t('accounting.journals.totals')}</th>
                      <th>{money(trial.totalDebit)}</th>
                      <th>{money(trial.totalCredit)}</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
