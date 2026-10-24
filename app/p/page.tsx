'use client';

/**
 * The shared document — a quote, invoice or receipt as the client sees it.
 *
 * The second public page here, and the one that closes the last open loop. A quote reaches
 * APPROVED properly when the client says so, not when someone in the office records that they
 * said so on the phone; an invoice gets a payment notice from the person who actually paid — a
 * notice, not a receipt. Somebody holding a share link is not somebody who has been paid, so the
 * declaration sits PENDING until finance acknowledges it, exactly as it does in the logged-in
 * client portal. The balance does not move here.
 * Both were reachable only through this link, and the link went nowhere.
 *
 * ── One page, three documents ─────────────────────────────────────────────────────────────
 *
 * `docType` decides everything: which date field the document carries, which totals are worth
 * showing, and — more importantly — which actions exist at all. Approval is quote-only and
 * rejected by the API for anything else; payment is invoice-only. Neither is offered unless
 * the tenant has switched it on in the portal settings, because a button whose endpoint will
 * answer `approval_not_available` is worse than no button.
 *
 * Payment additionally needs somewhere for the money to go. With no payment methods configured
 * the section is absent rather than showing an empty selector: the client cannot act on it and
 * the API would refuse a submission with no method anyway.
 *
 * The palette is the tenant's own client-facing one, scoped to this page — the root layout is
 * shared with the authenticated app and its dark theme has nothing to do with a document sent
 * to a customer.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_BASE } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type DocType = 'quote' | 'invoice' | 'receipt' | 'purchase';

type Line = {
  id: string;
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  discount?: number;
  lineTotal: number;
};

type Doc = {
  id: string;
  number: string | null;
  clientName: string | null;
  clientTaxId: string | null;
  currencyCode: string;
  subTotal?: number;
  taxTotal?: number;
  totalAmount: number;
  paidAmount?: number;
  remainingAmount?: number;
  status: string;
  clientApprovalStatus?: string | null;
  notes: string | null;
  lines?: Line[];
  quoteDate?: string; validUntil?: string | null;
  invoiceDate?: string; dueDate?: string | null;
  receiptDate?: string;
  etaQrImageUrl?: string | null;
  etaQrUrl?: string | null;
};

type PaymentMethod = { id: string; label?: string; name?: string; type?: string; details?: string };

type Payload = {
  docType: DocType;
  document: Doc;
  settings: {
    company: { name: string; logoUrl?: string; phone?: string; email?: string; taxId?: string; address?: string };
    portal: { approvalEnabled?: boolean; paymentEnabled?: boolean; clientPreviewEnabled?: boolean };
    paymentMethods?: PaymentMethod[];
    appearance?: {
      accent?: string; accentHover?: string; bg?: string;
      surface?: string; text?: string; textMuted?: string;
    };
  };
  terms?: { title?: string; text?: string } | null;
};

/** Quotes are closed once acted on; nothing here should offer a verdict on one of these. */
const QUOTE_CLOSED = ['CONVERTED', 'REJECTED', 'SUPERSEDED', 'APPROVED'];

export default function PublicDocumentPage() {
  return (
    <Suspense fallback={null}>
      <PublicDocument />
    </Suspense>
  );
}

function PublicDocument() {
  const { t, lang } = useI18n();
  const token = useSearchParams().get('token') ?? '';

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState('');
  const [payNotes, setPayNotes] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      setFailed('portal.invalidLink');
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/public/documents?token=${encodeURIComponent(token)}`);
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setFailed('portal.unavailable');
        return;
      }
      setData(json as Payload);
    } catch {
      setFailed('portal.unavailable');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(action: 'approve' | 'reject' | 'pay', body: Record<string, unknown> = {}) {
    setBusy(true);
    setFailed(null);
    setFlash(null);
    try {
      const res = await fetch(`${API_BASE}/public/documents/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...body }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setFailed(
          action === 'approve' ? 'portal.approveFailed'
            : action === 'reject' ? 'portal.rejectFailed'
              : 'clientPortal.paymentNotice.failed',
        );
        return;
      }
      setFlash(
        action === 'approve' ? 'portal.approveSuccess'
          : action === 'reject' ? 'portal.rejectSuccess'
            // Not "paid": a notice was recorded and the balance is untouched until finance
            // acknowledges it. Saying otherwise is how a dispute starts.
            : 'clientPortal.paymentNotice.sent',
      );
      setReference('');
      setPayNotes('');
      await load();
    } catch {
      setFailed('portal.approveFailed');
    } finally {
      setBusy(false);
    }
  }

  const a = data?.settings.appearance;
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

  if (loading) {
    return <main style={skin} className="grid place-items-center p-6">
      <p style={{ color: 'var(--p-muted)' }}>{t('portal.loading')}</p>
    </main>;
  }

  if (failed && !data) {
    return <main style={skin} className="grid place-items-center p-6">
      <p className="text-lg font-bold">{t(failed)}</p>
    </main>;
  }

  if (!data) return null;

  const { docType, document: doc, settings, terms } = data;
  const cur = doc.currencyCode;
  const money = (v: number) =>
    new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency: cur, maximumFractionDigits: 2,
    }).format(v);

  const card: React.CSSProperties = {
    background: 'var(--p-surface)',
    borderRadius: 14,
    border: '1px solid rgba(0,0,0,.08)',
    boxShadow: '0 1px 3px rgba(0,0,0,.06)',
  };

  /** Each type keeps its own date under its own name. */
  const issuedOn = doc.quoteDate ?? doc.invoiceDate ?? doc.receiptDate ?? null;
  const dueOn = doc.validUntil ?? doc.dueDate ?? null;

  const methods = settings.paymentMethods ?? [];
  const remaining = doc.remainingAmount ?? 0;

  const canApprove =
    docType === 'quote'
    && settings.portal.approvalEnabled === true
    && !QUOTE_CLOSED.includes(doc.status);

  // Money needs somewhere to go; with nothing configured the section says nothing useful.
  const canPay =
    docType === 'invoice'
    && settings.portal.paymentEnabled === true
    && remaining > 0.0001
    && methods.length > 0;

  const pdfHref = `${API_BASE}/public/documents/pdf?token=${encodeURIComponent(token)}&lang=${lang}`;

  return (
    <main style={skin} className="px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-3xl">
        <header style={card} className="mb-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {settings.company.logoUrl
                ? <img src={settings.company.logoUrl} alt="" style={{ maxHeight: 44 }} />
                : <span className="text-lg font-extrabold">{settings.company.name}</span>}
              {settings.company.taxId && (
                <p className="mt-1 text-xs" style={{ color: 'var(--p-muted)' }}>
                  {t('portal.taxId')} <span dir="ltr">{settings.company.taxId}</span>
                </p>
              )}
            </div>
            <div className="text-end">
              <p className="text-sm font-bold">{t(`portal.doc.${docType}`, docType)}</p>
              <p className="text-lg font-extrabold" dir="ltr">{doc.number ?? '—'}</p>
            </div>
          </div>

          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt style={{ color: 'var(--p-muted)' }}>{t('quotes.client')}</dt>
              <dd className="font-bold">{doc.clientName ?? '—'}</dd>
            </div>
            {issuedOn && (
              <div>
                <dt style={{ color: 'var(--p-muted)' }}>{t('treasury.date')}</dt>
                <dd className="font-bold" dir="ltr">{issuedOn}</dd>
              </div>
            )}
            {dueOn && (
              <div>
                <dt style={{ color: 'var(--p-muted)' }}>
                  {docType === 'quote' ? t('quotes.validUntil') : t('portal.dueDate')}
                </dt>
                <dd className="font-bold" dir="ltr">{dueOn}</dd>
              </div>
            )}
          </dl>
        </header>

        {flash && (
          <p style={{ ...card, borderColor: '#16a34a', color: '#166534' }} className="mb-4 p-3 text-sm font-bold">
            {t(flash)}
          </p>
        )}
        {failed && (
          <p style={{ ...card, borderColor: '#dc2626', color: '#991b1b' }} className="mb-4 p-3 text-sm font-bold">
            {t(failed)}
          </p>
        )}

        {(doc.lines ?? []).length > 0 && (
          <section style={card} className="mb-4 overflow-hidden">
            <div style={{ overflowX: 'auto' }}>
              <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'rgba(0,0,0,.03)' }}>
                    <th className="p-3 text-start">{t('portal.table.description')}</th>
                    <th className="p-3 text-start">{t('portal.table.quantity')}</th>
                    <th className="p-3 text-start">{t('portal.table.price')}</th>
                    <th className="p-3 text-start">{t('portal.table.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(doc.lines ?? []).map((l) => (
                    <tr key={l.id} style={{ borderTop: '1px solid rgba(0,0,0,.06)' }}>
                      <td className="p-3">{l.description}</td>
                      <td className="p-3">{l.quantity}{l.unit ? ` ${l.unit}` : ''}</td>
                      <td className="p-3">{money(l.unitPrice)}</td>
                      <td className="p-3">{money(l.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-2 border-t p-4 text-sm sm:ms-auto sm:w-72"
              style={{ borderColor: 'rgba(0,0,0,.08)' }}>
              {doc.subTotal != null && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--p-muted)' }}>{t('invoices.subTotal')}</span>
                  <span>{money(doc.subTotal)}</span>
                </div>
              )}
              {doc.taxTotal != null && doc.taxTotal !== 0 && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--p-muted)' }}>{t('invoices.tax')}</span>
                  <span>{money(doc.taxTotal)}</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-2 font-bold" style={{ borderColor: 'rgba(0,0,0,.08)' }}>
                <span>{t('portal.total')}</span>
                <span>{money(doc.totalAmount)}</span>
              </div>
              {remaining > 0 && (
                <div className="flex justify-between font-bold">
                  <span>{t('portal.remaining')}</span>
                  <span>{money(remaining)}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* A tax invoice carries the authority's own verification code. */}
        {doc.etaQrImageUrl && (
          <section style={card} className="mb-4 p-4 text-center">
            <img src={doc.etaQrImageUrl} alt="" style={{ maxWidth: 160, margin: '0 auto' }} />
            <p className="mt-2 text-xs" style={{ color: 'var(--p-muted)' }}>{t('portal.etaQr')}</p>
            {doc.etaQrUrl && (
              <a href={doc.etaQrUrl} target="_blank" rel="noopener noreferrer"
                className="mt-1 inline-block text-sm font-bold" style={{ color: 'var(--p-accent)' }}>
                {t('portal.etaQrLink')}
              </a>
            )}
          </section>
        )}

        {canApprove && (
          <section style={card} className="mb-4 flex flex-wrap gap-2 p-4">
            <button type="button" disabled={busy} onClick={() => void post('approve')}
              className="rounded-lg px-5 py-2 text-sm font-bold text-white" style={{ background: 'var(--p-accent)' }}>
              {t('portal.approve')}
            </button>
            <button type="button" disabled={busy} onClick={() => void post('reject')}
              className="rounded-lg px-5 py-2 text-sm font-bold" style={{ border: '1px solid rgba(0,0,0,.15)' }}>
              {t('portal.reject')}
            </button>
          </section>
        )}

        {canPay && (
          <section style={card} className="mb-4 p-4">
            <h2 className="text-sm font-bold">{t('clientPortal.paymentNotice.action')}</h2>
            {/* Said before the form, not after it is submitted. */}
            <p className="mt-1 text-xs" style={{ color: 'var(--p-muted)' }}>
              {t('clientPortal.paymentNotice.hint')}
            </p>
            <label className="mt-3 block text-sm">
              <span style={{ color: 'var(--p-muted)' }}>{t('portal.selectPayment')}</span>
              <select value={methodId} onChange={(e) => setMethodId(e.target.value)}
                className="mt-1 w-full rounded-lg p-3 text-sm"
                style={{ border: '1px solid rgba(0,0,0,.15)', background: 'var(--p-surface)', color: 'var(--p-text)' }}>
                <option value="" />
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>{m.label ?? m.name ?? m.id}</option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-sm">
              <span style={{ color: 'var(--p-muted)' }}>{t('clientPortal.paymentNotice.reference')}</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)}
                className="mt-1 w-full rounded-lg p-3 text-sm"
                style={{ border: '1px solid rgba(0,0,0,.15)', background: 'var(--p-surface)', color: 'var(--p-text)' }} />
            </label>
            <label className="mt-3 block text-sm">
              <span style={{ color: 'var(--p-muted)' }}>{t('clientPortal.paymentNotice.notes')}</span>
              <textarea value={payNotes} onChange={(e) => setPayNotes(e.target.value)} rows={2}
                className="mt-1 w-full rounded-lg p-3 text-sm"
                style={{ border: '1px solid rgba(0,0,0,.15)', background: 'var(--p-surface)', color: 'var(--p-text)' }} />
            </label>
            {/* The API needs one of the two: a claim with neither a reference nor a note is
                not evidence of anything, and it refuses it. */}
            <button type="button"
              disabled={busy || methodId === '' || (reference.trim() === '' && payNotes.trim() === '')}
              onClick={() => void post('pay', { paymentMethodId: methodId, reference, notes: payNotes })}
              className="mt-3 rounded-lg px-5 py-2 text-sm font-bold text-white"
              style={{
                background: 'var(--p-accent)',
                opacity: methodId === '' || (reference.trim() === '' && payNotes.trim() === '') ? 0.5 : 1,
              }}>
              {t('clientPortal.paymentNotice.submit')}
            </button>
          </section>
        )}

        {terms?.text && (
          <section style={card} className="mb-4 p-4">
            {terms.title && <h2 className="text-sm font-bold">{terms.title}</h2>}
            <p className="mt-2 whitespace-pre-wrap text-xs" style={{ color: 'var(--p-muted)' }}>{terms.text}</p>
          </section>
        )}

        <div className="text-center">
          <a href={pdfHref} target="_blank" rel="noopener noreferrer"
            className="text-sm font-bold" style={{ color: 'var(--p-accent)' }}>
            {t('portal.downloadPdf')}
          </a>
          {(settings.company.phone || settings.company.email) && (
            <p className="mt-3 text-xs" style={{ color: 'var(--p-muted)' }} dir="ltr">
              {[settings.company.phone, settings.company.email].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
