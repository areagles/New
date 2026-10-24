'use client';

/**
 * One quote.
 *
 * A quote is the only document in the chain that is a proposal rather than a record, and
 * almost everything on this screen is about what it can still become: a revision, a job on the
 * floor, or an invoice. Which of those are offered depends entirely on where it stands.
 *
 * ── Two states that are easy to conflate ──────────────────────────────────────────────────
 *
 * `status` is where the quote stands with the client — drafted, sent, approved, converted.
 * `internalApprovalStatus` is whether *we* have signed off on sending it at all. A quote over
 * the tenant's threshold is held as a draft with a pending internal approval, and until that
 * clears it has not reached the client whatever the status says. Both are shown.
 *
 * ── Versions ──────────────────────────────────────────────────────────────────────────────
 *
 * Revising a quote does not edit it. `new-version` supersedes the current one and creates its
 * successor, so the history of what was offered survives — which is the point, since a client
 * who agreed to version 2 did not agree to version 3. A superseded quote is readable and
 * nothing else, and the API refuses to modify it.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { QuoteEditor, type EditableQuote } from '@/components/quote-editor';
import { DocumentShare } from '@/components/document-share';
import { builtHref } from '@/lib/built';

type Line = {
  id: string;
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  discount: number;
  lineTotal: number;
};

type QuoteStatus = 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED' | 'CONVERTED' | 'SUPERSEDED';

// The editor's line shape is what it needs to write one back; this screen also reads the
// server's own id and computed total, so its line type replaces rather than narrows.
type Quote = Omit<EditableQuote, 'lines'> & {
  lines?: Line[];
  number: string | null;
  clientName: string | null;
  clientPhone: string | null;
  clientTaxId: string | null;
  subTotal: number;
  taxTotal: number;
  totalAmount: number;
  status: QuoteStatus;
  internalApprovalStatus: string | null;
  versionNumber: number | null;
  rootQuoteId: string | null;
  supersededById: string | null;
  rejectionReason: string | null;
  expectedCloseDate: string | null;
  shareToken: string | null;
  shareEnabled: boolean | null;
};

type Version = { id: string; number: string | null; versionNumber: number; status: QuoteStatus; totalAmount: number };

const STATUS_STYLE: Record<QuoteStatus, string> = {
  DRAFT: 'ae-badge-muted',
  SENT: 'ae-badge-info',
  APPROVED: 'ae-badge-success',
  REJECTED: 'ae-badge-danger',
  CONVERTED: 'ae-badge-success',
  SUPERSEDED: 'ae-badge-muted',
};

/** Acted on or replaced — the API refuses to modify any of these. */
const CLOSED: QuoteStatus[] = ['CONVERTED', 'REJECTED', 'SUPERSEDED'];

const DAY = 86400000;

export function QuoteDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const [quote, setQuote] = useState<Quote | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const money = useCallback(
    (v: number, currency: string) =>
      new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
        style: 'currency', currency, maximumFractionDigits: 2,
      }).format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api<{ quote?: Quote } | Quote>(`/quotes/${id}`);
      const q = ('quote' in res ? res.quote : res) as Quote;
      setQuote(q);
      // Only worth listing when there is more than one.
      const v = await api<{ items?: Version[] }>(`/quotes/${id}/versions`).catch(() => null);
      setVersions(v?.items ?? []);
    } catch (err) {
      setFailed(err instanceof ApiError);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Record that the client accepted.
   *
   * The intended route is the client pressing approve on a shared document link, which sets
   * `client_approval_status` as well. But agreement usually arrives by phone or on WhatsApp,
   * and without this the status could never leave SENT — so converting and raising a job,
   * both of which require APPROVED, were unreachable from here.
   */
  async function setStatus(status: 'APPROVED' | 'DRAFT') {
    if (!quote) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await api(`/quotes/${quote.id}`, {
        method: 'PATCH',
        body: { status, expectedUpdatedAt: quote.updatedAt },
      });
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code === 'conflict_stale_data' ? 'common.conflictStaleData' : 'common.error');
    } finally {
      setBusy(false);
    }
  }

  async function act(action: 'convert' | 'create-job' | 'new-version', confirmKey: string) {
    if (!quote || !window.confirm(t(confirmKey))) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await api(`/quotes/${quote.id}/${action}`, { method: 'POST' });
      setFlash(
        action === 'convert' ? 'quotes.converted'
          : action === 'create-job' ? 'quotes.jobCreated'
            : 'quotes.newVersionCreated',
      );
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code === 'job_exists' ? 'quotes.jobExists' : 'common.error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="ae-page">
        <PageHero title={t('quotes.title')} />
        <Panel><Skeleton rows={6} /></Panel>
      </div>
    );
  }

  if (failed || !quote) {
    return (
      <div className="ae-page">
        <PageHero title={t('quotes.title')}
          actions={<button type="button" className="ae-btn-ghost" onClick={onBack}>{t('common.close')}</button>} />
        <p className="ae-flash ae-flash--error">{t('quotes.loadFailed')}</p>
      </div>
    );
  }

  const title = quote.number ?? t('quotes.status.DRAFT');

  if (editing) {
    return (
      <div className="ae-page">
        <PageHero title={title} />
        <QuoteEditor
          quote={quote}
          onClose={() => setEditing(false)}
          onSaved={(held) => {
            setEditing(false);
            setFlash(held ? 'quotes.pendingInternalApproval' : null);
            void load();
          }}
        />
      </div>
    );
  }

  const manage = can('finance.quotes.manage');
  const closed = CLOSED.includes(quote.status);
  const pendingInternal = quote.internalApprovalStatus?.toUpperCase() === 'PENDING';

  /** Lapsed, or lapsing within three days — the window the system's own wording uses. */
  const validity = (() => {
    if (!quote.validUntil || closed) return null;
    const left = new Date(quote.validUntil).getTime() - Date.now();
    if (left < 0) return { tone: 'ae-badge-danger', text: t('quotes.expired') };
    if (left <= 3 * DAY) return { tone: 'ae-badge-warn', text: t('quotes.expiringSoon') };
    return null;
  })();

  const cur = quote.currencyCode;
  const fact = (label: string, value: React.ReactNode) => (
    <div>
      <p className="ae-stat-label">{label}</p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );

  return (
    <div className="ae-page">
      <PageHero
        title={title}
        actions={
          <div className="flex flex-wrap gap-2">
            {manage && !closed && (
              <button type="button" className="ae-btn-primary" onClick={() => setEditing(true)}>
                {t('common.edit')}
              </button>
            )}
            {manage && quote.status === 'SENT' && !pendingInternal && (
              <button type="button" className="ae-btn-secondary" disabled={busy}
                onClick={() => void setStatus('APPROVED')}>
                {t('portal.approve')}
              </button>
            )}
            {/* A rejected quote is reopened as a draft to be reworked. */}
            {manage && quote.status === 'REJECTED' && (
              <button type="button" className="ae-btn-secondary" disabled={busy}
                onClick={() => void setStatus('DRAFT')}>
                {t('quotes.reopen')}
              </button>
            )}
            {/* Converting is what an approved quote is for. */}
            {manage && quote.status === 'APPROVED' && (
              <button type="button" className="ae-btn-secondary" disabled={busy}
                onClick={() => void act('convert', 'quotes.confirmConvert')}>
                {t('quotes.convert')}
              </button>
            )}
            {manage && quote.status === 'APPROVED' && can('jobs.create', 'jobs.manage') && (
              <button type="button" className="ae-btn-secondary" disabled={busy}
                onClick={() => void act('create-job', 'quotes.confirmCreateJob')}>
                {t('quotes.createJob')}
              </button>
            )}
            {/* Revising replaces rather than rewrites, so it stays available after sending. */}
            {manage && !closed && quote.status !== 'DRAFT' && (
              <button type="button" className="ae-btn-ghost" disabled={busy}
                onClick={() => void act('new-version', 'quotes.confirmNewVersion')}>
                {t('quotes.newVersion')}
              </button>
            )}
            <button type="button" className="ae-btn-ghost" onClick={onBack}>{t('common.close')}</button>
          </div>
        }
      />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error)}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash)}</p>}

      {/* Held for sign-off: the status alone would read as an ordinary draft. */}
      {pendingInternal && (
        <p className="ae-flash ae-flash--warn mb-4">{t('quotes.pendingInternalApproval')}</p>
      )}
      {quote.status === 'SUPERSEDED' && quote.supersededById && (
        <p className="ae-flash ae-flash--warn mb-4">{t('quotes.status.SUPERSEDED')}</p>
      )}
      {quote.rejectionReason && (
        <p className="ae-flash ae-flash--error mb-4">{quote.rejectionReason}</p>
      )}

      <Panel className="ae-form-panel mb-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {fact(t('quotes.client'), quote.clientName ?? '—')}
          {fact(t('quotes.quoteDate'), <span dir="ltr">{quote.quoteDate}</span>)}
          {fact(
            t('quotes.validUntil'),
            <>
              <span dir="ltr">{quote.validUntil ?? '—'}</span>
              {validity && <span className={`ae-badge ${validity.tone} mt-1 block w-fit`}>{validity.text}</span>}
            </>,
          )}
          {fact(
            t('quotes.status'),
            <span className={`ae-badge ${STATUS_STYLE[quote.status]}`}>{t(`quotes.status.${quote.status}`)}</span>,
          )}
          {fact(t('invoices.taxMode'), t(`invoices.taxMode.${quote.taxMode}`))}
          {fact(t('invoices.currency'), <span dir="ltr">{cur}</span>)}
          {/* "نسخة جديدة" is the button that makes one; the number needs the noun. */}
          {quote.versionNumber != null && quote.versionNumber > 1
            && fact(t('quotes.version'), quote.versionNumber)}
          {quote.clientPhone && fact(t('party.phone'), <span dir="ltr">{quote.clientPhone}</span>)}
        </div>
        {quote.notes && (
          <p className="mt-4 whitespace-pre-wrap text-sm text-[var(--text-muted)]">{quote.notes}</p>
        )}
      </Panel>

      <Panel title={t('quotes.lines')} className="mb-4">
        <div className="ae-table-wrap">
          <table className="ae-table ae-table--rows">
            <thead>
              <tr>
                <th>{t('quotes.description')}</th>
                <th>{t('quotes.quantity')}</th>
                <th>{t('quotes.price')}</th>
                <th>{t('invoices.discount')}</th>
                <th>{t('invoices.lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {(quote.lines ?? []).map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td>{l.quantity}{l.unit ? ` ${l.unit}` : ''}</td>
                  <td>{money(l.unitPrice, cur)}</td>
                  <td>{l.discount > 0 ? money(l.discount, cur) : '—'}</td>
                  <td>{money(l.lineTotal, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-2 text-sm sm:ms-auto sm:w-72">
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">{t('invoices.subTotal')}</span>
            <span>{money(quote.subTotal, cur)}</span>
          </div>
          {quote.taxTotal !== 0 && (
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">{t('invoices.tax')}</span>
              <span>{money(quote.taxTotal, cur)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-[var(--border)] pt-2 font-bold">
            <span>{t('quotes.total')}</span>
            <span>{money(quote.totalAmount, cur)}</span>
          </div>
        </div>
      </Panel>

      {/* The link the client approves from — nothing reaches them until this is on. */}
      {manage && !closed && (
        <DocumentShare docType="quote" docId={quote.id}
          initial={{ shareToken: quote.shareToken, shareEnabled: quote.shareEnabled }} />
      )}

      {/* Only meaningful once the quote has actually been revised. */}
      {versions.length > 1 && (
        <Panel title={t('quotes.viewVersions')}>
          <ul className="space-y-2">
            {versions.map((v) => {
              const here = v.id === quote.id;
              const href = builtHref(`/quotes/?id=${v.id}`);
              const row = (
                <>
                  <span className="ae-dash-attention-label">
                    {t('quotes.version')} {v.versionNumber}
                    {v.number && <span dir="ltr"> · {v.number}</span>}
                  </span>
                  <span className="ae-dash-attention-detail">
                    {money(v.totalAmount, cur)} · {t(`quotes.status.${v.status}`)}
                  </span>
                </>
              );
              return (
                <li key={v.id}>
                  {here || !href
                    ? <span className="ae-dash-attention-row ae-dash-attention-row--info">{row}</span>
                    : <Link href={href} className="ae-dash-attention-row">{row}</Link>}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}
