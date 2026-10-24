'use client';

/**
 * التسويق والمبيعات — how the selling is going, and who is doing it.
 *
 * The pipeline itself lives in متابعة العملاء: leads and opportunities are deals there, and
 * duplicating them here would give two screens that disagree the moment one is edited. What is
 * here is everything about the selling that a deal board cannot show — how the team is doing
 * against target, which sources actually produce work, what campaigns cost against what they
 * returned, and what the people who sold it are owed.
 *
 * ── The leaderboard is scored, not just listed ────────────────────────────────────────────
 *
 * The metric decides the order, and it is switchable, because "best" means commission earned to
 * one manager and deals closed to another. The server ranks and scores; this screen picks the
 * measure and shows the rest of the row so the ranking can be argued with.
 *
 * ── ROI has a definition and it is stated ─────────────────────────────────────────────────
 *
 * (revenue − actual cost) ÷ cost, where revenue prefers collected invoices linked to the
 * campaign's deals and falls back to the value of deals won. Two reasonable definitions, and
 * which one applied changes the number — so the rule is on the screen rather than in a comment.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { SalesCommissions } from '@/components/sales-commissions';

type Member = {
  userId: string; userName: string; targetValue?: number; achieved?: number;
  achievementPercent?: number; openDeals?: number; wonCount?: number; overdueActivities?: number;
};
type Board = { members: Member[]; withTargetCount: number; memberCount: number; avgAchievement: number };
type LeaderRow = {
  userId: string; userName: string; userEmail: string;
  commission: number; points: number; wonCount: number; wonValue: number;
  openDeals: number; dealsCreated: number; activitiesCompleted: number; score: number; rank: number;
};
type Source = { id: string; code: string; name: string; nameEn: string | null; isActive: boolean; sortOrder: number };
type Campaign = {
  id: string; name: string; channel: string | null; budget: number; actualCost: number;
  currencyCode: string; startDate: string | null; endDate: string | null;
  status: string; notes: string | null; isActive: boolean;
  dealCount?: number; revenue?: number; roi?: number | null;
};

const METRICS = ['commission', 'points', 'won_count', 'won_value', 'deals', 'activities'] as const;
const CAMPAIGN_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED'] as const;
const TABS = ['team', 'sources', 'campaigns', 'commissions'] as const;
type Tab = (typeof TABS)[number];

const BLANK_CAMPAIGN = {
  name: '', channel: '', budget: '', actualCost: '', currencyCode: 'EGP',
  startDate: '', endDate: '', status: 'DRAFT', notes: '',
};

export default function SalesPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const manage = can('sales.manage');

  const [tab, setTab] = useState<Tab>('team');
  const [board, setBoard] = useState<Board | null>(null);
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [metric, setMetric] = useState<(typeof METRICS)[number]>('commission');
  const [sources, setSources] = useState<Source[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [newSource, setNewSource] = useState({ code: '', name: '', nameEn: '' });
  const [campaignForm, setCampaignForm] = useState<typeof BLANK_CAMPAIGN & { id?: string }>({ ...BLANK_CAMPAIGN });
  const [editingCampaign, setEditingCampaign] = useState(false);

  const money = useCallback(
    (v: number, currency = 'EGP') => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(v),
    [lang],
  );
  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', { maximumFractionDigits: 1 }).format(v),
    [lang],
  );
  const pct = useCallback(
    (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${num(v)}%`),
    [num],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tm, lb, sc, cp] = await Promise.all([
        api<{ board?: Board }>('/sales/team').catch(() => ({ board: undefined })),
        api<{ leaderboard?: { entries?: LeaderRow[] } }>(`/sales/leaderboard?metric=${metric}`)
          .catch(() => ({ leaderboard: undefined })),
        api<{ sources?: Source[] }>('/sales/sources').catch(() => ({ sources: [] })),
        api<Campaign[] | { items?: Campaign[] }>('/sales/campaigns').catch(() => [] as Campaign[]),
      ]);
      setBoard(tm.board ?? null);
      setLeaders(lb.leaderboard?.entries ?? []);
      setSources(sc.sources ?? []);
      setCampaigns(Array.isArray(cp) ? cp : (cp.items ?? []));
    } catch {
      setError('common.error');
    } finally {
      setLoading(false);
    }
  }, [metric]);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: Record<string, unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await api(path, { method, ...(body ? { body } : {}) });
      if (ok) setFlash(ok);
      await load();
      return true;
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code ? `sales.error.${code}` : 'common.error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveCampaign() {
    const body = {
      name: campaignForm.name.trim(),
      channel: campaignForm.channel.trim() || null,
      budget: Number(campaignForm.budget || 0),
      actualCost: Number(campaignForm.actualCost || 0),
      currencyCode: campaignForm.currencyCode,
      startDate: campaignForm.startDate || null,
      endDate: campaignForm.endDate || null,
      status: campaignForm.status,
      notes: campaignForm.notes.trim() || null,
    };
    const ok = campaignForm.id
      ? await call(`/sales/campaigns/${campaignForm.id}`, 'PATCH', body, 'sales.campaignUpdated')
      : await call('/sales/campaigns', 'POST', body, 'sales.campaignAdded');
    if (ok) setEditingCampaign(false);
  }

  return (
    <div className="ae-page">
      <PageHero title={t('sales.title')} subtitle={t('sales.subtitle')} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash)}</p>}

      {/* The deals themselves are one screen, not two — this says where they are rather than
          showing a second copy that drifts from the first. */}
      <p className="mb-4 text-xs text-[var(--text-muted)]">
        {t('sales.tab.leads')} · {t('sales.tab.opportunities')}:{' '}
        <Link href="/follow-up" className="underline">{t('followup.title')}</Link>
      </p>

      <div className="ae-tab-pills mb-4">
        {TABS.map((k) => (
          <button key={k} type="button" className={`ae-tab-pill ${tab === k ? 'is-active' : ''}`}
            onClick={() => { setTab(k); setError(null); setFlash(null); }}>
            {t(`sales.tab.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'team' && (
        loading ? <Panel><Skeleton rows={6} /></Panel> : (
          <div className="grid gap-4">
            <Panel title={t('sales.team.targetsBoard')}>
              <p className="mb-3 text-xs text-[var(--text-muted)]">{t('sales.team.hint')}</p>

              {board && (
                <div className="ae-counter-grid mb-3 grid gap-3 sm:grid-cols-3">
                  <div className="ae-counter">
                    <span className="ae-counter-label">{t('sales.team.members')}</span>
                    <span className="ae-counter-value">{num(board.memberCount)}</span>
                  </div>
                  <div className="ae-counter">
                    <span className="ae-counter-label">{t('sales.team.withTargets')}</span>
                    <span className="ae-counter-value">{num(board.withTargetCount)}</span>
                  </div>
                  <div className="ae-counter">
                    <span className="ae-counter-label">{t('sales.team.avgAchievement')}</span>
                    <span className="ae-counter-value">{pct(board.avgAchievement)}</span>
                  </div>
                </div>
              )}

              {(board?.members ?? []).length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  {t('common.noResults')}
                  {/* Targets are set elsewhere; saying where beats an empty board. */}
                  <span className="mt-1 block text-xs">{t('sales.team.setTargetsHint')}</span>
                </p>
              ) : (
                <div className="ae-table-wrap">
                  <table className="ae-table">
                    <thead>
                      <tr>
                        <th>{t('sales.team.member')}</th>
                        <th>{t('sales.commissions.achieved')}</th>
                        <th>{t('sales.commissions.achievement')}</th>
                        <th>{t('sales.team.openDeals')}</th>
                        <th>{t('sales.team.won')}</th>
                        <th>{t('sales.team.overdue')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(board?.members ?? []).map((m) => (
                        <tr key={m.userId}>
                          <td>{m.userName}</td>
                          <td>{money(m.achieved ?? 0)}</td>
                          <td className="font-bold">{pct(m.achievementPercent)}</td>
                          <td>{num(m.openDeals ?? 0)}</td>
                          <td>{num(m.wonCount ?? 0)}</td>
                          <td className={(m.overdueActivities ?? 0) > 0 ? 'font-bold text-[var(--danger,#dc2626)]' : ''}>
                            {num(m.overdueActivities ?? 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-xs text-[var(--text-muted)]">{t('sales.team.overdueAutomationHint')}</p>
            </Panel>

            <Panel title={t('sales.team.leaderboard')}>
              <div className="ae-toolbar mb-3">
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('sales.team.score')}</span>
                  <select className="ae-input" value={metric}
                    onChange={(e) => setMetric(e.target.value as (typeof METRICS)[number])}>
                    {METRICS.map((m) => (
                      <option key={m} value={m}>{t(`sales.team.metric.${m}`, m)}</option>
                    ))}
                  </select>
                </label>
              </div>

              {leaders.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
              ) : (
                <div className="ae-table-wrap">
                  <table className="ae-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>{t('sales.team.member')}</th>
                        <th>{t('sales.team.metric.commission')}</th>
                        <th>{t('sales.team.metric.points')}</th>
                        <th>{t('sales.team.won')}</th>
                        <th>{t('sales.team.metric.won_value')}</th>
                        <th>{t('sales.team.activitiesDone')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaders.map((r) => (
                        <tr key={r.userId}>
                          <td>{num(r.rank)}</td>
                          <td>
                            {r.userName}
                            <span className="block text-xs text-[var(--text-muted)]">{r.userEmail}</span>
                          </td>
                          <td>{money(r.commission)}</td>
                          <td>{num(r.points)}</td>
                          <td>{num(r.wonCount)}</td>
                          <td>{money(r.wonValue)}</td>
                          <td>{num(r.activitiesCompleted)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        )
      )}

      {tab === 'sources' && (
        <Panel title={t('sales.sources.taxonomy')}>
          <p className="mb-3 text-xs text-[var(--text-muted)]">{t('sales.sources.hint')}</p>

          {manage && (
            <div className="ae-toolbar mb-3">
              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('sales.sources.code')}</span>
                <input className="ae-input" value={newSource.code}
                  onChange={(e) => setNewSource({ ...newSource, code: e.target.value })} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('sales.sources.name')}</span>
                <input className="ae-input" value={newSource.name}
                  onChange={(e) => setNewSource({ ...newSource, name: e.target.value })} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('sales.sources.nameEn')}</span>
                <input className="ae-input" value={newSource.nameEn}
                  onChange={(e) => setNewSource({ ...newSource, nameEn: e.target.value })} />
              </label>
              <button type="button" className="ae-btn-secondary self-end text-xs"
                disabled={busy || newSource.code.trim() === '' || newSource.name.trim() === ''}
                onClick={async () => {
                  const ok = await call('/sales/sources', 'POST', {
                    code: newSource.code.trim(), name: newSource.name.trim(),
                    nameEn: newSource.nameEn.trim() || null,
                  }, 'sales.sources.saved');
                  if (ok) setNewSource({ code: '', name: '', nameEn: '' });
                }}>
                {t('sales.sources.add')}
              </button>
            </div>
          )}

          {loading ? <Skeleton rows={4} /> : sources.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {sources.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-mono text-xs">{s.code}</span> · {s.name}
                    {s.nameEn && <span className="text-xs text-[var(--text-muted)]"> · {s.nameEn}</span>}
                  </span>
                  <span className={`ae-badge ${s.isActive ? 'ae-badge-success' : 'ae-badge-muted'} text-xs`}>
                    {t(s.isActive ? 'common.active' : 'common.inactive')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === 'campaigns' && (
        <div className="grid gap-4">
          <Panel title={t('sales.tab.campaigns')}
            actions={manage && (
              <button type="button" className="ae-btn-primary text-xs"
                onClick={() => { setEditingCampaign(true); setCampaignForm({ ...BLANK_CAMPAIGN }); }}>
                {t('sales.addCampaign')}
              </button>
            )}>
            {/* Two defensible definitions of revenue, and which applied changes the answer. */}
            <p className="mb-3 text-xs text-[var(--text-muted)]">{t('sales.campaignRoiHint')}</p>

            {loading ? <Skeleton rows={4} /> : campaigns.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
            ) : (
              <div className="ae-table-wrap">
                <table className="ae-table">
                  <thead>
                    <tr>
                      <th>{t('sales.campaignName')}</th>
                      <th>{t('sales.channel')}</th>
                      <th>{t('sales.budget')}</th>
                      <th>{t('sales.actualCost')}</th>
                      <th>{t('sales.campaignRevenue')}</th>
                      <th>{t('sales.campaignRoi')}</th>
                      <th>{t('purchaseOrders.status')}</th>
                      {manage && <th aria-label={t('quotes.actions')} />}
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td className="text-xs">{c.channel ?? '—'}</td>
                        <td>{money(c.budget, c.currencyCode)}</td>
                        <td>{money(c.actualCost, c.currencyCode)}</td>
                        <td>{c.revenue !== undefined ? money(c.revenue, c.currencyCode) : '—'}</td>
                        <td className={`font-bold ${(c.roi ?? 0) < 0 ? 'text-[var(--danger,#dc2626)]' : ''}`}>
                          {pct(c.roi === null || c.roi === undefined ? null : c.roi * 100)}
                        </td>
                        <td>
                          <span className="ae-badge ae-badge-info text-xs">
                            {t(`sales.campaignStatus.${c.status}`, c.status)}
                          </span>
                        </td>
                        {manage && (
                          <td>
                            <span className="flex flex-wrap gap-1">
                              <button type="button" className="ae-btn-ghost px-2 py-1 text-xs"
                                onClick={() => {
                                  setEditingCampaign(true);
                                  setCampaignForm({
                                    id: c.id, name: c.name, channel: c.channel ?? '',
                                    budget: String(c.budget), actualCost: String(c.actualCost),
                                    currencyCode: c.currencyCode, startDate: c.startDate ?? '',
                                    endDate: c.endDate ?? '', status: c.status, notes: c.notes ?? '',
                                  });
                                }}>
                                {t('common.save')}
                              </button>
                              <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                                onClick={() => {
                                  if (!window.confirm(t('pricing.calc.confirmDelete'))) return;
                                  void call(`/sales/campaigns/${c.id}`, 'DELETE', undefined, 'sales.campaignDeleted');
                                }}>
                                {t('common.delete')}
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

          {editingCampaign && (
            <Panel title={t('sales.addCampaign')}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('sales.campaignName')}</span>
                  <input className="ae-input" value={campaignForm.name}
                    onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('sales.channel')}</span>
                  <input className="ae-input" value={campaignForm.channel}
                    onChange={(e) => setCampaignForm({ ...campaignForm, channel: e.target.value })} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('sales.budget')}</span>
                  <input type="number" min="0" step="any" className="ae-input" value={campaignForm.budget}
                    onChange={(e) => setCampaignForm({ ...campaignForm, budget: e.target.value })} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('sales.actualCost')}</span>
                  <input type="number" min="0" step="any" className="ae-input" value={campaignForm.actualCost}
                    onChange={(e) => setCampaignForm({ ...campaignForm, actualCost: e.target.value })} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('etaPull.from')}</span>
                  <input type="date" className="ae-input" value={campaignForm.startDate}
                    onChange={(e) => setCampaignForm({ ...campaignForm, startDate: e.target.value })} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('etaPull.to')}</span>
                  <input type="date" className="ae-input" value={campaignForm.endDate}
                    onChange={(e) => setCampaignForm({ ...campaignForm, endDate: e.target.value })} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('purchaseOrders.status')}</span>
                  <select className="ae-input" value={campaignForm.status}
                    onChange={(e) => setCampaignForm({ ...campaignForm, status: e.target.value })}>
                    {CAMPAIGN_STATUSES.map((s) => (
                      <option key={s} value={s}>{t(`sales.campaignStatus.${s}`)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="mt-3 block text-sm">
                <span className="mb-1 block font-bold">{t('invoices.notes')}</span>
                <textarea className="ae-input" rows={2} value={campaignForm.notes}
                  onChange={(e) => setCampaignForm({ ...campaignForm, notes: e.target.value })} />
              </label>
              <div className="mt-3 flex gap-2">
                <button type="button" className="ae-btn-primary"
                  disabled={busy || campaignForm.name.trim() === ''} onClick={() => void saveCampaign()}>
                  {t('common.save')}
                </button>
                <button type="button" className="ae-btn-ghost" onClick={() => setEditingCampaign(false)}>
                  {t('common.cancel')}
                </button>
              </div>
            </Panel>
          )}
        </div>
      )}

      {tab === 'commissions' && <SalesCommissions manage={manage} />}
    </div>
  );
}
