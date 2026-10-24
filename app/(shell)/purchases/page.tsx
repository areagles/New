'use client';

/**
 * Supplier invoices.
 *
 * The mirror of sales, with one thing sales does not have: withholding tax. It is deducted
 * from what the supplier is actually paid but not from what they invoiced, so the total and
 * the amount owed genuinely differ — the API keeps `withholdingAmount` apart from
 * `totalAmount` for exactly that reason, and the column is shown whenever any row carries
 * one rather than always taking up space.
 *
 * Tax mode carries the same weight as on the sales side: a TAX purchase enters the tax
 * review, a NORMAL one does not.
 *
 * The number on a row is ours, not the supplier's: the API issues `PUR-YYYY-NNNN` when the
 * document leaves draft, so a draft genuinely has none yet.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { PurchaseEditor } from '@/components/purchase-editor';
import { PurchaseDetail } from '@/components/purchase-detail';

type Purchase = {
  id: string;
  number: string | null;
  supplierName: string | null;
  purchaseDate: string;
  dueDate: string | null;
  currencyCode: string;
  subTotal: number;
  taxTotal: number;
  withholdingAmount: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: 'DRAFT' | 'DEFERRED' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  taxMode: 'TAX' | 'NORMAL';
  poId: string | null;
};

const STATUS_STYLE: Record<Purchase['status'], string> = {
  DRAFT: 'ae-badge-muted',
  DEFERRED: 'ae-badge-warn',
  PARTIAL: 'ae-badge-info',
  PAID: 'ae-badge-success',
  CANCELLED: 'ae-badge-danger',
};

const STATUSES = ['', 'DRAFT', 'DEFERRED', 'PARTIAL', 'PAID', 'CANCELLED'] as const;

/** useSearchParams suspends during prerender, so the static export needs the boundary. */
export default function PurchasesPage() {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <Purchases />
    </Suspense>
  );
}

function Purchases() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const openId = useSearchParams().get('id');
  const { can } = useSession();
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
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
    setFailed(false);
    try {
      const res = await api<Purchase[] | { items?: Purchase[] }>('/purchases');
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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((p) => {
      if (status && p.status !== status) return false;
      if (taxMode && p.taxMode !== taxMode) return false;
      if (!q) return true;
      return [p.number, p.supplierName].some((f) => f?.toLowerCase().includes(q));
    });
  }, [items, query, status, taxMode]);

  // Cancelled purchases are not owed.
  const live = shown.filter((p) => p.status !== 'CANCELLED');
  const purchased = live.reduce((s, p) => s + p.totalAmount, 0);
  const owed = live.reduce((s, p) => s + p.remainingAmount, 0);

  // Only worth a column when something actually has one.
  const anyWithholding = shown.some((p) => p.withholdingAmount > 0);

  if (openId) {
    return <PurchaseDetail id={openId} onBack={() => router.push('/purchases/')} />;
  }

  return (
    <div className="ae-page">
      <PageHero
        title={t('purchases.title')}
        actions={
          can('finance.purchases.manage') && !creating ? (
            <button type="button" className="ae-btn-primary" onClick={() => setCreating(true)}>
              {t('purchases.new')}
            </button>
          ) : undefined
        }
      />

      {creating && (
        <PurchaseEditor
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); void load(); }}
        />
      )}

      {failed && <p className="ae-flash ae-flash--error mb-4">{t('purchases.loadFailed')}</p>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="ae-stat-card p-4">
          <p className="ae-stat-label">{t('purchases.total')}</p>
          <p className="ae-stat-value">{money(purchased)}</p>
        </div>
        <div className="ae-stat-card p-4">
          <p className="ae-stat-label">{t('purchases.remaining')}</p>
          <p className={`ae-stat-value ${owed > 0 ? 'ae-stat-value--warn' : ''}`}>{money(owed)}</p>
        </div>
      </div>

      <Panel
        actions={
          <div className="ae-toolbar">
            <div className="ae-tab-pills">
              {(['', 'TAX', 'NORMAL'] as const).map((m) => (
                <button key={m || 'all'} type="button" onClick={() => setTaxMode(m)}
                  className={`ae-tab-pill ${taxMode === m ? 'is-active' : ''}`}>
                  {m ? t(`purchases.taxMode.${m}`) : t('common.all')}
                </button>
              ))}
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
              className="ae-input">
              {STATUSES.map((s) => (
                <option key={s || 'all'} value={s}>
                  {s ? t(`purchases.status.${s}`) : t('purchases.allStatuses')}
                </option>
              ))}
            </select>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t('purchases.search')} className="ae-input" />
          </div>
        }
      >
        {loading ? (
          <Skeleton rows={6} />
        ) : shown.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            {items.length === 0 ? t('purchases.noRecords') : t('common.noResults')}
          </p>
        ) : (
          <div className="ae-table-wrap">
            <table className="ae-table ae-table--rows">
              <thead>
                <tr>
                  <th>{t('purchases.number')}</th>
                  <th>{t('purchases.supplier')}</th>
                  <th>{t('purchases.date')}</th>
                  <th>{t('purchases.total')}</th>
                  {anyWithholding && <th>{t('purchases.withholding')}</th>}
                  <th>{t('purchases.remaining')}</th>
                  <th>{t('purchases.status')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className={p.status === 'CANCELLED' ? 'opacity-60' : undefined}>
                    <td>
                      {/* Numbered on leaving draft, so a draft has none to link by. */}
                      {p.number ? (
                        <Link href={`/purchases/?id=${p.id}`} className="font-bold underline" dir="ltr">
                          {p.number}
                        </Link>
                      ) : (
                        <Link href={`/purchases/?id=${p.id}`} className="font-bold underline">
                          {t('purchases.noNumber')}
                        </Link>
                      )}
                      <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                        {t(`purchases.taxMode.${p.taxMode}`)}
                      </span>
                    </td>
                    <td>{p.supplierName ?? '—'}</td>
                    <td dir="ltr">{p.purchaseDate}</td>
                    <td>{money(p.totalAmount, p.currencyCode)}</td>
                    {anyWithholding && (
                      <td>
                        {p.withholdingAmount > 0 ? `−${money(p.withholdingAmount, p.currencyCode)}` : '—'}
                      </td>
                    )}
                    <td>
                      {p.remainingAmount > 0 ? (
                        <span className="ae-stat-value--warn">{money(p.remainingAmount, p.currencyCode)}</span>
                      ) : '—'}
                    </td>
                    <td>
                      <span className={`ae-badge ${STATUS_STYLE[p.status]}`}>
                        {t(`purchases.status.${p.status}`)}
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
