'use client';

/**
 * صيانة الماكينات — preventive upkeep, driven by the impression counter.
 *
 * A press does not wear out by the calendar, it wears out by how much it has printed. So a plan
 * can be set by impressions, by days, or by both — and when both are set, whichever comes first
 * is what makes it due. That is the server's rule and this screen shows both countdowns rather
 * than collapsing them into one number, because "6,000 impressions left but overdue by a week"
 * is a different conversation from either half alone.
 *
 * ── The counter only goes forward ─────────────────────────────────────────────────────────
 *
 * A reading below the last known one is refused (`reading_below_last_known`). An impression
 * counter that went backwards means someone typed it wrong, and accepting it would reset every
 * plan on that machine to a wrong baseline — a maintenance schedule that quietly stops being due.
 *
 * ── The machines are the pricing machines ─────────────────────────────────────────────────
 *
 * There is no separate machine register: these are the presses in التسعير ← البيانات الأساسية,
 * the same rows the print calculator quotes from. One machine, one record, whether the question
 * is what it costs to run or when it was last serviced.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

type Reading = { id: string; readingValue: number; readingDate: string; notes: string | null };
type Plan = {
  id: string; machineId: string; name: string;
  intervalImpressions: number | null; intervalDays: number | null;
  lastServiceAt: string | null; lastServiceImpression: number | null;
  isActive: boolean; notes: string | null;
  status: 'OK' | 'DUE_SOON' | 'OVERDUE';
  impressionsRemaining: number | null; daysRemaining: number | null;
};
type MachineRow = {
  machineId: string; machineLabel: string;
  latestReading: Reading | null; plans: Plan[];
};

const STATUS_TONE: Record<Plan['status'], string> = {
  OK: 'ae-badge-success', DUE_SOON: 'ae-badge-warn', OVERDUE: 'ae-badge-danger',
};

export default function MaintenancePage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const manage = can('scheduling.manage');

  const [rows, setRows] = useState<MachineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Open forms, keyed by machine — several machines can be worked on without losing input. */
  const [reading, setReading] = useState<Record<string, { value: string; date: string }>>({});
  const [newPlan, setNewPlan] = useState<Record<string, { name: string; impressions: string; days: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ items?: MachineRow[] }>('/machines/maintenance-dashboard');
      setRows(d.items ?? []);
    } catch {
      setError('common.error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG').format(v),
    [lang],
  );
  const date = useCallback(
    (v: string | null) => (v ? new Date(v).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB') : '—'),
    [lang],
  );

  async function call(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method, ...(body ? { body } : {}) });
      await load();
      return true;
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      // reading_below_last_known has its own sentence in the dictionary; it is the one a
      // person will actually hit, and "could not save" would not tell them what to change.
      setError(code === 'reading_below_last_known' ? 'maintenance.readingError'
        : code ? `maintenance.error.${code}` : 'common.error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="ae-page">
        <PageHero title={t('maintenance.title')} subtitle={t('maintenance.subtitle')} />
        <Panel><Skeleton rows={6} /></Panel>
      </div>
    );
  }

  return (
    <div className="ae-page">
      <PageHero title={t('maintenance.title')} subtitle={t('maintenance.subtitle')} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}

      {rows.length === 0 ? (
        <Panel><p className="text-sm text-[var(--text-muted)]">{t('maintenance.noMachines')}</p></Panel>
      ) : (
        <div className="grid gap-4">
          {rows.map((m) => {
            const r = reading[m.machineId] ?? { value: '', date: new Date().toISOString().slice(0, 10) };
            const p = newPlan[m.machineId] ?? { name: '', impressions: '', days: '' };
            return (
              <Panel key={m.machineId} title={m.machineLabel}>
                <p className="mb-3 text-sm">
                  <span className="font-bold">{t('maintenance.latestReading')}: </span>
                  {m.latestReading
                    ? `${num(m.latestReading.readingValue)} ${t('maintenance.impressions')} · ${date(m.latestReading.readingDate)}`
                    : <span className="text-[var(--text-muted)]">{t('maintenance.noReading')}</span>}
                </p>

                {manage && (
                  <div className="ae-section-card mb-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <label className="text-sm">
                      <span className="mb-1 block font-bold">{t('maintenance.newReading')}</span>
                      <input type="number" min="0" step="1" className="ae-input" value={r.value}
                        onChange={(e) => setReading({ ...reading, [m.machineId]: { ...r, value: e.target.value } })} />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block font-bold">{t('invoices.date')}</span>
                      <input type="date" className="ae-input" value={r.date}
                        onChange={(e) => setReading({ ...reading, [m.machineId]: { ...r, date: e.target.value } })} />
                    </label>
                    <button type="button" className="ae-btn-primary"
                      disabled={busy || r.value === ''}
                      onClick={async () => {
                        const ok = await call('/machines/readings', 'POST', {
                          machineId: m.machineId, readingValue: Number(r.value), readingDate: r.date,
                        });
                        if (ok) setReading({ ...reading, [m.machineId]: { value: '', date: r.date } });
                      }}>
                      {t('maintenance.logReading')}
                    </button>
                  </div>
                )}

                {m.plans.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">{t('maintenance.noPlans')}</p>
                ) : (
                  <div className="ae-table-wrap">
                    <table className="ae-table">
                      <thead>
                        <tr>
                          <th>{t('maintenance.planName')}</th>
                          <th>{t('maintenance.remaining')}</th>
                          <th>{t('invoices.status')}</th>
                          <th>{t('maintenance.markServiced')}</th>
                          <th aria-label={t('quotes.actions')} />
                        </tr>
                      </thead>
                      <tbody>
                        {m.plans.map((pl) => (
                          <tr key={pl.id}>
                            <td>{pl.name}</td>
                            <td className="text-xs">
                              {/* Both countdowns, because whichever runs out first is what
                                  makes the plan due and only showing one hides the other. */}
                              {pl.impressionsRemaining !== null && (
                                <span className="block">
                                  {num(pl.impressionsRemaining)} {t('maintenance.impressions')}
                                </span>
                              )}
                              {pl.daysRemaining !== null && (
                                <span className="block">
                                  {num(pl.daysRemaining)} {t('maintenance.days')}
                                </span>
                              )}
                              {pl.impressionsRemaining === null && pl.daysRemaining === null && '—'}
                            </td>
                            <td>
                              <span className={`ae-badge ${STATUS_TONE[pl.status]} text-xs`}>
                                {t(`maintenance.status.${pl.status}`)}
                              </span>
                            </td>
                            <td className="text-xs">{date(pl.lastServiceAt)}</td>
                            <td>
                              {manage && (
                                <span className="flex flex-wrap gap-1">
                                  <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                                    onClick={() => {
                                      if (!window.confirm(t('maintenance.completeConfirm'))) return;
                                      void call(`/machines/maintenance-plans/${pl.id}/complete`, 'POST', {});
                                    }}>
                                    {t('maintenance.markServiced')}
                                  </button>
                                  <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                                    onClick={() => {
                                      if (!window.confirm(t('maintenance.deleteConfirm'))) return;
                                      void call(`/machines/maintenance-plans/${pl.id}`, 'DELETE');
                                    }}>
                                    {t('common.delete')}
                                  </button>
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {manage && (
                  <div className="ae-section-card mt-4 grid gap-3">
                    <h4 className="text-sm font-bold">{t('maintenance.newPlan')}</h4>
                    <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                      <label className="text-sm">
                        <span className="mb-1 block font-bold">{t('maintenance.planName')}</span>
                        <input className="ae-input" value={p.name}
                          onChange={(e) => setNewPlan({ ...newPlan, [m.machineId]: { ...p, name: e.target.value } })} />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block font-bold">{t('maintenance.intervalImpressions')}</span>
                        <input type="number" min="0" step="1" className="ae-input" value={p.impressions}
                          onChange={(e) => setNewPlan({ ...newPlan, [m.machineId]: { ...p, impressions: e.target.value } })} />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block font-bold">{t('maintenance.intervalDays')}</span>
                        <input type="number" min="0" step="1" className="ae-input" value={p.days}
                          onChange={(e) => setNewPlan({ ...newPlan, [m.machineId]: { ...p, days: e.target.value } })} />
                      </label>
                      <button type="button" className="ae-btn-secondary text-xs"
                        disabled={busy || p.name.trim() === '' || (p.impressions === '' && p.days === '')}
                        onClick={async () => {
                          const ok = await call('/machines/maintenance-plans', 'POST', {
                            machineId: m.machineId, name: p.name.trim(),
                            // Left blank means this interval does not apply, which is not zero.
                            intervalImpressions: p.impressions === '' ? null : Number(p.impressions),
                            intervalDays: p.days === '' ? null : Number(p.days),
                          });
                          if (ok) setNewPlan({ ...newPlan, [m.machineId]: { name: '', impressions: '', days: '' } });
                        }}>
                        {t('maintenance.addPlan')}
                      </button>
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">{t('maintenance.intervalHint')}</p>
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
