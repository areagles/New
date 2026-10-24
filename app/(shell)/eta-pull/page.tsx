'use client';

/**
 * استيراد مستندات ETA — what the tax authority already has, brought back in.
 *
 * Two directions, two purposes. واردة are documents suppliers filed against this company's tax
 * number: they exist at the authority whether or not anybody typed them here, so they can be
 * imported as purchases and stop being a gap. صادرة are this company's own submissions, matched
 * back against the local invoices they came from — a check that what was filed is what was
 * billed.
 *
 * ── The authority is not automatically right ──────────────────────────────────────────────
 *
 * A صادرة document whose total does not match its local invoice is flagged rather than trusted.
 * Either the invoice was edited after filing or the wrong thing was filed, and both need a
 * person. So the match view exists as its own tab and reports variance instead of silently
 * overwriting local figures.
 *
 * ── The pull is capped at one month ───────────────────────────────────────────────────────
 *
 * The authority's API refuses a wider range, and the server hands back the boundary it would
 * accept along with the refusal. Rather than making somebody work out the month arithmetic, the
 * screen offers that next window as a button.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

type Pulled = {
  id: string; uuid: string; direction: 'SENT' | 'RECEIVED'; docType: string | null;
  issuerName: string | null; issuerTaxId: string | null;
  receiverName: string | null; receiverTaxId: string | null;
  totalAmount: number; currencyCode: string; issueDate: string | null; etaStatus: string | null;
  importedPurchaseId: string | null; importedInvoiceId: string | null; importedAt: string | null;
  pulledAt: string;
};
type MatchRow = {
  uuid: string; issueDate?: string | null; etaTotal?: number; totalAmount?: number;
  localInvoiceId?: string | null; localNumber?: string | null; localTotal?: number | null;
  status: string; variance?: number;
};

const FILTERS = ['', 'pending', 'imported'] as const;

export default function EtaPullPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const manage = can('finance.purchases.manage') || can('finance.invoices.manage');

  const [view, setView] = useState<'list' | 'match'>('list');
  const [direction, setDirection] = useState<'RECEIVED' | 'SENT'>('RECEIVED');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('');
  const [docs, setDocs] = useState<Pulled[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [range, setRange] = useState({ from: monthAgo, to: today });
  /** The window the server said it would accept, when it refused the one that was asked for. */
  const [nextWindow, setNextWindow] = useState<{ from: string; to: string } | null>(null);

  const money = useCallback(
    (v: number, currency = 'EGP') => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(v),
    [lang],
  );
  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG').format(v),
    [lang],
  );
  const date = useCallback(
    (v: string | null | undefined) => (v ? new Date(v.replace(' ', 'T')).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB') : '—'),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ direction });
      if (filter) q.set('filter', filter);
      const [d, m] = await Promise.all([
        api<{ items?: Pulled[] }>(`/eta-pull/documents?${q}`),
        api<{ items?: MatchRow[] }>(`/eta-pull/match-review?direction=${direction}`).catch(() => ({ items: [] })),
      ]);
      setDocs(d.items ?? []);
      setMatches(m.items ?? []);
    } catch {
      setError('common.error');
    } finally {
      setLoading(false);
    }
  }, [direction, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function pull(from: string, to: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    setNextWindow(null);
    try {
      const res = await api<{ pulled?: number }>('/eta-pull/run', {
        method: 'POST',
        body: { direction, from, to },
      });
      setFlash(t('etaPull.pulledCount', { n: num(Number(res.pulled ?? 0)) }));
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      // The refusal carries the window it would have accepted; offering it saves the user
      // working out where one month ends.
      if (err instanceof ApiError && code === 'eta_pull_range_exceeds_one_month') {
        const p = err.payload as { maxTo?: string; nextFrom?: string };
        if (p.maxTo) setNextWindow({ from, to: p.maxTo });
      }
      setError(code ? `etaPull.error.${code}` : 'etaPull.pullFailed');
    } finally {
      setBusy(false);
    }
  }

  async function importDoc(d: Pulled) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await api(`/eta-pull/documents/${d.id}/import`, { method: 'POST', body: {} });
      setFlash('etaPull.imported');
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code ? `etaPull.error.${code}` : 'common.error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ae-page">
      <PageHero title={t('etaPull.title')} subtitle={t('etaPull.subtitle')} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash, flash)}</p>}

      <Panel className="mb-4">
        <div className="ae-toolbar">
          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('etaPull.viewList')}</span>
            <select className="ae-input" value={direction}
              onChange={(e) => setDirection(e.target.value as 'RECEIVED' | 'SENT')}>
              <option value="RECEIVED">{t('etaPull.received')}</option>
              <option value="SENT">{t('etaPull.sent')}</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('etaPull.from')}</span>
            <input type="date" className="ae-input" value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('etaPull.to')}</span>
            <input type="date" className="ae-input" value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </label>
          {manage && (
            <button type="button" className="ae-btn-primary self-end" disabled={busy}
              onClick={() => void pull(range.from, range.to)}>
              {t('etaPull.pullNow')}
            </button>
          )}
        </div>

        {nextWindow && (
          <div className="mt-3">
            <button type="button" className="ae-btn-secondary text-xs" disabled={busy}
              onClick={() => {
                setRange(nextWindow);
                void pull(nextWindow.from, nextWindow.to);
              }}>
              {t('etaPull.pullNow')} · {date(nextWindow.from)} → {date(nextWindow.to)}
            </button>
          </div>
        )}
      </Panel>

      <div className="ae-tab-pills mb-4">
        {(['list', 'match'] as const).map((k) => (
          <button key={k} type="button" className={`ae-tab-pill ${view === k ? 'is-active' : ''}`}
            onClick={() => { setView(k); setError(null); setFlash(null); }}>
            {t(k === 'list' ? 'etaPull.viewList' : 'etaPull.viewMatch')}
          </button>
        ))}
      </div>

      {view === 'list' && (
        <Panel>
          <div className="ae-tab-pills mb-3">
            {FILTERS.map((f) => (
              <button key={f || 'all'} type="button" className={`ae-tab-pill ${filter === f ? 'is-active' : ''}`}
                onClick={() => setFilter(f)}>
                {t(f === '' ? 'etaPull.filterAll' : f === 'pending' ? 'etaPull.filterPending' : 'etaPull.filterImported')}
              </button>
            ))}
          </div>

          {loading ? <Skeleton rows={5} /> : docs.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('etaPull.noDocuments')}</p>
          ) : (
            <div className="ae-table-wrap">
              <table className="ae-table">
                <thead>
                  <tr>
                    <th>{t('invoices.date')}</th>
                    <th>{t('purchaseOrders.supplier')}</th>
                    <th>{t('invoices.total')}</th>
                    <th>{t('purchaseOrders.status')}</th>
                    {manage && <th aria-label={t('quotes.actions')} />}
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => {
                    const imported = d.importedPurchaseId ?? d.importedInvoiceId;
                    return (
                      <tr key={d.id}>
                        <td className="text-xs">{date(d.issueDate)}</td>
                        <td>
                          {/* Whose document this is depends on which way it travelled. */}
                          {d.direction === 'RECEIVED' ? (d.issuerName ?? '—') : (d.receiverName ?? '—')}
                          <span className="block font-mono text-xs text-[var(--text-muted)]">{d.uuid}</span>
                        </td>
                        <td className="font-bold">{money(d.totalAmount, d.currencyCode)}</td>
                        <td className="text-xs">
                          {d.etaStatus ?? '—'}
                          {imported && (
                            <span className="ae-badge ae-badge-success ms-2 text-xs">
                              {t('etaPull.alreadyImported')}
                            </span>
                          )}
                        </td>
                        {manage && (
                          <td>
                            {d.importedPurchaseId ? (
                              <Link href={`/purchases?id=${d.importedPurchaseId}`} className="ae-btn-ghost px-2 py-1 text-xs">
                                {t('purchaseOrders.view')}
                              </Link>
                            ) : d.importedInvoiceId ? (
                              <Link href={`/invoices?id=${d.importedInvoiceId}`} className="ae-btn-ghost px-2 py-1 text-xs">
                                {t('etaPull.openInvoice')}
                              </Link>
                            ) : (
                              <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                                onClick={() => void importDoc(d)}>
                                {t('etaPull.import')}
                              </button>
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
      )}

      {view === 'match' && (
        <Panel title={t('etaPull.viewMatch')}>
          {loading ? <Skeleton rows={5} /> : matches.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
          ) : (
            <div className="ae-table-wrap">
              <table className="ae-table">
                <thead>
                  <tr>
                    <th>{t('invoices.date')}</th>
                    <th>{t('invoices.number')}</th>
                    <th>{t('invoices.total')}</th>
                    <th>{t('etaPull.localTotal')}</th>
                    <th>{t('purchaseOrders.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => (
                    <tr key={m.uuid}>
                      <td className="text-xs">{date(m.issueDate)}</td>
                      <td>
                        {m.localInvoiceId ? (
                          <Link href={`/invoices?id=${m.localInvoiceId}`} className="font-bold underline">
                            {m.localNumber ?? '—'}
                          </Link>
                        ) : '—'}
                        <span className="block font-mono text-xs text-[var(--text-muted)]">{m.uuid}</span>
                      </td>
                      <td>{money(Number(m.etaTotal ?? m.totalAmount ?? 0))}</td>
                      <td>{m.localTotal !== null && m.localTotal !== undefined ? money(m.localTotal) : '—'}</td>
                      <td className="text-xs">
                        {/* A mismatch is a question for a person, not a figure to adopt. */}
                        <span className={`ae-badge text-xs ${
                          m.status === 'ok' || m.status === 'matched' ? 'ae-badge-success'
                            : m.status === 'variance' ? 'ae-badge-danger' : 'ae-badge-warn'}`}>
                          {t(m.status === 'ok' || m.status === 'matched' ? 'etaPull.matchOk'
                            : m.status === 'variance' ? 'etaPull.matchVariance' : 'etaPull.matchUnlinked')}
                        </span>
                        {m.variance !== undefined && Math.abs(m.variance) > 0.005 && (
                          <span className="block text-[var(--text-muted)]">{money(m.variance)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
