'use client';

/**
 * متابعة العملاء — the pipeline, and the promises made along it.
 *
 * Four views of the same thing. مسار المبيعات is the board: deals in columns by stage, dragged
 * forward as they progress. المتابعات is the list of calls, meetings and notes with dates
 * attached — the half of selling that is remembering to ring back. التوقّع weights each deal by
 * its probability. القمع measures how many leads survive to a paid invoice.
 *
 * ── A lead is a deal with no client yet ───────────────────────────────────────────────────
 *
 * There is no separate lead record. A deal whose `clientId` is null is a lead: it carries its
 * own company, phone and email, and turns into a real client only when it is worth one. That is
 * why the board shows a lead badge rather than a separate list, and why converting is an action
 * on the deal — the history follows it instead of being retyped into a new record.
 *
 * ── Moving a deal rewrites its probability ────────────────────────────────────────────────
 *
 * Each stage carries a default probability, and the server applies it when a deal moves. So the
 * forecast is a consequence of where deals actually are, not a number someone maintains by hand
 * — which is the only version of a forecast that stays true for more than a week.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { selectableParties } from '@/lib/parties';

type Stage = {
  id: string; name: string; sortOrder: number; isWon: boolean; isLost: boolean;
  defaultProbability: number; dealCount: number;
};
type Deal = {
  id: string; clientId: string | null; clientName: string | null;
  stageId: string; stageName: string | null; title: string; value: number; currencyCode: string;
  company: string | null; phone: string | null; email: string | null; source: string | null;
  probability: number; campaignId: string | null; campaignName: string | null;
  expectedCloseDate: string | null; assignedUserId: string | null; assignedUserName: string | null;
  status: string; notes: string | null; winReason: string | null; lostReason: string | null;
};
type Activity = {
  id: string; dealId: string | null; dealTitle: string | null;
  clientId: string | null; clientName: string | null;
  type: string; subject: string; body: string | null;
  dueAt: string | null; completedAt: string | null;
};
type Assignee = { id: string; name: string; email: string };
type Client = { id: string; name: string; isActive?: boolean };

type Forecast = {
  totals: { dealCount: number; pipelineValue: number; weightedValue: number; bestCaseValue: number; coverageRatio: number | null };
  byStage: { stageId: string; stageName: string; dealCount: number; value: number; weighted: number }[];
  byAssignee: { userId: string | null; userName: string | null; dealCount: number; value: number; weighted: number }[];
};
type Funnel = {
  stages: { key: string; count: number; value: number | null }[];
  conversion: Record<string, number | null>;
  linked: { quotesWithDeal: number; invoicesWithDeal: number };
};
type Summary = { openDeals: number; openLeads: number; overdueActivities: number; pipelineValue: number; weightedForecast: number };

const ACTIVITY_TYPES = ['CALL', 'MEETING', 'EMAIL', 'NOTE', 'FOLLOW_UP'] as const;
const ACTIVITY_FILTERS = ['open', 'today', 'overdue', 'all'] as const;

type Tab = 'pipeline' | 'activities' | 'forecast' | 'funnel';

const BLANK_DEAL = {
  title: '', clientId: '', stageId: '', value: '', company: '', phone: '', email: '',
  source: '', probability: '', expectedCloseDate: '', assignedUserId: '', notes: '',
};
const BLANK_ACTIVITY = { dealId: '', clientId: '', type: 'CALL', subject: '', body: '', dueAt: '' };

export default function FollowUpPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const manage = can('crm.followup.manage');

  const [tab, setTab] = useState<Tab>('pipeline');
  const [stages, setStages] = useState<Stage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);

  const [activityFilter, setActivityFilter] = useState<(typeof ACTIVITY_FILTERS)[number]>('open');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [dealForm, setDealForm] = useState<typeof BLANK_DEAL & { id?: string }>({ ...BLANK_DEAL });
  const [dealOpen, setDealOpen] = useState(false);
  const [actForm, setActForm] = useState<typeof BLANK_ACTIVITY & { id?: string }>({ ...BLANK_ACTIVITY });
  const [actOpen, setActOpen] = useState(false);

  const money = useCallback(
    (v: number, currency = 'EGP') => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency, maximumFractionDigits: 0,
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
  const pct = useCallback(
    (v: number | null) => (v === null ? '—' : `${new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', { maximumFractionDigits: 1 }).format(v)}%`),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [st, dl, ac, asg, cl, sm, fc, fn] = await Promise.all([
        api<{ stages?: Stage[] }>('/crm/pipeline/stages'),
        api<Deal[]>('/crm/deals'),
        api<Activity[]>(`/crm/activities${activityFilter === 'all' ? '' : `?filter=${activityFilter}`}`),
        api<Assignee[]>('/crm/assignees').catch(() => [] as Assignee[]),
        api<Client[]>('/clients').catch(() => [] as Client[]),
        api<Summary>('/crm/summary').catch(() => null),
        api<{ forecast?: Forecast }>('/crm/forecast').catch(() => ({ forecast: undefined })),
        api<{ funnel?: Funnel }>('/crm/funnel').catch(() => ({ funnel: undefined })),
      ]);
      setStages((st.stages ?? []).sort((a, b) => a.sortOrder - b.sortOrder));
      setDeals(Array.isArray(dl) ? dl : []);
      setActivities(Array.isArray(ac) ? ac : []);
      setAssignees(Array.isArray(asg) ? asg : []);
      setClients(Array.isArray(cl) ? cl : []);
      setSummary(sm);
      setForecast(fc.forecast ?? null);
      setFunnel(fn.funnel ?? null);
    } catch {
      setError('followup.loadFailed');
    } finally {
      setLoading(false);
    }
  }, [activityFilter]);

  useEffect(() => {
    void load();
  }, [load]);

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
      setError(code ? `followup.error.${code}` : 'common.error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Moving a stage is a PATCH of stageId alone. The probability is deliberately not sent — the
   * server applies the target stage's default, and sending the old one would freeze a deal's
   * odds at whatever they were three stages ago.
   */
  function moveDeal(deal: Deal, stageId: string) {
    const target = stages.find((s) => s.id === stageId);
    // Closing a deal is worth a sentence about why — it is the only record of what actually
    // won or lost the work, and nobody writes it down a week later.
    const reason = target?.isWon
      ? window.prompt(t('followup.winReasonPrompt')) ?? ''
      : target?.isLost
        ? window.prompt(t('followup.lostReasonPrompt')) ?? ''
        : null;
    return call(`/crm/deals/${deal.id}`, 'PATCH', {
      stageId,
      ...(target?.isWon && reason ? { winReason: reason } : {}),
      ...(target?.isLost && reason ? { lostReason: reason } : {}),
    }, 'followup.dealSaved');
  }

  /**
   * Converting a lead does two things — it creates the client and raises the first quote at the
   * deal's value — and the server then syncs the deal's value to that quote's total. Both are
   * said before it happens and the quote's number is reported after, because a document that
   * appears without being announced is a document nobody goes looking for.
   */
  async function convertToClient(d: Deal) {
    if (!window.confirm(`${t('followup.confirmConvertClient')}\n${t('followup.convertAlsoQuote')}`)) return;
    const res = await call(`/crm/deals/${d.id}/convert-to-client`, 'POST', {}, undefined);
    if (!res) return;
    const quote = res.quote as { number?: string } | null | undefined;
    setFlash(quote?.number
      ? `${t('followup.clientCreated')} · ${t('followup.quoteCreated')} ${quote.number}`
      : t('followup.clientCreated'));
  }

  function openDeal(d?: Deal) {
    setDealOpen(true);
    setError(null);
    setDealForm(d ? {
      id: d.id, title: d.title, clientId: d.clientId ?? '', stageId: d.stageId,
      value: String(d.value || ''), company: d.company ?? '', phone: d.phone ?? '',
      email: d.email ?? '', source: d.source ?? '', probability: String(d.probability),
      expectedCloseDate: d.expectedCloseDate ?? '', assignedUserId: d.assignedUserId ?? '',
      notes: d.notes ?? '',
    } : { ...BLANK_DEAL, stageId: stages[0]?.id ?? '' });
  }

  async function saveDeal() {
    const body = {
      title: dealForm.title.trim(),
      clientId: dealForm.clientId || null,
      stageId: dealForm.stageId,
      value: Number(dealForm.value || 0),
      company: dealForm.company.trim() || null,
      phone: dealForm.phone.trim() || null,
      email: dealForm.email.trim() || null,
      source: dealForm.source.trim() || null,
      probability: dealForm.probability === '' ? undefined : Number(dealForm.probability),
      expectedCloseDate: dealForm.expectedCloseDate || null,
      assignedUserId: dealForm.assignedUserId || null,
      notes: dealForm.notes.trim() || null,
    };
    const res = dealForm.id
      ? await call(`/crm/deals/${dealForm.id}`, 'PATCH', body, 'followup.dealSaved')
      : await call('/crm/deals', 'POST', body, 'followup.dealAdded');
    if (res) setDealOpen(false);
  }

  async function saveActivity() {
    const body = {
      dealId: actForm.dealId || null,
      clientId: actForm.clientId || null,
      type: actForm.type,
      subject: actForm.subject.trim(),
      body: actForm.body.trim() || null,
      dueAt: actForm.dueAt || null,
    };
    const res = actForm.id
      ? await call(`/crm/activities/${actForm.id}`, 'PATCH', body, 'followup.activitySaved')
      : await call('/crm/activities', 'POST', body, 'followup.activityAdded');
    if (res) setActOpen(false);
  }

  /**
   * Every deal sits in its own stage column, won and lost included. The closing stages ARE the
   * won and lost columns — filtering to open deals would leave them permanently empty, which is
   * the opposite of what a pipeline board is for: seeing where the work went.
   */
  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const d of deals) {
      map.set(d.stageId, [...(map.get(d.stageId) ?? []), d]);
    }
    return map;
  }, [deals]);

  if (loading) {
    return (
      <div className="ae-page">
        <PageHero title={t('followup.title')} subtitle={t('followup.subtitle')} />
        <Panel><Skeleton rows={8} /></Panel>
      </div>
    );
  }

  return (
    <div className="ae-page">
      <PageHero title={t('followup.title')} subtitle={t('followup.subtitle')}
        actions={manage && (
          <button type="button" className="ae-btn-primary" onClick={() => openDeal()}>
            {t('followup.addDeal')}
          </button>
        )} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash, flash)}</p>}

      {summary && (
        <div className="ae-counter-grid mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {([
            ['followup.kpi.deals', num(summary.openDeals)],
            ['followup.kpi.leads', num(summary.openLeads)],
            ['followup.kpi.overdue', num(summary.overdueActivities)],
            ['followup.kpi.value', money(summary.pipelineValue)],
            ['followup.kpi.weighted', money(summary.weightedForecast)],
          ] as const).map(([k, v]) => (
            <div key={k} className="ae-counter">
              <span className="ae-counter-label">{t(k)}</span>
              <span className="ae-counter-value">{v}</span>
            </div>
          ))}
        </div>
      )}

      <div className="ae-tab-pills mb-4">
        {(['pipeline', 'activities', 'forecast', 'funnel'] as const).map((k) => (
          <button key={k} type="button" className={`ae-tab-pill ${tab === k ? 'is-active' : ''}`}
            onClick={() => { setTab(k); setError(null); setFlash(null); }}>
            {t(`followup.tab.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'pipeline' && (
        <div className="ae-table-wrap">
          <div className="flex min-w-max gap-3">
            {stages.map((s) => {
              const col = dealsByStage.get(s.id) ?? [];
              return (
                <div key={s.id} className="w-64 shrink-0">
                  <div className="mb-2 flex items-baseline justify-between text-sm font-bold">
                    <span>{s.name}</span>
                    <span className="text-xs text-[var(--text-muted)]">
                      {num(col.length)} · {num(s.defaultProbability)}%
                    </span>
                  </div>
                  <div className="grid gap-2">
                    {col.map((d) => (
                      <div key={d.id} className="ae-section-card grid gap-1 text-sm">
                        <button type="button" className="text-start font-bold underline"
                          onClick={() => manage && openDeal(d)} disabled={!manage}>
                          {d.title}
                        </button>
                        <span className="text-xs text-[var(--text-muted)]">
                          {/* A deal with no client is a lead, and says so rather than
                              showing an empty client field. */}
                          {d.clientName ?? (
                            <span className="ae-badge ae-badge-info text-xs">{t('followup.leadBadge')}</span>
                          )}
                          {d.company && ` · ${d.company}`}
                        </span>
                        <span className="text-xs">
                          {money(d.value, d.currencyCode)} · {num(d.probability)}%
                        </span>
                        {d.status !== 'OPEN' && (
                          <span className="text-xs">
                            <span className={`ae-badge ${d.status === 'WON' ? 'ae-badge-success' : 'ae-badge-muted'} text-xs`}>
                              {t(`followup.status.${d.status}`, d.status)}
                            </span>
                            {(d.winReason || d.lostReason) && (
                              <span className="ms-2 text-[var(--text-muted)]">{d.winReason ?? d.lostReason}</span>
                            )}
                          </span>
                        )}
                        {d.expectedCloseDate && (
                          <span className="text-xs text-[var(--text-muted)]">
                            {t('followup.expectedClose')}: {date(d.expectedCloseDate)}
                          </span>
                        )}
                        {manage && (
                          <span className="mt-1 flex flex-wrap gap-1">
                            <select className="ae-input text-xs" value={d.stageId}
                              onChange={(e) => void moveDeal(d, e.target.value)} disabled={busy}>
                              {stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                            </select>
                          </span>
                        )}
                        {manage && (
                          <span className="flex flex-wrap gap-1">
                            <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                              onClick={async () => {
                                if (!window.confirm(t('followup.confirmConvertQuote'))) return;
                                const res = await call(`/crm/deals/${d.id}/convert-to-quote`, 'POST', {}, undefined);
                                const q = res?.quote as { number?: string } | undefined;
                                if (res) setFlash(`${t('followup.quoteCreated')} ${q?.number ?? ''}`);
                              }}>
                              {t('followup.createQuote')}
                            </button>
                            {!d.clientId && (
                              <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                                onClick={() => void convertToClient(d)}>
                                {t('followup.convertToClient')}
                              </button>
                            )}
                            <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                              onClick={() => {
                                if (!window.confirm(t('followup.confirmDeleteDeal'))) return;
                                void call(`/crm/deals/${d.id}`, 'DELETE', undefined, 'followup.dealDeleted');
                              }}>
                              {t('common.delete')}
                            </button>
                          </span>
                        )}
                      </div>
                    ))}
                    {col.length === 0 && (
                      <p className="text-xs text-[var(--text-muted)]">{t('common.noResults')}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'activities' && (
        <Panel actions={manage && (
          <button type="button" className="ae-btn-secondary text-xs"
            onClick={() => { setActOpen(true); setActForm({ ...BLANK_ACTIVITY }); }}>
            {t('followup.addActivity')}
          </button>
        )}>
          <div className="ae-tab-pills mb-3">
            {ACTIVITY_FILTERS.map((f) => (
              <button key={f} type="button" className={`ae-tab-pill ${activityFilter === f ? 'is-active' : ''}`}
                onClick={() => setActivityFilter(f)}>
                {t(`followup.filter.${f}`)}
              </button>
            ))}
          </div>

          {activities.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
          ) : (
            <div className="ae-table-wrap">
              <table className="ae-table">
                <thead>
                  <tr>
                    <th>{t('followup.typeLabel')}</th>
                    <th>{t('followup.subject')}</th>
                    <th>{t('followup.client')}</th>
                    <th>{t('followup.linkedDeal')}</th>
                    <th>{t('followup.due')}</th>
                    <th aria-label={t('followup.actions')} />
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a) => {
                    const overdue = !a.completedAt && a.dueAt
                      && new Date(a.dueAt.replace(' ', 'T')).getTime() < Date.now();
                    return (
                      <tr key={a.id}>
                        <td className="text-xs">{t(`followup.type.${a.type}`, a.type)}</td>
                        <td>{a.subject}</td>
                        <td className="text-xs">{a.clientName ?? '—'}</td>
                        <td className="text-xs">{a.dealTitle ?? '—'}</td>
                        <td className="text-xs">
                          {date(a.dueAt)}
                          {/* Overdue is the only thing that makes a follow-up urgent, so it
                              is marked on the row rather than left to the filter. */}
                          {overdue && (
                            <span className="ae-badge ae-badge-danger ms-2 text-xs">
                              {t('followup.filter.overdue')}
                            </span>
                          )}
                          {a.completedAt && (
                            <span className="ae-badge ae-badge-success ms-2 text-xs">
                              {t('followup.done')}
                            </span>
                          )}
                        </td>
                        <td>
                          {manage && (
                            <span className="flex flex-wrap gap-1">
                              <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                                onClick={() => void call(
                                  `/crm/activities/${a.id}/${a.completedAt ? 'reopen' : 'complete'}`,
                                  'PATCH', {},
                                  a.completedAt ? 'followup.activityReopened' : 'followup.activityDone',
                                )}>
                                {t(a.completedAt ? 'followup.reopen' : 'followup.complete')}
                              </button>
                              <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                                onClick={() => {
                                  setActOpen(true);
                                  setActForm({
                                    id: a.id, dealId: a.dealId ?? '', clientId: a.clientId ?? '',
                                    type: a.type, subject: a.subject, body: a.body ?? '',
                                    dueAt: a.dueAt ? a.dueAt.replace(' ', 'T').slice(0, 16) : '',
                                  });
                                }}>
                                {t('followup.editActivity')}
                              </button>
                              <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                                onClick={() => {
                                  if (!window.confirm(t('followup.confirmDeleteActivity'))) return;
                                  void call(`/crm/activities/${a.id}`, 'DELETE', undefined, 'followup.activityDeleted');
                                }}>
                                {t('common.delete')}
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {tab === 'forecast' && forecast && (
        <>
          <Panel>
            <p className="mb-3 text-xs text-[var(--text-muted)]">{t('followup.forecast.hint')}</p>
            <div className="ae-counter-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="ae-counter">
                <span className="ae-counter-label">{t('followup.forecast.pipeline')}</span>
                <span className="ae-counter-value">{money(forecast.totals.pipelineValue)}</span>
                <span className="ae-counter-hint">{num(forecast.totals.dealCount)}</span>
              </div>
              <div className="ae-counter">
                <span className="ae-counter-label">{t('followup.forecast.weighted')}</span>
                <span className="ae-counter-value">{money(forecast.totals.weightedValue)}</span>
              </div>
              <div className="ae-counter">
                <span className="ae-counter-label">{t('followup.forecast.coverage')}</span>
                <span className="ae-counter-value">
                  {forecast.totals.coverageRatio === null ? '—' : pct(forecast.totals.coverageRatio * 100)}
                </span>
              </div>
            </div>
          </Panel>

          {(['byStage', 'byAssignee'] as const).map((k) => (
            <Panel key={k} title={t(`followup.forecast.${k}`)} className="mt-4">
              {forecast[k].length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
              ) : (
                <div className="ae-table-wrap">
                  <table className="ae-table">
                    <thead>
                      <tr>
                        <th>{t(k === 'byStage' ? 'followup.stage' : 'followup.assignee')}</th>
                        <th>{t('followup.kpi.deals')}</th>
                        <th>{t('followup.forecast.pipeline')}</th>
                        <th>{t('followup.forecast.weighted')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forecast[k].map((r, i) => (
                        <tr key={i}>
                          <td>
                            {'stageName' in r
                              ? r.stageName
                              : (r.userName ?? t('followup.unassigned'))}
                          </td>
                          <td>{num(r.dealCount)}</td>
                          <td>{money(r.value)}</td>
                          <td className="font-bold">{money(r.weighted)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          ))}
        </>
      )}

      {tab === 'funnel' && funnel && (
        <Panel>
          <p className="mb-3 text-xs text-[var(--text-muted)]">{t('followup.funnel.hint')}</p>
          <div className="grid gap-3 sm:grid-cols-4">
            {funnel.stages.map((s) => (
              <div key={s.key} className="ae-counter">
                <span className="ae-counter-label">{t(`followup.funnel.stage.${s.key}`, s.key)}</span>
                <span className="ae-counter-value">{num(s.count)}</span>
                {s.value !== null && <span className="ae-counter-hint">{money(s.value)}</span>}
              </div>
            ))}
          </div>

          <h3 className="mb-2 mt-4 text-sm font-bold">{t('followup.tab.funnel')}</h3>
          <ul className="grid gap-2 text-sm">
            {Object.entries(funnel.conversion).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between gap-2">
                <span>{t(`followup.funnel.rate.${k}`, k)}</span>
                <span className="font-bold">{pct(v)}</span>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-[var(--text-muted)]">
            {t('followup.funnel.linked')}: {num(funnel.linked.quotesWithDeal)} {t('followup.funnel.quotesWord')}
            {' · '}{num(funnel.linked.invoicesWithDeal)} {t('followup.funnel.invoicesWord')}
          </p>
        </Panel>
      )}

      {dealOpen && (
        <Panel title={dealForm.id ? t('followup.editDeal') : t('followup.addDeal')} className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('followup.dealTitle')}</span>
              <input className="ae-input" value={dealForm.title}
                onChange={(e) => setDealForm({ ...dealForm, title: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('followup.client')}</span>
              <select className="ae-input" value={dealForm.clientId}
                onChange={(e) => setDealForm({ ...dealForm, clientId: e.target.value })}>
                <option value="">{t('followup.noClientYet')}</option>
                {selectableParties(clients, dealForm.clientId).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('followup.stage')}</span>
              <select className="ae-input" value={dealForm.stageId}
                onChange={(e) => setDealForm({ ...dealForm, stageId: e.target.value })}>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('followup.value')}</span>
              <input type="number" min="0" step="any" className="ae-input" value={dealForm.value}
                onChange={(e) => setDealForm({ ...dealForm, value: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('followup.probability')}</span>
              <input type="number" min="0" max="100" step="1" className="ae-input" value={dealForm.probability}
                onChange={(e) => setDealForm({ ...dealForm, probability: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('followup.expectedClose')}</span>
              <input type="date" className="ae-input" value={dealForm.expectedCloseDate}
                onChange={(e) => setDealForm({ ...dealForm, expectedCloseDate: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('followup.company')}</span>
              <input className="ae-input" value={dealForm.company}
                onChange={(e) => setDealForm({ ...dealForm, company: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('followup.phone')}</span>
              <input className="ae-input" value={dealForm.phone}
                onChange={(e) => setDealForm({ ...dealForm, phone: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('followup.email')}</span>
              <input type="email" className="ae-input" value={dealForm.email}
                onChange={(e) => setDealForm({ ...dealForm, email: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('followup.source')}</span>
              <input className="ae-input" value={dealForm.source}
                onChange={(e) => setDealForm({ ...dealForm, source: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('followup.assignee')}</span>
              <select className="ae-input" value={dealForm.assignedUserId}
                onChange={(e) => setDealForm({ ...dealForm, assignedUserId: e.target.value })}>
                <option value="">{t('followup.unassigned')}</option>
                {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block font-bold">{t('followup.notes')}</span>
            <textarea className="ae-input" rows={2} value={dealForm.notes}
              onChange={(e) => setDealForm({ ...dealForm, notes: e.target.value })} />
          </label>
          <div className="mt-3 flex gap-2">
            <button type="button" className="ae-btn-primary"
              disabled={busy || dealForm.title.trim() === '' || dealForm.stageId === ''}
              onClick={() => void saveDeal()}>
              {t('common.save')}
            </button>
            <button type="button" className="ae-btn-ghost" onClick={() => setDealOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </Panel>
      )}

      {actOpen && (
        <Panel title={actForm.id ? t('followup.editActivity') : t('followup.addActivity')} className="mt-4">
          <p className="mb-3 text-xs text-[var(--text-muted)]">{t('followup.activityClientOrDealHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('followup.typeLabel')}</span>
              <select className="ae-input" value={actForm.type}
                onChange={(e) => setActForm({ ...actForm, type: e.target.value })}>
                {ACTIVITY_TYPES.map((x) => <option key={x} value={x}>{t(`followup.type.${x}`)}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('followup.subject')}</span>
              <input className="ae-input" value={actForm.subject}
                onChange={(e) => setActForm({ ...actForm, subject: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('followup.due')}</span>
              <input type="datetime-local" className="ae-input" value={actForm.dueAt}
                onChange={(e) => setActForm({ ...actForm, dueAt: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('followup.client')}</span>
              <select className="ae-input" value={actForm.clientId}
                onChange={(e) => setActForm({ ...actForm, clientId: e.target.value })}>
                <option value="">{t('followup.optionalClient')}</option>
                {selectableParties(clients, actForm.clientId).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('followup.linkedDeal')}</span>
              <select className="ae-input" value={actForm.dealId}
                onChange={(e) => setActForm({ ...actForm, dealId: e.target.value })}>
                <option value="">{t('followup.noDeal')}</option>
                {deals.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block font-bold">{t('followup.body')}</span>
            <textarea className="ae-input" rows={3} value={actForm.body}
              onChange={(e) => setActForm({ ...actForm, body: e.target.value })} />
          </label>
          <div className="mt-3 flex gap-2">
            <button type="button" className="ae-btn-primary"
              disabled={busy || actForm.subject.trim() === '' || (actForm.clientId === '' && actForm.dealId === '')}
              onClick={() => void saveActivity()}>
              {t('common.save')}
            </button>
            <button type="button" className="ae-btn-ghost" onClick={() => setActOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}
