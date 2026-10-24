'use client';

/**
 * Sales invoices — the list.
 *
 * Two things this screen has to keep straight, because the system does:
 *
 * Tax mode. A TAX invoice enters the tax reports and the ETA filing; a NORMAL one does not,
 * and the API refuses to submit it at five separate points. The distinction is on the row and
 * in the filters rather than buried, since it decides what happens to the document.
 *
 * Payment state. `status` is the document's own state, while paid/remaining are money. A
 * DEFERRED invoice with nothing paid and one that is half paid read very differently, so the
 * remaining amount is shown against the total rather than on its own.
 *
 * Creating an invoice opens inline rather than on its own route: the app is a static export,
 * so a per-invoice URL would need every id known at build time. Editing, cancelling and ETA
 * submission all live on the invoice's own view at `?id=`, since each of them depends on
 * state — payments, filing status — that the list does not carry.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { InvoiceEditor } from '@/components/invoice-editor';
import { InvoiceDetail } from '@/components/invoice-detail';
import { useSession } from '@/lib/session';

type Invoice = {
  id: string;
  number: string | null;
  clientName: string | null;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: 'DRAFT' | 'DEFERRED' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  taxMode: 'TAX' | 'NORMAL';
  etaStatus: 'NONE' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'FAILED' | 'CANCELLED';
};

const STATUS_STYLE: Record<Invoice['status'], string> = {
  DRAFT: 'ae-badge-muted',
  DEFERRED: 'ae-badge-warn',
  PARTIAL: 'ae-badge-info',
  PAID: 'ae-badge-success',
  CANCELLED: 'ae-badge-danger',
};

const ETA_STYLE: Record<Invoice['etaStatus'], string> = {
  NONE: 'ae-badge-muted',
  SUBMITTED: 'ae-badge-info',
  ACCEPTED: 'ae-badge-success',
  REJECTED: 'ae-badge-danger',
  FAILED: 'ae-badge-danger',
  CANCELLED: 'ae-badge-muted',
};

const STATUSES = ['', 'DRAFT', 'DEFERRED', 'PARTIAL', 'PAID', 'CANCELLED'] as const;

/**
 * useSearchParams suspends during prerender, so the page it drives has to sit inside a
 * boundary for the static export to build.
 */
export default function InvoicesPage() {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <Invoices />
    </Suspense>
  );
}

function Invoices() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get('id');
  const { can } = useSession();
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('');
  const [taxMode, setTaxMode] = useState<'' | 'TAX' | 'NORMAL'>('');

  const money = useCallback(
    (v: number, currency = 'EGP') =>
      new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
        style: 'currency', currency, maximumFractionDigits: 0,
      }).format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api<Invoice[] | { items?: Invoice[] }>('/invoices');
      setItems(Array.isArray(res) ? res : res.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (status && i.status !== status) return false;
      if (taxMode && i.taxMode !== taxMode) return false;
      if (!q) return true;
      return [i.number, i.clientName].some((f) => f?.toLowerCase().includes(q));
    });
  }, [items, query, status, taxMode]);

  // Cancelled invoices are not owed, so they stay out of the totals.
  const live = shown.filter((i) => i.status !== 'CANCELLED');
  const outstanding = live.reduce((s, i) => s + i.remainingAmount, 0);
  const invoiced = live.reduce((s, i) => s + i.totalAmount, 0);

  if (openId) {
    return <InvoiceDetail id={openId} onBack={() => router.push('/invoices/')} />;
  }

  return (
    <div className="ae-page">
      <PageHero
        title={t('invoices.title')}
        actions={
          can('finance.invoices.manage') && !creating ? (
            <button type="button" className="ae-btn-primary" onClick={() => setCreating(true)}>
              {t('invoices.new')}
            </button>
          ) : undefined
        }
      />

      {creating && (
        <InvoiceEditor
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); void load(); }}
        />
      )}

      {error && <p className="ae-flash ae-flash--error mb-4">{t('common.error')}</p>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="ae-stat-card p-4">
          <p className="ae-stat-label">{t('invoices.total')}</p>
          <p className="ae-stat-value">{money(invoiced)}</p>
        </div>
        <div className="ae-stat-card p-4">
          <p className="ae-stat-label">{t('invoices.remaining')}</p>
          <p className={`ae-stat-value ${outstanding > 0 ? 'ae-stat-value--warn' : ''}`}>
            {money(outstanding)}
          </p>
        </div>
      </div>

      <Panel
        actions={
          <div className="ae-toolbar">
            <div className="ae-tab-pills">
              {(['', 'TAX', 'NORMAL'] as const).map((m) => (
                <button
                  key={m || 'all'} type="button" onClick={() => setTaxMode(m)}
                  className={`ae-tab-pill ${taxMode === m ? 'is-active' : ''}`}
                >
                  {m ? t(`invoices.taxMode.${m}`) : t('common.all')}
                </button>
              ))}
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
              className="ae-input"
            >
              {STATUSES.map((s) => (
                <option key={s || 'all'} value={s}>
                  {s ? t(`invoices.status.${s}`) : t('invoices.allStatuses')}
                </option>
              ))}
            </select>
            <input
              type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t('invoices.search')} className="ae-input"
            />
          </div>
        }
      >
        {loading ? (
          <Skeleton rows={6} />
        ) : shown.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            {items.length === 0 ? t('common.noRecords') : t('common.noResults')}
          </p>
        ) : (
          <div className="ae-table-wrap">
            <table className="ae-table ae-table--rows">
              <thead>
                <tr>
                  <th>{t('invoices.number')}</th>
                  <th>{t('invoices.client')}</th>
                  <th>{t('invoices.date')}</th>
                  <th>{t('invoices.total')}</th>
                  <th>{t('invoices.remaining')}</th>
                  <th>{t('invoices.status')}</th>
                  <th>{t('invoices.detail.eta')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} className={i.status === 'CANCELLED' ? 'opacity-60' : undefined}>
                    <td>
                      <Link href={`/invoices/?id=${i.id}`} className="font-bold underline" dir="ltr">
                        {i.number ?? '—'}
                      </Link>
                      <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                        {t(`invoices.taxMode.${i.taxMode}`)}
                      </span>
                    </td>
                    <td>{i.clientName ?? '—'}</td>
                    <td dir="ltr">{i.invoiceDate}</td>
                    <td>{money(i.totalAmount, i.currencyCode)}</td>
                    <td>
                      {i.remainingAmount > 0 ? (
                        <span className="ae-stat-value--warn">
                          {money(i.remainingAmount, i.currencyCode)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <span className={`ae-badge ${STATUS_STYLE[i.status]}`}>
                        {t(`invoices.status.${i.status}`)}
                      </span>
                    </td>
                    <td>
                      {/* A normal invoice never goes to ETA, so an empty state there is
                          correct rather than something waiting to be done. */}
                      {i.taxMode === 'TAX' ? (
                        <span className={`ae-badge ${ETA_STYLE[i.etaStatus]}`}>
                          {t(`invoices.eta.status.${i.etaStatus}`)}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">—</span>
                      )}
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
