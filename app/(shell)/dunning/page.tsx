'use client';

/**
 * تذكيرات السداد — chasing what is owed, in stages.
 *
 * An overdue invoice is not one event, it is an escalation: a polite note at seven days, a
 * firmer one at thirty, something else at sixty. The stages are configured once and then every
 * overdue invoice climbs them on its own schedule, which is the difference between a collections
 * process and someone remembering to send emails.
 *
 * ── The stage is the server's decision ────────────────────────────────────────────────────
 *
 * A reminder is sent at a stage, not just to an invoice. The bulk endpoint works out which stage
 * each invoice has reached — the highest active rule whose day count the invoice has passed —
 * and refuses with `no_stage` when it has passed none. This page sends in bulk for exactly that
 * reason rather than sending one at a time with a stage of its own choosing: two places deciding
 * which reminder someone gets is how a client receives the sixty-day letter on day eight.
 *
 * ── Sending is outward-facing ─────────────────────────────────────────────────────────────
 *
 * Every send here puts a message in front of a client, so it asks first and reports what
 * actually happened — `sent` and `failed` separately, because a bulk run that half worked is
 * neither a success nor a failure and saying "done" would hide the half that did not.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

type Candidate = {
  invoiceId: string; invoiceNumber: string | null; clientId: string; clientName: string;
  clientEmail: string | null; clientPhone: string | null; dueDate: string;
  currencyCode: string; remainingAmount: number; daysOverdue: number; lastStageSent: number | null;
};
type Rule = { id: string; daysOverdue: number; active: boolean; subject: string; body: string };
type LogRow = {
  id: string; invoiceId: string; invoiceNumber: string | null; clientName: string;
  stageDays: number; channel: string; status: string; error: string | null; sentAt: string;
};

type Tab = 'candidates' | 'rules' | 'log';

export default function DunningPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const manage = can('finance.invoices.manage');

  const [tab, setTab] = useState<Tab>('candidates');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, r, l] = await Promise.all([
        api<{ items?: Candidate[] }>('/dunning/candidates'),
        api<{ items?: Rule[] }>('/dunning/rules'),
        api<{ items?: LogRow[] }>('/dunning/log?limit=100'),
      ]);
      setCandidates(c.items ?? []);
      setRules(r.items ?? []);
      setLog(l.items ?? []);
    } catch {
      setError('common.error');
    } finally {
      setLoading(false);
    }
  }, []);

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
    (v: string) => new Date(v).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB'),
    [lang],
  );
  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG').format(v),
    [lang],
  );

  const pickedIds = useMemo(
    () => candidates.filter((c) => picked[c.invoiceId]).map((c) => c.invoiceId),
    [candidates, picked],
  );

  /**
   * Which stage an invoice has reached — the highest active rule it has passed. Shown so the
   * row says what would be sent before anyone sends it; the server decides the same way and
   * has the final word.
   */
  const stageFor = useCallback((daysOverdue: number): number | null => {
    const passed = rules.filter((r) => r.active && r.daysOverdue <= daysOverdue);
    return passed.length ? Math.max(...passed.map((r) => r.daysOverdue)) : null;
  }, [rules]);

  async function sendBulk() {
    if (pickedIds.length === 0) return;
    if (!window.confirm(t('dunning.sendBulk', { count: String(pickedIds.length) }))) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await api<{ sent: number; failed: number }>('/dunning/send/bulk', {
        method: 'POST',
        body: { invoiceIds: pickedIds },
      });
      // A partial run is reported as a partial run.
      setFlash(t('dunning.bulkResult', { sent: String(res.sent), failed: String(res.failed) }));
      setPicked({});
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code ? `dunning.error.${code}` : 'common.error');
    } finally {
      setBusy(false);
    }
  }

  /**
   * WhatsApp is a fallback for clients with no email on file. Nothing is sent from the server —
   * it opens a chat per client with the amount and due date, and the person clicking sends it.
   */
  function whatsappBulk() {
    const withPhone = candidates.filter((c) => picked[c.invoiceId] && c.clientPhone);
    if (withPhone.length === 0) {
      setError('dunning.noPhoneSelected');
      return;
    }
    if (!window.confirm(t('dunning.whatsappBulk'))) return;
    for (const c of withPhone) {
      const text = `${c.clientName} — ${t('invoices.number')} ${c.invoiceNumber ?? ''}`
        + ` · ${money(c.remainingAmount, c.currencyCode)}`
        + ` · ${t('dunning.due')} ${date(c.dueDate)}`
        + ` · ${num(c.daysOverdue)} ${t('dunning.daysOverdue')}`;
      window.open(
        `https://wa.me/${(c.clientPhone ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`,
        '_blank', 'noopener',
      );
    }
    setFlash(t('dunning.whatsappOpened', { n: String(withPhone.length) }));
  }

  async function saveRules() {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await api<{ items?: Rule[] }>('/dunning/rules', {
        method: 'POST',
        body: { items: rules.map((r) => ({ ...r, daysOverdue: Number(r.daysOverdue) })) },
      });
      setRules(res.items ?? rules);
      setFlash('dunning.rulesSaved');
    } catch {
      setError('common.error');
    } finally {
      setBusy(false);
    }
  }

  const setRule = (i: number, patch: Partial<Rule>) =>
    setRules((rs) => rs.map((r, x) => (x === i ? { ...r, ...patch } : r)));

  if (loading) {
    return (
      <div className="ae-page">
        <PageHero title={t('dunning.title')} subtitle={t('dunning.subtitle')} />
        <Panel><Skeleton rows={6} /></Panel>
      </div>
    );
  }

  return (
    <div className="ae-page">
      <PageHero title={t('dunning.title')} subtitle={t('dunning.subtitle')} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash, flash)}</p>}

      <div className="ae-tab-pills mb-4">
        {(['candidates', 'rules', 'log'] as const).map((k) => (
          <button key={k} type="button" className={`ae-tab-pill ${tab === k ? 'is-active' : ''}`}
            onClick={() => { setTab(k); setError(null); setFlash(null); }}>
            {t(`dunning.tab.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'candidates' && (
        <Panel>
          {candidates.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('dunning.noOverdue')}</p>
          ) : (
            <>
              {manage && (
                <div className="ae-toolbar mb-3 flex flex-wrap gap-2">
                  <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                    onClick={() => setPicked(Object.fromEntries(candidates.map((c) => [c.invoiceId, true])))}>
                    {t('dunning.selectAll')}
                  </button>
                  <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                    onClick={() => setPicked({})}>
                    {t('dunning.deselectAll')}
                  </button>
                  <button type="button" className="ae-btn-primary"
                    disabled={busy || pickedIds.length === 0} onClick={() => void sendBulk()}>
                    {t('dunning.sendBulk', { count: String(pickedIds.length) })}
                  </button>
                  <button type="button" className="ae-btn-secondary"
                    disabled={busy || pickedIds.length === 0} onClick={whatsappBulk}>
                    {t('dunning.whatsappBulk')}
                  </button>
                </div>
              )}

              <div className="ae-table-wrap">
                <table className="ae-table">
                  <thead>
                    <tr>
                      {manage && <th aria-label={t('dunning.selectAll')} />}
                      <th>{t('invoices.number')}</th>
                      <th>{t('quotes.client')}</th>
                      <th>{t('invoices.remaining')}</th>
                      <th>{t('dunning.due')}</th>
                      <th>{t('dunning.daysOverdue')}</th>
                      <th>{t('dunning.stage')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => {
                      const stage = stageFor(c.daysOverdue);
                      return (
                        <tr key={c.invoiceId}>
                          {manage && (
                            <td>
                              <input type="checkbox" checked={picked[c.invoiceId] === true}
                                onChange={(e) => setPicked({ ...picked, [c.invoiceId]: e.target.checked })} />
                            </td>
                          )}
                          <td>
                            <Link href={`/invoices?id=${c.invoiceId}`} className="font-bold underline">
                              {c.invoiceNumber ?? '—'}
                            </Link>
                          </td>
                          <td>
                            {c.clientName}
                            {/* No email is the reason a send will fail, so it is said here
                                rather than discovered in the failure count afterwards. */}
                            {!c.clientEmail && (
                              <span className="block text-xs text-[var(--text-muted)]">{t('dunning.noEmail')}</span>
                            )}
                          </td>
                          <td className="font-bold">{money(c.remainingAmount, c.currencyCode)}</td>
                          <td className="text-xs">{date(c.dueDate)}</td>
                          <td>{num(c.daysOverdue)}</td>
                          <td className="text-xs">
                            {stage === null
                              ? <span className="text-[var(--text-muted)]">{t('dunning.noStage')}</span>
                              : (
                                <>
                                  {t('dunning.stage')} {num(stage)}
                                  {c.lastStageSent !== null && (
                                    <span className="block text-[var(--text-muted)]">
                                      {t('dunning.lastSent')} {num(c.lastStageSent)}
                                    </span>
                                  )}
                                </>
                              )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
      )}

      {tab === 'rules' && (
        <Panel>
          <p className="mb-3 text-xs text-[var(--text-muted)]">{t('dunning.templateHint')}</p>
          <div className="grid gap-4">
            {rules.map((r, i) => (
              <div key={r.id} className="ae-section-card grid gap-3">
                <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
                  <label className="text-sm">
                    <span className="mb-1 block font-bold">{t('dunning.afterDays')}</span>
                    <input type="number" min="0" step="1" className="ae-input" disabled={!manage}
                      value={r.daysOverdue}
                      onChange={(e) => setRule(i, { daysOverdue: Number(e.target.value) })} />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-bold">{t('dunning.subject')}</span>
                    <input className="ae-input" disabled={!manage} value={r.subject}
                      onChange={(e) => setRule(i, { subject: e.target.value })} />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" disabled={!manage} checked={r.active}
                      onChange={(e) => setRule(i, { active: e.target.checked })} />
                    <span>{t('dunning.active')}</span>
                  </label>
                </div>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('dunning.body')}</span>
                  <textarea className="ae-input" rows={4} disabled={!manage} value={r.body}
                    onChange={(e) => setRule(i, { body: e.target.value })} />
                </label>
                {manage && (
                  <button type="button" className="ae-btn-ghost self-start px-3 py-1 text-xs"
                    onClick={() => setRules(rules.filter((_, x) => x !== i))}>
                    {t('common.delete')}
                  </button>
                )}
              </div>
            ))}
          </div>

          {manage && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="ae-btn-secondary text-xs"
                onClick={() => setRules([...rules, {
                  id: '', daysOverdue: 0, active: true, subject: '', body: '',
                }])}>
                {t('dunning.addStage')}
              </button>
              <button type="button" className="ae-btn-primary" disabled={busy} onClick={() => void saveRules()}>
                {t('dunning.saveRules')}
              </button>
            </div>
          )}
        </Panel>
      )}

      {tab === 'log' && (
        <Panel>
          {log.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('dunning.noLog')}</p>
          ) : (
            <div className="ae-table-wrap">
              <table className="ae-table">
                <thead>
                  <tr>
                    <th>{t('invoices.number')}</th>
                    <th>{t('quotes.client')}</th>
                    <th>{t('dunning.stage')}</th>
                    <th>{t('invoices.status')}</th>
                    <th>{t('common.lastUpdated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <Link href={`/invoices?id=${l.invoiceId}`} className="font-bold underline">
                          {l.invoiceNumber ?? '—'}
                        </Link>
                      </td>
                      <td>{l.clientName}</td>
                      <td>{num(l.stageDays)}</td>
                      <td className="text-xs">
                        {t(l.status === 'SENT' ? 'dunning.statusSent' : 'dunning.statusFailed')}
                        {/* The reason a send failed is the only thing that makes the row
                            actionable — an unexplained failure just gets retried forever. */}
                        {l.error && (
                          <span className="block text-[var(--text-muted)]">
                            {t(`dunning.error.${l.error}`, l.error)}
                          </span>
                        )}
                      </td>
                      <td className="text-xs">{date(l.sentAt)}</td>
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
