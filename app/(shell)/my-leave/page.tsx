'use client';

/**
 * إجازاتي — an employee's own leave, without going through HR to see it.
 *
 * Self-service: no `hr.*` permission is needed, because this shows one person their own balance
 * and their own requests. The API works that out from the session's user, so nothing here takes
 * an employee id — a page that let you type one would be a page that let you read a colleague's
 * leave.
 *
 * ── The balance has three parts, and pending is one of them ───────────────────────────────
 *
 * Entitled, used, remaining — and separately, days already requested and not yet decided. Those
 * pending days are not deducted from the remaining figure, so a balance of ten with four pending
 * really means six once they are approved. Both numbers are shown for that reason: a screen that
 * only shows "remaining" invites a second request that cannot be honoured.
 *
 * ── Not every user is an employee ─────────────────────────────────────────────────────────
 *
 * A login exists before an employee record is linked to it, and the API answers
 * `employee_not_linked` in that case. That is not an error to bury: the page says who can fix it
 * and where, because the person reading it cannot.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PageHero, Panel, Skeleton } from '@/components/page';

type Balance = { entitled: number; used: number; remaining: number; pending?: number };
type Request = {
  id: string; leaveType: string; startDate: string; endDate: string;
  days: number; status: 'PENDING' | 'APPROVED' | 'REJECTED'; notes?: string | null;
};
type Payload = { employee: { id: string; name: string } | null; balance: Balance; requests: Request[] };

const TYPES = ['ANNUAL', 'SICK', 'UNPAID'] as const;
const STATUS_TONE: Record<string, string> = {
  PENDING: 'ae-badge-warn', APPROVED: 'ae-badge-success', REJECTED: 'ae-badge-danger',
};

export default function MyLeavePage() {
  const { t, lang } = useI18n();

  const [data, setData] = useState<Payload | null>(null);
  const [notLinked, setNotLinked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ leaveType: 'ANNUAL', startDate: today, endDate: today, notes: '' });

  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', { maximumFractionDigits: 2 }).format(v),
    [lang],
  );
  const date = useCallback(
    (v: string) => new Date(v).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB'),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setNotLinked(false);
    try {
      setData(await api<Payload>('/hr/me/leave'));
    } catch (err) {
      // Not an error the reader can act on themselves, so it gets its own state and its own
      // sentence rather than the generic failure.
      if (err instanceof ApiError && err.code === 'employee_not_linked') setNotLinked(true);
      else setError('common.error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await api('/hr/me/leave', {
        method: 'POST',
        body: {
          leaveType: form.leaveType,
          startDate: form.startDate,
          endDate: form.endDate,
          notes: form.notes.trim() || null,
        },
      });
      setFlash('myLeave.submitted');
      setForm({ ...form, notes: '' });
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code ? `myLeave.error.${code}` : 'common.error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="ae-page">
        <PageHero title={t('myLeave.title')} subtitle={t('myLeave.subtitle')} />
        <Panel><Skeleton rows={5} /></Panel>
      </div>
    );
  }

  if (notLinked) {
    return (
      <div className="ae-page">
        <PageHero title={t('myLeave.title')} subtitle={t('myLeave.subtitle')} />
        <Panel><p className="text-sm">{t('myLeave.notLinked')}</p></Panel>
      </div>
    );
  }

  const b = data?.balance;

  return (
    <div className="ae-page">
      <PageHero title={t('myLeave.title')} subtitle={t('myLeave.subtitle')} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash)}</p>}

      {b && (
        <div className="ae-counter-grid mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="ae-counter">
            <span className="ae-counter-label">{t('myLeave.entitled')}</span>
            <span className="ae-counter-value">{num(b.entitled)}</span>
          </div>
          <div className="ae-counter">
            <span className="ae-counter-label">{t('myLeave.used')}</span>
            <span className="ae-counter-value">{num(b.used)}</span>
          </div>
          <div className="ae-counter">
            <span className="ae-counter-label">{t('myLeave.remaining')}</span>
            <span className="ae-counter-value">{num(b.remaining)}</span>
          </div>
          {/* Pending days are not taken out of remaining, so showing only remaining would
              invite a request the balance cannot actually cover. */}
          <div className={`ae-counter${(b.pending ?? 0) > 0 ? ' ae-counter--warn' : ''}`}>
            <span className="ae-counter-label">{t('myLeave.pending')}</span>
            <span className="ae-counter-value">{num(b.pending ?? 0)}</span>
          </div>
        </div>
      )}

      <Panel title={t('myLeave.request')}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('myLeave.type')}</span>
            <select className="ae-input" value={form.leaveType}
              onChange={(e) => setForm({ ...form, leaveType: e.target.value })}>
              {TYPES.map((x) => <option key={x} value={x}>{t(`myLeave.type.${x}`)}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('etaPull.from')}</span>
            <input type="date" className="ae-input" value={form.startDate}
              onChange={(e) => setForm({
                ...form,
                startDate: e.target.value,
                // A start after the end is rejected by the API; moving the end with it is
                // what somebody picking a single day actually meant.
                endDate: form.endDate < e.target.value ? e.target.value : form.endDate,
              })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('etaPull.to')}</span>
            <input type="date" className="ae-input" min={form.startDate} value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('invoices.notes')}</span>
            <input className="ae-input" value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        </div>
        <button type="button" className="ae-btn-primary mt-3" disabled={busy}
          onClick={() => void submit()}>
          {t('myLeave.submit')}
        </button>
      </Panel>

      <Panel title={t('myLeave.myRequests')} className="mt-4">
        {(data?.requests ?? []).length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t('myLeave.empty')}</p>
        ) : (
          <div className="ae-table-wrap">
            <table className="ae-table">
              <thead>
                <tr>
                  <th>{t('myLeave.type')}</th>
                  <th>{t('etaPull.from')}</th>
                  <th>{t('etaPull.to')}</th>
                  <th>{t('myLeave.days')}</th>
                  <th>{t('purchaseOrders.status')}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.requests ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="text-xs">{t(`myLeave.type.${r.leaveType}`, r.leaveType)}</td>
                    <td className="text-xs">{date(r.startDate)}</td>
                    <td className="text-xs">{date(r.endDate)}</td>
                    <td>{num(r.days)}</td>
                    <td>
                      <span className={`ae-badge ${STATUS_TONE[r.status] ?? 'ae-badge-muted'} text-xs`}>
                        {t(`myLeave.status.${r.status}`, r.status)}
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
