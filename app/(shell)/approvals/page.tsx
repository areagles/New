'use client';

/**
 * The approvals inbox.
 *
 * The list is generic: each row carries an `entityType` and the server decides what
 * approving one actually does. Loan requests are handled that way — approving one here
 * disburses the loan, writes the payment voucher and posts the journal, all server-side.
 *
 * Entity types that have their own dedicated endpoint (quotes, journals, leave, receipt
 * payments) are answered with `use_entity_endpoint` and a hint rather than being decided
 * here; those are surfaced as a link to the owning screen instead of an approve button.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

type Approval = {
  id: string;
  entityType: string;
  entityId: string;
  description: string | null;
  amount: number | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedByName: string | null;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  reason: string | null;
};

const STATUS_STYLE: Record<Approval['status'], string> = {
  PENDING: 'ae-badge-warn',
  APPROVED: 'ae-badge-success',
  REJECTED: 'ae-badge-danger',
};

/**
 * Types the API refuses to decide here, answering `use_entity_endpoint`: the decision has
 * consequences only the owning module knows how to carry out.
 *
 * The link goes to the record where one can be addressed and to the module's list where it
 * cannot — a quote opens on `?id=`, a journal is found in its own list, which is still an
 * answer to "where do I go" rather than a sentence saying "not here".
 */
const DELEGATED: Record<string, (entityId: string) => string> = {
  quote: (id) => `/quotes/?id=${id}`,
  receipt_payment: () => '/receipts',
  leave: () => '/hr',
  journal: () => '/journals',
};

export default function ApprovalsPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const [items, setItems] = useState<Approval[]>([]);
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('PENDING');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = status ? `?status=${status}` : '';
      const res = await api<{ items: Approval[] }>(`/approvals${qs}`);
      setItems(res.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unexpected_response');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(item: Approval, action: 'approve' | 'reject') {
    // The endpoint stores a reason and the row shows it back; a refusal with none is a
    // decision the requester cannot act on.
    const reason = action === 'reject' ? (window.prompt(t('quotes.rejectReasonPrompt')) ?? '') : '';
    setBusyId(item.id);
    setError(null);
    try {
      await api(`/approvals/${item.id}/${action}`, { method: 'POST', body: { reason } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unexpected_response');
    } finally {
      setBusyId(null);
    }
  }

  const money = (v: number) =>
    new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency: 'EGP', maximumFractionDigits: 0,
    }).format(v);

  const canDecide = can('approvals.manage', 'hr.manage', 'hr.payroll.manage');

  return (
    <div className="ae-page">
      <PageHero
        title={t('approvals.title')}
        actions={
          <div className="ae-tab-pills">
            {(['PENDING', 'APPROVED', 'REJECTED', ''] as const).map((s) => (
              <button
                key={s || 'all'} type="button" onClick={() => setStatus(s)}
                className={`ae-tab-pill ${status === s ? 'is-active' : ''}`}
              >
                {s ? t(`approvals.status.${s}`) : t('approvals.all')}
              </button>
            ))}
          </div>
        }
      />

      {error && <p className="ae-flash ae-flash--error mb-4">{t('common.error')}</p>}

      <Panel>
        {loading ? (
          <Skeleton rows={4} />
        ) : items.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t('approvals.empty')}</p>
        ) : (
          <div className="ae-table-wrap">
            <table className="ae-table ae-table--rows">
              <thead>
                <tr>
                  <th>{t('approvals.entityType')}</th>
                  <th>{t('approvals.description')}</th>
                  <th>{t('treasury.amount')}</th>
                  <th>{t('approvals.requestedBy')}</th>
                  <th>{t('invoices.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const delegated = DELEGATED[item.entityType];
                  return (
                    <tr key={item.id}>
                      <td>
                        <span className="ae-badge ae-badge-info">
                          {t(`approvals.entityType.${item.entityType}`)}
                        </span>
                      </td>
                      <td className="max-w-md">{item.description ?? '—'}</td>
                      <td>{item.amount !== null ? money(item.amount) : '—'}</td>
                      <td>
                        {item.requestedByName ?? '—'}
                        <span className="block text-xs text-[var(--text-muted)]">
                          {item.requestedAt.slice(0, 10)}
                        </span>
                      </td>
                      <td>
                        <span className={`ae-badge ${STATUS_STYLE[item.status]}`}>
                          {t(`approvals.status.${item.status}`)}
                        </span>
                        {item.reason && (
                          <span className="block text-xs text-[var(--text-muted)]">{item.reason}</span>
                        )}
                      </td>
                      <td className="ae-actions-cell whitespace-nowrap">
                        {item.status !== 'PENDING' ? (
                          <span className="text-xs text-[var(--text-muted)]">
                            {item.decidedByName ?? ''}
                          </span>
                        ) : delegated ? (
                          // Deciding these here is refused by the API by design — so this
                          // says where instead, and takes you there.
                          <Link href={delegated(item.entityId)} className="ae-dash-section-link">
                            {t('approvals.openEntity')} · {t('approvals.decidedElsewhere')}
                          </Link>
                        ) : canDecide ? (
                          <span className="flex gap-2">
                            <button
                              type="button" disabled={busyId === item.id}
                              onClick={() => decide(item, 'approve')}
                              className="ae-btn-primary px-3 py-1 text-xs"
                            >
                              {t('approvals.approve')}
                            </button>
                            <button
                              type="button" disabled={busyId === item.id}
                              onClick={() => decide(item, 'reject')}
                              className="ae-btn-ghost px-3 py-1 text-xs"
                            >
                              {t('approvals.reject')}
                            </button>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
