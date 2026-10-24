'use client';

/**
 * Work orders.
 *
 * The operational spine of the system: a quote becomes a job, the job walks a chain of stages,
 * and at the end of the chain it becomes an invoice.
 *
 * ── Why the board needs a type ─────────────────────────────────────────────────────────────
 *
 * Each of the six job types has its own chain — printing runs design → client review → source
 * files → montage → purchasing → printing → finishing → delivery → accounting → archive, while
 * social runs ideas → idea review → copywriting → … → performance report. The chains overlap
 * but do not match, so there is no single set of columns that describes all of them at once:
 * the union runs to twenty-five columns, most empty for any given job.
 *
 * So the board is offered per type, and "كل الأنواع" shows the table instead. That is stated
 * by disabling the board rather than by silently switching view under the person's hands.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { JobEditor, type JobType } from '@/components/job-editor';
import { JobDetail, type Stage } from '@/components/job-detail';

type Job = {
  id: string;
  number: string;
  title: string;
  clientName: string;
  jobType: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  currentStage: string;
  deliveryDate: string | null;
  quantity: number;
  price: number;
  currencyCode: string;
  invoiceNumber: string | null;
};

type Workflow = {
  types: JobType[];
  stagesByType: Record<string, Stage[]>;
};

type Summary = { activeCount: number; overdueCount: number; completedToday: number };

const STATUS_STYLE: Record<Job['status'], string> = {
  ACTIVE: 'ae-badge-info',
  COMPLETED: 'ae-badge-success',
  CANCELLED: 'ae-badge-danger',
};

/** The API's own three: active, everything, and the archive. */
const STATUS_FILTERS = [
  { value: 'ACTIVE', key: 'jobs.filter.active' },
  { value: 'ALL', key: 'jobs.filter.all' },
  { value: 'COMPLETED', key: 'jobs.filter.archive' },
] as const;

const DAY = 86400000;

export default function JobsPage() {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <Jobs />
    </Suspense>
  );
}

function Jobs() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const openId = useSearchParams().get('id');
  const { can } = useSession();

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  const [view, setView] = useState<'board' | 'table'>('board');
  const [typeKey, setTypeKey] = useState('');
  const [status, setStatus] = useState<string>('ACTIVE');
  const [query, setQuery] = useState('');
  const [lateOnly, setLateOnly] = useState(false);

  const money = useCallback(
    (v: number, currency = 'EGP') =>
      new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
        style: 'currency', currency, maximumFractionDigits: 0,
      }).format(v),
    [lang],
  );

  const loadWorkflow = useCallback(async () => {
    try {
      const w = await api<Workflow>('/jobs/workflow');
      setWorkflow(w);
      // Start on a real type so the board has a chain to lay out.
      setTypeKey((v) => v || w.types.find((x) => x.isActive)?.typeKey || '');
    } catch {
      setFailed(true);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const params = new URLSearchParams();
      if (typeKey) params.set('type', typeKey);
      params.set('status', status);
      if (query.trim()) params.set('q', query.trim());
      const [list, sum] = await Promise.all([
        api<Job[]>(`/jobs?${params}`),
        api<Summary>('/jobs/summary'),
      ]);
      setJobs(Array.isArray(list) ? list : []);
      setSummary(sum);
    } catch (err) {
      setFailed(err instanceof ApiError);
    } finally {
      setLoading(false);
    }
  }, [typeKey, status, query]);

  useEffect(() => {
    void loadWorkflow();
  }, [loadWorkflow]);

  useEffect(() => {
    void load();
  }, [load]);

  const types = workflow?.types.filter((x) => x.isActive) ?? [];
  const typeName = (x: JobType) => (lang === 'ar' ? x.nameAr : x.nameEn);
  const chain = workflow?.stagesByType[typeKey] ?? [];
  const stageName = (key: string) => {
    const s = chain.find((x) => x.stageKey === key)
      ?? Object.values(workflow?.stagesByType ?? {}).flat().find((x) => x.stageKey === key);
    return s ? (lang === 'ar' ? s.nameAr : s.nameEn) : key;
  };

  const overdue = (j: Job) =>
    j.status === 'ACTIVE' && j.deliveryDate != null &&
    new Date(j.deliveryDate).getTime() < Date.now();

  const shown = useMemo(
    () => (lateOnly ? jobs.filter(overdue) : jobs),
    [jobs, lateOnly],
  );

  // A board needs one chain; without a type there is no column set that fits.
  const boardable = typeKey !== '';
  const effectiveView = boardable ? view : 'table';

  if (openId) {
    return (
      <JobDetail
        id={openId}
        stagesByType={workflow?.stagesByType ?? {}}
        onBack={() => router.push('/jobs/')}
      />
    );
  }

  const card = (j: Job) => (
    <Link key={j.id} href={`/jobs/?id=${j.id}`} className="ae-pulse-card">
      <span className="ae-pulse-label">{j.title}</span>
      <span className="text-xs font-bold" dir="ltr">{j.number}</span>
      <span className="ae-pulse-detail">{j.clientName}</span>
      {j.deliveryDate && (
        <span className={`ae-badge ${overdue(j) ? 'ae-badge-danger' : 'ae-badge-muted'} mt-1 w-fit`}>
          <span dir="ltr">{j.deliveryDate}</span>
        </span>
      )}
    </Link>
  );

  return (
    <div className="ae-page">
      <PageHero
        title={t('jobs.title')}
        actions={
          can('jobs.create', 'jobs.manage') && !creating ? (
            <button type="button" className="ae-btn-primary" onClick={() => setCreating(true)}>
              {t('jobs.create')}
            </button>
          ) : undefined
        }
      />

      {creating && (
        <JobEditor
          types={types}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); void load(); }}
        />
      )}

      {failed && <p className="ae-flash ae-flash--error mb-4">{t('common.error')}</p>}

      {summary && (
        <div className="ae-dash-metrics-grid mb-4">
          <div className="ae-stat-card">
            <p className="ae-stat-label">{t('jobs.active')}</p>
            <p className="ae-stat-value">{summary.activeCount}</p>
          </div>
          <div className="ae-stat-card">
            <p className="ae-stat-label">{t('jobs.overdue')}</p>
            <p className={`ae-stat-value ${summary.overdueCount > 0 ? 'ae-stat-value--warn' : ''}`}>
              {summary.overdueCount}
            </p>
          </div>
          <div className="ae-stat-card">
            <p className="ae-stat-label">{t('jobs.completedToday')}</p>
            <p className="ae-stat-value">{summary.completedToday}</p>
          </div>
        </div>
      )}

      <Panel
        actions={
          <div className="ae-toolbar">
            <div className="ae-tab-pills">
              <button type="button" onClick={() => setTypeKey('')}
                className={`ae-tab-pill ${typeKey === '' ? 'is-active' : ''}`}>
                {t('jobs.filter.allTypes')}
              </button>
              {types.map((x) => (
                <button key={x.typeKey} type="button" onClick={() => setTypeKey(x.typeKey)}
                  className={`ae-tab-pill ${typeKey === x.typeKey ? 'is-active' : ''}`}>
                  <span aria-hidden>{x.icon}</span> {typeName(x)}
                </button>
              ))}
            </div>

            <div className="ae-tab-pills">
              <button type="button" onClick={() => setView('board')} disabled={!boardable}
                className={`ae-tab-pill ${effectiveView === 'board' ? 'is-active' : ''}`}>
                {t('jobs.view.kanban')}
              </button>
              <button type="button" onClick={() => setView('table')}
                className={`ae-tab-pill ${effectiveView === 'table' ? 'is-active' : ''}`}>
                {t('jobs.cards')}
              </button>
            </div>

            <select value={status} onChange={(e) => setStatus(e.target.value)} className="ae-input">
              {STATUS_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>{t(s.key)}</option>
              ))}
            </select>

            <button type="button" onClick={() => setLateOnly((v) => !v)}
              className={`ae-tab-pill ${lateOnly ? 'is-active' : ''}`}>
              {t('jobs.filter.late')}
            </button>

            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t('jobs.filter.search')} className="ae-input" />
          </div>
        }
      >
        {loading ? (
          <Skeleton rows={6} />
        ) : shown.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t('jobs.emptyBoard')}</p>
        ) : effectiveView === 'board' ? (
          <div className="ae-pipeline">
            {chain.map((s) => {
              const inStage = shown.filter((j) => j.currentStage === s.stageKey);
              return (
                <div key={s.stageKey} className="ae-pipeline-phase p-3" style={{ minWidth: '15rem' }}>
                  <div className="ae-pipeline-phase-head mb-2">
                    <span className="ae-pipeline-phase-title">{lang === 'ar' ? s.nameAr : s.nameEn}</span>
                    <span className="ae-pipeline-phase-count">{inStage.length}</span>
                  </div>
                  {inStage.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">{t('jobs.emptyColumn')}</p>
                  ) : (
                    <div className="grid gap-2">{inStage.map(card)}</div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="ae-table-wrap">
            <table className="ae-table ae-table--rows">
              <thead>
                <tr>
                  <th>{t('jobs.number')}</th>
                  <th>{t('jobs.fieldTitle')}</th>
                  <th>{t('jobs.fieldClient')}</th>
                  <th>{t('jobs.currentStage')}</th>
                  <th>{t('jobs.fieldDelivery')}</th>
                  <th>{t('jobs.fieldPrice')}</th>
                  <th>{t('jobs.status')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((j) => (
                  <tr key={j.id} className={j.status === 'CANCELLED' ? 'opacity-60' : undefined}>
                    <td>
                      <Link href={`/jobs/?id=${j.id}`} className="font-bold underline" dir="ltr">
                        {j.number}
                      </Link>
                    </td>
                    <td>{j.title}</td>
                    <td>{j.clientName}</td>
                    <td>{stageName(j.currentStage)}</td>
                    <td>
                      {j.deliveryDate ? (
                        <>
                          <span dir="ltr">{j.deliveryDate}</span>
                          {overdue(j) && (
                            <span className="ae-badge ae-badge-danger mt-1 block w-fit">
                              {t('jobs.delivery.late', {
                                days: Math.ceil((Date.now() - new Date(j.deliveryDate).getTime()) / DAY),
                              })}
                            </span>
                          )}
                        </>
                      ) : t('jobs.delivery.unset')}
                    </td>
                    <td>{j.price > 0 ? money(j.price, j.currencyCode) : '—'}</td>
                    <td>
                      <span className={`ae-badge ${STATUS_STYLE[j.status]}`}>
                        {t(`jobs.status.${j.status}`)}
                      </span>
                    </td>
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
