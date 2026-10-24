'use client';

/**
 * إقفال الفترات — freezing a month so nothing else can be posted into it.
 *
 * An open month is a month whose numbers can still change. Once the accounts have been reported
 * on, that has to stop, and closing is how: the API refuses to post or void a journal entry in a
 * closed period, which is what makes last month's figures the same next week.
 *
 * ── The checklist is a precondition, not advice ───────────────────────────────────────────
 *
 * Before closing, the server lists what is in the way: a draft invoice, a draft payroll run, an
 * unposted journal — and, crucially, a prior month still open, because closing March while
 * February is open leaves a hole that only shows up at year end. Anything at severity `error`
 * blocks the close outright. So the checklist is fetched and shown before the button is offered,
 * rather than the close being attempted and refused.
 *
 * ── Two irreversible-shaped actions ───────────────────────────────────────────────────────
 *
 * الإقفال السنوي posts a closing entry that moves the year's profit into equity. إعادة الفتح
 * unlocks a month somebody deliberately locked. Both ask first. Neither is undone by clicking
 * again.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Panel, Skeleton } from '@/components/page';

type Period = { id: string | null; year: number; month: number; status: 'OPEN' | 'CLOSED'; closedAt: string | null };
type Issue = { code: string; severity: string; month?: number };

export function AccountingPeriods({ manage }: { manage: boolean }) {
  const { t, lang } = useI18n();

  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [checklist, setChecklist] = useState<{ year: number; month: number; issues: Issue[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', { useGrouping: false }).format(v),
    [lang],
  );
  const money = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency: 'EGP', maximumFractionDigits: 2,
    }).format(v),
    [lang],
  );
  const dateTime = useCallback(
    (v: string | null) => (v ? new Date(v.replace(' ', 'T')).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB') : '—'),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPeriods(await api<Period[]>(`/accounting/periods?year=${year}`));
    } catch {
      setError('accounting.periods.loadFailed');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openChecklist(p: Period) {
    setError(null);
    setFlash(null);
    setChecklist(null);
    try {
      const res = await api<{ year: number; month: number; issues: Issue[] }>(
        `/accounting/periods/checklist?year=${p.year}&month=${p.month}`,
      );
      setChecklist(res);
    } catch {
      setError('accounting.periods.loadFailed');
    }
  }

  async function call(path: string, body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await api<Record<string, unknown>>(path, { method: 'POST', body });
      setFlash(ok);
      setChecklist(null);
      await load();
      return res;
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      // A blocked close carries the reasons with it; showing them beats a bare refusal.
      const issues = err instanceof ApiError ? (err.payload as { issues?: Issue[] }).issues : undefined;
      if (issues?.length) setChecklist({ year, month: 0, issues });
      setError(code ? `accounting.error.${code}` : 'common.error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const blocking = (checklist?.issues ?? []).filter((i) => i.severity === 'error');

  return (
    <div className="grid gap-4">
      {error && <p className="ae-flash ae-flash--error">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success">{t(flash, flash)}</p>}

      <Panel title={t('accounting.periods.title')}
        actions={manage && (
          <button type="button" className="ae-btn-secondary text-xs" disabled={busy}
            onClick={async () => {
              if (!window.confirm(t('accounting.periods.confirmYearClose'))) return;
              const res = await call('/accounting/periods/year-close', { year }, undefined as unknown as string);
              if (res) setFlash(`${t('accounting.periods.yearClosed')} · ${money(Number(res.netIncome ?? 0))}`);
            }}>
            {t('accounting.periods.yearClose')}
          </button>
        )}>
        <p className="mb-3 text-xs text-[var(--text-muted)]">{t('accounting.periods.hint')}</p>

        <div className="ae-toolbar mb-3">
          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('accounting.periods.year')}</span>
            <input type="number" min="2000" max="2100" step="1" className="ae-input w-32"
              value={year} onChange={(e) => setYear(Number(e.target.value) || thisYear)} />
          </label>
        </div>

        {loading ? <Skeleton rows={6} /> : (
          <div className="ae-table-wrap">
            <table className="ae-table">
              <thead>
                <tr>
                  <th>{t('accounting.periods.month')}</th>
                  <th>{t('accounting.periods.status')}</th>
                  <th>{t('accounting.periods.closedAt')}</th>
                  {manage && <th aria-label={t('quotes.actions')} />}
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={`${p.year}-${p.month}`}>
                    <td>{num(p.month)} / {num(p.year)}</td>
                    <td>
                      <span className={`ae-badge ${p.status === 'CLOSED' ? 'ae-badge-muted' : 'ae-badge-success'} text-xs`}>
                        {t(`accounting.periods.status.${p.status}`)}
                      </span>
                    </td>
                    <td className="text-xs">{dateTime(p.closedAt)}</td>
                    {manage && (
                      <td>
                        <span className="flex flex-wrap gap-1">
                          {p.status === 'OPEN' ? (
                            <button type="button" className="ae-btn-ghost px-2 py-1 text-xs"
                              onClick={() => void openChecklist(p)}>
                              {t('accounting.periods.checklistTitle')}
                            </button>
                          ) : (
                            <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                              onClick={() => {
                                if (!window.confirm(t('accounting.periods.confirmReopen'))) return;
                                void call('/accounting/periods/reopen', { year: p.year, month: p.month },
                                  'accounting.periods.reopened');
                              }}>
                              {t('accounting.periods.reopen')}
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

      {checklist && (
        <Panel title={`${t('accounting.periods.checklistTitle')} — ${num(checklist.month)} / ${num(checklist.year)}`}>
          {checklist.issues.length === 0 ? (
            <p className="ae-flash ae-flash--success">{t('accounting.periods.checklistOk')}</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {checklist.issues.map((i, ix) => (
                <li key={ix} className="flex items-center gap-2">
                  <span aria-hidden>{i.severity === 'error' ? '🔴' : '🟠'}</span>
                  <span>
                    {t(`accounting.periods.checklist.${i.code}`,
                      i.code, i.month !== undefined ? { month: num(i.month) } : undefined)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {manage && checklist.month > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {/* Offered only when nothing blocks it — the server would refuse otherwise, and a
                  button that exists to be refused teaches people to ignore refusals. */}
              {blocking.length === 0 ? (
                <button type="button" className="ae-btn-primary" disabled={busy}
                  onClick={() => {
                    if (!window.confirm(t('accounting.periods.confirmClose'))) return;
                    void call('/accounting/periods/close',
                      { year: checklist.year, month: checklist.month }, 'accounting.periods.closed');
                  }}>
                  {t('accounting.periods.close')}
                </button>
              ) : (
                <p className="ae-alert-pill ae-alert-pill--warn block text-xs">
                  {t('accounting.periods.closeBlocked')}
                </p>
              )}
              <button type="button" className="ae-btn-ghost" onClick={() => setChecklist(null)}>
                {t('common.cancel')}
              </button>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
