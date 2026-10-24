'use client';

/**
 * Quotes.
 *
 * A quote carries two states that mean different things and are easy to conflate:
 *
 *   `status` is where it stands with the client — drafted, sent, approved, converted.
 *   `internalApprovalStatus` is whether *we* have signed off on sending it at all. A quote
 *   awaiting internal approval has not reached the client yet, whatever its status says, so
 *   that is called out rather than left to be inferred.
 *
 * Validity is the other thing worth surfacing. An expired quote is not a state the API
 * stores — it is `validUntil` against today — so it is computed here and shown on the row,
 * because a quote nobody noticed had lapsed is the usual way one is lost.
 *
 * Quotes are versioned: revising one supersedes it and the successor carries a version
 * number. A superseded quote is kept but dimmed; it is history, not work.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { QuoteEditor } from '@/components/quote-editor';
import { QuoteDetail } from '@/components/quote-detail';

type Quote = {
  id: string;
  number: string | null;
  clientName: string | null;
  quoteDate: string;
  validUntil: string | null;
  currencyCode: string;
  totalAmount: number;
  status: 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED' | 'CONVERTED' | 'SUPERSEDED';
  taxMode: 'TAX' | 'NORMAL';
  versionNumber: number | null;
  supersededById: string | null;
  internalApprovalStatus: string | null;
};

const STATUS_STYLE: Record<Quote['status'], string> = {
  DRAFT: 'ae-badge-muted',
  SENT: 'ae-badge-info',
  APPROVED: 'ae-badge-success',
  REJECTED: 'ae-badge-danger',
  CONVERTED: 'ae-badge-success',
  SUPERSEDED: 'ae-badge-muted',
};

const STATUSES = ['', 'DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'CONVERTED', 'SUPERSEDED'] as const;

/** Still in play — neither closed out nor replaced. */
const OPEN: Quote['status'][] = ['DRAFT', 'SENT', 'APPROVED'];

const DAY = 86400000;

/** useSearchParams suspends during prerender, so the static export needs the boundary. */
export default function QuotesPage() {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <Quotes />
    </Suspense>
  );
}

function Quotes() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const openId = useSearchParams().get('id');
  const { can } = useSession();
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const [items, setItems] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('');

  const money = useCallback(
    (v: number, currency = 'EGP') =>
      new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
        style: 'currency', currency, maximumFractionDigits: 0,
      }).format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api<Quote[] | { items?: Quote[] }>('/quotes');
      setItems(Array.isArray(res) ? res : res.items ?? []);
    } catch (err) {
      setFailed(err instanceof ApiError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(q: Quote, action: 'convert' | 'create-job' | 'reopen', confirmKey: string) {
    if (!window.confirm(t(confirmKey))) return;
    setBusyId(q.id);
    try {
      await api(`/quotes/${q.id}/${action}`, { method: 'POST' });
      await load();
    } catch {
      setFailed(true);
    } finally {
      setBusyId(null);
    }
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((x) => {
      if (status && x.status !== status) return false;
      if (!q) return true;
      return [x.number, x.clientName].some((f) => f?.toLowerCase().includes(q));
    });
  }, [items, query, status]);

  /** Lapsed, or lapsing within three days — the window the system's own wording uses. */
  const validity = (q: Quote): 'expired' | 'soon' | null => {
    if (!q.validUntil || !OPEN.includes(q.status)) return null;
    const left = new Date(q.validUntil).getTime() - Date.now();
    if (left < 0) return 'expired';
    if (left <= 3 * DAY) return 'soon';
    return null;
  };

  const open = shown.filter((q) => OPEN.includes(q.status));
  const openValue = open.reduce((s, q) => s + q.totalAmount, 0);
  const expiredCount = shown.filter((q) => validity(q) === 'expired').length;

  const manage = can('finance.quotes.manage');

  if (openId) {
    return <QuoteDetail id={openId} onBack={() => router.push('/quotes/')} />;
  }

  return (
    <div className="ae-page">
      <PageHero
        title={t('quotes.title')}
        actions={
          can('finance.quotes.manage') && !creating ? (
            <button type="button" className="ae-btn-primary" onClick={() => setCreating(true)}>
              {t('quotes.new')}
            </button>
          ) : undefined
        }
      />

      {creating && (
        <QuoteEditor
          onClose={() => setCreating(false)}
          onSaved={(held) => {
            setCreating(false);
            // Above the tenant's threshold the server holds a send as a pending draft.
            setFlash(held ? 'quotes.pendingInternalApproval' : 'quotes.created');
            void load();
          }}
        />
      )}

      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash)}</p>}
      {failed && <p className="ae-flash ae-flash--error mb-4">{t('quotes.loadFailed')}</p>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="ae-stat-card p-4">
          <p className="ae-stat-label">{t('quotes.total')}</p>
          <p className="ae-stat-value">{money(openValue)}</p>
        </div>
        <div className="ae-stat-card p-4">
          <p className="ae-stat-label">{t('quotes.expired')}</p>
          <p className={`ae-stat-value ${expiredCount > 0 ? 'ae-stat-value--warn' : ''}`}>
            {expiredCount}
          </p>
        </div>
      </div>

      <Panel
        actions={
          <div className="ae-toolbar">
            <select value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
              className="ae-input">
              {STATUSES.map((s) => (
                <option key={s || 'all'} value={s}>
                  {s ? t(`quotes.status.${s}`) : t('quotes.allStatuses')}
                </option>
              ))}
            </select>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t('quotes.search')} className="ae-input" />
          </div>
        }
      >
        {loading ? (
          <Skeleton rows={6} />
        ) : shown.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            {items.length === 0 ? t('quotes.noRecords') : t('common.noResults')}
          </p>
        ) : (
          <div className="ae-table-wrap">
            <table className="ae-table ae-table--rows">
              <thead>
                <tr>
                  <th>{t('quotes.number')}</th>
                  <th>{t('quotes.client')}</th>
                  <th>{t('quotes.quoteDate')}</th>
                  <th>{t('quotes.validUntil')}</th>
                  <th>{t('quotes.total')}</th>
                  <th>{t('quotes.status')}</th>
                  {manage && <th>{t('quotes.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((q) => {
                  const v = validity(q);
                  const pendingInternal =
                    q.internalApprovalStatus != null &&
                    q.internalApprovalStatus.toUpperCase() === 'PENDING';
                  return (
                    <tr key={q.id} className={q.status === 'SUPERSEDED' ? 'opacity-60' : undefined}>
                      <td>
                        <Link href={`/quotes/?id=${q.id}`} className="font-bold underline" dir="ltr">
                          {q.number ?? t('quotes.status.DRAFT')}
                        </Link>
                        {q.versionNumber != null && q.versionNumber > 1 && (
                          <span className="ae-badge ae-badge-muted mt-1 block w-fit">
                            {t('quotes.version')} {q.versionNumber}
                          </span>
                        )}
                      </td>
                      <td>{q.clientName ?? '—'}</td>
                      <td dir="ltr">{q.quoteDate}</td>
                      <td>
                        <span dir="ltr">{q.validUntil ?? '—'}</span>
                        {v && (
                          <span className={`ae-badge mt-1 block w-fit ${v === 'expired' ? 'ae-badge-danger' : 'ae-badge-warn'}`}>
                            {t(v === 'expired' ? 'quotes.expired' : 'quotes.expiringSoon')}
                          </span>
                        )}
                      </td>
                      <td>{money(q.totalAmount, q.currencyCode)}</td>
                      <td>
                        <span className={`ae-badge ${STATUS_STYLE[q.status]}`}>
                          {t(`quotes.status.${q.status}`)}
                        </span>
                        {pendingInternal && (
                          <span className="ae-badge ae-badge-warn mt-1 block w-fit">
                            {t('quotes.pendingInternalApproval')}
                          </span>
                        )}
                      </td>
                      {manage && (
                        <td className="ae-actions-cell whitespace-nowrap">
                          <span className="ae-action-icons">
                            {q.status === 'APPROVED' && (
                              <button type="button" disabled={busyId === q.id}
                                className="ae-btn-ghost px-3 py-1 text-xs"
                                onClick={() => act(q, 'convert', 'quotes.confirmConvert')}>
                                {t('quotes.convert')}
                              </button>
                            )}
                            {q.status === 'CONVERTED' && (
                              <span className="text-xs text-[var(--text-muted)]">
                                {t('quotes.alreadyConverted')}
                              </span>
                            )}
                            {q.status === 'REJECTED' && (
                              <button type="button" disabled={busyId === q.id}
                                className="ae-btn-ghost px-3 py-1 text-xs"
                                onClick={() => act(q, 'reopen', 'quotes.reopen')}>
                                {t('quotes.reopen')}
                              </button>
                            )}
                          </span>
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
