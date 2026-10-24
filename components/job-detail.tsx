'use client';

/**
 * One work order.
 *
 * A job is really a position on a chain: its type picks a chain of five to ten stages, and
 * almost everything about the job means "where it has got to". So the stepper is the screen,
 * not an ornament on it — the facts and the log sit underneath.
 *
 * ── Who may move it ─────────────────────────────────────────────────────────────────────
 *
 * Two separate checks live in the API and both are worth understanding, because they pull in
 * opposite directions.
 *
 * `ae_job_stage_role_allowed` asks whether you hold the role the *current* stage belongs to —
 * designer, reviewer, purchaser, printer, producer, delivery rep. Leaving a stage you are not
 * assigned to is refused with `stage_role_required`, for a manager as much as for anyone.
 *
 * `ae_job_validate_transition_preconditions` asks whether the work of the stage is actually
 * done — proofs uploaded, montage confirmed, CTP completed, the QA checklist finished. Its
 * first line is `if (in_array('jobs.manage', $auth['permissions'])) return null;`: a manager
 * is exempt from all of it. That is deliberate, and it is what the system's own
 * "خيارات متقدمة (نقل حر بين المراحل)" refers to.
 *
 * So the next stage is offered to everyone and the API decides; free movement to any stage is
 * offered only to a manager, since for anyone else most of those jumps would be refused. Every
 * refusal is rendered with its own wording — the API says exactly what is missing, and
 * "something went wrong" would be strictly less useful than "لا يمكن نقل الأمر للمشتريات قبل
 * رفع ملف مونتاج".
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { JobFiles } from '@/components/job-files';
import { JobProofs } from '@/components/job-proofs';
import { builtHref } from '@/lib/built';

export type Stage = { stageKey: string; nameAr: string; nameEn: string; sortOrder?: number };

type Assignment = { id: string; userId: string; userName: string; roleKey: string; assignedAt: string };
type JobEvent = {
  id: string;
  eventType: string;
  fromStage: string | null;
  toStage: string | null;
  message: string | null;
  actorName: string | null;
  createdAt: string;
};

type Job = {
  id: string;
  number: string;
  title: string;
  clientId: string;
  clientName: string;
  jobType: string;
  designStatus: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  currentStage: string;
  deliveryDate: string | null;
  quantity: number;
  price: number;
  currencyCode: string;
  notes: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  reviewUrl: string | null;
  /** The API decides what this stage may send, to whom, and why not. */
  share?: {
    kind: string;
    canSend: boolean;
    blockReason: string | null;
    includesReviewUrl: boolean;
    reviewUrl: string | null;
    subjectAr: string; subjectEn: string;
    bodyAr: string; bodyEn: string;
  };
  assignments?: Assignment[];
  events?: JobEvent[];
};

const STATUS_STYLE: Record<Job['status'], string> = {
  ACTIVE: 'ae-badge-info',
  COMPLETED: 'ae-badge-success',
  CANCELLED: 'ae-badge-danger',
};

const DAY = 86400000;

export function JobDetail({
  id,
  stagesByType,
  onBack,
}: {
  id: string;
  stagesByType: Record<string, Stage[]>;
  onBack: () => void;
}) {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const money = useCallback(
    (v: number, currency: string) =>
      new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
        style: 'currency', currency, maximumFractionDigits: 0,
      }).format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api<{ job?: Job } | Job>(`/jobs/${id}`);
      setJob(('job' in res ? res.job : res) as Job);
    } catch (err) {
      setFailed(err instanceof ApiError);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function moveTo(stage: Stage) {
    if (!job) return;
    const label = lang === 'ar' ? stage.nameAr : stage.nameEn;
    if (!window.confirm(t('jobs.confirmNextStage', { job: job.number, stage: label }))) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/jobs/${job.id}/stage`, { method: 'POST', body: { stageKey: stage.stageKey } });
      await load();
    } catch (err) {
      // The API names exactly what is missing; that is far more useful than a generic failure.
      const code = err instanceof ApiError ? err.code : '';
      setError(code ? `jobs.stage.error.${code}` : 'common.error');
    } finally {
      setBusy(false);
    }
  }

  async function cancelJob() {
    if (!job || !window.confirm(t('jobs.cancelConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/jobs/${job.id}/cancel`, { method: 'POST' });
      await load();
    } catch {
      setError('common.error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="ae-page">
        <PageHero title={t('jobs.title')} />
        <Panel><Skeleton rows={6} /></Panel>
      </div>
    );
  }

  if (failed || !job) {
    return (
      <div className="ae-page">
        <PageHero
          title={t('jobs.title')}
          actions={<button type="button" className="ae-btn-ghost" onClick={onBack}>{t('common.close')}</button>}
        />
        <p className="ae-flash ae-flash--error">{t('common.error')}</p>
      </div>
    );
  }

  const chain = stagesByType[job.jobType] ?? [];
  const at = chain.findIndex((s) => s.stageKey === job.currentStage);
  const next = at >= 0 && at < chain.length - 1 ? chain[at + 1] : null;
  const stageName = (s: Stage) => (lang === 'ar' ? s.nameAr : s.nameEn);

  const manage = can('jobs.manage');
  const live = job.status === 'ACTIVE';

  /** Late, or how long is left — the thing anyone looking at a job wants first. */
  const delivery = (() => {
    if (!job.deliveryDate) return null;
    const days = Math.ceil((new Date(job.deliveryDate).getTime() - Date.now()) / DAY);
    if (!live) return null;
    if (days < 0) return { tone: 'ae-badge-danger', text: t('jobs.delivery.late', { days: Math.abs(days) }) };
    return { tone: days <= 3 ? 'ae-badge-warn' : 'ae-badge-muted', text: t('jobs.delivery.remaining', { days }) };
  })();

  const fact = (label: string, value: React.ReactNode) => (
    <div>
      <p className="ae-stat-label">{label}</p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );

  const invoiceHref = job.invoiceId ? builtHref(`/invoices/?id=${job.invoiceId}`) : null;
  const quoteHref = job.quoteId ? builtHref(`/quotes/?id=${job.quoteId}`) : null;

  return (
    <div className="ae-page">
      <PageHero
        title={job.number}
        actions={
          <div className="flex flex-wrap gap-2">
            {manage && live && (
              <button type="button" className="ae-btn-secondary" disabled={busy} onClick={() => void cancelJob()}>
                {t('jobs.cancel')}
              </button>
            )}
            <button type="button" className="ae-btn-ghost" onClick={onBack}>{t('common.close')}</button>
          </div>
        }
      />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}

      {/* ── Where it has got to ────────────────────────────────────────────── */}
      <Panel title={t('jobs.stageStepper')} className="mb-4">
        <div className="ae-workflow-strip">
          <ol className="ae-workflow-steps">
            {chain.map((s, i) => (
              <li key={s.stageKey}
                className={`ae-workflow-step ${i < at ? 'is-done' : ''} ${i === at ? 'is-current' : ''}`}>
                {/* The API's stage names are already numbered — "1. التصميم", "2. مراجعة
                    العميل" — so the index slot carries only the done mark. */}
                {i < at && <span className="ae-workflow-index" aria-hidden>✓</span>}
                <span className="ae-workflow-label">{stageName(s)}</span>
              </li>
            ))}
          </ol>
        </div>

        {live && (
          <div className="ae-workflow-actions mt-4 items-center">
            {next && (
              <button type="button" className="ae-btn-primary" disabled={busy} onClick={() => void moveTo(next)}>
                {t('jobs.nextStage')}: {stageName(next)}
              </button>
            )}

            {/* Free movement is a manager's exemption from the preconditions, not a shortcut
                anyone has — offering it more widely would mostly produce refusals. */}
            {manage && (
              <button type="button" className="ae-btn-ghost text-xs" onClick={() => setAdvanced((v) => !v)}>
                {t('jobs.advancedOptions')}
              </button>
            )}
          </div>
        )}

        {advanced && live && (
          <div className="ae-dash-section-links mt-3">
            {chain.filter((s) => s.stageKey !== job.currentStage).map((s) => (
              <button key={s.stageKey} type="button" className="ae-dash-section-link"
                disabled={busy} onClick={() => void moveTo(s)}>
                {stageName(s)}
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Panel className="ae-form-panel mb-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {fact(t('jobs.fieldTitle'), job.title)}
          {fact(t('jobs.fieldClient'), job.clientName)}
          {fact(
            t('jobs.status'),
            <span className={`ae-badge ${STATUS_STYLE[job.status]}`}>{t(`jobs.status.${job.status}`)}</span>,
          )}
          {fact(
            t('jobs.fieldDelivery'),
            job.deliveryDate ? (
              <>
                <span dir="ltr">{job.deliveryDate}</span>
                {delivery && <span className={`ae-badge ${delivery.tone} mt-1 block w-fit`}>{delivery.text}</span>}
              </>
            ) : t('jobs.delivery.unset'),
          )}
          {job.quantity > 0 && fact(t('jobs.fieldQuantity'), job.quantity.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-EG'))}
          {job.price > 0 && fact(t('jobs.fieldPrice'), money(job.price, job.currencyCode))}
          {fact(t('jobs.fieldDesign'), t(job.designStatus === 'ready' ? 'jobs.designReady' : 'jobs.designNeeded'))}
          {/* The two documents a job hangs between. */}
          {job.quoteNumber && fact(
            t('quotes.title'),
            quoteHref ? <Link href={quoteHref} className="underline" dir="ltr">{job.quoteNumber}</Link>
              : <span dir="ltr">{job.quoteNumber}</span>,
          )}
          {job.invoiceNumber && fact(
            t('invoices.title'),
            invoiceHref ? <Link href={invoiceHref} className="underline" dir="ltr">{job.invoiceNumber}</Link>
              : <span dir="ltr">{job.invoiceNumber}</span>,
          )}
        </div>

        {job.notes && (
          <p className="mt-4 whitespace-pre-wrap text-sm text-[var(--text-muted)]">{job.notes}</p>
        )}
      </Panel>

      {/* Proofs come before files: uploading one moves the job on its own, so it is the
          most consequential thing on this screen after the stepper itself. */}
      <div className="mb-4">
        <JobProofs
          jobId={job.id}
          canManage={live && can('jobs.create', 'jobs.manage')}
          onJobChanged={() => void load()}
        />
      </div>

      {/* Files sit under it because half the chain is gated on one existing: the stage a
          file is filed under is what unlocks the next move. */}
      <div className="mb-4">
        <JobFiles
          jobId={job.id}
          chain={chain}
          currentStage={job.currentStage}
          canManage={live && can('jobs.create', 'jobs.manage')}
          onChanged={() => void load()}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('jobs.assignments.title')}>
          {(job.assignments ?? []).length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('jobs.assignments.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {(job.assignments ?? []).map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-bold">{a.userName}</span>
                  <span className="ae-badge ae-badge-muted">
                    {t(`jobs.assignments.roles.${a.roleKey}`, a.roleKey)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t('audit.title')}>
          {(job.events ?? []).length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
          ) : (
            <ul className="space-y-3">
              {(job.events ?? []).map((e) => (
                <li key={e.id} className="text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-bold">
                      {/* The API writes a message for most events; the type is the fallback. */}
                      {e.message ?? t(`jobs.events.${e.eventType}`, e.eventType)}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]" dir="ltr">{e.createdAt}</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">
                    {e.actorName ?? t('jobs.events.auto')}
                    {e.toStage && ` · ${stageName(chain.find((s) => s.stageKey === e.toStage) ?? { stageKey: e.toStage, nameAr: e.toStage, nameEn: e.toStage })}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
