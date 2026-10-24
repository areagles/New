'use client';

/**
 * الإحاطة الصباحية — the short list of things that will go wrong today if nobody touches them.
 *
 * The dashboard already shows this briefing as one panel among many. This page is the same
 * briefing with nothing else on the screen, which is the point: it is what you open at eight in
 * the morning before the day starts making decisions for you.
 *
 * ── An empty briefing is the good outcome ─────────────────────────────────────────────────
 *
 * The server only returns items that need doing — overdue invoices, cheques due today, approvals
 * waiting, jobs past their date — and returns nothing at all when there are none. So the empty
 * state here is not "no data yet", it is "nothing is on fire", and it says so.
 *
 * ── Sending it on ─────────────────────────────────────────────────────────────────────────
 *
 * Two ways out: an email digest the server composes and sends, and a WhatsApp message the server
 * composes and this page opens. Both are outward-facing, so both ask first — an accidental click
 * should not put a briefing in front of the owner's phone at midnight.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { builtHref } from '@/lib/built';

type Item = { id: string; tone: string; count: number; href: string | null; actionKey: string };
type Briefing = { asOf: string; items: Item[] };
type Owner = { whatsapp?: { phones: string[]; message: string; hasUrgent: boolean } };

const TONE_ICON: Record<string, string> = {
  danger: '🔴', warn: '🟠', info: '🔵', success: '🟢',
};

export default function MorningPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const [data, setData] = useState<Briefing | null>(null);
  const [wa, setWa] = useState<Owner['whatsapp'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<Briefing>('/dashboard/morning');
      setData(d);
      // The WhatsApp text is composed by the owner endpoint; without that permission the
      // briefing still works and only the send button goes away.
      if (can('settings.manage') || can('identity.users.manage')) {
        const o = await api<Owner>('/owner/kpis').catch(() => null);
        setWa(o?.whatsapp ?? null);
      }
    } catch {
      setError('morning.loadFailed');
    } finally {
      setLoading(false);
    }
  }, [can]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendEmail() {
    if (!window.confirm(t('owner.email.send'))) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await api<{ sent?: number; recipients?: number }>('/alerts/morning-email', { method: 'POST' });
      setFlash(t('owner.email.sent', { n: String(res.sent ?? res.recipients ?? 0) }));
    } catch (err) {
      setError(err instanceof ApiError ? 'owner.email.failed' : 'common.error');
    } finally {
      setBusy(false);
    }
  }

  /**
   * The message is the server's, not this page's — it opens wa.me with text the API composed,
   * so what reaches the owner's phone is the same briefing the screen shows.
   */
  function sendWhatsapp() {
    if (!wa || wa.phones.length === 0) {
      setError('owner.wa.noPhones');
      return;
    }
    if (!wa.hasUrgent) {
      setError('owner.wa.noUrgent');
      return;
    }
    if (!window.confirm(t('owner.wa.send'))) return;
    for (const phone of wa.phones) {
      window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(wa.message)}`, '_blank', 'noopener');
    }
    setFlash(t('owner.wa.opened', { n: String(wa.phones.length) }));
  }

  const items = data?.items ?? [];

  return (
    <div className="ae-page">
      <PageHero title={t('morning.title')} subtitle={t('morning.subtitle')} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{flash}</p>}

      {loading ? (
        <Panel><Skeleton rows={5} /></Panel>
      ) : (
        <>
          <Panel title={t('morning.actionsTitle')}>
            <p className="mb-3 text-xs text-[var(--text-muted)]">
              {t('morning.asOf')} {data?.asOf
                ? new Date(data.asOf).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')
                : '—'}
            </p>

            {items.length === 0 ? (
              /* Nothing returned means nothing needs doing — stated as the result it is. */
              <div className="ae-dash-clear-pill">
                <strong className="block">{t('morning.allClear')}</strong>
                <span className="text-xs">{t('morning.allClearHint')}</span>
              </div>
            ) : (
              <ul className="ae-dash-attention">
                {items.map((it) => {
                  const to = builtHref(it.href);
                  const row = (
                    <>
                      <span aria-hidden>{TONE_ICON[it.tone] ?? '•'}</span>
                      <span className="ae-dash-attention-label">{t(it.actionKey)}</span>
                      <span className="ae-dash-attention-detail">{it.count}</span>
                      {to && <span className="ae-dash-chevron" aria-hidden>←</span>}
                    </>
                  );
                  const cls = `ae-dash-attention-row${it.tone === 'info' ? ' ae-dash-attention-row--info' : it.tone === 'warn' ? ' ae-dash-attention-row--warn' : ''}`;
                  return (
                    <li key={it.id}>
                      {/* An unbuilt destination is shown without a link rather than as a dead
                          one — the count still tells you the item is waiting. */}
                      {to
                        ? <Link href={to} className={cls}>{row}</Link>
                        : <span className={cls}>{row}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {(can('settings.manage') || can('identity.users.manage')) && (
            <Panel className="mt-4">
              <div className="flex flex-wrap gap-2">
                <button type="button" className="ae-btn-secondary" disabled={busy}
                  onClick={() => void sendEmail()}>
                  {t('owner.email.send')}
                </button>
                <button type="button" className="ae-btn-ghost" disabled={busy || !wa?.hasUrgent}
                  onClick={sendWhatsapp}>
                  {t('owner.wa.send')}
                </button>
              </div>
              <p className="mt-2 text-xs text-[var(--text-muted)]">{t('owner.wa.hint')}</p>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
