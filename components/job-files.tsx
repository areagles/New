'use client';

/**
 * A job's files.
 *
 * This is what makes the stages mean anything. Half the chain is gated on a file existing —
 * the API refuses to move a print job to montage without a source file, to purchasing without
 * a montage file, to client review without a proof — so the stage a file is filed under is
 * part of the file, not a label on it. It defaults to whichever stage the job is standing on,
 * which is nearly always the right answer.
 *
 * ── Uploading ─────────────────────────────────────────────────────────────────────────────
 *
 * The endpoint takes one file per request (`$_FILES['file']`, singular), so picking several
 * sends several requests, one after another rather than at once: these are print files, and
 * four 50 MB uploads in parallel on a site connection finish later than four in sequence and
 * report nothing useful in the meantime.
 *
 * Progress is shown per file because it has to be. The cap is 64 MB, which on a slow link is
 * minutes; a screen with no feedback for that long reads as broken and gets refreshed.
 *
 * ── When the response is lost ─────────────────────────────────────────────────────────────
 *
 * Measured on this host: a 95 MB upload returned a 307 from the edge after ~3½ minutes, and
 * the file was on disk, complete, listed against the job. The bytes arrive; the answer does
 * not always come back. Treating that as a failure would invite a retry and leave two copies,
 * so an interrupted upload re-reads the list and only reports a failure if the file is
 * genuinely absent.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiDownload, apiUpload, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Panel } from '@/components/page';
import type { Stage } from '@/components/job-detail';

export type JobFile = {
  id: string;
  stageKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  description: string | null;
  createdAt: string;
};

type Pending = {
  name: string;
  size: number;
  /** 0–1 while sending, null once sent and the server is still working. */
  progress: number | null;
  /** A dictionary key, or ready text when the server supplied part of it. */
  error?: string;
  errorIsText?: boolean;
};

const ERROR_KEY: Record<string, string> = {
  invalid_file_type: 'jobs.files.badType',
  stage_role_required: 'jobs.stageRoleRequired',
  upload_interrupted: 'jobs.files.uploadInterrupted',
  invalid_stage: 'common.error',
  upload_failed: 'common.error',
};

export function JobFiles({
  jobId,
  chain,
  currentStage,
  canManage,
  onChanged,
}: {
  jobId: string;
  chain: Stage[];
  currentStage: string;
  canManage: boolean;
  onChanged?: () => void;
}) {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const [files, setFiles] = useState<JobFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [stageKey, setStageKey] = useState(currentStage);
  const [description, setDescription] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setStageKey(currentStage), [currentStage]);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items?: JobFile[] }>(`/jobs/${jobId}/files`);
      setFiles(res.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? 'common.error' : null);
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

  const stageName = (key: string) => {
    const s = chain.find((x) => x.stageKey === key);
    return s ? (lang === 'ar' ? s.nameAr : s.nameEn) : key;
  };

  async function upload(chosen: File[]) {
    if (chosen.length === 0) return;
    setError(null);
    setPending(chosen.map((f) => ({ name: f.name, size: f.size, progress: 0 })));

    // One at a time: the endpoint takes one file, and serial uploads of print-sized files
    // finish sooner and report honestly along the way.
    for (let i = 0; i < chosen.length; i++) {
      const file = chosen[i];
      const form = new FormData();
      form.append('file', file);
      form.append('stageKey', stageKey);
      if (description.trim()) form.append('description', description.trim());

      try {
        await apiUpload(`/jobs/${jobId}/files`, form, {
          onProgress: (p) =>
            setPending((list) => list.map((x, n) => (n === i ? { ...x, progress: p } : x))),
        });
      } catch (err) {
        const code = err instanceof ApiError ? err.code : '';

        if (code === 'file_too_large') {
          // The refusal carries the limit, so the message states what the server actually
          // enforces rather than a number copied over here that could drift out of date.
          const max = Number((err as ApiError).payload.maxBytes ?? 0);
          const label = max > 0 ? size(max) : '';
          setPending((list) =>
            list.map((x, n) =>
              (n === i ? { ...x, error: t('jobs.files.tooLarge', { size: label }), errorIsText: true } : x)),
          );
          continue;
        }

        if (code === 'upload_interrupted') {
          // The bytes may well have arrived. Ask the server before calling it a failure.
          const before = files.length;
          await load();
          const res = await api<{ items?: JobFile[] }>(`/jobs/${jobId}/files`).catch(() => null);
          const landed = (res?.items ?? []).length > before;
          if (landed) continue;
        }

        setPending((list) =>
          list.map((x, n) => (n === i ? { ...x, error: ERROR_KEY[code] ?? 'common.error' } : x)),
        );
        continue;
      }
    }

    // Only the ones that worked disappear. A refusal has to stay on screen to be read —
    // clearing the whole list on completion took the reason away with it.
    setPending((list) => list.filter((x) => x.error));
    setDescription('');
    if (inputRef.current) inputRef.current.value = '';
    await load();
    onChanged?.();
  }

  async function remove(f: JobFile) {
    if (!window.confirm(t('jobs.files.deleteConfirm'))) return;
    try {
      await api(`/jobs/${jobId}/files/${f.id}`, { method: 'DELETE' });
      await load();
      onChanged?.();
    } catch {
      setError('common.error');
    }
  }

  async function download(f: JobFile) {
    try {
      await apiDownload(`/jobs/${jobId}/files/${f.id}/download`, f.fileName);
    } catch {
      setError('common.error');
    }
  }

  const uploading = pending.some((p) => !p.error);
  const failed = pending.filter((p) => p.error);

  return (
    <Panel title={t('jobs.files.title')}>
      {error && <p className="ae-flash ae-flash--error mb-3">{t(error)}</p>}

      {canManage && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('jobs.files.stage')}</span>
            <select value={stageKey} onChange={(e) => setStageKey(e.target.value)}
              disabled={uploading} className="ae-input">
              {chain.map((s) => (
                <option key={s.stageKey} value={s.stageKey}>{stageName(s.stageKey)}</option>
              ))}
            </select>
          </label>

          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-bold">{t('jobs.files.description')}</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              disabled={uploading} className="ae-input" />
          </label>

          <div className="sm:col-span-3">
            {/* The native control paints its own "Choose Files / No file chosen" in the
                browser's language, which lands as English in the middle of an Arabic screen
                and cannot be restyled. It is kept for what it does and hidden for what it
                says; the button opens it. */}
            <input
              ref={inputRef}
              type="file"
              multiple
              disabled={uploading}
              onChange={(e) => void upload(Array.from(e.target.files ?? []))}
              className="sr-only"
            />
            <button
              type="button"
              className="ae-btn-secondary"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {t('jobs.files.upload')}
            </button>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <ul className="mb-4 space-y-2">
          {pending.map((p, i) => (
            <li key={`${p.name}-${i}`} className="text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-bold">{p.name}</span>
                <span className="text-xs text-[var(--text-muted)]">
                  {p.error
                    ? (p.errorIsText ? p.error : t(p.error))
                    : p.progress === null
                      ? t('common.saving')
                      : `${Math.round(p.progress * 100)}%`}
                </span>
              </div>
              <div className="ae-progress mt-1" role="presentation">
                <span style={{ width: p.progress === null ? '100%' : `${(p.progress ?? 0) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {failed.length > 0 && !uploading && (
        <button type="button" className="ae-btn-ghost mb-4 text-xs" onClick={() => setPending([])}>
          {t('common.close')}
        </button>
      )}

      {loading ? (
        <div className="ae-skeleton h-8 w-full" aria-hidden />
      ) : files.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">{t('jobs.files.empty')}</p>
      ) : (
        <div className="ae-table-wrap">
          <table className="ae-table ae-table--rows">
            <thead>
              <tr>
                <th>{t('hr.documentFile')}</th>
                <th>{t('jobs.files.stage')}</th>
                <th>{t('hr.fileSize')}</th>
                <th>{t('treasury.date')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td>
                    <button type="button" className="font-bold underline" onClick={() => void download(f)}>
                      {f.fileName}
                    </button>
                    {f.description && (
                      <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{f.description}</span>
                    )}
                  </td>
                  <td>{stageName(f.stageKey)}</td>
                  <td className="whitespace-nowrap" dir="ltr">{size(f.fileSize)}</td>
                  <td className="whitespace-nowrap" dir="ltr">{f.createdAt}</td>
                  <td className="ae-actions-cell">
                    {can('jobs.manage') && (
                      <button type="button" aria-label={t('common.delete')}
                        className="ae-icon-btn ae-icon-btn-danger" onClick={() => void remove(f)}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
