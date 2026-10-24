'use client';

/**
 * طلب عرض سعر — the front door.
 *
 * The third public page, and the only one anybody can reach without a link somebody sent them.
 * A stranger fills it in and gets a price back before the tab closes; the request lands in
 * طلبات عروض الأسعار and, on the server's own initiative, in the CRM pipeline as a lead.
 *
 * ── The instant estimate is the whole point ───────────────────────────────────────────────
 *
 * A print enquiry that ends with "we'll get back to you" mostly ends. So the submission returns
 * a real number, costed by the same engine the shop quotes with — on defaults, but real. It is
 * labelled as مبدئي on the screen the customer reads, because it will move once someone picks
 * the actual paper.
 *
 * If the shop has no paper or machine in its catalogue the estimate comes back null. The form
 * still works and still records the enquiry; it just says the team will be in touch, rather
 * than showing a confident zero.
 *
 * ── ?token= turns a stranger into a customer ──────────────────────────────────────────────
 *
 * A client's portal token pre-fills their details, attaches the request to their account, and
 * shows what they have asked for before. Without one the page is anonymous, which is the
 * default and has to keep working — most people arrive from a business card.
 *
 * The palette is the tenant's client-facing one, scoped here: the root layout is shared with
 * the dark authenticated app and has nothing to do with a page a customer sees.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_BASE } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type Appearance = { accent?: string; bg?: string; surface?: string; text?: string; textMuted?: string };
type Company = { name?: string; phone?: string; email?: string; logoUrl?: string };
type PastRequest = { id: string; title: string; status: string; estimateTotal: number | null; createdAt: string };

type Bootstrap = {
  ok: boolean;
  company?: Company;
  appearance?: Appearance;
  client?: { name: string; phone: string | null; email: string | null } | null;
  items?: PastRequest[];
};

type Submitted = { title: string; estimateTotal: number | null };

const SPEC_FIELDS = [
  { key: 'qty', label: 'rfqPublic.field.qty' },
  { key: 'widthCm', label: 'rfqPublic.field.width' },
  { key: 'heightCm', label: 'rfqPublic.field.height' },
  { key: 'gsm', label: 'rfqPublic.field.gsm' },
  { key: 'colors', label: 'rfqPublic.field.colors' },
] as const;

function RfqForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const tenant = params.get('tenant') ?? 'sys';
  const { t, lang } = useI18n();

  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Submitted | null>(null);

  const [form, setForm] = useState({ contactName: '', contactPhone: '', contactEmail: '', title: '' });
  const [specs, setSpecs] = useState<Record<string, string>>({ colors: '4' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ tenant });
      if (token) q.set('token', token);
      const res = await fetch(`${API_BASE}/public/rfq?${q}`);
      const json = (await res.json()) as Bootstrap;
      setData(json);
      // A recognised token means we already know who this is; asking again is rude.
      if (json.client) {
        setForm((f) => ({
          ...f,
          contactName: json.client?.name ?? '',
          contactPhone: json.client?.phone ?? '',
          contactEmail: json.client?.email ?? '',
        }));
      }
    } catch {
      setError('rfqPublic.error.network');
    } finally {
      setLoading(false);
    }
  }, [tenant, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const a = data?.appearance;
  const skin: React.CSSProperties = {
    ['--p-accent' as string]: a?.accent ?? '#0c8ee6',
    ['--p-bg' as string]: a?.bg ?? '#f1f5f9',
    ['--p-surface' as string]: a?.surface ?? '#ffffff',
    ['--p-text' as string]: a?.text ?? '#0f172a',
    ['--p-muted' as string]: a?.textMuted ?? '#64748b',
    background: 'var(--p-bg)',
    color: 'var(--p-text)',
    minHeight: '100dvh',
  };

  const money = (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
    style: 'currency', currency: 'EGP', maximumFractionDigits: 0,
  }).format(v);

  async function submit() {
    if (form.contactName.trim() === '' || form.title.trim() === '') {
      setError('rfqPublic.error.nameAndTitle');
      return;
    }
    if (form.contactPhone.trim() === '' && form.contactEmail.trim() === '') {
      setError('rfqPublic.error.contact');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/public/rfq`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantSlug: tenant,
          portalToken: token || undefined,
          contactName: form.contactName.trim(),
          contactPhone: form.contactPhone.trim() || null,
          contactEmail: form.contactEmail.trim() || null,
          title: form.title.trim(),
          jobType: 'print',
          // Only what was actually filled in — a blank field is not a zero, and sending it as
          // one would have the estimator cost a job with no paper weight.
          specs: Object.fromEntries(
            Object.entries(specs).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]),
          ),
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; item?: { title: string; estimateTotal: number | null } };
      if (!json.ok || !json.item) {
        setError(json.error === 'phone_or_email_required' ? 'rfqPublic.error.contact'
          : json.error === 'contact_name_and_title_required' ? 'rfqPublic.error.nameAndTitle'
          : 'rfqPublic.error.submit');
        return;
      }
      setDone({ title: json.item.title, estimateTotal: json.item.estimateTotal });
    } catch {
      setError('rfqPublic.error.network');
    } finally {
      setBusy(false);
    }
  }

  const card: React.CSSProperties = {
    background: 'var(--p-surface)',
    borderRadius: '0.75rem',
    padding: '1.25rem',
  };
  const field: React.CSSProperties = {
    width: '100%', padding: '0.55rem 0.75rem', borderRadius: '0.5rem',
    border: '1px solid rgba(128,128,128,0.35)', background: 'var(--p-surface)', color: 'var(--p-text)',
  };

  if (loading) {
    return <main style={skin} className="grid place-items-center p-6">
      <p style={{ color: 'var(--p-muted)' }}>{t('rfqPublic.loading')}</p>
    </main>;
  }

  if (done) {
    return (
      <main style={skin} className="p-6">
        <div className="mx-auto grid max-w-xl gap-4" style={card}>
          <h1 className="text-xl font-bold">{t('rfqPublic.submittedTitle')}</h1>
          <p>{done.title}</p>
          {done.estimateTotal !== null ? (
            <>
              <p className="text-2xl font-bold" style={{ color: 'var(--p-accent)' }}>
                {money(done.estimateTotal)}
              </p>
              <p className="text-sm" style={{ color: 'var(--p-muted)' }}>{t('rfqPublic.estimateLabel')}</p>
            </>
          ) : null}
          {/* No catalogue to cost against still records the enquiry; either way this is what
              happens next, so it is said once rather than twice. */}
          <p className="text-sm" style={{ color: 'var(--p-muted)' }}>{t('rfqPublic.willContact')}</p>
        </div>
      </main>
    );
  }

  return (
    <main style={skin} className="p-4 sm:p-6">
      <div className="mx-auto grid max-w-2xl gap-4">
        <header className="grid gap-1">
          <h1 className="text-2xl font-bold">{data?.company?.name ?? t('rfqPublic.title')}</h1>
          <p style={{ color: 'var(--p-muted)' }}>
            {data?.client
              ? t('rfqPublic.greeting', { name: data.client.name })
              : t('rfqPublic.subtitle')}
          </p>
        </header>

        {error && (
          <p style={{ ...card, color: '#b91c1c', padding: '0.75rem 1rem' }}>{t(error)}</p>
        )}

        <section style={card} className="grid gap-3">
          <h2 className="text-sm font-bold">{t('rfqPublic.section.contact')}</h2>
          <label className="grid gap-1 text-sm">
            <span className="font-bold">{t('rfqPublic.field.name')}</span>
            <input style={field} value={form.contactName}
              onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-bold">{t('rfqPublic.field.phone')}</span>
              <input style={field} inputMode="tel" value={form.contactPhone}
                onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold">{t('rfqPublic.field.email')}</span>
              <input style={field} type="email" value={form.contactEmail}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
            </label>
          </div>
        </section>

        <section style={card} className="grid gap-3">
          <h2 className="text-sm font-bold">{t('rfqPublic.section.request')}</h2>
          <label className="grid gap-1 text-sm">
            <span className="font-bold">{t('rfqPublic.field.title')}</span>
            <input style={field} value={form.title} placeholder={t('rfqPublic.field.titlePlaceholder')}
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            {SPEC_FIELDS.map((f) => (
              <label key={f.key} className="grid gap-1 text-sm">
                <span className="font-bold">{t(f.label)}</span>
                <input style={field} type="number" min="0" step="any" inputMode="numeric"
                  value={specs[f.key] ?? ''}
                  onChange={(e) => setSpecs({ ...specs, [f.key]: e.target.value })} />
              </label>
            ))}
          </div>
          <button type="button" disabled={busy} onClick={() => void submit()}
            style={{
              background: 'var(--p-accent)', color: '#fff', padding: '0.65rem 1rem',
              borderRadius: '0.5rem', fontWeight: 700, opacity: busy ? 0.6 : 1,
            }}>
            {busy ? t('rfqPublic.submitting') : t('rfqPublic.submit')}
          </button>
        </section>

        {/* Only for a recognised client — an anonymous visitor has no history to show. */}
        {data?.items && data.items.length > 0 && (
          <section style={card} className="grid gap-2">
            <h2 className="text-sm font-bold">{t('rfqPublic.previousRequests')}</h2>
            {data.items.map((r) => (
              <div key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span>{r.title}</span>
                <span style={{ color: 'var(--p-muted)' }}>
                  {t(`rfqPublic.status.${r.status}`, r.status)}
                  {r.estimateTotal !== null && ` · ${money(r.estimateTotal)}`}
                </span>
              </div>
            ))}
          </section>
        )}

        {data?.company && (data.company.phone || data.company.email) && (
          <footer className="text-center text-xs" style={{ color: 'var(--p-muted)' }}>
            {[data.company.phone, data.company.email].filter(Boolean).join(' · ')}
          </footer>
        )}
      </div>
    </main>
  );
}

/** useSearchParams needs a Suspense boundary in a static export. */
export default function RfqPublicPage() {
  return (
    <Suspense fallback={null}>
      <RfqForm />
    </Suspense>
  );
}
