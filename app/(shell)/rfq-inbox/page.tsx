'use client';

/**
 * طلبات عروض الأسعار — what came in through the front door.
 *
 * A stranger fills in the public form at /rfq, or a known client uses their portal link, and the
 * request lands here. It arrives with a ballpark estimate the server worked out from the shop's
 * first active paper and machine — a number to answer the phone with, not a quote.
 *
 * ── Three things a request can become ─────────────────────────────────────────────────────
 *
 * A CRM deal (raised automatically on submission, so the enquiry is already in the pipeline
 * before anyone opens this page), a work order, or a polite no. Converting to a job needs a real
 * client first: a request carries a name and a phone, not an account, and a job without one has
 * nowhere to send the invoice. The API refuses it, and so does this screen — by saying which
 * step is missing rather than by greying out a button with no explanation.
 *
 * ── The estimate is a ballpark and is labelled as one ─────────────────────────────────────
 *
 * `ae_rfq_quick_estimate` runs the real costing engine, but on defaults: the first paper in the
 * catalogue, the first machine, one piece per sheet, 5% waste, 20% profit. It is honest for a
 * first conversation and wrong for a quote, which is what التسعير is for.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { selectableParties } from '@/lib/parties';

type Rfq = {
  id: string; clientId: string | null; clientName: string | null;
  contactName: string; contactPhone: string | null; contactEmail: string | null;
  title: string; jobType: string;
  specs: Record<string, unknown> | null;
  estimateTotal: number | null;
  status: string; staffNotes: string | null;
  convertedJobId: string | null; dealId: string | null; sourceCode: string | null;
  createdAt: string;
};
type Client = { id: string; name: string; isActive?: boolean };

const STATUSES = ['NEW', 'REVIEWING', 'QUOTED', 'CONVERTED', 'DECLINED'] as const;
const STATUS_TONE: Record<string, string> = {
  NEW: 'ae-badge-info', REVIEWING: 'ae-badge-warn', QUOTED: 'ae-badge-warn',
  CONVERTED: 'ae-badge-success', DECLINED: 'ae-badge-muted',
};
/**
 * The spec keys the public form collects, in the order it asks for them, paired with the
 * dictionary key that names each. The two do not match one-for-one — the form asks for
 * "width" and stores `widthCm` — so the mapping is written out rather than derived.
 */
const SPEC_FIELDS: readonly (readonly [string, string])[] = [
  ['qty', 'rfqPublic.field.qty'],
  ['widthCm', 'rfqPublic.field.width'],
  ['heightCm', 'rfqPublic.field.height'],
  ['gsm', 'rfqPublic.field.gsm'],
  ['colors', 'rfqPublic.field.colors'],
];

export default function RfqInboxPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const manage = can('jobs.manage');

  const [items, setItems] = useState<Rfq[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  /** Per-request edits held locally until saved, so two rows can be worked on at once. */
  const [drafts, setDrafts] = useState<Record<string, { clientId: string; status: string; staffNotes: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([
        api<{ items?: Rfq[] }>(`/rfq${status ? `?status=${status}` : ''}`),
        api<Client[]>('/clients').catch(() => [] as Client[]),
      ]);
      setItems(r.items ?? []);
      setClients(Array.isArray(c) ? c : []);
      setDrafts({});
    } catch {
      setError('common.error');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency: 'EGP', maximumFractionDigits: 0,
    }).format(v),
    [lang],
  );
  const date = useCallback(
    (v: string) => new Date(v.replace(' ', 'T')).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB'),
    [lang],
  );
  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG').format(v),
    [lang],
  );

  async function call(path: string, method: 'POST' | 'PATCH', body?: Record<string, unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await api<Record<string, unknown>>(path, { method, ...(body ? { body } : {}) });
      if (ok) setFlash(ok);
      await load();
      return res;
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code ? `rfq.error.${code}` : 'common.error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const draftFor = (r: Rfq) => drafts[r.id] ?? {
    clientId: r.clientId ?? '', status: r.status, staffNotes: r.staffNotes ?? '',
  };

  /**
   * The client's own link, which remembers who they are and shows them their past requests.
   * Minted on demand rather than up front — a token that exists is a token that can leak.
   */
  async function copyPortalLink(clientId: string) {
    setError(null);
    try {
      const res = await api<{ portalToken?: string }>('/rfq/client-portal-link', {
        method: 'POST', body: { clientId },
      });
      if (!res.portalToken) return;
      await navigator.clipboard.writeText(`${window.location.origin}/rfq/?token=${res.portalToken}`);
      setFlash('rfq.portalLinkCopied');
    } catch {
      setError('common.error');
    }
  }

  if (loading) {
    return (
      <div className="ae-page">
        <PageHero title={t('rfq.title')} subtitle={t('rfq.subtitle')} />
        <Panel><Skeleton rows={6} /></Panel>
      </div>
    );
  }

  return (
    <div className="ae-page">
      <PageHero title={t('rfq.title')} subtitle={t('rfq.subtitle')}
        actions={(
          <button type="button" className="ae-btn-secondary text-xs"
            onClick={async () => {
              await navigator.clipboard.writeText(`${window.location.origin}/rfq/`);
              setFlash('rfq.copied');
            }}>
            {t('rfq.copyPublicLink')}
          </button>
        )} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash)}</p>}

      <p className="mb-4 text-xs text-[var(--text-muted)]">
        {t('rfq.publicLink')}: <code>{typeof window !== 'undefined' ? `${window.location.origin}/rfq/` : '/rfq/'}</code>
      </p>

      <div className="ae-tab-pills mb-4">
        <button type="button" className={`ae-tab-pill ${status === '' ? 'is-active' : ''}`}
          onClick={() => setStatus('')}>{t('rfq.filterAll')}</button>
        {STATUSES.map((s) => (
          <button key={s} type="button" className={`ae-tab-pill ${status === s ? 'is-active' : ''}`}
            onClick={() => setStatus(s)}>{t(`rfq.status.${s}`)}</button>
        ))}
      </div>

      {items.length === 0 ? (
        <Panel><p className="text-sm text-[var(--text-muted)]">{t('rfq.empty')}</p></Panel>
      ) : (
        <div className="grid gap-4">
          {items.map((r) => {
            const d = draftFor(r);
            const dirty = d.clientId !== (r.clientId ?? '') || d.status !== r.status
              || d.staffNotes !== (r.staffNotes ?? '');
            return (
              <Panel key={r.id} title={r.title}
                actions={(
                  <span className={`ae-badge ${STATUS_TONE[r.status] ?? 'ae-badge-muted'} text-xs`}>
                    {t(`rfq.status.${r.status}`, r.status)}
                  </span>
                )}>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="grid gap-1 text-sm">
                    <span className="font-bold">{t('rfq.contact')}</span>
                    <span>{r.contactName}</span>
                    {r.contactPhone && <a href={`tel:${r.contactPhone}`} className="underline">{r.contactPhone}</a>}
                    {r.contactEmail && <a href={`mailto:${r.contactEmail}`} className="underline">{r.contactEmail}</a>}
                    <span className="text-xs text-[var(--text-muted)]">{date(r.createdAt)}</span>
                    {r.sourceCode && (
                      <span className="text-xs text-[var(--text-muted)]">{t('followup.source')}: {r.sourceCode}</span>
                    )}
                  </div>

                  <div className="grid gap-1 text-sm">
                    <span className="font-bold">{t('rfq.estimate')}</span>
                    {r.estimateTotal !== null ? (
                      <>
                        <span className="text-lg font-bold">{money(r.estimateTotal)}</span>
                        {/* Said every time it is shown, because a number on a screen becomes a
                            promise the moment someone reads it down the phone. */}
                        <span className="text-xs text-[var(--text-muted)]">{t('rfq.estimateBallpark')}</span>
                      </>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">{t('rfq.noEstimate')}</span>
                    )}
                    {r.specs && (
                      <span className="text-xs">
                        {SPEC_FIELDS.filter(([k]) => r.specs?.[k] !== undefined && r.specs?.[k] !== '')
                          .map(([k, label]) => `${t(label)}: ${num(Number(r.specs?.[k]))}`)
                          .join(' · ')}
                      </span>
                    )}
                  </div>
                </div>

                {manage && (
                  <div className="ae-section-card mt-3 grid gap-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-sm">
                        <span className="mb-1 block font-bold">{t('rfq.matchClient')}</span>
                        <select className="ae-input" value={d.clientId}
                          onChange={(e) => setDrafts({ ...drafts, [r.id]: { ...d, clientId: e.target.value } })}>
                          <option value="">{t('rfq.selectClient')}</option>
                          {selectableParties(clients, d.clientId).map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block font-bold">{t('purchaseOrders.status')}</span>
                        <select className="ae-input" value={d.status}
                          onChange={(e) => setDrafts({ ...drafts, [r.id]: { ...d, status: e.target.value } })}>
                          {STATUSES.map((s) => <option key={s} value={s}>{t(`rfq.status.${s}`)}</option>)}
                        </select>
                      </label>
                    </div>
                    <label className="text-sm">
                      <span className="mb-1 block font-bold">{t('rfq.notes')}</span>
                      <textarea className="ae-input" rows={2} value={d.staffNotes}
                        onChange={(e) => setDrafts({ ...drafts, [r.id]: { ...d, staffNotes: e.target.value } })} />
                    </label>

                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="ae-btn-secondary text-xs" disabled={busy || !dirty}
                        onClick={() => void call(`/rfq/${r.id}`, 'PATCH', {
                          clientId: d.clientId, status: d.status, staffNotes: d.staffNotes.trim() || null,
                        }, 'common.success')}>
                        {t('rfq.save')}
                      </button>

                      {r.convertedJobId ? (
                        <Link href={`/jobs?id=${r.convertedJobId}`} className="ae-btn-ghost px-3 py-1 text-xs">
                          {t('rfq.openJob')}
                        </Link>
                      ) : (
                        <button type="button" className="ae-btn-primary text-xs" disabled={busy}
                          onClick={() => {
                            // The API refuses this without a client; saying which step is
                            // missing beats a button that does nothing when pressed.
                            if (!r.clientId) { setError('rfq.convertNeedsClient'); return; }
                            void call(`/rfq/${r.id}/convert`, 'POST', {}, 'rfq.converted');
                          }}>
                          {t('rfq.convert')}
                        </button>
                      )}

                      {r.dealId ? (
                        <Link href="/follow-up" className="ae-btn-ghost px-3 py-1 text-xs">
                          {t('rfq.openDeal')}
                        </Link>
                      ) : (
                        <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                          onClick={() => void call(`/rfq/${r.id}/create-deal`, 'POST', {}, 'rfq.dealCreated')}>
                          {t('rfq.createDeal')}
                        </button>
                      )}

                      {r.clientId && can('clients.manage') && (
                        <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                          onClick={() => void copyPortalLink(r.clientId!)}>
                          {t('rfq.copyPortalLink')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
