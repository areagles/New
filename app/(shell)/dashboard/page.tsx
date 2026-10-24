'use client';

/**
 * The dashboard.
 *
 * One call to `/dashboard` returns the whole system's state — fourteen sections covering
 * finance, jobs, accounting, HR, inventory, assets, CRM and treasury. Rendering all of it is
 * the easy mistake: on any given day most of those numbers are zero, and a screen of zeros
 * hides the two or three that are not.
 *
 * So nothing here renders unconditionally. Every zone asks whether it has something to say
 * and stays out of the way when it does not:
 *
 *   the pulse strip keeps only the counters that are actually carrying a signal, and collapses
 *   to a single line when none are; the attention zone appears only when something is overdue;
 *   a section card is dropped when every one of its metrics is zero; treasury lists the
 *   currencies holding money, plus the base currency whether or not it holds any.
 *
 * The consequence is that a fresh system shows the setup checklist and little else, and the
 * board fills in as the business does — which is the point of a dashboard rather than a report.
 *
 * The API hands out hrefs for the whole system, most of them still pointing at screens this
 * rebuild has not migrated. Every destination goes through `builtHref`, so a card links when
 * there is somewhere to go and reads as plain text when there is not.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { builtHref } from '@/lib/built';

type Tone = 'default' | 'success' | 'warn' | 'danger' | 'info';

type PulseItem = {
  id: string;
  tone?: Tone;
  count?: number;
  amount?: number;
  href?: string;
  meta?: Record<string, number>;
};

type OpenDoc = {
  id: string;
  number: string | null;
  clientName?: string | null;
  supplierName?: string | null;
  currencyCode: string;
  remainingAmount: number;
  dueDate?: string | null;
  daysOverdue?: number;
};

type Dashboard = {
  baseCurrency: string;
  user?: { name?: string | null };
  onboarding?: {
    items: { key: string; done: boolean; href: string }[];
    doneCount: number;
    totalCount: number;
    dismissed: boolean;
  };
  notifications?: {
    items: { id: string; type: string; href?: string; severity?: string; message?: string | null; count?: number }[];
  };
  pulse?: { items: PulseItem[] };
  finance?: {
    kpis?: {
      invoicedBase: number; collectedBase: number; remainingBase: number; collectionRate: number;
      openInvoiceCount: number; overdueCount: number; overdueBase: number;
      unallocatedReceiptCount: number; unallocatedBase: number;
    };
    apKpis?: {
      purchasedBase: number; paidBase: number; remainingBase: number; paymentRate: number;
      openPurchaseCount: number; overdueCount: number; overdueBase: number;
    };
    openInvoices?: OpenDoc[];
    openPurchases?: OpenDoc[];
    treasury?: { currencyCode: string; balance: number; label: string; symbol: string }[];
  };
  accounting?: {
    postedEntryCount: number;
    trialBalanced: boolean;
    incomeStatement?: { revenue: number; expenses: number; netIncome: number };
  };
  jobs?: { jobKpis?: { activeCount: number; overdueCount: number; pendingProofs: number; awaitingInvoice: number } };
  hr?: { activeEmployees: number; departments: number; pendingLeave: number; currentMonthPayrollGross: number };
  inventory?: { itemCount: number; lowStockCount: number; totalStockValue: number };
  assets?: { activeCount: number; totalBookValue: number };
  clients?: { activeCount: number };
  crm?: { openDeals: number; openLeads: number; overdueActivities: number; pipelineValue: number };
  mom?: {
    sales: { thisMonth: number; prevMonth: number; changePct: number | null };
    collections: { thisMonth: number; prevMonth: number; changePct: number | null };
  };
};

/** A counter is only worth a card when it is counting something. */
const live = (p: PulseItem) => (p.count ?? 0) > 0 || (p.amount ?? 0) > 0;

const PULSE_ICON: Record<string, string> = {
  due_today: '📅',
  overdue_ar: '⏰',
  collect_week: '📈',
  cash: '🏦',
  jobs_active: '🖨️',
  quotes_expiring: '📄',
};

/** Actions worth one tap from here, kept to the documents this rebuild can actually create. */
const QUICK = [
  { href: '/invoices', key: 'dashboard.quick.newInvoice', icon: '🧾', tint: 'finance' },
  { href: '/receipts', key: 'dashboard.quick.newReceipt', icon: '💵', tint: 'cash' },
  { href: '/quotes', key: 'dashboard.quick.newQuote', icon: '📝', tint: 'sales' },
];

export default function DashboardPage() {
  const { t, lang } = useI18n();
  const { user } = useSession();

  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  // Rendered only after mount: the server has no clock to agree with.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const money = useCallback(
    (v: number, currency = 'EGP') =>
      new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
        style: 'currency', currency, maximumFractionDigits: 0,
      }).format(v),
    [lang],
  );

  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG').format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setData(await api<Dashboard>('/dashboard'));
    } catch (err) {
      setFailed(err instanceof ApiError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function dismissOnboarding() {
    setDismissing(true);
    try {
      await api('/dashboard/onboarding/dismiss', { method: 'POST' });
      await load();
    } catch {
      setFailed(true);
    } finally {
      setDismissing(false);
    }
  }

  const greeting = useMemo(() => {
    const h = now?.getHours();
    if (h == null) return 'dashboard.greeting';
    if (h < 12) return 'dashboard.greet.morning';
    if (h < 17) return 'dashboard.greet.afternoon';
    if (h < 22) return 'dashboard.greet.evening';
    return 'dashboard.greet.night';
  }, [now]);

  const base = data?.baseCurrency ?? 'EGP';
  const ar = data?.finance?.kpis;
  const ap = data?.finance?.apKpis;

  const pulse = (data?.pulse?.items ?? []).filter(live);

  /** Everything overdue, from either side of the ledger, newest pain first. */
  const overdue = useMemo(() => {
    const inv = (data?.finance?.openInvoices ?? []).filter((d) => (d.daysOverdue ?? 0) > 0);
    const pur = (data?.finance?.openPurchases ?? []).filter((d) => (d.daysOverdue ?? 0) > 0);
    return [
      ...inv.map((d) => ({ ...d, side: 'ar' as const })),
      ...pur.map((d) => ({ ...d, side: 'ap' as const })),
    ].sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0)).slice(0, 6);
  }, [data]);

  /**
   * System alerts, minus the ones the rows below already say better.
   *
   * `invoice_overdue` is a headline for exactly the invoices listed underneath with their
   * numbers, parties and amounts, so keeping both says the same thing twice — once vaguely.
   */
  const alerts = useMemo(() => {
    const covered = new Set<string>();
    if (overdue.some((d) => d.side === 'ar')) covered.add('invoice_overdue');
    if (overdue.some((d) => d.side === 'ap')) covered.add('purchase_overdue');
    return (data?.notifications?.items ?? []).filter(
      (n) => (n.severity === 'warn' || n.severity === 'error') && !covered.has(n.type),
    );
  }, [data, overdue]);

  const treasury = useMemo(
    () => (data?.finance?.treasury ?? [])
      .filter((r) => r.balance !== 0 || r.currencyCode === base)
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)),
    [data, base],
  );

  /** Module cards, each dropped when it has nothing but zeros to report. */
  const sections = useMemo(() => {
    const d = data;
    if (!d) return [];
    const all = [
      {
        id: 'jobs', icon: '🖨️', title: 'dashboard.jobs.title', href: '/jobs',
        metrics: [
          { label: 'dashboard.jobs.title', value: d.jobs?.jobKpis?.activeCount ?? 0 },
          { label: 'dashboard.jobs.awaitingInvoice', value: d.jobs?.jobKpis?.awaitingInvoice ?? 0 },
          { label: 'dashboard.jobs.pendingProofs', value: d.jobs?.jobKpis?.pendingProofs ?? 0 },
          { label: 'dashboard.pulse.overdueJobs', value: d.jobs?.jobKpis?.overdueCount ?? 0, tone: 'warn' },
        ],
      },
      {
        id: 'accounting', icon: '📚', title: 'dashboard.accounting.title', href: '/journals',
        metrics: [
          { label: 'dashboard.accounting.postedEntries', value: d.accounting?.postedEntryCount ?? 0 },
          { label: 'dashboard.accounting.mtdRevenue', value: d.accounting?.incomeStatement?.revenue ?? 0, money: true },
          { label: 'dashboard.accounting.mtdExpenses', value: d.accounting?.incomeStatement?.expenses ?? 0, money: true },
          { label: 'dashboard.accounting.mtdNet', value: d.accounting?.incomeStatement?.netIncome ?? 0, money: true },
        ],
      },
      {
        id: 'hr', icon: '👥', title: 'dashboard.hr.title', href: '/hr',
        metrics: [
          { label: 'dashboard.hr.employees', value: d.hr?.activeEmployees ?? 0 },
          { label: 'dashboard.hr.departments', value: d.hr?.departments ?? 0 },
          { label: 'dashboard.hr.pendingLeave', value: d.hr?.pendingLeave ?? 0, tone: 'warn' },
          { label: 'dashboard.hr.payrollGross', value: d.hr?.currentMonthPayrollGross ?? 0, money: true },
        ],
      },
      {
        id: 'inventory', icon: '📦', title: 'dashboard.inventory.title', href: '/inventory',
        metrics: [
          { label: 'dashboard.inventory.items', value: d.inventory?.itemCount ?? 0 },
          { label: 'dashboard.inventory.lowStock', value: d.inventory?.lowStockCount ?? 0, tone: 'warn' },
          { label: 'dashboard.inventory.stockValue', value: d.inventory?.totalStockValue ?? 0, money: true },
        ],
      },
      {
        id: 'crm', icon: '🎯', title: 'dashboard.sales.title', href: '/sales',
        metrics: [
          { label: 'dashboard.crm.openDeals', value: d.crm?.openDeals ?? 0 },
          { label: 'dashboard.sales.leads', value: d.crm?.openLeads ?? 0 },
          { label: 'dashboard.crm.overdueActivities', value: d.crm?.overdueActivities ?? 0, tone: 'warn' },
          { label: 'dashboard.crm.pipelineValue', value: d.crm?.pipelineValue ?? 0, money: true },
        ],
      },
      {
        id: 'assets', icon: '🏗️', title: 'dashboard.assets.title', href: '/assets',
        metrics: [
          { label: 'dashboard.assets.active', value: d.assets?.activeCount ?? 0 },
          { label: 'dashboard.assets.bookValue', value: d.assets?.totalBookValue ?? 0, money: true },
        ],
      },
      {
        id: 'clients', icon: '🤝', title: 'dashboard.clients.title', href: '/clients',
        metrics: [{ label: 'dashboard.clients.active', value: d.clients?.activeCount ?? 0 }],
      },
    ];
    return all.filter((s) => s.metrics.some((m) => m.value > 0));
  }, [data]);

  if (loading) {
    return (
      <div className="ae-page">
        <div className="ae-dash-skeleton-hero ae-skeleton mb-4 h-32 w-full" aria-hidden />
        <div className="ae-pulse-grid" aria-hidden>
          {[0, 1, 2, 3].map((i) => <div key={i} className="ae-skeleton h-24 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  const onboarding = data?.onboarding;
  const showOnboarding =
    onboarding && !onboarding.dismissed && onboarding.doneCount < onboarding.totalCount;

  const name = data?.user?.name ?? user?.name ?? '';

  return (
    <div className="ae-page ae-dashboard">
      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <header className="ae-dash-hero--vivid mb-5">
        <div className="ae-dash-hero-orbs" aria-hidden>
          <span className="ae-dash-orb ae-dash-orb--a" />
          <span className="ae-dash-orb ae-dash-orb--b" />
          <span className="ae-dash-orb ae-dash-orb--c" />
        </div>

        <div className="ae-dash-hero-main">
          <div className="ae-dash-hero-copy">
            <p className="ae-dash-eyebrow">
              <span className="ae-live-dot" aria-hidden />
              {t('dashboard.liveSync')}
            </p>
            <h1 className="ae-dash-hero-title">
              <span className="ae-dash-greet-wave" aria-hidden>👋</span>
              {t(greeting)}
              {name && <span className="ae-dash-hero-name">{name}</span>}
            </h1>
          </div>

          {now && (
            <div className="ae-dash-hero-side">
              <div className="ae-dash-clock">
                <span className="ae-dash-clock-time" dir="ltr">
                  {now.toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-GB', {
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
                <span className="ae-dash-clock-date">
                  {now.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', {
                    weekday: 'long', day: 'numeric', month: 'long',
                  })}
                </span>
              </div>
            </div>
          )}
        </div>

        <nav className="ae-dash-quick-rail" aria-label={t('dashboard.quickActions')}>
          {QUICK.map((q) => (
            <Link key={q.href} href={q.href} className={`ae-dash-quick-chip ae-dash-quick-chip--${q.tint}`}>
              <span className="ae-dash-quick-icon" aria-hidden>{q.icon}</span>
              {t(q.key)}
            </Link>
          ))}
        </nav>
      </header>

      {failed && <p className="ae-flash ae-flash--error mb-4">{t('dashboard.loadFailed')}</p>}

      {/* ── Setup, while there is any of it left ─────────────────────────────── */}
      {showOnboarding && (
        <section className="ae-dash-zone ae-dash-zone--onboard mb-5">
          <div className="ae-dash-zone-head">
            <div>
              <p className="ae-dash-zone-kicker">{t('dashboard.zone.setup')}</p>
              <h2 className="ae-dash-zone-title">{t('dashboard.onboarding.title')}</h2>
            </div>
            <div className="ae-dash-zone-actions">
              <span className="ae-dash-progress-chip">
                {num(onboarding.doneCount)}/{num(onboarding.totalCount)}
              </span>
              <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                disabled={dismissing} onClick={() => void dismissOnboarding()}>
                {t('dashboard.onboarding.dismiss')}
              </button>
            </div>
          </div>

          <div className="ae-onboard-track" aria-hidden>
            <span style={{ width: `${(onboarding.doneCount / Math.max(1, onboarding.totalCount)) * 100}%` }} />
          </div>

          <ul className="ae-onboard-grid">
            {onboarding.items.map((step) => {
              const label = t(`dashboard.onboarding.item.${step.key}`);
              const to = step.done ? null : builtHref(step.href);
              const body = (
                <>
                  <span className="ae-onboard-check" aria-hidden>{step.done ? '✓' : '+'}</span>
                  {label}
                </>
              );
              const cls = `ae-onboard-item ${step.done ? 'is-done' : 'is-todo'}`;
              return (
                <li key={step.key}>
                  {to
                    ? <Link href={to} className={cls}>{body}</Link>
                    : <span className={cls}>{body}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="ae-dash-layout">
        <div className="ae-dash-bento-main space-y-5">
          {/* ── Today's pulse ───────────────────────────────────────────────── */}
          <section className="ae-dash-zone ae-dash-zone--pulse">
            <div className="ae-dash-zone-head">
              <div>
                <p className="ae-dash-zone-kicker">{t('dashboard.zone.now')}</p>
                <h2 className="ae-dash-zone-title">{t('dashboard.pulse.title')}</h2>
              </div>
              {pulse.length === 0 && (
                <span className="ae-dash-clear-pill">✓ {t('dashboard.allClear')}</span>
              )}
            </div>

            {pulse.length === 0 ? (
              <p className="ae-dash-quiet-note">{t('dashboard.noAlerts')}</p>
            ) : (
              <div className="ae-pulse-grid">
                {pulse.map((p) => {
                  const to = builtHref(p.href);
                  const tone = p.tone && p.tone !== 'default' ? ` ae-pulse-card--${p.tone}` : '';
                  const body = (
                    <>
                      <span className="ae-pulse-icon" aria-hidden>{PULSE_ICON[p.id] ?? '•'}</span>
                      <span className="ae-pulse-label">{t(`dashboard.pulse.${p.id}`)}</span>
                      <span className="ae-pulse-value">
                        {(p.amount ?? 0) > 0 ? money(p.amount!, base) : num(p.count ?? 0)}
                      </span>
                      {/* Both figures matter when both are present: how much, across how many. */}
                      {(p.amount ?? 0) > 0 && (p.count ?? 0) > 0 && (
                        <span className="ae-pulse-detail">
                          {num(p.count!)} {t('dashboard.pulse.invoices')}
                        </span>
                      )}
                      {to && <span className="ae-pulse-go" aria-hidden>←</span>}
                    </>
                  );
                  return to
                    ? <Link key={p.id} href={to} className={`ae-pulse-card${tone}`}>{body}</Link>
                    : <div key={p.id} className={`ae-pulse-card${tone}`}>{body}</div>;
                })}
              </div>
            )}
          </section>

          {/* ── What is actually late ───────────────────────────────────────── */}
          {(overdue.length > 0 || alerts.length > 0) && (
            <section className="ae-dash-zone ae-dash-zone--ops">
              <div className="ae-dash-zone-head">
                <div>
                  <p className="ae-dash-zone-kicker">{t('dashboard.zone.priority')}</p>
                  <h2 className="ae-dash-zone-title">{t('dashboard.attention.title')}</h2>
                </div>
                <span className="ae-dash-attention-pill">
                  {t('dashboard.attentionCount', { n: num(overdue.length + alerts.length) })}
                </span>
              </div>

              <ul className="ae-dash-attention">
                {alerts.map((a) => {
                  const to = builtHref(a.href);
                  // The type carries the wording; `message` is only set when the API has
                  // something more specific than the type to say.
                  const label = a.message ?? t(`notifications.type.${a.type}`);
                  const row = (
                    <>
                      <span className="ae-dash-attention-label">{label}</span>
                      <span className="ae-dash-attention-detail">
                        {(a.count ?? 0) > 1
                          ? t('notifications.countLabel', { count: num(a.count!) })
                          : t('dashboard.pulse.action')}
                      </span>
                    </>
                  );
                  return (
                    <li key={a.id}>
                      {to
                        ? <Link href={to} className="ae-dash-attention-row ae-dash-attention-row--info">{row}</Link>
                        : <span className="ae-dash-attention-row ae-dash-attention-row--info">{row}</span>}
                    </li>
                  );
                })}

                {overdue.map((d) => {
                  const to = builtHref(d.side === 'ar' ? `/invoices?id=${d.id}` : '/purchases');
                  const party = d.clientName ?? d.supplierName ?? '—';
                  const row = (
                    <>
                      <span className="ae-dash-attention-label">
                        <span dir="ltr">{d.number ?? '—'}</span> · {party}
                      </span>
                      <span className="ae-dash-attention-detail">
                        {money(d.remainingAmount, d.currencyCode)} ·{' '}
                        {t('dashboard.invoiceOverdueDays', { days: num(d.daysOverdue ?? 0) })}
                      </span>
                    </>
                  );
                  return (
                    <li key={`${d.side}-${d.id}`}>
                      {to
                        ? <Link href={to} className="ae-dash-attention-row ae-dash-attention-row--warn">{row}</Link>
                        : <span className="ae-dash-attention-row ae-dash-attention-row--warn">{row}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* ── Module cards, only where there is something in them ─────────── */}
          {sections.length > 0 && (
            <section>
              <div className="ae-dash-row-head">
                <p className="ae-dash-section-label">{t('dashboard.zone.modules')}</p>
              </div>
              <div className="ae-section-cards-grid">
                {sections.map((s) => {
                  const to = builtHref(s.href);
                  return (
                    <article key={s.id} className={`ae-section-card ae-section-card--${s.id}`}>
                      <div className="ae-section-card-head">
                        <div className="ae-section-card-title-row">
                          <span className="ae-section-card-icon" aria-hidden>{s.icon}</span>
                          <h3 className="ae-section-card-title">{t(s.title)}</h3>
                        </div>
                        {to && <Link href={to} className="ae-section-card-link">{t('dashboard.viewAll')}</Link>}
                      </div>
                      <div className="ae-section-card-metrics">
                        {s.metrics.map((m) => (
                          <div key={m.label} className={`ae-counter ${m.tone === 'warn' && m.value > 0 ? 'ae-counter--warn' : ''}`}>
                            <div className="ae-counter-body">
                              {/* The design clips these to one line, so the full wording
                                  stays available rather than being lost to the ellipsis. */}
                              <p className="ae-counter-label" title={t(m.label)}>{t(m.label)}</p>
                              <p className="ae-counter-value">
                                {m.money ? money(m.value, base) : num(m.value)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* ── Side rail ───────────────────────────────────────────────────────── */}
        <aside className="ae-dash-bento-side space-y-5">
          {/* Collection and payment, each as a share of what was billed. */}
          {((ar?.invoicedBase ?? 0) > 0 || (ap?.purchasedBase ?? 0) > 0) && (
            <section className="ae-dash-zone ae-dash-zone--kpi">
              <div className="ae-dash-zone-head">
                <div>
                  <p className="ae-dash-zone-kicker">{t('dashboard.zone.overview')}</p>
                  <h2 className="ae-dash-zone-title">{t('dashboard.focus.title')}</h2>
                </div>
              </div>

              <div className="space-y-3">
                {(ar?.invoicedBase ?? 0) > 0 && (
                  <div>
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold">{t('dashboard.collectionProgress')}</span>
                      <span className="ae-dash-progress-chip">{num(Math.round(ar!.collectionRate))}%</span>
                    </div>
                    <div className="ae-progress" role="presentation">
                      <span style={{ width: `${Math.min(100, ar!.collectionRate)}%` }} />
                    </div>
                    <p className="ae-counter-hint">
                      {money(ar!.collectedBase, base)} / {money(ar!.invoicedBase, base)}
                    </p>
                  </div>
                )}

                {(ap?.purchasedBase ?? 0) > 0 && (
                  <div>
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold">{t('dashboard.focus.apRemaining')}</span>
                      <span className="ae-dash-progress-chip">{num(Math.round(ap!.paymentRate))}%</span>
                    </div>
                    <div className="ae-progress" role="presentation">
                      <span style={{ width: `${Math.min(100, ap!.paymentRate)}%` }} />
                    </div>
                    <p className="ae-counter-hint">
                      {money(ap!.paidBase, base)} / {money(ap!.purchasedBase, base)}
                    </p>
                  </div>
                )}

                {(ar?.unallocatedReceiptCount ?? 0) > 0 && (
                  <p className="ae-alert-pill ae-alert-pill--info block text-xs">
                    {t('dashboard.focus.unallocatedReceipts')} · {money(ar!.unallocatedBase, base)}
                  </p>
                )}
              </div>
            </section>
          )}

          {/* ── Treasury ────────────────────────────────────────────────────── */}
          {treasury.length > 0 && (
            <section className="ae-dash-zone">
              <div className="ae-dash-zone-head">
                <div>
                  <p className="ae-dash-zone-kicker">{t('dashboard.zone.flow')}</p>
                  <h2 className="ae-dash-zone-title">{t('dashboard.treasuryTitle')}</h2>
                </div>
              </div>
              <div className="ae-dash-metrics-grid">
                {treasury.map((row) => (
                  <div key={row.currencyCode} className="ae-stat-card">
                    <p className="ae-stat-label">{row.label}</p>
                    <p className={`ae-stat-value ${row.balance < 0 ? 'ae-stat-value--danger' : ''}`}>
                      {money(row.balance, row.currencyCode)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Against last month ──────────────────────────────────────────── */}
          {data?.mom && (data.mom.sales.thisMonth > 0 || data.mom.sales.prevMonth > 0
            || data.mom.collections.thisMonth > 0 || data.mom.collections.prevMonth > 0) && (
            <section className="ae-dash-zone">
              <div className="ae-dash-zone-head">
                <div>
                  <p className="ae-dash-zone-kicker">{t('dashboard.zone.trends')}</p>
                  <h2 className="ae-dash-zone-title">{t('dashboard.mom.title')}</h2>
                </div>
              </div>
              <div className="ae-dash-metrics-grid">
                {([
                  ['dashboard.mom.sales', data.mom.sales],
                  ['dashboard.mom.collections', data.mom.collections],
                ] as const).map(([label, m]) => (
                  <div key={label} className="ae-stat-card">
                    <p className="ae-stat-label">{t(label)}</p>
                    <p className="ae-stat-value">{money(m.thisMonth, base)}</p>
                    {/* A percentage against a month that had nothing is not a comparison —
                        going from zero to anything is reported by the API as +100%. */}
                    {m.changePct != null && m.prevMonth > 0 && (
                      <p className={`ae-counter-hint ${m.changePct >= 0 ? 'ae-stat-value--success' : 'ae-stat-value--danger'}`}>
                        {m.changePct >= 0 ? '▲' : '▼'} {num(Math.abs(Math.round(m.changePct)))}%
                        {' '}{t('dashboard.mom.vsPrev')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
