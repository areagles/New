'use client';

/**
 * Cheques.
 *
 * A cheque is not money. It is a promise dated in the future that can still fail, and the
 * system models it that way: a receipt paid by cheque is stamped UNDER_COLLECTION and only
 * becomes real when someone here says it cleared.
 *
 * That is why this is a page and not a filter on the receipts list. Receipts are ordered by
 * when they were written; a cheque matters by when it falls due, and the question this screen
 * answers — what is landing this week, and what was due and has not been settled — cannot be
 * asked of a list sorted the other way.
 *
 * ── Bouncing is a reversal, not a flag ────────────────────────────────────────────────────
 *
 * `ae_set_receipt_cheque_status` does far more than set a column. A bounce voids the journal
 * entries, deletes the allocations, recomputes every invoice the cheque had been paying — so
 * they go back to owing — and reverses the treasury movement. The invoice that looked settled
 * is unpaid again, which is the truth. The confirmation says so before the click, because
 * "ارتداد" beside a row does not look like it undoes four things.
 *
 * A settled cheque cannot be settled again: the API refuses anything not UNDER_COLLECTION with
 * `cheque_already_settled`, so the actions are only on the ones still in flight.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

type ChequeStatus = 'UNDER_COLLECTION' | 'CLEARED' | 'BOUNCED';

type Receipt = {
  id: string;
  number: string | null;
  type: 'IN' | 'OUT';
  receiptDate: string;
  clientName: string | null;
  supplierName: string | null;
  amount: number;
  currencyCode: string;
  paymentMethod: string;
  chequeNumber: string | null;
  chequeBankName: string | null;
  chequeDueDate: string | null;
  chequeStatus: ChequeStatus | null;
  chequeBounceReason: string | null;
  chequeClearedAt: string | null;
  chequeBouncedAt: string | null;
};

const STATUS_STYLE: Record<ChequeStatus, string> = {
  UNDER_COLLECTION: 'ae-badge-warn',
  CLEARED: 'ae-badge-success',
  BOUNCED: 'ae-badge-danger',
};

const ERROR_KEY: Record<string, string> = {
  not_a_cheque: 'common.error',
  cheque_already_settled: 'receipts.cheque.status',
  invalid_status: 'common.error',
};

const DAY = 86400000;
const SOON = 7 * DAY;

export default function ChequesPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const [items, setItems] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [status, setStatus] = useState<'' | ChequeStatus>('UNDER_COLLECTION');

  const money = useCallback(
    (v: number, cur = 'EGP') => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency: cur, maximumFractionDigits: 0,
    }).format(v),
    [lang],
  );
  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG').format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<Receipt[] | { items?: Receipt[] }>('/receipts');
      const all = Array.isArray(res) ? res : res.items ?? [];
      // The API has no cheque list of its own; a cheque is a receipt wearing one.
      setItems(all.filter((r) => r.paymentMethod === 'CHEQUE'));
    } catch (err) {
      setError(err instanceof ApiError ? 'receipts.loadFailed' : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function settle(r: Receipt, next: 'CLEARED' | 'BOUNCED') {
    let reason: string | null = null;
    if (next === 'BOUNCED') {
      if (!window.confirm(t('receipts.cheque.confirmBounce'))) return;
      reason = window.prompt(t('receipts.cheque.bounceReasonPrompt')) ?? '';
    }
    setBusyId(r.id);
    setError(null);
    setFlash(null);
    try {
      await api(`/receipts/${r.id}/cheque-status`, {
        method: 'POST',
        body: { status: next, ...(reason ? { reason } : {}) },
      });
      setFlash(next === 'CLEARED' ? 'receipts.cheque.markedCleared' : 'receipts.cheque.markedBounced');
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(ERROR_KEY[code] ?? 'common.error');
    } finally {
      setBusyId(null);
    }
  }

  /** Where a cheque stands against today — only meaningful while it is still in flight. */
  const timing = (r: Receipt) => {
    if (r.chequeStatus !== 'UNDER_COLLECTION' || !r.chequeDueDate) return null;
    const left = new Date(r.chequeDueDate).getTime() - Date.now();
    if (left < 0) {
      return { tone: 'ae-badge-danger', text: t('cheques.overdue'), days: Math.ceil(-left / DAY) };
    }
    if (left <= SOON) {
      return { tone: 'ae-badge-warn', text: t('cheques.dueSoon'), days: Math.ceil(left / DAY) };
    }
    return null;
  };

  const inFlight = items.filter((r) => r.chequeStatus === 'UNDER_COLLECTION');
  const overdue = inFlight.filter((r) => timing(r)?.text === t('cheques.overdue'));
  const dueSoon = inFlight.filter((r) => timing(r)?.text === t('cheques.dueSoon'));
  const bounced = items.filter((r) => r.chequeStatus === 'BOUNCED');

  const shown = useMemo(() => {
    const list = status ? items.filter((r) => r.chequeStatus === status) : items;
    // Due date first — that is the whole reason this is not the receipts list.
    return [...list].sort((a, b) => (a.chequeDueDate ?? '9999').localeCompare(b.chequeDueDate ?? '9999'));
  }, [items, status]);

  const party = (r: Receipt) => r.clientName ?? r.supplierName ?? '—';
  const manage = can('finance.receipts.manage');

  return (
    <div className="ae-page">
      <PageHero title={t('cheques.title')} subtitle={t('cheques.subtitle')} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error)}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash)}</p>}

      <div className="ae-dash-metrics-grid mb-4">
        <div className="ae-stat-card">
          <p className="ae-stat-label">{t('cheques.summary.underCollection')}</p>
          <p className="ae-stat-value">{money(inFlight.reduce((s, r) => s + r.amount, 0))}</p>
          <p className="ae-stat-hint">{num(inFlight.length)}</p>
        </div>
        <div className="ae-stat-card">
          <p className="ae-stat-label">{t('cheques.summary.dueSoon')}</p>
          <p className={`ae-stat-value ${dueSoon.length ? 'ae-stat-value--warn' : ''}`}>
            {money(dueSoon.reduce((s, r) => s + r.amount, 0))}
          </p>
          <p className="ae-stat-hint">{num(dueSoon.length)}</p>
        </div>
        <div className="ae-stat-card">
          <p className="ae-stat-label">{t('cheques.summary.overdue')}</p>
          <p className={`ae-stat-value ${overdue.length ? 'ae-stat-value--danger' : ''}`}>
            {money(overdue.reduce((s, r) => s + r.amount, 0))}
          </p>
          <p className="ae-stat-hint">{num(overdue.length)}</p>
        </div>
        <div className="ae-stat-card">
          <p className="ae-stat-label">{t('cheques.summary.bounced')}</p>
          <p className={`ae-stat-value ${bounced.length ? 'ae-stat-value--danger' : ''}`}>
            {money(bounced.reduce((s, r) => s + r.amount, 0))}
          </p>
          <p className="ae-stat-hint">{num(bounced.length)}</p>
        </div>
      </div>

      <Panel
        actions={
          <div className="ae-toolbar">
            <div className="ae-tab-pills">
              {(['UNDER_COLLECTION', 'CLEARED', 'BOUNCED', ''] as const).map((s) => (
                <button key={s || 'all'} type="button" onClick={() => setStatus(s)}
                  className={`ae-tab-pill ${status === s ? 'is-active' : ''}`}>
                  {s ? t(`receipts.cheque.status.${s}`) : t('common.all')}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {loading ? (
          <Skeleton rows={6} />
        ) : shown.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t('receipts.noRecords')}</p>
        ) : (
          <div className="ae-table-wrap">
            <table className="ae-table ae-table--rows">
              <thead>
                <tr>
                  <th>{t('receipts.cheque.number')}</th>
                  <th>{t('receipts.party')}</th>
                  <th>{t('receipts.cheque.dueDate')}</th>
                  <th>{t('treasury.amount')}</th>
                  <th>{t('receipts.cheque.status')}</th>
                  {manage && <th>{t('users.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const when = timing(r);
                  return (
                    <tr key={r.id} className={r.chequeStatus === 'BOUNCED' ? 'opacity-60' : undefined}>
                      <td>
                        <span className="font-bold" dir="ltr">{r.chequeNumber ?? '—'}</span>
                        {r.chequeBankName && (
                          <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{r.chequeBankName}</span>
                        )}
                        {/* Which receipt it came in on, for anyone who needs the document. */}
                        <Link href="/receipts/" className="mt-0.5 block text-xs underline" dir="ltr">
                          {r.number ?? '—'}
                        </Link>
                      </td>
                      <td>
                        {party(r)}
                        <span className={`ae-badge ${r.type === 'IN' ? 'ae-badge-success' : 'ae-badge-info'} mt-1 block w-fit`}>
                          {t(`receipts.type.${r.type}`)}
                        </span>
                      </td>
                      <td>
                        <span dir="ltr">{r.chequeDueDate ?? '—'}</span>
                        {when && (
                          <span className={`ae-badge ${when.tone} mt-1 block w-fit`}>
                            {when.text} · {num(when.days)}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">{money(r.amount, r.currencyCode)}</td>
                      <td>
                        <span className={`ae-badge ${STATUS_STYLE[r.chequeStatus ?? 'UNDER_COLLECTION']}`}>
                          {t(`receipts.cheque.status.${r.chequeStatus ?? 'UNDER_COLLECTION'}`)}
                        </span>
                        {/* A bounce without its reason is a fact nobody can act on. */}
                        {r.chequeBounceReason && (
                          <span className="mt-1 block text-xs text-[var(--text-muted)]">{r.chequeBounceReason}</span>
                        )}
                      </td>
                      {manage && (
                        <td className="ae-actions-cell whitespace-nowrap">
                          {/* Settled once and only once — the API refuses the second attempt. */}
                          {r.chequeStatus === 'UNDER_COLLECTION' ? (
                            <span className="ae-action-icons">
                              <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                                disabled={busyId === r.id} onClick={() => void settle(r, 'CLEARED')}>
                                {t('receipts.cheque.markCleared')}
                              </button>
                              <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                                disabled={busyId === r.id} onClick={() => void settle(r, 'BOUNCED')}>
                                {t('receipts.cheque.markBounced')}
                              </button>
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--text-muted)]" dir="ltr">
                              {(r.chequeClearedAt ?? r.chequeBouncedAt ?? '').slice(0, 10)}
                            </span>
                          )}
                        </td>
                      )}
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
