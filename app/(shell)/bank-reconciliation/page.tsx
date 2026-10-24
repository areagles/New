'use client';

/**
 * المطابقة البنكية — making the books agree with the bank.
 *
 * Two records of the same money: what the system thinks is in the account (رصيد الدفاتر, built
 * from receipts and journal entries) and what the bank says (رصيد الكشف, the opening balance
 * plus every imported line). The gap between them is الفرق, and reconciliation is the work of
 * driving it to zero.
 *
 * A non-zero variance is not an error. It is usually a receipt recorded but not yet cleared, or
 * a bank charge nobody has entered — which is exactly why the unmatched lines and the unmatched
 * receipts are shown side by side with it, rather than the variance being reported alone.
 *
 * ── Matching, in three degrees of trust ───────────────────────────────────────────────────
 *
 *   اقتراحات      the server proposes: same direction, within seven days, within five piastres.
 *   تلقائي        a saved pattern in the description auto-matches — but only when exactly one
 *                 candidate at that amount exists. More than one and it is left alone, because
 *                 guessing between two receipts is how the wrong invoice gets marked paid.
 *   استبعاد       for lines that will never match anything: charges, interest, transfers.
 *
 * Every one of them is reversible. Nothing here writes a journal entry.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

type BankAccount = {
  id: string; code: string; name: string; bankName: string | null;
  accountNumber: string | null; currencyCode: string; openingBalance: number; isActive: boolean;
};
type Txn = {
  id: string; transactionDate: string; description: string | null; reference: string | null;
  amount: number; balanceAfter: number | null; matchStatus: 'UNMATCHED' | 'MATCHED' | 'EXCLUDED';
  matchedRefType: string | null; matchedRefId: string | null;
};
/** Shape read off a real response: the server labels each candidate and scores the fit. */
type Suggestion = {
  refType: string; refId: string; label: string;
  date: string; amount: number; score: number;
};
type Summary = {
  bankAccount: BankAccount; dateTo: string;
  bookBalance: number; statementBalance: number; variance: number;
  unmatchedTransactionCount: number; unmatchedTransactionTotal: number;
  matchedTransactionCount: number;
  unmatchedReceipts: { id: string; number: string | null; receiptDate: string; type: string; amount: number; partyName: string | null }[];
};
type Rule = { id: string; pattern: string; bank_account_id?: string; matched_count?: number; matchedCount?: number };

const STATUSES = ['UNMATCHED', 'MATCHED', 'EXCLUDED'] as const;

export default function BankReconciliationPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const reconcile = can('finance.bank.reconcile');

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('UNMATCHED');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  /** Suggestions are fetched per line on demand — one request per row up front would be rude. */
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion[]>>({});
  const [importing, setImporting] = useState(false);
  const [csv, setCsv] = useState('');
  const [newPattern, setNewPattern] = useState('');

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
    (v: string | null | undefined) => (v ? new Date(v.replace(' ', 'T')).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB') : '—'),
    [lang],
  );

  const loadAccounts = useCallback(async () => {
    try {
      const a = await api<BankAccount[] | { items?: BankAccount[] }>('/bank-accounts');
      const list = Array.isArray(a) ? a : (a.items ?? []);
      setAccounts(list);
      setAccountId((id) => id || list[0]?.id || '');
    } catch {
      setError('bank.loadFailed');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAccountData = useCallback(async () => {
    if (!accountId) return;
    try {
      const [s, tx, r] = await Promise.all([
        api<Summary>(`/bank-reconciliation/summary?bankAccountId=${accountId}`),
        api<Txn[]>(`/bank-reconciliation/transactions?bankAccountId=${accountId}${statusFilter ? `&status=${statusFilter}` : ''}`),
        api<{ items?: Rule[] }>('/bank-reconciliation/match-rules').catch(() => ({ items: [] })),
      ]);
      setSummary(s);
      setTxns(Array.isArray(tx) ? tx : []);
      setRules(r.items ?? []);
      setSuggestions({});
    } catch {
      setError('bank.loadFailed');
    }
  }, [accountId, statusFilter]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    void loadAccountData();
  }, [loadAccountData]);

  async function call(path: string, method: 'POST' | 'DELETE', body?: Record<string, unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await api<Record<string, unknown>>(path, { method, ...(body ? { body } : {}) });
      if (ok) setFlash(ok);
      await loadAccountData();
      return res;
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code ? `bank.error.${code}` : 'common.error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function suggest(txnId: string) {
    setError(null);
    try {
      const res = await api<Suggestion[]>(`/bank-reconciliation/transactions/${txnId}/suggest`);
      setSuggestions({ ...suggestions, [txnId]: Array.isArray(res) ? res : [] });
    } catch {
      setError('common.error');
    }
  }

  if (loading) {
    return (
      <div className="ae-page">
        <PageHero title={t('bank.title')} subtitle={t('bank.subtitle')} />
        <Panel><Skeleton rows={6} /></Panel>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="ae-page">
        <PageHero title={t('bank.title')} subtitle={t('bank.subtitle')} />
        <Panel><p className="text-sm text-[var(--text-muted)]">{t('bank.noAccounts')}</p></Panel>
      </div>
    );
  }

  const cur = summary?.bankAccount.currencyCode ?? 'EGP';
  /** Reconciled is variance zero; anything else is work outstanding, however small. */
  const reconciled = summary !== null && Math.abs(summary.variance) < 0.005;

  return (
    <div className="ae-page">
      <PageHero title={t('bank.title')} subtitle={t('bank.subtitle')}
        actions={reconcile && (
          <span className="flex flex-wrap gap-2">
            <button type="button" className="ae-btn-secondary text-xs" onClick={() => setImporting(!importing)}>
              {t('bank.importTitle')}
            </button>
            <button type="button" className="ae-btn-primary text-xs" disabled={busy}
              onClick={async () => {
                const res = await call('/bank-reconciliation/auto-match', 'POST', { bankAccountId: accountId }, undefined);
                if (!res) return;
                // Matched and skipped are reported separately: skipped means several candidates
                // at the same amount, which is a human decision, not a failure.
                setFlash(`${t('bank.rules.runResultMatched')} ${num(Number(res.matchedCount ?? 0))}`
                  + ` · ${t('bank.rules.runResultSkipped')} ${num(Number(res.skippedCount ?? 0))}`);
              }}>
              {t('bank.rules.runAutoMatch')}
            </button>
          </span>
        )} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash, flash)}</p>}

      <div className="ae-toolbar mb-4">
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('bank.selectAccount')}</span>
          <select className="ae-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.bankName ? ` — ${a.bankName}` : ''} · {a.currencyCode}
              </option>
            ))}
          </select>
        </label>
      </div>

      {summary && (
        <Panel className="mb-4">
          <div className="ae-counter-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="ae-counter">
              <span className="ae-counter-label">{t('bank.bookBalance')}</span>
              <span className="ae-counter-value">{money(summary.bookBalance, cur)}</span>
            </div>
            <div className="ae-counter">
              <span className="ae-counter-label">{t('bank.statementBalance')}</span>
              <span className="ae-counter-value">{money(summary.statementBalance, cur)}</span>
            </div>
            <div className={`ae-counter${reconciled ? ' ae-counter--success' : ' ae-counter--warn'}`}>
              <span className="ae-counter-label">{t('bank.variance')}</span>
              <span className="ae-counter-value">{money(summary.variance, cur)}</span>
            </div>
            <div className="ae-counter">
              <span className="ae-counter-label">{t('bank.unmatchedCount')}</span>
              <span className="ae-counter-value">{num(summary.unmatchedTransactionCount)}</span>
              <span className="ae-counter-hint">{money(summary.unmatchedTransactionTotal, cur)}</span>
            </div>
          </div>

          {/* The other half of the gap: money the system knows about that the statement has
              not shown yet. Shown next to the variance because that is usually what it is. */}
          {summary.unmatchedReceipts.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-bold">{t('bank.unmatchedReceipts')}</h3>
              <ul className="grid gap-1 text-xs">
                {summary.unmatchedReceipts.slice(0, 10).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>{r.number ?? '—'} · {r.partyName ?? '—'}</span>
                    <span className="text-[var(--text-muted)]">
                      {date(r.receiptDate)} · {money(r.amount, cur)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}

      {importing && reconcile && (
        <Panel title={t('bank.importTitle')} className="mb-4">
          <p className="mb-2 text-xs text-[var(--text-muted)]">{t('bank.importHint')}</p>
          <textarea className="ae-input font-mono text-xs" rows={6} value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={'2026-08-01,تحويل من عميل,TRX-1,5000\n2026-08-02,مصاريف بنكية,,-50'} />
          <div className="mt-3 flex gap-2">
            <button type="button" className="ae-btn-primary" disabled={busy || csv.trim() === ''}
              onClick={async () => {
                const res = await call('/bank-reconciliation/import', 'POST',
                  { bankAccountId: accountId, csv }, undefined);
                if (!res) return;
                setCsv('');
                setImporting(false);
                setFlash(`${t('bank.importSuccess')} · ${num(Number(res.importedCount ?? 0))}`);
              }}>
              {t('bank.import')}
            </button>
            <button type="button" className="ae-btn-ghost" onClick={() => setImporting(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </Panel>
      )}

      <Panel title={t('bank.transactions')}>
        <div className="ae-tab-pills mb-3">
          <button type="button" className={`ae-tab-pill ${statusFilter === '' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('')}>{t('common.all')}</button>
          {STATUSES.map((s) => (
            <button key={s} type="button" className={`ae-tab-pill ${statusFilter === s ? 'is-active' : ''}`}
              onClick={() => setStatusFilter(s)}>{t(`bank.status.${s}`)}</button>
          ))}
        </div>

        {txns.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
        ) : (
          <div className="ae-table-wrap">
            <table className="ae-table">
              <thead>
                <tr>
                  <th>{t('invoices.date')}</th>
                  <th>{t('bank.description')}</th>
                  <th>{t('bank.reference')}</th>
                  <th>{t('bank.amount')}</th>
                  <th>{t('bank.status')}</th>
                  <th aria-label={t('quotes.actions')} />
                </tr>
              </thead>
              <tbody>
                {txns.map((tx) => (
                  <tr key={tx.id}>
                    <td className="text-xs">{date(tx.transactionDate)}</td>
                    <td>{tx.description ?? '—'}</td>
                    <td className="text-xs">{tx.reference ?? '—'}</td>
                    <td className={`font-bold ${tx.amount < 0 ? 'text-[var(--danger,#dc2626)]' : ''}`}>
                      {money(tx.amount, cur)}
                    </td>
                    <td>
                      <span className={`ae-badge text-xs ${
                        tx.matchStatus === 'MATCHED' ? 'ae-badge-success'
                          : tx.matchStatus === 'EXCLUDED' ? 'ae-badge-muted' : 'ae-badge-warn'}`}>
                        {t(`bank.status.${tx.matchStatus}`)}
                      </span>
                    </td>
                    <td>
                      {reconcile && (
                        <span className="flex flex-wrap gap-1">
                          {tx.matchStatus === 'MATCHED' ? (
                            <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                              onClick={() => {
                                if (!window.confirm(t('bank.confirmUnmatch'))) return;
                                void call(`/bank-reconciliation/transactions/${tx.id}/unmatch`, 'POST', {}, 'bank.unmatched');
                              }}>
                              {t('bank.unmatch')}
                            </button>
                          ) : tx.matchStatus === 'UNMATCHED' ? (
                            <>
                              <button type="button" className="ae-btn-ghost px-2 py-1 text-xs"
                                onClick={() => void suggest(tx.id)}>
                                {t('bank.suggest')}
                              </button>
                              <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                                onClick={() => void call(`/bank-reconciliation/transactions/${tx.id}/exclude`, 'POST', {}, undefined)}>
                                {t('bank.exclude')}
                              </button>
                            </>
                          ) : null}
                        </span>
                      )}

                      {/* Suggestions open under the line they belong to, so the amounts being
                          compared are next to each other rather than in a dialog. */}
                      {suggestions[tx.id] && (
                        <div className="mt-2 grid gap-1 text-xs">
                          <span className="font-bold">{t('bank.suggestionsFor')}</span>
                          {suggestions[tx.id].length === 0 ? (
                            <span className="text-[var(--text-muted)]">{t('common.noResults')}</span>
                          ) : suggestions[tx.id].map((s) => (
                            <button key={`${s.refType}-${s.refId}`} type="button"
                              className="ae-btn-ghost px-2 py-1 text-start text-xs" disabled={busy}
                              onClick={() => void call(`/bank-reconciliation/transactions/${tx.id}/match`, 'POST',
                                { refType: s.refType, refId: s.refId }, 'bank.matched')}>
                              {t('bank.match')} · {s.label} · {money(s.amount, cur)} · {date(s.date)}
                              {/* The score is the server's confidence; a weak match deserves
                                  a second look before it is accepted. */}
                              <span className="ms-2 text-[var(--text-muted)]">{num(s.score)}%</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {reconcile && (
        <Panel title={t('bank.rules.title')} className="mt-4">
          <p className="mb-3 text-xs text-[var(--text-muted)]">{t('bank.rules.hint')}</p>
          <div className="ae-toolbar mb-3">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('bank.rules.addPattern')}</span>
              <input className="ae-input" value={newPattern} placeholder={t('bank.rules.patternPlaceholder')}
                onChange={(e) => setNewPattern(e.target.value)} />
            </label>
            <button type="button" className="ae-btn-secondary self-end text-xs"
              disabled={busy || newPattern.trim() === ''}
              onClick={async () => {
                const res = await call('/bank-reconciliation/match-rules', 'POST',
                  { pattern: newPattern.trim(), bankAccountId: accountId }, 'common.success');
                if (res) setNewPattern('');
              }}>
              {t('common.save')}
            </button>
          </div>

          {rules.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {rules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{r.pattern}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-muted)]">
                      {t('bank.rules.matchedCount')}: {num(Number(r.matchedCount ?? r.matched_count ?? 0))}
                    </span>
                    <button type="button" aria-label={t('common.delete')} className="ae-icon-btn ae-icon-btn-danger"
                      onClick={() => {
                        if (!window.confirm(t('bank.rules.confirmDelete'))) return;
                        void call(`/bank-reconciliation/match-rules/${r.id}`, 'DELETE', undefined, 'common.success');
                      }}>✕</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}
