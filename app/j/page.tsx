'use client';

/**
 * The client's proof review — the public half of the workflow.
 *
 * Everything else in this rebuild is behind a session. This page is not: it is reached from a
 * link sent to a client, identified only by the job's `access_token` in the query string, and
 * the person opening it has no account here and never will. That single fact decides the whole
 * design — no shell, no navigation, nothing to explore, one question asked plainly.
 *
 * It matters more than it looks. A print job stops at client review until a proof is approved
 * or sent back, and the API only accepts that verdict through this token. Without this page the
 * staff side can upload proofs it can never get an answer to, and every job would have to be
 * dragged past the gate by a manager's exemption — which is exactly what "approved" is supposed
 * to mean, recorded by the person whose approval it is.
 *
 * A rejection carries a reason, and the reason is required rather than optional: the API will
 * take an empty one, but a proof returned with no explanation is a proof that comes back
 * unchanged. The stock reasons come from the system's own list.
 *
 * The palette is the tenant's client-facing one from `appearance` — light, and nothing to do
 * with the gold-night admin theme. It is applied to this page's own container rather than the
 * document, because the root layout is shared with the authenticated app.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_BASE } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type ProofStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

type Proof = {
  id: string;
  fileName: string;
  mimeType: string;
  description: string | null;
  status: ProofStatus;
  clientComment: string | null;
  reviewedAt: string | null;
};

type Payload = {
  job: {
    number: string;
    title: string;
    jobType: string;
    currentStageLabel: string;
    deliveryDate: string | null;
    status: string;
  };
  client: { name: string };
  company: { name: string; logoUrl?: string; phone?: string; email?: string };
  appearance?: {
    accent?: string; accentHover?: string; bg?: string;
    surface?: string; text?: string; textMuted?: string;
  };
  proofs: Proof[];
};

/** Stock reasons the system already offers; a job type picks which set applies. */
const REASON_SETS: Record<string, string> = {
  print: 'design', carton: 'design', plastic: 'design',
  design_only: 'design', web: 'design', social: 'content',
};

export default function JobReviewPage() {
  return (
    <Suspense fallback={null}>
      <JobReview />
    </Suspense>
  );
}

function JobReview() {
  const { t, lang } = useI18n();
  const token = useSearchParams().get('token') ?? '';

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      setFailed('jobReview.invalidLink');
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/public/job-review?token=${encodeURIComponent(token)}`);
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setFailed('jobReview.unavailable');
        return;
      }
      setData(json as Payload);
    } catch {
      setFailed('jobReview.unavailable');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(proof: Proof, decision: 'approve' | 'reject') {
    if (decision === 'reject' && comment.trim() === '') {
      setFailed('jobReview.validationReasonRequired');
      return;
    }
    setBusyId(proof.id);
    setFailed(null);
    setFlash(null);
    try {
      const res = await fetch(
        `${API_BASE}/public/job-review/proofs/${proof.id}/${decision}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, comment: comment.trim() }),
        },
      );
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setFailed(json.error === 'proof_already_reviewed' ? 'jobReview.alreadyReviewed' : 'jobReview.actionFailed');
        return;
      }
      setFlash(decision === 'approve' ? 'jobReview.approveSuccess' : 'jobReview.rejectSuccess');
      setRejecting(null);
      setComment('');
      await load();
    } catch {
      setFailed('jobReview.actionFailed');
    } finally {
      setBusyId(null);
    }
  }

  const a = data?.appearance;
  // The tenant's own client-facing palette, scoped to this page.
  const skin: React.CSSProperties = {
    ['--jr-accent' as string]: a?.accent ?? '#0c8ee6',
    ['--jr-accent-hover' as string]: a?.accentHover ?? '#0675c4',
    ['--jr-bg' as string]: a?.bg ?? '#f1f5f9',
    ['--jr-surface' as string]: a?.surface ?? '#ffffff',
    ['--jr-text' as string]: a?.text ?? '#0f172a',
    ['--jr-muted' as string]: a?.textMuted ?? '#64748b',
    background: 'var(--jr-bg)',
    color: 'var(--jr-text)',
    minHeight: '100dvh',
  };

  if (loading) {
    return <main style={skin} className="grid place-items-center p-6">
      <p style={{ color: 'var(--jr-muted)' }}>{t('jobReview.loading')}</p>
    </main>;
  }

  if (failed && !data) {
    return <main style={skin} className="grid place-items-center p-6">
      <p className="text-lg font-bold">{t(failed)}</p>
    </main>;
  }

  if (!data) return null;

  const { job, client, company, proofs } = data;
  const reasonSet = REASON_SETS[job.jobType] ?? 'design';
  const reasons = [1, 2, 3, 4]
    .map((n) => t(`jobReview.reasonPresets.${reasonSet}.${n}`))
    .filter((s) => !s.startsWith('jobReview.'));

  const card: React.CSSProperties = {
    background: 'var(--jr-surface)',
    borderRadius: 14,
    border: '1px solid rgba(0,0,0,.08)',
    boxShadow: '0 1px 3px rgba(0,0,0,.06)',
  };

  const statusLabel: Record<ProofStatus, string> = {
    PENDING: t('jobReview.counts.pending'),
    APPROVED: t('jobReview.decisionApproved'),
    REJECTED: t('jobReview.decisionRejected'),
  };
  const statusColor: Record<ProofStatus, string> = {
    PENDING: 'var(--jr-muted)', APPROVED: '#16a34a', REJECTED: '#dc2626',
  };

  return (
    <main style={skin} className="px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-3xl">
        <header style={card} className="mb-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {company.logoUrl
                ? <img src={company.logoUrl} alt="" style={{ maxHeight: 40 }} />
                : <span className="text-lg font-extrabold">{company.name}</span>}
            </div>
            <span className="text-sm" style={{ color: 'var(--jr-muted)' }}>
              {t('jobReview.jobNumber')} <span dir="ltr" className="font-bold">{job.number}</span>
            </span>
          </div>

          <h1 className="mt-4 text-xl font-extrabold">{t('jobReview.title')}</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--jr-muted)' }}>{job.title}</p>

          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt style={{ color: 'var(--jr-muted)' }}>{t('jobReview.you')}</dt>
              <dd className="font-bold">{client.name}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--jr-muted)' }}>{t('jobReview.stage')}</dt>
              <dd className="font-bold">{job.currentStageLabel}</dd>
            </div>
            {job.deliveryDate && (
              <div>
                <dt style={{ color: 'var(--jr-muted)' }}>{t('jobReview.delivery')}</dt>
                <dd className="font-bold" dir="ltr">{job.deliveryDate}</dd>
              </div>
            )}
          </dl>
        </header>

        {flash && (
          <p style={{ ...card, borderColor: '#16a34a', color: '#166534' }} className="mb-4 p-3 text-sm font-bold">
            {t(flash)}
          </p>
        )}
        {failed && (
          <p style={{ ...card, borderColor: '#dc2626', color: '#991b1b' }} className="mb-4 p-3 text-sm font-bold">
            {t(failed)}
          </p>
        )}

        {proofs.length === 0 ? (
          <p style={card} className="p-6 text-center text-sm" >{t('jobReview.noProofs')}</p>
        ) : (
          <ul className="space-y-4">
            {proofs.map((p) => {
              const src = `${API_BASE}/public/job-review/file?token=${encodeURIComponent(token)}&proofId=${p.id}`;
              const isImage = p.mimeType.startsWith('image/');
              const decided = p.status !== 'PENDING';
              return (
                <li key={p.id} style={card} className="overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4"
                    style={{ borderColor: 'rgba(0,0,0,.08)' }}>
                    <span className="font-bold" dir="ltr">{p.fileName}</span>
                    <span className="text-sm font-bold" style={{ color: statusColor[p.status] }}>
                      {statusLabel[p.status]}
                    </span>
                  </div>

                  {p.description && (
                    <p className="px-4 pt-3 text-sm" style={{ color: 'var(--jr-muted)' }}>{p.description}</p>
                  )}

                  {/* Shown in the page, not offered as a download: the question is whether
                      this looks right, and it cannot be answered without seeing it. */}
                  <div className="p-4">
                    {isImage ? (
                      <img src={src} alt={p.fileName} className="w-full rounded-lg" />
                    ) : (
                      <iframe src={src} title={p.fileName} className="w-full rounded-lg"
                        style={{ height: '60vh', border: '1px solid rgba(0,0,0,.08)' }} />
                    )}
                    <a href={src} target="_blank" rel="noopener noreferrer"
                      className="mt-2 inline-block text-sm font-bold" style={{ color: 'var(--jr-accent)' }}>
                      {t('jobReview.pdfFullscreen')}
                    </a>
                  </div>

                  {decided ? (
                    <div className="border-t p-4 text-sm" style={{ borderColor: 'rgba(0,0,0,.08)' }}>
                      <p style={{ color: 'var(--jr-muted)' }}>
                        {t('jobReview.alreadyReviewed')}
                        {p.reviewedAt && <span dir="ltr"> · {p.reviewedAt}</span>}
                      </p>
                      {p.clientComment && <p className="mt-2">{p.clientComment}</p>}
                    </div>
                  ) : (
                    <div className="border-t p-4" style={{ borderColor: 'rgba(0,0,0,.08)' }}>
                      {rejecting === p.id ? (
                        <>
                          <label className="block text-sm font-bold">{t('jobReview.comment')}</label>
                          <textarea
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder={t('jobReview.reasonPlaceholder')}
                            rows={3}
                            className="mt-1 w-full rounded-lg p-3 text-sm"
                            style={{ border: '1px solid rgba(0,0,0,.15)', background: 'var(--jr-surface)', color: 'var(--jr-text)' }}
                          />
                          {reasons.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {reasons.map((r) => (
                                <button key={r} type="button" onClick={() => setComment(r)}
                                  className="rounded-full px-3 py-1 text-xs"
                                  style={{ border: '1px solid rgba(0,0,0,.15)', color: 'var(--jr-muted)' }}>
                                  {r}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" disabled={busyId === p.id}
                              onClick={() => void decide(p, 'reject')}
                              className="rounded-lg px-4 py-2 text-sm font-bold text-white"
                              style={{ background: '#dc2626' }}>
                              {t('jobReview.reject')}
                            </button>
                            <button type="button" onClick={() => { setRejecting(null); setComment(''); }}
                              className="rounded-lg px-4 py-2 text-sm font-bold"
                              style={{ border: '1px solid rgba(0,0,0,.15)' }}>
                              {t('jobReview.discardDraft')}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button type="button" disabled={busyId === p.id}
                            onClick={() => void decide(p, 'approve')}
                            className="rounded-lg px-5 py-2 text-sm font-bold text-white"
                            style={{ background: 'var(--jr-accent)' }}>
                            {t('jobReview.approve')}
                          </button>
                          <button type="button" onClick={() => { setRejecting(p.id); setFailed(null); }}
                            className="rounded-lg px-5 py-2 text-sm font-bold"
                            style={{ border: '1px solid rgba(0,0,0,.15)' }}>
                            {t('jobReview.reject')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {(company.phone || company.email) && (
          <p className="mt-6 text-center text-xs" style={{ color: 'var(--jr-muted)' }} dir="ltr">
            {[company.phone, company.email].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </main>
  );
}
