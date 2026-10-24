'use client';

/**
 * ميزان المراجعة — every account's balance, and the proof the books hold together.
 *
 * `balanced` is the whole reason this report exists. Double-entry means every posted line has a
 * matching opposite, so total debits must equal total credits; when they do not, something has
 * been written that no accounting rule allows, and every figure downstream is suspect. That flag
 * is shown first and loudly, before the rows it describes.
 *
 * The server tolerates five piastres either way when deciding `balanced` — rounding across
 * thousands of lines, not a licence — so this screen reports the server's verdict rather than
 * re-deriving one from the totals and disagreeing with it at the margin.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Panel, Skeleton } from '@/components/page';

type Row = {
  accountId: string; code: string; name: string; accountType: string;
  debit: number; credit: number; balance: number; balanceDrCr: number;
};
type Trial = {
  from: string | null; to: string | null; rows: Row[];
  totalDebit: number; totalCredit: number; balanced: boolean;
};

export function AccountingTrial() {
  const { t, lang } = useI18n();

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Trial | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const money = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency: 'EGP', maximumFractionDigits: 2,
    }).format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      setData(await api<Trial>(`/accounting/trial-balance${q.toString() ? `?${q}` : ''}`));
    } catch {
      setError('accounting.trialFailed');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel title={t('accounting.tab.trial')}>
      <form className="ae-toolbar mb-3" onSubmit={(e) => e.preventDefault()}>
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('accounting.trialDateFrom')}</span>
          <input type="date" className="ae-input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('accounting.trialDateTo')}</span>
          <input type="date" className="ae-input" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </form>

      {error && <p className="ae-flash ae-flash--error mb-3">{t(error)}</p>}

      {loading ? <Skeleton rows={6} /> : !data ? null : data.rows.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">{t('accounting.noPosted')}</p>
      ) : (
        <>
          {/* Said before the numbers, not after: an unbalanced trial balance means every row
              below it is worth less than it looks. */}
          <p className={`ae-flash mb-3 ${data.balanced ? 'ae-flash--success' : 'ae-flash--error'}`}>
            {t(data.balanced ? 'accounting.trialBalanced' : 'accounting.trialUnbalanced')}
          </p>

          <div className="ae-table-wrap">
            <table className="ae-table">
              <thead>
                <tr>
                  <th>{t('accounting.code')}</th>
                  <th>{t('accounting.name')}</th>
                  <th>{t('accounting.typeLabel')}</th>
                  <th>{t('accounting.debit')}</th>
                  <th>{t('accounting.credit')}</th>
                  <th>{t('accounting.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.accountId}>
                    <td className="font-mono text-xs">{r.code}</td>
                    <td>{r.name}</td>
                    <td className="text-xs">{t(`accounting.type.${r.accountType}`, r.accountType)}</td>
                    <td>{r.debit ? money(r.debit) : '—'}</td>
                    <td>{r.credit ? money(r.credit) : '—'}</td>
                    <td className="font-bold">{money(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={3}>{t('accounting.totals')}</th>
                  <th>{money(data.totalDebit)}</th>
                  <th>{money(data.totalCredit)}</th>
                  <th />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}
