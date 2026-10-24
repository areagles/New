'use client';

/**
 * أرشيف العمليات — one search across everything that ever happened.
 *
 * Jobs, invoices and quotes each have their own list page with their own filters, and those are
 * for working: what is open, what is late, what needs a decision. This is for remembering — a
 * client rings about a job from March and all anyone has is a name and half a number.
 *
 * So the search is deliberately blunt: number, client, title, one box, all three document types.
 * The server pages it (forty at a time, capped at a hundred) rather than returning a year of
 * history, and every row links straight into the document it came from.
 *
 * ── Permissions decide the tabs, not the sidebar ──────────────────────────────────────────
 *
 * The API returns an empty result for a type the viewer cannot see rather than refusing the
 * request, so a tab nobody is allowed into would look like an empty archive. The tabs are
 * filtered by the same keys the endpoint checks, which makes an empty tab mean "nothing there"
 * instead of "you are not allowed".
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

type Kind = 'jobs' | 'invoices' | 'quotes';

type Row = {
  id: string; number: string | null; clientName: string; status: string;
  href: string; updatedAt: string;
  title?: string; currentStage?: string;
  invoiceDate?: string; quoteDate?: string;
  totalAmount?: number; currencyCode?: string;
};

type Result = { type: Kind; items: Row[]; total: number; page: number; pageSize: number; query: string };

/** Read off the same ae_perm_any calls the endpoint branches on. */
const TAB_PERMS: Record<Kind, string[]> = {
  jobs: ['jobs.view', 'jobs.create', 'jobs.manage'],
  invoices: ['finance.view', 'finance.invoices.manage'],
  quotes: ['finance.view', 'finance.quotes.manage'],
};

export default function ArchivePage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const tabs = (Object.keys(TAB_PERMS) as Kind[]).filter((k) => TAB_PERMS[k].some((p) => can(p)));

  const [kind, setKind] = useState<Kind>(tabs[0] ?? 'jobs');
  const [query, setQuery] = useState('');
  /** What was actually sent — typing must not fire a request per keystroke. */
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ type: kind, page: String(page) });
      if (applied) params.set('q', applied);
      setData(await api<Result>(`/archive?${params}`));
    } catch {
      setError('archive.loadFailed');
    } finally {
      setLoading(false);
    }
  }, [kind, page, applied]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = useCallback(
    (v: number, currency = 'EGP') => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(v),
    [lang],
  );
  const date = useCallback(
    (v?: string | null) => (v ? new Date(v).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB') : '—'),
    [lang],
  );

  if (tabs.length === 0) {
    return (
      <div className="ae-page">
        <PageHero title={t('archive.title')} subtitle={t('archive.subtitleReal')} />
        <p className="ae-flash ae-flash--error">{t('archive.noAccess')}</p>
      </div>
    );
  }

  const items = data?.items ?? [];
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="ae-page">
      <PageHero title={t('archive.title')} subtitle={t('archive.subtitleReal')} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error)}</p>}

      <div className="ae-tab-pills mb-4">
        {tabs.map((k) => (
          <button key={k} type="button" className={`ae-tab-pill ${kind === k ? 'is-active' : ''}`}
            onClick={() => { setKind(k); setPage(1); }}>
            {t(`archive.tab.${k}`)}
          </button>
        ))}
      </div>

      <Panel>
        <form className="ae-toolbar mb-3"
          onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(query.trim()); }}>
          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('archive.search')}</span>
            <input className="ae-input" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t('archive.searchPlaceholder')} />
          </label>
          <button type="submit" className="ae-btn-primary self-end" disabled={loading}>
            {t('archive.search')}
          </button>
        </form>

        {loading ? <Skeleton rows={6} /> : items.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t('archive.empty')}</p>
        ) : (
          <>
            <div className="ae-table-wrap">
              <table className="ae-table">
                <thead>
                  <tr>
                    <th>{t('invoices.number')}</th>
                    <th>{t('quotes.client')}</th>
                    {kind === 'jobs' ? <th>{t('jobs.fieldTitle')}</th> : <th>{t('invoices.total')}</th>}
                    <th>{t('invoices.status')}</th>
                    <th>{t('common.lastUpdated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {/* Every row is the document it came from — the point of the archive. */}
                        <Link href={r.href} className="font-bold underline">{r.number ?? '—'}</Link>
                      </td>
                      <td>{r.clientName}</td>
                      {kind === 'jobs'
                        ? <td>{r.title ?? '—'}</td>
                        : <td>{r.totalAmount !== undefined ? money(r.totalAmount, r.currencyCode) : '—'}</td>}
                      <td className="text-xs">
                        {t(kind === 'jobs' ? `jobs.status.${r.status}` : `${kind}.status.${r.status}`, r.status)}
                      </td>
                      <td className="text-xs">{date(r.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-[var(--text-muted)]">
                {t('archive.pageOf', {
                  page: String(data?.page ?? 1),
                  total: String(pageCount),
                  count: String(data?.total ?? 0),
                })}
              </span>
              <span className="flex gap-2">
                <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                  disabled={loading || (data?.page ?? 1) <= 1} onClick={() => setPage((p) => p - 1)}>
                  ›
                </button>
                <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                  disabled={loading || (data?.page ?? 1) >= pageCount} onClick={() => setPage((p) => p + 1)}>
                  ‹
                </button>
              </span>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
