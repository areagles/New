'use client';

/**
 * Settings.
 *
 * The API exposes about forty settings endpoints across twenty sections — company, portal,
 * payment methods and gateway, tax, numbering, tax types, ETA and its e-seal and outbox,
 * backups, security, alerts, appearance, locale, exchange, HR, jobs, sales, accounting. Each
 * is a screen's worth of decisions, and putting all of them behind one page would produce a
 * form nobody could find anything in.
 *
 * So this covers the five that everything else already visibly depends on:
 *
 *   company, because every document sent to a client is currently headed "Arab Eagles" with no
 *   logo, address or tax number; the client portal, because its two switches decide whether a
 *   shared quote can be approved and — with more consequence than it looks — whether an invoice
 *   can be settled from a link; payment methods, without which the portal's payment section has
 *   nothing to offer; the tax rates, which price every invoice; and the quote approval
 *   threshold, which silently turns a large quote into a pending draft.
 *
 * Each tab saves through its own endpoint, so a failure in one leaves the others alone, and
 * each says what it saved rather than sharing a single anonymous "done".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiUpload, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

type Company = {
  name: string; legalName: string; logoUrl: string; address: string;
  phone: string; secondaryPhone: string; email: string; website: string;
  taxId: string; commercialNumber: string;
};

type Portal = { clientPreviewEnabled: boolean; paymentEnabled: boolean; approvalEnabled: boolean };

type PaymentMethod = {
  id: string; type: 'BANK' | 'WALLET' | 'LINK'; label: string; details: string; isActive: boolean;
};

type Tax = {
  vatEnabled: boolean; vatRate: number;
  withholdingEnabled: boolean; withholdingRate: number;
  withholdingRates: Record<string, number>;
};

type Settings = { company: Company; portal: Portal; paymentMethods: PaymentMethod[]; tax: Tax };

const TABS = [
  { key: 'company', label: 'settings.companyTab' },
  { key: 'portal', label: 'settings.portalTab' },
  { key: 'payment', label: 'settings.paymentTab' },
  { key: 'tax', label: 'settings.taxTab' },
  { key: 'quotes', label: 'quotes.title' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const COMPANY_FIELDS: [keyof Company, string][] = [
  ['name', 'settings.companyName'],
  ['legalName', 'settings.legalName'],
  ['taxId', 'settings.taxId'],
  ['commercialNumber', 'settings.commercialNumber'],
  ['phone', 'settings.companyPhone'],
  ['secondaryPhone', 'settings.secondaryPhone'],
  ['email', 'settings.companyEmail'],
  ['website', 'settings.website'],
  ['address', 'settings.address'],
];

const WITHHOLDING_KEYS = ['goods', 'services', 'professional', 'rent'] as const;

export default function SettingsPage() {
  const { t } = useI18n();
  const { can } = useSession();

  const [tab, setTab] = useState<TabKey>('company');
  const [data, setData] = useState<Settings | null>(null);
  const [threshold, setThreshold] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, q] = await Promise.all([
        api<{ settings?: Settings } & Partial<Settings>>('/settings'),
        api<{ threshold?: number }>('/quotes/internal-approval-settings').catch(() => null),
      ]);
      const settings = (s.settings ?? s) as Settings;
      setData({
        company: settings.company,
        portal: settings.portal,
        paymentMethods: settings.paymentMethods ?? [],
        tax: settings.tax,
      });
      if (q?.threshold != null) setThreshold(String(q.threshold));
    } catch (err) {
      setError(err instanceof ApiError ? 'common.error' : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Each section answers for itself, so a failure names the section that failed. */
  async function save(section: TabKey) {
    if (!data) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      if (section === 'company') {
        await api('/settings/company', { method: 'PATCH', body: data.company });
        setFlash('settings.companySaved');
      } else if (section === 'portal') {
        await api('/settings/portal', { method: 'PATCH', body: data.portal });
        setFlash('settings.portalSaved');
      } else if (section === 'payment') {
        await api('/settings/payment-methods', { method: 'PATCH', body: { paymentMethods: data.paymentMethods } });
        setFlash('settings.paymentSaved');
      } else if (section === 'tax') {
        await api('/settings/tax', { method: 'PATCH', body: data.tax });
        setFlash('settings.taxTab');
      } else {
        await api('/quotes/internal-approval-settings', {
          method: 'PUT', body: { threshold: Number(threshold || 0) },
        });
        setFlash('settings.quoteApprovalThreshold');
      }
      await load();
    } catch {
      setError('common.error');
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const form = new FormData();
      form.append('logo', file);
      await apiUpload('/settings/company/logo', form);
      setFlash('settings.logoUploaded');
      await load();
    } catch {
      setError('settings.logoFailed');
    } finally {
      setBusy(false);
      if (logoRef.current) logoRef.current.value = '';
    }
  }

  async function removeLogo() {
    setBusy(true);
    try {
      await api('/settings/company/logo', { method: 'DELETE' });
      setFlash('settings.logoRemoved');
      await load();
    } catch {
      setError('settings.logoFailed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="ae-page">
        <PageHero title={t('settings.title')} subtitle={t('settings.subtitle')} />
        <Panel><Skeleton rows={6} /></Panel>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="ae-page">
        <PageHero title={t('settings.title')} subtitle={t('settings.subtitle')} />
        <p className="ae-flash ae-flash--error">{t('common.error')}</p>
      </div>
    );
  }

  const manage = can('settings.manage');
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setData((d) => (d ? { ...d, [key]: value } : d));

  const saveButton = (section: TabKey) =>
    manage && (
      <div className="mt-4">
        <button type="button" className="ae-btn-primary" disabled={busy} onClick={() => void save(section)}>
          {busy ? t('common.saving') : t('common.save')}
        </button>
      </div>
    );

  return (
    <div className="ae-page">
      <PageHero title={t('settings.title')} subtitle={t('settings.subtitle')} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error)}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash)}</p>}

      <div className="ae-tab-pills mb-4">
        {TABS.map((x) => (
          <button key={x.key} type="button" onClick={() => { setTab(x.key); setFlash(null); setError(null); }}
            className={`ae-tab-pill ${tab === x.key ? 'is-active' : ''}`}>
            {t(x.label)}
          </button>
        ))}
      </div>

      {tab === 'company' && (
        <>
          <Panel title={t('settings.logo')} className="mb-4">
            <div className="flex flex-wrap items-center gap-4">
              {data.company.logoUrl
                ? <img src={data.company.logoUrl} alt="" style={{ maxHeight: 56 }} />
                : <span className="text-sm text-[var(--text-muted)]">{t('settings.logoEmpty')}</span>}

              {manage && (
                <>
                  {/* Hidden for the same reason as everywhere else: the native control writes
                      its own English chrome into an Arabic screen. */}
                  <input ref={logoRef} type="file" accept="image/*" className="sr-only"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); }} />
                  <button type="button" className="ae-btn-secondary" disabled={busy}
                    onClick={() => logoRef.current?.click()}>
                    {t('settings.logoUpload')}
                  </button>
                  {data.company.logoUrl && (
                    <button type="button" className="ae-btn-ghost" disabled={busy} onClick={() => void removeLogo()}>
                      {t('settings.logoRemove')}
                    </button>
                  )}
                </>
              )}
            </div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">{t('settings.logoHint')}</p>
          </Panel>

          <Panel title={t('settings.companyTab')} className="ae-form-panel">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {COMPANY_FIELDS.map(([field, label]) => (
                <label key={field} className="text-sm">
                  <span className="mb-1 block font-bold">{t(label)}</span>
                  <input value={data.company[field] ?? ''} disabled={!manage}
                    onChange={(e) => set('company', { ...data.company, [field]: e.target.value })}
                    className="ae-input" />
                </label>
              ))}
            </div>
            {saveButton('company')}
          </Panel>
        </>
      )}

      {tab === 'portal' && (
        <Panel title={t('settings.portalTab')} className="ae-form-panel">
          <div className="space-y-3">
            {([
              ['clientPreviewEnabled', 'settings.clientPreview'],
              ['approvalEnabled', 'settings.approvalOnPortal'],
              ['paymentEnabled', 'settings.paymentOnPortal'],
            ] as const).map(([field, label]) => (
              <label key={field} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={data.portal[field] === true} disabled={!manage}
                  onChange={(e) => set('portal', { ...data.portal, [field]: e.target.checked })} />
                <span>{t(label)}</span>
              </label>
            ))}
          </div>

          {/* Not a preference. The endpoint behind this switch creates a receipt for the whole
              remaining balance, allocates it, moves the treasury and posts the journal entry —
              on the say-so of anyone holding the share link, with no verification step. */}
          {data.portal.paymentEnabled && (
            <p className="ae-alert-pill ae-alert-pill--warn mt-3 block text-xs">
              {t('portal.confirmPayment')} — {t('settings.paymentOnPortal')}
            </p>
          )}

          {saveButton('portal')}
        </Panel>
      )}

      {tab === 'payment' && (
        <Panel title={t('settings.paymentTab')} className="ae-form-panel">
          {data.paymentMethods.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
          ) : (
            <div className="ae-table-wrap">
              <table className="ae-table ae-table--rows">
                <thead>
                  <tr>
                    <th>{t('settings.paymentLabel')}</th>
                    <th>{t('settings.paymentType')}</th>
                    <th>{t('settings.paymentDetails')}</th>
                    <th>{t('settings.paymentActive')}</th>
                    {manage && <th />}
                  </tr>
                </thead>
                <tbody>
                  {data.paymentMethods.map((m, i) => {
                    const patch = (p: Partial<PaymentMethod>) =>
                      set('paymentMethods', data.paymentMethods.map((x, n) => (n === i ? { ...x, ...p } : x)));
                    return (
                      <tr key={m.id || i}>
                        <td><input value={m.label} disabled={!manage}
                          onChange={(e) => patch({ label: e.target.value })} className="ae-input" /></td>
                        <td>
                          <select value={m.type} disabled={!manage}
                            onChange={(e) => patch({ type: e.target.value as PaymentMethod['type'] })} className="ae-input">
                            {(['BANK', 'WALLET', 'LINK'] as const).map((x) => (
                              <option key={x} value={x}>{t(`settings.paymentType.${x}`)}</option>
                            ))}
                          </select>
                        </td>
                        <td><input value={m.details ?? ''} disabled={!manage}
                          onChange={(e) => patch({ details: e.target.value })} className="ae-input" /></td>
                        <td>
                          <input type="checkbox" checked={m.isActive !== false} disabled={!manage}
                            onChange={(e) => patch({ isActive: e.target.checked })} />
                        </td>
                        {manage && (
                          <td className="ae-actions-cell">
                            <button type="button" aria-label={t('common.delete')}
                              className="ae-icon-btn ae-icon-btn-danger"
                              onClick={() => set('paymentMethods', data.paymentMethods.filter((_, n) => n !== i))}>
                              ✕
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {manage && (
            <button type="button" className="ae-btn-ghost mt-3 text-xs"
              onClick={() => set('paymentMethods', [
                ...data.paymentMethods,
                // The id is the client's handle until the server assigns its own on save.
                { id: `m${Date.now()}`, type: 'BANK', label: '', details: '', isActive: true },
              ])}>
              {t('common.add')}
            </button>
          )}

          {saveButton('payment')}
        </Panel>
      )}

      {tab === 'tax' && (
        <Panel title={t('settings.taxTitle')} className="ae-form-panel">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={data.tax.vatEnabled} disabled={!manage}
              onChange={(e) => set('tax', { ...data.tax, vatEnabled: e.target.checked })} />
            <span>{t('settings.vatEnabled')}</span>
          </label>
          {data.tax.vatEnabled && (
            <label className="mt-3 block max-w-xs text-sm">
              <span className="mb-1 block font-bold">{t('settings.vatRate')}</span>
              <input type="number" min="0" step="any" value={data.tax.vatRate} disabled={!manage}
                onChange={(e) => set('tax', { ...data.tax, vatRate: Number(e.target.value) })} className="ae-input" />
            </label>
          )}
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t('settings.vatHint')}</p>

          <label className="mt-5 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={data.tax.withholdingEnabled} disabled={!manage}
              onChange={(e) => set('tax', { ...data.tax, withholdingEnabled: e.target.checked })} />
            <span>{t('settings.withholdingEnabled')}</span>
          </label>

          {/* Per-category rates only mean anything once withholding is switched on. */}
          {data.tax.withholdingEnabled && (
            <div className="mt-3">
              <p className="ae-stat-label">{t('settings.withholdingRatesTitle')}</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {WITHHOLDING_KEYS.map((k) => (
                  <label key={k} className="text-sm">
                    <span className="mb-1 block font-bold">
                      {/* The label carries a baked-in percentage; the live one is the input. */}
                      {t(`settings.withholding.${k}`).replace(/\s*\([^)]*\)\s*$/, '')}
                    </span>
                    <input type="number" min="0" step="any" disabled={!manage}
                      value={data.tax.withholdingRates?.[k] ?? 0}
                      onChange={(e) => set('tax', {
                        ...data.tax,
                        withholdingRates: { ...data.tax.withholdingRates, [k]: Number(e.target.value) },
                      })}
                      className="ae-input" />
                  </label>
                ))}
              </div>
            </div>
          )}

          {saveButton('tax')}
        </Panel>
      )}

      {tab === 'quotes' && (
        <Panel title={t('quotes.title')} className="ae-form-panel">
          <label className="block max-w-sm text-sm">
            <span className="mb-1 block font-bold">{t('settings.quoteApprovalThreshold')}</span>
            <input type="number" min="0" step="any" value={threshold} disabled={!manage}
              onChange={(e) => setThreshold(e.target.value)} className="ae-input" />
          </label>
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t('settings.quoteApprovalThresholdHint')}</p>
          {saveButton('quotes')}
        </Panel>
      )}
    </div>
  );
}
