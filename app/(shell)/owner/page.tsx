'use client';

/**
 * لوحة مؤشرات المالك — the executive view.
 *
 * The main dashboard answers "what is happening today". This answers "how is the business
 * doing", which is a different question and wants different numbers: the year against last
 * year, the month against last month, and the handful of counts that decide whether to worry.
 *
 * ── Why the year chart is drawn here rather than fetched ──────────────────────────────────
 *
 * `/owner/kpis` returns twelve months of sales and collections. Rendering that as inline SVG
 * bars keeps the page self-contained — no chart library, no second request — and the bars are
 * scaled against the largest month so a flat year reads as flat rather than as noise amplified
 * to fill the box.
 *
 * ── System health belongs on the owner's screen ───────────────────────────────────────────
 *
 * Backups and exchange rates are not finance, but they are the two silent failures that only
 * surface when it is too late: a backup that stopped running months ago, or FX rates frozen at
 * a stale value while foreign-currency balances quietly drift. The API reports both; this is
 * the one screen whose reader can actually order something done about them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { builtHref } from '@/lib/built';

type Money = { thisMonth: number; prevMonth: number; changePct: number | null };
type YoySide = { ytd: number; prevYtd: number; changePct: number | null };
type MonthRow = { month: number; label: string; sales: number; collections: number };

type Owner = {
  asOf: string;
  baseCurrency: string;
  kpis: {
    clientsActive: number; jobsActive: number;
    salesThisMonth: number; collectionsThisMonth: number; treasuryTotal: number;
    overdueCount: number; overdueAmount: number;
    dueTodayCount: number; dueTodayAmount: number;
    lateJobs: number; approvals: number; paymentNotices: number; chequesDueSoon: number;
  };
  mom: { sales: Money; collections: Money };
  yoy: { thisYear: number; prevYear: number; sales: YoySide; collections: YoySide; monthly: MonthRow[] };
  health: { backupDue: boolean; lastBackupOk: boolean; lastBackupAt: string | null; fxDue: boolean; lastFxOk: boolean };
  pulse: { items: { id: string; tone: string; count: number; amount: number; href: string | null }[] };
};

export default function OwnerPage() {
  const { t, lang } = useI18n();

  const [data, setData] = useState<Owner | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<Owner>('/owner/kpis'));
    } catch {
      setError('owner.loadFailed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const money = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency: data?.baseCurrency ?? 'EGP', maximumFractionDigits: 0,
    }).format(v),
    [lang, data?.baseCurrency],
  );
  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG').format(v),
    [lang],
  );
  /** Years and month numbers are labels, not quantities: ٢٠٢٦ never ٢٬٠٢٦. */
  const plain = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', { useGrouping: false }).format(v),
    [lang],
  );

  /**
   * A percentage against a zero base is not a hundred per cent increase, it is a first sale.
   * The dashboard learned this the hard way; the same rule applies here.
   */
  const pct = useCallback((v: number | null, base: number) => {
    if (v === null || base === 0) return null;
    const sign = v > 0 ? '▲' : v < 0 ? '▼' : '—';
    return `${sign} ${new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', { maximumFractionDigits: 1 }).format(Math.abs(v))}%`;
  }, [lang]);

  const chartMax = useMemo(() => {
    const rows = data?.yoy.monthly ?? [];
    return Math.max(1, ...rows.map((r) => Math.max(r.sales, r.collections)));
  }, [data]);

  if (loading) {
    return (
      <div className="ae-page">
        <PageHero title={t('owner.title')} subtitle={t('owner.subtitle')} />
        <Panel><Skeleton rows={8} /></Panel>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="ae-page">
        <PageHero title={t('owner.title')} subtitle={t('owner.subtitle')} />
        <p className="ae-flash ae-flash--error">{t(error ?? 'common.error')}</p>
      </div>
    );
  }

  const k = data.kpis;

  const counter = (labelKey: string, value: string, hint?: string | null, tone?: 'warn' | 'danger' | 'success') => (
    <div className={`ae-counter${tone ? ` ae-counter--${tone}` : ''}`} key={labelKey}>
      <span className="ae-counter-label">{t(labelKey)}</span>
      <span className="ae-counter-value">{value}</span>
      {hint && <span className="ae-counter-hint">{hint}</span>}
    </div>
  );

  return (
    <div className="ae-page">
      <PageHero title={t('owner.title')} subtitle={t('owner.subtitle')} />

      <p className="mb-4 text-xs text-[var(--text-muted)]">
        {t('morning.asOf')} {new Date(data.asOf).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')}
      </p>

      <Panel title={t('owner.financial')}>
        <div className="ae-counter-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {counter('owner.kpi.sales', money(k.salesThisMonth), pct(data.mom.sales.changePct, data.mom.sales.prevMonth))}
          {counter('owner.kpi.collections', money(k.collectionsThisMonth), pct(data.mom.collections.changePct, data.mom.collections.prevMonth))}
          {counter('owner.kpi.treasury', money(k.treasuryTotal))}
          {counter('owner.kpi.overdue', money(k.overdueAmount),
            `${num(k.overdueCount)} ${t('owner.kpi.invoices')}`, k.overdueCount > 0 ? 'danger' : undefined)}
          {counter('owner.kpi.dueToday', money(k.dueTodayAmount),
            `${num(k.dueTodayCount)} ${t('owner.kpi.invoices')}`, k.dueTodayCount > 0 ? 'warn' : undefined)}
        </div>
      </Panel>

      <Panel title={t('owner.operations')} className="mt-4">
        <div className="ae-counter-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {counter('owner.kpi.clients', num(k.clientsActive))}
          {counter('owner.kpi.jobs', num(k.jobsActive))}
          {counter('owner.kpi.lateJobs', num(k.lateJobs), null, k.lateJobs > 0 ? 'danger' : undefined)}
          {counter('owner.kpi.approvals', num(k.approvals), null, k.approvals > 0 ? 'warn' : undefined)}
          {counter('owner.kpi.paymentNotices', num(k.paymentNotices), null, k.paymentNotices > 0 ? 'warn' : undefined)}
          {counter('owner.kpi.cheques', num(k.chequesDueSoon), null, k.chequesDueSoon > 0 ? 'warn' : undefined)}
        </div>
      </Panel>

      <Panel title={`${t('owner.yoy.title')} — ${plain(data.yoy.thisYear)} / ${plain(data.yoy.prevYear)}`} className="mt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {counter('owner.yoy.sales', money(data.yoy.sales.ytd), pct(data.yoy.sales.changePct, data.yoy.sales.prevYtd))}
          {counter('owner.yoy.collections', money(data.yoy.collections.ytd), pct(data.yoy.collections.changePct, data.yoy.collections.prevYtd))}
        </div>

        <h3 className="mb-2 mt-4 text-sm font-bold">{t('owner.yoy.chart')}</h3>
        {/* Bars scaled to the largest month, so a quiet year looks quiet. Each month is a pair:
            what was invoiced and what was actually collected — the gap between them is the
            story the two YTD totals above only summarise. */}
        <div className="ae-table-wrap">
          <div className="flex min-w-[32rem] items-end gap-2" style={{ height: '10rem' }}>
            {data.yoy.monthly.map((m) => (
              <div key={m.label} className="flex flex-1 flex-col items-center justify-end gap-1">
                <span className="flex h-full w-full items-end justify-center gap-0.5">
                  <span title={`${t('owner.yoy.sales')}: ${money(m.sales)}`}
                    style={{ height: `${(m.sales / chartMax) * 100}%` }}
                    className="w-2 rounded-t bg-[var(--accent)]" />
                  <span title={`${t('owner.yoy.collections')}: ${money(m.collections)}`}
                    style={{ height: `${(m.collections / chartMax) * 100}%` }}
                    className="w-2 rounded-t bg-[var(--text-muted)]" />
                </span>
                <span className="text-[0.65rem] text-[var(--text-muted)]">{plain(m.month)}</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      {data.pulse.items.length > 0 && (
        <Panel title={t('owner.attention')} className="mt-4">
          <div className="ae-pulse-grid">
            {data.pulse.items.map((p) => {
              const to = builtHref(p.href);
              const tone = p.tone && p.tone !== 'default' ? ` ae-pulse-card--${p.tone}` : '';
              const body = (
                <>
                  <span className="ae-pulse-label">{t(`dashboard.pulse.${p.id}`, p.id)}</span>
                  <span className="ae-pulse-value">{num(p.count)}</span>
                  {p.amount > 0 && <span className="ae-pulse-detail">{money(p.amount)}</span>}
                </>
              );
              return to
                ? <Link key={p.id} href={to} className={`ae-pulse-card${tone}`}>{body}</Link>
                : <div key={p.id} className={`ae-pulse-card${tone}`}>{body}</div>;
            })}
          </div>
        </Panel>
      )}

      <Panel title={t('owner.health')} className="mt-4">
        <ul className="ae-dash-attention">
          <li>
            <span className={`ae-dash-attention-row${data.health.backupDue ? ' ae-dash-attention-row--warn' : ''}`}>
              <span aria-hidden>{data.health.backupDue ? '🟠' : '🟢'}</span>
              <span className="ae-dash-attention-label">{t(data.health.backupDue ? 'owner.health.backupDue' : 'owner.health.backupOk')}</span>
              <span className="ae-dash-attention-detail">
                {data.health.lastBackupAt
                  ? new Date(data.health.lastBackupAt).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')
                  : '—'}
              </span>
            </span>
          </li>
          <li>
            <span className={`ae-dash-attention-row${data.health.fxDue ? ' ae-dash-attention-row--warn' : ''}`}>
              <span aria-hidden>{data.health.fxDue ? '🟠' : '🟢'}</span>
              <span className="ae-dash-attention-label">{t(data.health.fxDue ? 'owner.health.fxDue' : 'owner.health.fxOk')}</span>
            </span>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
