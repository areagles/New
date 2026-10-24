'use client';

/**
 * دفتر الأستاذ — one account, every posted movement, with the balance carried forward.
 *
 * The running balance is the point. A list of debits and credits tells you what happened; the
 * cumulative column tells you where the account stood after each one, which is what anybody
 * actually asks the ledger.
 *
 * ── The opening balance only exists with a start date ─────────────────────────────────────
 *
 * With no `from`, the server returns everything the account has ever done and the opening
 * balance is zero — correctly, since there is nothing before the beginning. Give it a start
 * date and the opening is everything that happened before it. So the opening row is shown only
 * when a start date is set; showing a zero opening on an unbounded ledger would read as a claim
 * rather than as the absence of one.
 */

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Panel } from '@/components/page';
import type { Account } from '@/app/(shell)/accounting/page';

type Line = {
  entryId: string; number: string | null; entryDate: string; description: string | null;
  refType: string; refId: string | null; debit: number; credit: number;
  runningBalance: number; lineDescription: string | null;
};
type Ledger = {
  baseCurrency: string; account: Account; dateFrom: string | null; dateTo: string | null;
  openingBalance: number; closingBalance: number;
  totalDebit: number; totalCredit: number; lines: Line[];
};

export function AccountingLedger({ accounts }: { accounts: Account[] }) {
  const { t, lang } = useI18n();

  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Ledger | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const money = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency: data?.baseCurrency ?? 'EGP', maximumFractionDigits: 2,
    }).format(v),
    [lang, data?.baseCurrency],
  );
  const date = useCallback(
    (v: string) => new Date(v).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB'),
    [lang],
  );

  async function run() {
    if (!accountId) return;
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      setData(await api<Ledger>(`/accounting/accounts/${accountId}/ledger${q.toString() ? `?${q}` : ''}`));
    } catch {
      setError('accounting.ledger.loadFailed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('accounting.ledger.title')}>
      <p className="mb-3 text-xs text-[var(--text-muted)]">{t('accounting.ledger.hint')}</p>

      <form className="ae-toolbar mb-3" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('accounting.ledger.selectAccount')}</span>
          <select className="ae-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">—</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('accounting.trialDateFrom')}</span>
          <input type="date" className="ae-input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('accounting.trialDateTo')}</span>
          <input type="date" className="ae-input" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="submit" className="ae-btn-primary self-end" disabled={busy || accountId === ''}>
          {t('accounting.ledger.view')}
        </button>
      </form>

      {error && <p className="ae-flash ae-flash--error mb-3">{t(error)}</p>}

      {data && (
        data.lines.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t('accounting.ledger.empty')}</p>
        ) : (
          <div className="ae-table-wrap">
            <table className="ae-table">
              <thead>
                <tr>
                  <th>{t('accounting.journals.date')}</th>
                  <th>{t('accounting.journals.number')}</th>
                  <th>{t('accounting.journals.description')}</th>
                  <th>{t('accounting.debit')}</th>
                  <th>{t('accounting.credit')}</th>
                  <th>{t('accounting.ledger.running')}</th>
                </tr>
              </thead>
              <tbody>
                {/* Only meaningful when a start date bounds the period; without one there is
                    nothing before the first line to open with. */}
                {data.dateFrom && (
                  <tr>
                    <td colSpan={5} className="font-bold">{t('accounting.ledger.opening')}</td>
                    <td className="font-bold">{money(data.openingBalance)}</td>
                  </tr>
                )}
                {data.lines.map((l, i) => (
                  <tr key={`${l.entryId}-${i}`}>
                    <td className="text-xs">{date(l.entryDate)}</td>
                    <td className="font-mono text-xs">{l.number ?? '—'}</td>
                    <td>
                      {l.lineDescription || l.description || '—'}
                      {l.refType !== 'manual' && (
                        <span className="block text-xs text-[var(--text-muted)]">
                          {t(`accounting.journals.ref.${l.refType}`, l.refType)}
                        </span>
                      )}
                    </td>
                    <td>{l.debit ? money(l.debit) : '—'}</td>
                    <td>{l.credit ? money(l.credit) : '—'}</td>
                    <td className="font-bold">{money(l.runningBalance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={3}>{t('accounting.totals')}</th>
                  <th>{money(data.totalDebit)}</th>
                  <th>{money(data.totalCredit)}</th>
                  <th>{money(data.closingBalance)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}
    </Panel>
  );
}
