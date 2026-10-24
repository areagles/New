'use client';

/**
 * جدولة الماكينات — which press is running what, and when.
 *
 * A Gantt board over a moving date window: one row per active machine, one bar per booking. The
 * window defaults to three days back and eleven forward, which is the horizon a shop actually
 * plans over — far enough to see next week's crush, near enough that today is still on screen.
 *
 * ── A conflict is a question, not an error ────────────────────────────────────────────────
 *
 * Booking a machine that is already busy comes back `ok:false` with the overlapping blocks
 * listed, and the same request with `force` goes through. That is deliberate on the server's
 * part — overlapping a run across a shift change is normal practice — so this screen shows what
 * it would collide with and lets the person decide, rather than refusing or silently forcing.
 *
 * ── Positioning ───────────────────────────────────────────────────────────────────────────
 *
 * Bars are placed by percentage across the window, from the block's own start and end. A block
 * that begins before the window or ends after it is clamped to the edges so it still reads as
 * "running through here" instead of vanishing or overflowing the row.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

type Machine = { id: string; label: string };
type Block = {
  id: string; machineId: string; machineLabel: string | null;
  jobId: string | null; jobNumber: string | null; clientName: string | null;
  title: string; startsAt: string; endsAt: string; notes: string | null; color: string | null;
};
type JobOption = { id: string; number: string | null; title: string; clientName: string; deliveryDate: string | null };
type Board = { machines: Machine[]; blocks: Block[]; from: string; to: string };

const DAY_MS = 86_400_000;
/** Matches the server's own default span so paging moves by exactly one screen. */
const WINDOW_DAYS = 14;

const BLANK = { machineId: '', jobId: '', title: '', startsAt: '', endsAt: '', notes: '', color: '' };

export default function SchedulingPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const manage = can('scheduling.manage');

  const [offset, setOffset] = useState(0);
  const [board, setBoard] = useState<Board | null>(null);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<typeof BLANK & { id?: string }>({ ...BLANK });
  const [editing, setEditing] = useState(false);
  /** What the requested booking would collide with, kept until it is forced or abandoned. */
  const [conflicts, setConflicts] = useState<Block[] | null>(null);

  const window14 = useMemo(() => {
    const base = Date.now() + offset * WINDOW_DAYS * DAY_MS;
    const from = new Date(base - 3 * DAY_MS);
    const to = new Date(base + 11 * DAY_MS);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }, [offset]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, j] = await Promise.all([
        api<Board>(`/scheduling/board?from=${window14.from}&to=${window14.to}`),
        api<{ items?: JobOption[] }>('/scheduling/jobs').catch(() => ({ items: [] })),
      ]);
      setBoard(b);
      setJobs(j.items ?? []);
    } catch {
      setError('scheduling.loadError');
    } finally {
      setLoading(false);
    }
  }, [window14]);

  useEffect(() => {
    void load();
  }, [load]);

  const date = useCallback(
    (v: string) => new Date(v).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'numeric' }),
    [lang],
  );
  const dateTime = useCallback(
    (v: string) => new Date(v).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', {
      day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
    }),
    [lang],
  );

  /** Day columns across the window — the header ruler the bars are measured against. */
  const days = useMemo(() => {
    if (!board) return [];
    const start = new Date(`${board.from}T00:00:00`).getTime();
    const end = new Date(`${board.to}T23:59:59`).getTime();
    const out: { label: string; iso: string }[] = [];
    for (let ts = start; ts <= end; ts += DAY_MS) {
      const d = new Date(ts);
      out.push({ label: date(d.toISOString()), iso: d.toISOString().slice(0, 10) });
    }
    return out;
  }, [board, date]);

  /**
   * Overlapping blocks get their own lane so both stay visible. A machine that is double-booked
   * is exactly what this board exists to show; drawing the second bar on top of the first would
   * hide the one thing worth seeing. Lanes are assigned greedily in start order — each block
   * takes the first lane whose last block has already finished.
   */
  const lanesFor = useCallback((blocks: Block[]) => {
    const sorted = [...blocks].sort(
      (a, b) => new Date(a.startsAt.replace(' ', 'T')).getTime() - new Date(b.startsAt.replace(' ', 'T')).getTime(),
    );
    const laneEnds: number[] = [];
    const lane = new Map<string, number>();
    for (const b of sorted) {
      const s = new Date(b.startsAt.replace(' ', 'T')).getTime();
      const e = new Date(b.endsAt.replace(' ', 'T')).getTime();
      let i = laneEnds.findIndex((end) => end <= s);
      if (i === -1) { i = laneEnds.length; laneEnds.push(e); } else { laneEnds[i] = e; }
      lane.set(b.id, i);
    }
    return { lane, count: Math.max(1, laneEnds.length) };
  }, []);

  /** Where a block sits in the window, as percentages, clamped to the visible edges. */
  const place = useCallback((b: Block) => {
    if (!board) return null;
    const start = new Date(`${board.from}T00:00:00`).getTime();
    const end = new Date(`${board.to}T23:59:59`).getTime();
    const span = Math.max(1, end - start);
    const s = Math.max(start, new Date(b.startsAt.replace(' ', 'T')).getTime());
    const e = Math.min(end, new Date(b.endsAt.replace(' ', 'T')).getTime());
    if (e <= start || s >= end) return null;
    return {
      inset: `${((s - start) / span) * 100}%`,
      width: `${Math.max(1, ((e - s) / span) * 100)}%`,
    };
  }, [board]);

  function openNew(machineId: string) {
    setEditing(true);
    setConflicts(null);
    setError(null);
    setForm({ ...BLANK, machineId });
  }

  function openEdit(b: Block) {
    setEditing(true);
    setConflicts(null);
    setError(null);
    setForm({
      id: b.id, machineId: b.machineId, jobId: b.jobId ?? '', title: b.title,
      startsAt: b.startsAt.replace(' ', 'T').slice(0, 16),
      endsAt: b.endsAt.replace(' ', 'T').slice(0, 16),
      notes: b.notes ?? '', color: b.color ?? '',
    });
  }

  async function save(force = false) {
    if (form.title.trim() === '') {
      setError('scheduling.titleRequired');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        machineId: form.machineId,
        jobId: form.jobId || null,
        title: form.title.trim(),
        startsAt: form.startsAt,
        endsAt: form.endsAt,
        notes: form.notes.trim() || null,
        color: form.color || null,
        force,
      };
      if (form.id) await api(`/scheduling/blocks/${form.id}`, { method: 'PATCH', body });
      else await api('/scheduling/blocks', { method: 'POST', body });
      setEditing(false);
      setConflicts(null);
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      // A conflict arrives as a rejection carrying the overlapping blocks — api() throws on any
      // ok:false, 409 included — so it is read off the error rather than the return value.
      const withConflicts = err instanceof ApiError
        ? (err.payload as { conflicts?: Block[] }).conflicts
        : undefined;
      if (withConflicts?.length) {
        setConflicts(withConflicts);
        return;
      }
      setError(code ? `scheduling.error.${code}` : 'scheduling.saveError');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t('scheduling.deleteConfirm'))) return;
    setBusy(true);
    try {
      await api(`/scheduling/blocks/${id}`, { method: 'DELETE' });
      setEditing(false);
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
        <PageHero title={t('scheduling.title')} subtitle={t('scheduling.subtitle')} />
        <Panel><Skeleton rows={6} /></Panel>
      </div>
    );
  }

  const machines = board?.machines ?? [];

  return (
    <div className="ae-page">
      <PageHero title={t('scheduling.title')} subtitle={t('scheduling.subtitle')} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}

      {machines.length === 0 ? (
        <Panel><p className="text-sm text-[var(--text-muted)]">{t('scheduling.noMachines')}</p></Panel>
      ) : (
        <Panel>
          <div className="ae-toolbar mb-3 flex flex-wrap items-center gap-2">
            <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" onClick={() => setOffset((o) => o - 1)}>
              {t('scheduling.prevWindow')}
            </button>
            <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" onClick={() => setOffset(0)}>
              {t('scheduling.today')}
            </button>
            <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" onClick={() => setOffset((o) => o + 1)}>
              {t('scheduling.nextWindow')}
            </button>
            <span className="text-xs text-[var(--text-muted)]">
              {board && `${date(board.from)} → ${date(board.to)}`}
            </span>
          </div>

          <div className="ae-table-wrap">
            <div className="min-w-[72rem]">
              {/* The ruler the bars are measured against. */}
              <div className="mb-1 flex gap-2 text-[0.65rem] text-[var(--text-muted)]">
                <span className="w-32 shrink-0" />
                <span className="flex flex-1">
                  {days.map((d) => (
                    <span key={d.iso} className="flex-1 text-center">{d.label}</span>
                  ))}
                </span>
              </div>

              {machines.map((m) => {
                const mine = (board?.blocks ?? []).filter((b) => b.machineId === m.id);
                const { lane, count } = lanesFor(mine);
                return (
                  <div key={m.id} className="mb-2 flex items-stretch gap-2">
                    <span className="flex w-32 shrink-0 items-center text-xs font-bold">{m.label}</span>
                    <span className="relative flex-1 rounded bg-[var(--surface-2,rgba(128,128,128,0.12))]"
                      style={{ minHeight: `${1.25 + count * 1.75}rem` }}>
                      {/* Day gridlines, so a bar's edges can be read against a date. */}
                      <span className="absolute inset-0 flex" aria-hidden>
                        {days.map((d) => (
                          <span key={d.iso} className="flex-1 border-e border-[var(--border,rgba(128,128,128,0.2))]" />
                        ))}
                      </span>
                      {mine.map((b) => {
                        const pos = place(b);
                        if (!pos) return null;
                        return (
                          <button key={b.id} type="button" disabled={!manage} onClick={() => openEdit(b)}
                            title={`${b.title} · ${dateTime(b.startsAt)} → ${dateTime(b.endsAt)}`}
                            className="absolute truncate rounded px-2 py-1 text-start text-[0.7rem] text-white"
                            style={{
                              insetInlineStart: pos.inset, width: pos.width,
                              top: `${0.25 + (lane.get(b.id) ?? 0) * 1.75}rem`,
                              background: b.color || 'var(--accent)',
                            }}>
                            {b.jobNumber ? `${b.jobNumber} — ${b.title}` : b.title}
                          </button>
                        );
                      })}
                      {manage && (
                        <button type="button" onClick={() => openNew(m.id)}
                          className="absolute bottom-0.5 end-1 text-[0.65rem] underline">
                          {t('scheduling.addBlock')}
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>
      )}

      {editing && (
        <Panel title={form.id ? t('scheduling.editBlock') : t('scheduling.newBlock')} className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('scheduling.machine')}</span>
              <select className="ae-input" value={form.machineId}
                onChange={(e) => setForm({ ...form, machineId: e.target.value })}>
                {machines.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('scheduling.blockTitle')}</span>
              <input className="ae-input" value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('scheduling.job')}</span>
              <select className="ae-input" value={form.jobId}
                onChange={(e) => setForm({ ...form, jobId: e.target.value })}>
                {/* Downtime and maintenance are bookings with no job behind them. */}
                <option value="">{t('scheduling.noJob')}</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.number ? `${j.number} — ` : ''}{j.title} · {j.clientName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('scheduling.start')}</span>
              <input type="datetime-local" className="ae-input" value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('scheduling.end')}</span>
              <input type="datetime-local" className="ae-input" value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('scheduling.color')}</span>
              <input type="color" className="ae-input h-10" value={form.color || '#c9a227'}
                onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </label>
          </div>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block font-bold">{t('scheduling.notes')}</span>
            <textarea className="ae-input" rows={2} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>

          {conflicts && (
            <div className="ae-flash ae-flash--error mt-3">
              <strong className="block">{t('scheduling.conflictTitle')}</strong>
              <span className="block text-xs">{t('scheduling.conflictBody')}</span>
              <ul className="mt-1 text-xs">
                {conflicts.map((c) => (
                  <li key={c.id}>
                    {c.jobNumber ? `${c.jobNumber} — ` : ''}{c.title} · {dateTime(c.startsAt)} → {dateTime(c.endsAt)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="ae-btn-primary" disabled={busy} onClick={() => void save(false)}>
              {t('scheduling.save')}
            </button>
            {/* Only offered once a conflict is on screen — overriding something you have not
                been shown is not a decision, it is a guess. */}
            {conflicts && (
              <button type="button" className="ae-btn-secondary" disabled={busy} onClick={() => void save(true)}>
                {t('scheduling.forceBook')}
              </button>
            )}
            {form.id && (
              <button type="button" className="ae-btn-ghost" disabled={busy} onClick={() => void remove(form.id!)}>
                {t('scheduling.delete')}
              </button>
            )}
            <button type="button" className="ae-btn-ghost" onClick={() => { setEditing(false); setConflicts(null); }}>
              {t('scheduling.cancel')}
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}
