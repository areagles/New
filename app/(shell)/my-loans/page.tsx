'use client';

/**
 * The employee's own advances: what is still owed, a form to ask for another, and the
 * history of what they have asked for.
 *
 * Backed by the self-service endpoints, which resolve the employee from the signed-in user —
 * there is no employee id to pass, and a user with no employee record gets
 * `no_linked_employee` rather than an empty list. That is a setup gap rather than a failure,
 * so it is shown as information; anything else is shown as an error.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PageHero, Panel, Skeleton } from '@/components/page';

type LoanRequest = {
  id: string;
  requestedAmount: number;
  requestedMonthlyDeduction: number;
  approvedAmount: number | null;
  approvedMonthlyDeduction: number | null;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  decisionNotes: string | null;
  createdAt: string;
};

type ListResponse = { employee: { id: string; name: string | null }; items: LoanRequest[] };

const STATUS_STYLE: Record<LoanRequest['status'], string> = {
  PENDING: 'ae-badge-warn',
  APPROVED: 'ae-badge-success',
  REJECTED: 'ae-badge-danger',
  CANCELLED: 'ae-badge-muted',
};

export default function MyLoansPage() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<LoanRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [amount, setAmount] = useState('');
  const [monthly, setMonthly] = useState('');
  const [reason, setReason] = useState('');

  const money = useCallback(
    (v: number) =>
      new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
        style: 'currency',
        currency: 'EGP',
        maximumFractionDigits: 0,
      }).format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<ListResponse>('/hr/me/loan-requests');
      setItems(res.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unexpected_response');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/hr/me/loan-requests', {
        method: 'POST',
        body: {
          requestedAmount: Number(amount),
          requestedMonthlyDeduction: Number(monthly || 0),
          reason: reason.trim(),
        },
      });
      setAmount('');
      setMonthly('');
      setReason('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unexpected_response');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/hr/me/loan-requests/${id}/cancel`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unexpected_response');
    } finally {
      setBusy(false);
    }
  }

  const pending = items.some((i) => i.status === 'PENDING');
  const approved = items.filter((i) => i.status === 'APPROVED');
  const outstanding = approved.reduce((sum, i) => sum + (i.approvedAmount ?? 0), 0);
  const instalment = approved.reduce((sum, i) => sum + (i.approvedMonthlyDeduction ?? 0), 0);

  const notLinked = error === 'no_linked_employee';

  return (
    <div className="ae-page">
      <PageHero title={t('nav.myLoans')} />

      {error && !notLinked && <p className="ae-flash ae-flash--error mb-4">{t('common.error')}</p>}
      {notLinked && <p className="ae-flash ae-flash--info mb-4">{t('hr.employeeNotLinked')}</p>}

      {!notLinked && (
        <>
          {approved.length > 0 && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div className="ae-stat-card p-4">
                <p className="ae-stat-label">{t('hr.loans.remaining')}</p>
                <p className="ae-stat-value">{money(outstanding)}</p>
              </div>
              <div className="ae-stat-card p-4">
                <p className="ae-stat-label">{t('hr.loans.monthly')}</p>
                <p className="ae-stat-value">{money(instalment)}</p>
              </div>
            </div>
          )}

          <Panel title={t('hr.loans.request')} className="ae-form-panel mb-4">
            {pending ? (
              <p className="ae-alert-pill ae-alert-pill--info">{t('hr.loans.requestPending')}</p>
            ) : (
              <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('hr.loans.principal')}</span>
                  <input
                    type="number" min="1" step="1" required inputMode="decimal"
                    value={amount} onChange={(e) => setAmount(e.target.value)}
                    className="ae-input w-full"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('hr.loans.monthly')}</span>
                  <input
                    type="number" min="0" step="1" inputMode="decimal"
                    value={monthly} onChange={(e) => setMonthly(e.target.value)}
                    className="ae-input w-full"
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block font-bold">{t('hr.loans.reason')}</span>
                  <input
                    type="text" value={reason} onChange={(e) => setReason(e.target.value)}
                    className="ae-input w-full"
                  />
                </label>
                <div className="sm:col-span-2">
                  <button type="submit" disabled={busy} className="ae-btn-primary">
                    {busy ? t('common.saving') : t('hr.loans.request')}
                  </button>
                </div>
              </form>
            )}
          </Panel>

          <Panel title={t('hr.loans.myRequests')}>
            {loading ? (
              <Skeleton rows={3} />
            ) : items.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">{t('approvals.empty')}</p>
            ) : (
              <div className="ae-table-wrap">
                <table className="ae-table ae-table--rows">
                  <thead>
                    <tr>
                      <th>{t('hr.loans.date')}</th>
                      <th>{t('hr.loans.principal')}</th>
                      <th>{t('hr.loans.monthly')}</th>
                      <th>{t('approvals.status.PENDING')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr key={r.id}>
                        <td>{r.createdAt.slice(0, 10)}</td>
                        <td>{money(r.approvedAmount ?? r.requestedAmount)}</td>
                        <td>{money(r.approvedMonthlyDeduction ?? r.requestedMonthlyDeduction)}</td>
                        <td>
                          <span className={`ae-badge ${STATUS_STYLE[r.status]}`}>
                            {t(`hr.loans.requestStatus.${r.status}`)}
                          </span>
                          {r.decisionNotes && (
                            <span className="mt-1 block text-xs text-[var(--text-muted)]">
                              {r.decisionNotes}
                            </span>
                          )}
                        </td>
                        <td className="ae-actions-cell">
                          {r.status === 'PENDING' && (
                            <button
                              type="button" disabled={busy} onClick={() => cancel(r.id)}
                              className="ae-btn-ghost px-3 py-1 text-xs"
                            >
                              {t('common.cancel')}
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
        </>
      )}
    </div>
  );
}
