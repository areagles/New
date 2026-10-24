'use client';

/**
 * Proofs — what the client is asked to sign off.
 *
 * A proof is not just another file, and it does not live in the files panel for two reasons.
 *
 * Uploading one moves the job by itself. `ae_job_save_proof` calls
 * `ae_job_auto_transition_after_proof_upload`, so a print job sitting in design lands in client
 * review the moment a proof arrives — no one presses anything. The upload therefore refreshes
 * the whole job, not just this list, or the stepper above would still be showing the old stage.
 *
 * And a proof carries a verdict. PENDING until the client opens the review link and either
 * approves it — which advances the job again — or rejects it with a comment, which sends it
 * back to design. Neither decision is made here: staff upload and read the answer. `reset`
 * exists for when a decision was made in error and the client should look again.
 *
 * The client's comment is shown against a rejection because it is the entire content of that
 * rejection — a proof marked "مرفوض" with the reason hidden a click away is a proof someone
 * will re-upload unchanged.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiDownload, apiUpload, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Panel } from '@/components/page';

type ProofStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type Proof = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  description: string | null;
  status: ProofStatus;
  clientComment: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

const STATUS_STYLE: Record<ProofStatus, string> = {
  PENDING: 'ae-badge-warn',
  APPROVED: 'ae-badge-success',
  REJECTED: 'ae-badge-danger',
};

const ERROR_KEY: Record<string, string> = {
  invalid_file_type: 'jobs.files.badType',
  stage_role_required: 'jobs.stageRoleRequired',
  upload_interrupted: 'jobs.files.uploadInterrupted',
  file_required: 'common.error',
  upload_failed: 'common.error',
};

export function JobProofs({
  jobId,
  canManage,
  onJobChanged,
}: {
  jobId: string;
  canManage: boolean;
  /** A proof upload, delete or reset can move the job — the caller has to re-read it. */
  onJobChanged: () => void;
}) {
  const { t, lang } = useI18n();

  const [proofs, setProofs] = useState<Proof[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null | undefined>(undefined);
  const [description, setDescription] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items?: Proof[] }>(`/jobs/${jobId}/proofs`);
      setProofs(res.items ?? []);
    } catch {
      setError('common.error');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const size = (bytes: number) => {
    const mb = bytes / 1024 / 1024;
    const n = new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      maximumFractionDigits: mb < 1 ? 1 : 0,
    });
    return mb < 1 ? `${n.format(bytes / 1024)} KB` : `${n.format(mb)} MB`;
  };

  async function upload(file: File) {
    setError(null);
    setErrorText(null);
    setProgress(0);

    const form = new FormData();
    form.append('file', file);
    if (description.trim()) form.append('description', description.trim());

    try {
      await apiUpload(`/jobs/${jobId}/proofs`, form, { onProgress: setProgress });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';

      if (code === 'file_too_large') {
        const max = Number((err as ApiError).payload.maxBytes ?? 0);
        setErrorText(t('jobs.files.tooLarge', { size: max > 0 ? size(max) : '' }));
      } else if (code === 'upload_interrupted') {
        // The bytes may have landed even though the reply did not — ask before reporting.
        const before = proofs.length;
        const res = await api<{ items?: Proof[] }>(`/jobs/${jobId}/proofs`).catch(() => null);
        if ((res?.items ?? []).length <= before) setError(ERROR_KEY[code]);
      } else {
        setError(ERROR_KEY[code] ?? 'common.error');
      }
    } finally {
      setProgress(undefined);
      setDescription('');
      if (inputRef.current) inputRef.current.value = '';
      await load();
      // The stage has very likely moved; the screen around this panel has to catch up.
      onJobChanged();
    }
  }

  async function act(p: Proof, what: 'delete' | 'reset') {
    const confirmKey = what === 'delete' ? 'jobs.proofs.deleteConfirm' : 'jobs.proofs.resetConfirm';
    if (!window.confirm(t(confirmKey))) return;
    setBusyId(p.id);
    setError(null);
    try {
      if (what === 'delete') await api(`/jobs/${jobId}/proofs/${p.id}`, { method: 'DELETE' });
      else await api(`/jobs/${jobId}/proofs/${p.id}/reset`, { method: 'PATCH' });
      await load();
      onJobChanged();
    } catch {
      setError('common.error');
    } finally {
      setBusyId(null);
    }
  }

  const uploading = progress !== undefined;

  return (
    <Panel title={t('jobs.proofs.title')}>
      {error && <p className="ae-flash ae-flash--error mb-3">{t(error)}</p>}
      {errorText && <p className="ae-flash ae-flash--error mb-3">{errorText}</p>}

      {canManage && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-bold">{t('jobs.proofs.description')}</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              disabled={uploading} className="ae-input" />
          </label>

          <div className="flex items-end">
            {/* Hidden for the same reason as on the files panel: the native control writes
                its own English chrome into an Arabic screen. */}
            <input
              ref={inputRef}
              type="file"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
              className="sr-only"
            />
            <button type="button" className="ae-btn-secondary" disabled={uploading}
              onClick={() => inputRef.current?.click()}>
              {t('jobs.proofs.upload')}
            </button>
          </div>
        </div>
      )}

      {uploading && (
        <div className="mb-4">
          <div className="mb-1 flex justify-between text-xs text-[var(--text-muted)]">
            <span>{t('jobs.proofs.upload')}</span>
            <span>{progress === null ? t('common.saving') : `${Math.round((progress ?? 0) * 100)}%`}</span>
          </div>
          <div className="ae-progress" role="presentation">
            <span style={{ width: progress === null ? '100%' : `${(progress ?? 0) * 100}%` }} />
          </div>
        </div>
      )}

      {loading ? (
        <div className="ae-skeleton h-8 w-full" aria-hidden />
      ) : proofs.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">{t('jobs.proofs.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {proofs.map((p) => (
            <li key={p.id} className="ae-dash-attention-row flex-col items-stretch gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" className="font-bold underline"
                  onClick={() => void apiDownload(`/jobs/${jobId}/proofs/${p.id}/download`, p.fileName)}>
                  {p.fileName}
                </button>
                <span className={`ae-badge ${STATUS_STYLE[p.status]}`}>
                  {t(`jobs.proofs.status.${p.status}`)}
                </span>
              </div>

              {p.description && (
                <p className="text-xs text-[var(--text-muted)]">{p.description}</p>
              )}

              {/* A rejection without its reason is a proof someone re-uploads unchanged. */}
              {p.clientComment && (
                <p className="ae-alert-pill ae-alert-pill--warn block text-xs">{p.clientComment}</p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                <span dir="ltr">{size(p.fileSize)} · {p.reviewedAt ?? p.createdAt}</span>
                {canManage && (
                  <span className="ae-action-icons">
                    {p.status !== 'PENDING' && (
                      <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                        disabled={busyId === p.id} onClick={() => void act(p, 'reset')}>
                        {t('jobs.proofs.resetForReview')}
                      </button>
                    )}
                    <button type="button" aria-label={t('common.delete')}
                      className="ae-icon-btn ae-icon-btn-danger"
                      disabled={busyId === p.id} onClick={() => void act(p, 'delete')}>
                      ✕
                    </button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
