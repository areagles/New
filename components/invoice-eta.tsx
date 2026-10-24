'use client';

/**
 * The ETA panel on an invoice: where it stands with the tax authority, what is stopping it
 * from being filed, and the actions that move it forward.
 *
 * Readiness comes first and submission is gated on it. The authority rejects a document for
 * reasons that are knowable beforehand — a missing item code, no activity code in settings, a
 * receiver without a tax id — and finding that out from a rejection is slower and leaves a
 * failed submission on the record. `heal` fills in the codes that can be derived; the rest
 * are shown as what they are, since most of them are settings a person has to go and fix.
 *
 * Only tax invoices reach here. A normal one is refused by the API at five separate points,
 * so the caller does not render this panel for one at all.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Panel } from '@/components/page';

type Issue = { code: string; severity?: string; message?: string; detail?: string };
type Readiness = { ready?: boolean; issues?: Issue[]; warnings?: Issue[] };

export type EtaState = {
  etaStatus: 'NONE' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'FAILED' | 'CANCELLED';
  etaUuid: string | null;
  etaLastError: string | null;
};

const ETA_STYLE: Record<EtaState['etaStatus'], string> = {
  NONE: 'ae-badge-muted',
  SUBMITTED: 'ae-badge-info',
  ACCEPTED: 'ae-badge-success',
  REJECTED: 'ae-badge-danger',
  FAILED: 'ae-badge-danger',
  CANCELLED: 'ae-badge-muted',
};

/**
 * The readiness endpoint reports snake_case codes; the recovered wording is filed under short
 * names. Mapped rather than renamed on either side, so neither the API nor the dictionary has
 * to change for the other.
 */
const ERR_KEY: Record<string, string> = {
  eta_disabled: 'disabled',
  eta_issuer_tax_id_required: 'issuerTax',
  eta_activity_code_required: 'activityCode',
  eta_item_code_required: 'itemCode',
  eta_unit_code_required: 'unitCode',
  eta_eseal_missing: 'eseal',
  eta_eseal_pin_required: 'esealPin',
  eta_auth_failed: 'auth',
  eta_exchange_rate_required: 'exchangeRate',
  invoice_not_submittable: 'notSubmittable',
  not_tax_invoice: 'notTax',
  invoice_lines_required: 'lines',
  receiver_address_empty: 'receiverAddress',
  receiver_person_mode: 'receiverPerson',
  egs_codes_not_imported: 'egsCatalog',
};

/** Already filed, or withdrawn — there is nothing left to send. */
const SETTLED: EtaState['etaStatus'][] = ['ACCEPTED', 'SUBMITTED', 'CANCELLED'];

export function InvoiceEta({
  invoiceId,
  state,
  canManage,
  onChanged,
}: {
  invoiceId: string;
  state: EtaState;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<null | 'heal' | 'submit' | 'status'>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const settled = SETTLED.includes(state.etaStatus);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      setReadiness(await api<Readiness>(`/invoices/${invoiceId}/eta/readiness`));
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'common.error');
    } finally {
      setChecking(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    // No point checking readiness for something already filed.
    if (!settled) void check();
  }, [check, settled]);

  async function run(action: 'heal' | 'submit' | 'status') {
    setBusy(action);
    setError(null);
    setFlash(null);
    try {
      if (action === 'status') await api(`/invoices/${invoiceId}/eta/status`);
      else await api(`/invoices/${invoiceId}/eta/${action}`, { method: 'POST' });
      if (action === 'heal') {
        setFlash('invoices.eta.healed');
        await check();
      } else {
        onChanged();
      }
    } catch (err) {
      // The API's ETA errors are specific and already translated; anything else is generic.
      const code = err instanceof ApiError ? err.code : '';
      setError(code.startsWith('eta_') || code.startsWith('invoices.') ? code : 'common.error');
    } finally {
      setBusy(null);
    }
  }

  const issues = readiness?.issues ?? [];
  const warnings = readiness?.warnings ?? [];
  const ready = readiness?.ready === true;

  /**
   * Per-line problems arrive as `<code>_line_<n>`, so the line number is split off and shown
   * beside the message — knowing a code is missing matters less than knowing which line it is
   * missing from.
   */
  const label = (i: Issue) => {
    const m = /^(.*)_line_(\d+)$/.exec(i.code);
    const base = m ? m[1] : i.code;
    const text = t(`invoices.eta.err.${ERR_KEY[base] ?? base}`, i.detail ?? i.message ?? base);
    return m ? `${text} — ${t('invoices.itemCode')} ${m[2]}` : text;
  };

  return (
    <Panel title={t('invoices.eta')} className="ae-form-panel mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`ae-badge ${ETA_STYLE[state.etaStatus]}`}>
          {t(`invoices.eta.status.${state.etaStatus}`)}
        </span>
        {state.etaUuid && (
          <span className="text-xs text-[var(--text-muted)]" dir="ltr">{state.etaUuid}</span>
        )}
      </div>

      {state.etaLastError && (
        <p className="ae-flash ae-flash--error mt-3 text-xs">{state.etaLastError}</p>
      )}
      {error && <p className="ae-flash ae-flash--error mt-3">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success mt-3">{t(flash, '')}</p>}

      {!settled && (
        <>
          {checking ? (
            <div className="ae-skeleton mt-4 h-8 w-full" aria-hidden />
          ) : (
            <>
              {issues.length > 0 && (
                <ul className="mt-4 space-y-1">
                  {issues.map((i, n) => (
                    <li key={`${i.code}-${n}`} className="ae-alert-pill ae-alert-pill--warn block text-xs">
                      {label(i)}
                    </li>
                  ))}
                </ul>
              )}
              {warnings.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {warnings.map((i, n) => (
                    <li key={`${i.code}-${n}`} className="ae-alert-pill ae-alert-pill--neutral block text-xs">
                      {label(i)}
                    </li>
                  ))}
                </ul>
              )}
              {ready && issues.length === 0 && (
                <p className="ae-alert-pill ae-alert-pill--info mt-4 inline-block text-xs">
                  {t('invoices.eta.allReady')}
                </p>
              )}
            </>
          )}

          {canManage && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="ae-btn-primary"
                disabled={busy !== null || !ready}
                onClick={() => run('submit')}
              >
                {busy === 'submit' ? t('common.saving') : t('invoices.eta.submit', t('invoices.eta'))}
              </button>
              <button
                type="button"
                className="ae-btn-secondary"
                disabled={busy !== null}
                onClick={() => run('heal')}
              >
                {busy === 'heal' ? t('common.saving') : t('invoices.eta.bulkHeal')}
              </button>
              <button
                type="button"
                className="ae-btn-ghost"
                disabled={busy !== null || checking}
                onClick={() => void check()}
              >
                {t('invoices.eta.bulkScan')}
              </button>
            </div>
          )}
        </>
      )}

      {settled && canManage && state.etaStatus === 'SUBMITTED' && (
        <div className="mt-4">
          <button type="button" className="ae-btn-ghost" disabled={busy !== null} onClick={() => run('status')}>
            {busy === 'status' ? t('common.loading') : t('invoices.eta.bulkScan')}
          </button>
        </div>
      )}
    </Panel>
  );
}
