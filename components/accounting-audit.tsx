'use client';

/**
 * The two audits — what the books say versus what they should say.
 *
 * تدقيق الترحيل finds posted documents with no journal entry behind them: an invoice that was
 * issued but never reached the ledger, so it shows in sales and not in the trial balance. It can
 * be fixed from here, because the fix is deterministic — rebuild the entry from the document.
 *
 * تدقيق البيانات finds documents whose own arithmetic does not hold: a total that is not
 * subtotal plus tax, allocations exceeding the receipt they sit on, paid plus remaining not
 * equalling the total. There is no button for these. The number that is wrong cannot be guessed
 * from the numbers that are right, so each one is a document somebody has to open.
 *
 * Both are meant to find nothing. An empty result is the outcome, and both say so plainly rather
 * than showing an empty table that reads like a failure to load.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Panel, Skeleton } from '@/components/page';

type Issue = {
  docType: string; docId: string; number: string | null;
  issueCode?: string; amount?: number; currencyCode?: string;
};

export function AccountingAudit({ mode, manage }: { mode: 'posting' | 'integrity'; manage: boolean }) {
  const { t, lang } = useI18n();

  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const path = mode === 'posting' ? '/accounting/posting-audit' : '/accounting/document-integrity';

  const money = useCallback(
    (v: number, currency = 'EGP') => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ issues?: Issue[] }>(path);
      setIssues(d.issues ?? []);
    } catch {
      setError(mode === 'posting' ? 'accounting.postingAudit.loadFailed' : 'accounting.integrity.loadFailed');
    } finally {
      setLoading(false);
    }
  }, [path, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remediate(issue: Issue) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const d = await api<{ issues?: Issue[] }>('/accounting/posting-audit/remediate', {
        method: 'POST',
        body: { docType: issue.docType, docId: issue.docId },
      });
      setIssues(d.issues ?? []);
      setFlash('accounting.postingAudit.remediated');
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code ? `accounting.error.${code}` : 'common.error');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'posting' ? 'accounting.postingAudit.title' : 'accounting.integrity.title';
  const subtitle = mode === 'posting' ? 'accounting.postingAudit.subtitle' : 'accounting.integrity.subtitle';
  const clean = mode === 'posting' ? 'accounting.postingAudit.clean' : 'accounting.integrity.clean';

  return (
    <Panel title={t(title)}>
      <p className="mb-3 text-xs text-[var(--text-muted)]">{t(subtitle)}</p>

      {error && <p className="ae-flash ae-flash--error mb-3">{t(error)}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-3">{t(flash)}</p>}

      {loading ? <Skeleton rows={4} /> : issues.length === 0 ? (
        /* Finding nothing is the point of running it. */
        <p className="ae-flash ae-flash--success">{t(clean)}</p>
      ) : (
        <div className="ae-table-wrap">
          <table className="ae-table">
            <thead>
              <tr>
                <th>{t('accounting.postingAudit.docType')}</th>
                <th>{t('accounting.postingAudit.number')}</th>
                {mode === 'posting'
                  ? <th>{t('accounting.postingAudit.amount')}</th>
                  : <th>{t('accounting.integrity.issue')}</th>}
                {mode === 'posting' && manage && <th aria-label={t('quotes.actions')} />}
              </tr>
            </thead>
            <tbody>
              {issues.map((i) => (
                <tr key={`${i.docType}-${i.docId}-${i.issueCode ?? ''}`}>
                  <td className="text-xs">{t(`accounting.postingAudit.docType.${i.docType}`, i.docType)}</td>
                  <td className="font-mono text-xs">{i.number ?? i.docId}</td>
                  {mode === 'posting' ? (
                    <td>{i.amount !== undefined ? money(i.amount, i.currencyCode) : '—'}</td>
                  ) : (
                    <td className="text-xs">
                      {t(`accounting.integrity.issue.${i.issueCode}`, i.issueCode ?? '')}
                    </td>
                  )}
                  {mode === 'posting' && manage && (
                    <td>
                      <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                        onClick={() => void remediate(i)}>
                        {t('accounting.postingAudit.remediate')}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
