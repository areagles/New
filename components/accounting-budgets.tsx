'use client';

/**
 * الميزانيات — a monthly target per account, against what actually posted.
 *
 * One line per account per month. The actual side is not entered: it comes from posted journal
 * entries for that account in that month, which is the only version of "actual" worth comparing
 * against — a budget measured against a number somebody typed measures nothing.
 *
 * ── The sign of a variance depends on the account ─────────────────────────────────────────
 *
 * Spending less than budgeted on an expense is good; earning less than budgeted on revenue is
 * not. The server returns `variance` as actual minus budget and leaves the reading to the
 * screen, so the colour here follows the account type rather than the sign alone.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Panel, Skeleton } from '@/components/page';
import type { Account } from '@/app/(shell)/accounting/page';

type MonthRow = { month: number; budget: number; actual: number; variance: number };
type AccountRow = {
  accountId: string; accountCode: string; accountName: string; accountType: string;
  months: MonthRow[];
};
type Line = { id: string; accountId: string; periodYear: number; periodMonth: number; amount: number };

export function AccountingBudgets({ accounts, manage }: { accounts: Account[]; manage: boolean }) {
  const { t, lang } = useI18n();

  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [form, setForm] = useState({ accountId: '', month: String(new Date().getMonth() + 1), amount: '' });

  const money = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency: 'EGP', maximumFractionDigits: 0,
    }).format(v),
    [lang],
  );
  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', { useGrouping: false }).format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ accounts?: AccountRow[]; lines?: Line[] }>(`/accounting/budgets?year=${year}`);
      setRows(d.accounts ?? []);
      setLines(d.lines ?? []);
    } catch {
      setError('common.error');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(path: string, method: 'POST' | 'DELETE', body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await api(path, { method, ...(body ? { body } : {}) });
      setFlash('common.success');
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

  /**
   * Under budget on an expense is good news; under budget on revenue is not. The raw sign
   * cannot say which, so the account type does.
   */
  const varianceTone = (accountType: string, variance: number) => {
    if (Math.abs(variance) < 0.005) return '';
    const good = accountType === 'EXPENSE' ? variance < 0 : variance > 0;
    return good ? 'text-[var(--success,#16a34a)]' : 'text-[var(--danger,#dc2626)]';
  };

  return (
    <div className="grid gap-4">
      {error && <p className="ae-flash ae-flash--error">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success">{t(flash)}</p>}

      <Panel title={t('accounting.budgets.title')}>
        <p className="mb-3 text-xs text-[var(--text-muted)]">{t('accounting.budgets.subtitle')}</p>

        <div className="ae-toolbar mb-3">
          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('accounting.periods.year')}</span>
            <input type="number" min="2000" max="2100" step="1" className="ae-input w-32"
              value={year} onChange={(e) => setYear(Number(e.target.value) || thisYear)} />
          </label>
        </div>

        {manage && (
          <div className="ae-section-card mb-4 grid gap-3 sm:grid-cols-[1fr_8rem_10rem_auto] sm:items-end">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('accounting.name')}</span>
              <select className="ae-input" value={form.accountId}
                onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
                <option value="">—</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('accounting.periods.month')}</span>
              <select className="ae-input" value={form.month}
                onChange={(e) => setForm({ ...form, month: e.target.value })}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={String(m)}>{num(m)}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('accounting.budgets.amount')}</span>
              <input type="number" min="0" step="any" className="ae-input" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </label>
            <button type="button" className="ae-btn-secondary text-xs"
              disabled={busy || form.accountId === '' || form.amount === ''}
              onClick={async () => {
                const ok = await call('/accounting/budgets', 'POST', {
                  accountId: form.accountId, periodYear: year,
                  periodMonth: Number(form.month), amount: Number(form.amount),
                });
                if (ok) setForm({ ...form, amount: '' });
              }}>
              {t('common.save')}
            </button>
          </div>
        )}

        {loading ? <Skeleton rows={6} /> : rows.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t('accounting.budgets.empty')}</p>
        ) : (
          <div className="ae-table-wrap">
            <table className="ae-table">
              <thead>
                <tr>
                  <th>{t('accounting.code')}</th>
                  <th>{t('accounting.name')}</th>
                  <th>{t('accounting.periods.month')}</th>
                  <th>{t('accounting.budgets.amount')}</th>
                  <th>{t('accounting.budgets.actual')}</th>
                  <th>{t('accounting.variance')}</th>
                  {manage && <th aria-label={t('quotes.actions')} />}
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((r) => r.months.map((m) => {
                  const line = lines.find(
                    (l) => l.accountId === r.accountId && l.periodMonth === m.month && l.periodYear === year,
                  );
                  return (
                    <tr key={`${r.accountId}-${m.month}`}>
                      <td className="font-mono text-xs">{r.accountCode}</td>
                      <td>{r.accountName}</td>
                      <td>{num(m.month)}</td>
                      <td>{money(m.budget)}</td>
                      <td>{money(m.actual)}</td>
                      <td className={`font-bold ${varianceTone(r.accountType, m.variance)}`}>
                        {money(m.variance)}
                      </td>
                      {manage && (
                        <td>
                          {line && (
                            <button type="button" aria-label={t('common.delete')}
                              className="ae-icon-btn ae-icon-btn-danger" disabled={busy}
                              onClick={() => void call(`/accounting/budgets/${line.id}`, 'DELETE')}>✕</button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
