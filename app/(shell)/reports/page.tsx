'use client';

/**
 * Reports.
 *
 * Fourteen report endpoints exist. These five are the ones that answer a question somebody
 * actually asks out loud: what happened, who owes us and how late, what came in and went out,
 * what we owe the tax authority, and how the floor is doing.
 *
 * ── Aging is the one that gets used ───────────────────────────────────────────────────────
 *
 * It is the report a business chases money with, so it is not just five totals: each client
 * expands to the invoices behind their balance, because "٦٦٬٢٠٠ overdue" is not actionable and
 * "INV-2026-0007, 123 days" is. The buckets come from the API, including the sign convention on
 * `daysOverdue` — a negative value is a document not yet due, which is what lands in `current`.
 *
 * ── The tax tab reconciles rather than reports ────────────────────────────────────────────
 *
 * `variance` is the point of it. The API computes VAT twice — once from the documents and once
 * from the ledger accounts — and the difference between them should be zero. When it is not,
 * something was posted that the documents do not account for, and `issues` names which law it
 * belongs to. That check is worth more than any of the totals beside it, so it is stated
 * whichever way it comes out rather than only when it fails.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PageHero, Panel, Skeleton } from '@/components/page';

type Bucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';
const BUCKETS: Bucket[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];

type AgingDoc = {
  id: string; number: string | null; dueDate: string; daysOverdue: number;
  bucket: Bucket; currencyCode: string; remainingAmount: number;
};
type AgingParty = {
  partyId: string; partyName: string; buckets: Record<Bucket, number>;
  total: number; documents: AgingDoc[];
};
type Aging = {
  asOfDate: string; baseCurrency: string;
  receivables: { parties: AgingParty[]; totals: Record<Bucket, number>; grandTotal: number };
  payables: { parties: AgingParty[]; totals: Record<Bucket, number>; grandTotal: number };
};

/**
 * The summary endpoint returns SQL aggregates, not documents: one row per status with a count
 * and a total, in snake_case, with the decimals as strings. It is passed through unmapped, so
 * the shape is read as it comes rather than as the rest of the API would have written it.
 */
type SummaryRow = { status?: string; type?: string; cnt: number; total_base: string; currency_code: string };
type Summary = {
  baseCurrency: string;
  invoices: SummaryRow[];
  receipts: SummaryRow[];
  quotes: SummaryRow[];
  purchases: SummaryRow[];
  treasury: { currencyCode: string; balance: number; label: string }[];
};

type CashFlow = {
  baseCurrency: string; openingBalance: number; totalCashIn: number; totalCashOut: number;
  months: { month: string; cashIn: number; cashOut: number; net: number; runningBalance: number }[];
};

type TaxReview = {
  baseCurrency: string;
  vat: {
    enabled: boolean; rate: number; salesBase: number; purchaseBase: number;
    outputVat: number; inputVat: number; netVat: number; netVatStatus: string;
    ledgerOutput: number; ledgerInput: number; variance: number;
    taxInvoiceCount: number; taxPurchaseCount: number;
  };
  withholding: { enabled: boolean; totalWithheld: number; paymentCount: number };
  issues: { law: string; code: string; severity: string }[];
};

type Operations = {
  generatedAt: string;
  kpis: {
    activeJobs: number; overdueJobs: number; completedToday: number;
    onTimeRate: number | null; avgCycleDays: number | null;
    materialCostTotal: number; serviceCostTotal: number;
  };
  activeByStage: { stageKey: string; label?: string; count: number }[];
  lateJobs: { id: string; number: string; title: string; clientName: string; daysLate: number }[];
  topClients: { clientName: string; jobCount: number }[];
};

const TABS = [
  { key: 'overview', label: 'reports.tabs.overview', path: '/reports/summary' },
  { key: 'aging', label: 'reports.tabs.aging', path: '/reports/aging' },
  { key: 'cashflow', label: 'reports.tabs.cashflow', path: '/reports/cash-flow' },
  { key: 'tax', label: 'reports.tabs.tax', path: '/reports/tax-review' },
  { key: 'operations', label: 'reports.tabs.operations', path: '/reports/operations' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function ReportsPage() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<TabKey>('overview');
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [openParty, setOpenParty] = useState<string | null>(null);

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

  // Each tab fetches once and is kept, so switching back is instant and the server is not
  // asked to recompute a report nobody changed.
  const load = useCallback(async (key: TabKey) => {
    if (data[key]) return;
    setLoading(true);
    setFailed(false);
    try {
      const path = TABS.find((x) => x.key === key)!.path;
      const res = await api<Record<string, unknown>>(path);
      setData((d) => ({ ...d, [key]: res }));
    } catch (err) {
      setFailed(err instanceof ApiError);
    } finally {
      setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  const agingTable = (side: Aging['receivables'], title: string, cur: string) => (
    <Panel title={title} className="mb-4">
      {side.grandTotal === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">{t('reports.aging.empty')}</p>
      ) : (
        <>
          <div className="ae-dash-metrics-grid mb-4">
            {BUCKETS.map((b) => (
              <div key={b} className="ae-stat-card">
                <p className="ae-stat-label">{t(`reports.aging.bucket.${b}`)}</p>
                <p className={`ae-stat-value ${b === 'd90_plus' && side.totals[b] > 0 ? 'ae-stat-value--danger' : ''}`}>
                  {money(side.totals[b], cur)}
                </p>
              </div>
            ))}
          </div>

          <div className="ae-table-wrap">
            <table className="ae-table ae-table--rows">
              <thead>
                <tr>
                  <th>{t('party.name')}</th>
                  {BUCKETS.map((b) => <th key={b}>{t(`reports.aging.bucket.${b}`)}</th>)}
                  <th>{t('reports.aging.total')}</th>
                </tr>
              </thead>
              <tbody>
                {side.parties.map((p) => (
                  <>
                    <tr key={p.partyId}>
                      <td>
                        {/* A total is not actionable; the documents behind it are. */}
                        <button type="button" className="font-bold underline"
                          onClick={() => setOpenParty(openParty === p.partyId ? null : p.partyId)}>
                          {p.partyName}
                        </button>
                      </td>
                      {BUCKETS.map((b) => (
                        <td key={b}>{p.buckets[b] > 0 ? money(p.buckets[b], cur) : '—'}</td>
                      ))}
                      <td className="font-bold">{money(p.total, cur)}</td>
                    </tr>
                    {openParty === p.partyId && p.documents.map((d) => (
                      <tr key={d.id} className="text-xs">
                        <td colSpan={BUCKETS.length + 2}>
                          <span className="font-bold" dir="ltr">{d.number ?? '—'}</span>
                          {' · '}
                          <span dir="ltr">{d.dueDate}</span>
                          {' · '}
                          {/* Negative means not due yet — the API's own sign convention. */}
                          {d.daysOverdue > 0
                            ? <span className="ae-stat-value--warn">{t('jobs.delivery.late', { days: num(d.daysOverdue) })}</span>
                            : <span className="text-[var(--text-muted)]">{t('reports.aging.bucket.current')}</span>}
                          {' · '}
                          {money(d.remainingAmount, d.currencyCode)}
                        </td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>{t('reports.aging.total')}</th>
                  {BUCKETS.map((b) => <th key={b}>{money(side.totals[b], cur)}</th>)}
                  <th>{money(side.grandTotal, cur)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Panel>
  );

  const current = data[tab];

  return (
    <div className="ae-page">
      <PageHero title={t('reports.title')} subtitle={t('reports.subtitle')} />

      <div className="ae-tab-pills mb-4">
        {TABS.map((x) => (
          <button key={x.key} type="button" onClick={() => setTab(x.key)}
            className={`ae-tab-pill ${tab === x.key ? 'is-active' : ''}`}>
            {t(x.label)}
          </button>
        ))}
      </div>

      {failed && <p className="ae-flash ae-flash--error mb-4">{t('reports.loadFailed')}</p>}

      {loading && !current ? (
        <Panel><Skeleton rows={6} /></Panel>
      ) : !current ? null : tab === 'overview' ? (
        (() => {
          const sm = current as unknown as Summary;
          const cur = sm.baseCurrency;
          const sum = (rows: SummaryRow[]) => rows.reduce((a, r) => a + Number(r.total_base), 0);
          const count = (rows: SummaryRow[]) => rows.reduce((a, r) => a + Number(r.cnt), 0);

          const groups = [
            { label: 'invoices.title', rows: sm.invoices, statusPrefix: 'invoices.status' },
            { label: 'purchases.title', rows: sm.purchases, statusPrefix: 'purchases.status' },
            { label: 'receipts.title', rows: sm.receipts, statusPrefix: 'receipts.type' },
            { label: 'quotes.title', rows: sm.quotes, statusPrefix: 'quotes.status' },
          ];

          return (
            <>
              <div className="ae-dash-metrics-grid mb-4">
                {groups.map((b) => (
                  <div key={b.label} className="ae-stat-card">
                    <p className="ae-stat-label">{t(b.label)}</p>
                    <p className="ae-stat-value">{money(sum(b.rows), cur)}</p>
                    <p className="ae-stat-hint">{num(count(b.rows))}</p>
                  </div>
                ))}
              </div>

              {/* The breakdown the aggregate is hiding: same money, split by where it stands. */}
              {groups.filter((b) => b.rows.length > 0).map((b) => (
                <Panel key={b.label} title={t(b.label)} className="mb-4">
                  <div className="ae-table-wrap">
                    <table className="ae-table ae-table--rows">
                      <thead>
                        <tr>
                          <th>{t('invoices.status')}</th>
                          <th>{t('dashboard.pulse.invoices')}</th>
                          <th>{t('reports.totalBase')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.rows.map((r) => {
                          const key = r.status ?? r.type ?? '';
                          return (
                            <tr key={key}>
                              <td>{t(`${b.statusPrefix}.${key}`, key)}</td>
                              <td>{num(Number(r.cnt))}</td>
                              <td>{money(Number(r.total_base), cur)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              ))}

              <Panel title={t('treasury.balances')}>
                <div className="ae-dash-metrics-grid">
                  {sm.treasury.filter((b) => b.balance !== 0 || b.currencyCode === cur).map((b) => (
                    <div key={b.currencyCode} className="ae-stat-card">
                      <p className="ae-stat-label">{b.label}</p>
                      <p className="ae-stat-value">{money(b.balance, b.currencyCode)}</p>
                    </div>
                  ))}
                </div>
              </Panel>
            </>
          );
        })()
      ) : tab === 'aging' ? (
        (() => {
          const a = current as unknown as Aging;
          return (
            <>
              <p className="mb-4 text-sm text-[var(--text-muted)]">
                {t('reports.aging.asOf')} <span dir="ltr">{a.asOfDate}</span>
              </p>
              {agingTable(a.receivables, t('reports.aging.receivables'), a.baseCurrency)}
              {agingTable(a.payables, t('reports.aging.payables'), a.baseCurrency)}
            </>
          );
        })()
      ) : tab === 'cashflow' ? (
        (() => {
          const c = current as unknown as CashFlow;
          const cur = c.baseCurrency;
          return (
            <>
              <div className="ae-dash-metrics-grid mb-4">
                <div className="ae-stat-card">
                  <p className="ae-stat-label">{t('reports.cashflow.opening')}</p>
                  <p className="ae-stat-value">{money(c.openingBalance, cur)}</p>
                </div>
                <div className="ae-stat-card">
                  <p className="ae-stat-label">{t('reports.cashflow.totalIn')}</p>
                  <p className="ae-stat-value ae-stat-value--success">{money(c.totalCashIn, cur)}</p>
                </div>
                <div className="ae-stat-card">
                  <p className="ae-stat-label">{t('reports.cashflow.totalOut')}</p>
                  <p className="ae-stat-value">{money(c.totalCashOut, cur)}</p>
                </div>
              </div>

              <Panel title={t('reports.cashflow.title')}>
                <div className="ae-table-wrap">
                  <table className="ae-table ae-table--rows">
                    <thead>
                      <tr>
                        <th>{t('reports.cashflow.month')}</th>
                        <th>{t('reports.cashflow.cashIn')}</th>
                        <th>{t('reports.cashflow.cashOut')}</th>
                        <th>{t('reports.cashflow.net')}</th>
                        <th>{t('reports.cashflow.runningBalance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Months with no movement are kept: a gap in the run is itself the fact. */}
                      {c.months.map((m) => (
                        <tr key={m.month}>
                          <td dir="ltr">{m.month}</td>
                          <td>{m.cashIn > 0 ? money(m.cashIn, cur) : '—'}</td>
                          <td>{m.cashOut > 0 ? money(m.cashOut, cur) : '—'}</td>
                          <td className={m.net < 0 ? 'ae-stat-value--danger' : undefined}>
                            {m.net !== 0 ? money(m.net, cur) : '—'}
                          </td>
                          <td className="font-bold">{money(m.runningBalance, cur)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          );
        })()
      ) : tab === 'tax' ? (
        (() => {
          const r = current as unknown as TaxReview;
          const cur = r.baseCurrency;
          const balanced = Math.abs(r.vat.variance) < 0.01;
          return (
            <>
              {/* The reconciliation, stated either way — it is the point of the report. */}
              <p className={`ae-flash mb-4 ${balanced ? 'ae-flash--success' : 'ae-flash--error'}`}>
                {t('reports.tax.variance')}: {money(r.vat.variance, cur)} — {t('reports.tax.vatVarianceHint')}
              </p>

              {r.issues.length > 0 && (
                <ul className="mb-4 space-y-1">
                  {r.issues.map((i) => (
                    <li key={i.code} className="ae-alert-pill ae-alert-pill--warn block text-xs">
                      {t(`reports.tax.law.${i.law}`, i.law)} — {t(`reports.tax.issue.${i.code}`, i.code)}
                    </li>
                  ))}
                </ul>
              )}

              <Panel title={t('reports.tax.vatSection')} className="mb-4">
                <div className="ae-dash-metrics-grid">
                  {([
                    ['reports.tax.salesBase', r.vat.salesBase],
                    ['reports.tax.outputVat', r.vat.outputVat],
                    ['reports.tax.purchaseBase', r.vat.purchaseBase],
                    ['reports.tax.inputVat', r.vat.inputVat],
                  ] as const).map(([label, v]) => (
                    <div key={label} className="ae-stat-card">
                      <p className="ae-stat-label">{t(label)}</p>
                      <p className="ae-stat-value">{money(v, cur)}</p>
                    </div>
                  ))}
                  <div className="ae-stat-card ae-stat-card--featured">
                    <p className="ae-stat-label">{t('reports.tax.netVat')}</p>
                    <p className="ae-stat-value">{money(r.vat.netVat, cur)}</p>
                    <p className="ae-stat-hint">
                      {t(r.vat.netVatStatus === 'payable' ? 'reports.tax.netVatPayable' : 'reports.tax.netVatRecoverable')}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-[var(--text-muted)]">{t('reports.tax.vatClearingHint')}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {t('reports.tax.taxInvoices')}: {num(r.vat.taxInvoiceCount)} ·{' '}
                  {t('reports.tax.taxPurchases')}: {num(r.vat.taxPurchaseCount)}
                </p>
              </Panel>

              {/* Only when the tenant has it switched on — otherwise the figures are all zero. */}
              {r.withholding.enabled && (
                <Panel title={t('reports.tax.withholdingSection')}>
                  <div className="ae-dash-metrics-grid">
                    <div className="ae-stat-card">
                      <p className="ae-stat-label">{t('reports.tax.totalWithheld')}</p>
                      <p className="ae-stat-value">{money(r.withholding.totalWithheld, cur)}</p>
                    </div>
                    <div className="ae-stat-card">
                      <p className="ae-stat-label">{t('reports.tax.paymentCount')}</p>
                      <p className="ae-stat-value">{num(r.withholding.paymentCount)}</p>
                    </div>
                  </div>
                </Panel>
              )}
            </>
          );
        })()
      ) : (
        (() => {
          const o = current as unknown as Operations;
          return (
            <>
              <div className="ae-dash-metrics-grid mb-4">
                <div className="ae-stat-card">
                  <p className="ae-stat-label">{t('jobs.active')}</p>
                  <p className="ae-stat-value">{num(o.kpis.activeJobs)}</p>
                </div>
                <div className="ae-stat-card">
                  <p className="ae-stat-label">{t('jobs.overdue')}</p>
                  <p className={`ae-stat-value ${o.kpis.overdueJobs > 0 ? 'ae-stat-value--warn' : ''}`}>
                    {num(o.kpis.overdueJobs)}
                  </p>
                </div>
                {/* A rate over no finished jobs is not a rate — and the API answers 0 rather
                    than null, so "0% on time" appears for a floor that has never run. */}
                {o.kpis.onTimeRate != null && o.kpis.activeJobs + o.kpis.completedToday > 0 && (
                  <div className="ae-stat-card">
                    <p className="ae-stat-label">{t('reports.operations.onTimeRate')}</p>
                    <p className="ae-stat-value">{num(Math.round(o.kpis.onTimeRate))}%</p>
                  </div>
                )}
                {o.kpis.avgCycleDays != null && o.kpis.activeJobs > 0 && (
                  <div className="ae-stat-card">
                    <p className="ae-stat-label">{t('reports.operations.avgCycleDays')}</p>
                    <p className="ae-stat-value">{num(Math.round(o.kpis.avgCycleDays))}</p>
                  </div>
                )}
              </div>

              {o.lateJobs.length > 0 && (
                <Panel title={t('reports.operations.lateJobs')} className="mb-4">
                  <ul className="ae-dash-attention">
                    {o.lateJobs.map((j) => (
                      <li key={j.id} className="ae-dash-attention-row ae-dash-attention-row--warn">
                        <span className="ae-dash-attention-label">
                          <span dir="ltr">{j.number}</span> · {j.title}
                        </span>
                        <span className="ae-dash-attention-detail">
                          {j.clientName} · {t('reports.operations.daysLate')} {num(j.daysLate)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              {o.activeByStage.length > 0 && (
                <Panel title={t('reports.operations.byStage')} className="mb-4">
                  <div className="ae-dash-metrics-grid">
                    {o.activeByStage.map((s) => (
                      <div key={s.stageKey} className="ae-stat-card">
                        <p className="ae-stat-label">{s.label ?? s.stageKey}</p>
                        <p className="ae-stat-value">{num(s.count)}</p>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {o.topClients.length > 0 && (
                <Panel title={t('reports.operations.topClients')}>
                  <ul className="space-y-2">
                    {o.topClients.map((c) => (
                      <li key={c.clientName} className="flex justify-between text-sm">
                        <span>{c.clientName}</span>
                        <span className="font-bold">{num(c.jobCount)}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              {o.kpis.activeJobs === 0 && o.lateJobs.length === 0 && (
                <p className="text-sm text-[var(--text-muted)]">{t('jobs.emptyBoard')}</p>
              )}
            </>
          );
        })()
      )}
    </div>
  );
}
