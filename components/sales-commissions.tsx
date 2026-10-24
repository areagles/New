'use client';

/**
 * عمولات المسوقين — what the people who sold it are owed, and on what basis.
 *
 * Two audiences on one tab. A salesperson sees their own account: the target, how far along it
 * is, which tier that puts them in, and every movement that made up the balance. A manager sees
 * the rules that produce all of it and can pay a balance out.
 *
 * ── When commission is earned is the whole argument ───────────────────────────────────────
 *
 * `accrualTrigger` decides it: on converting a lead, or on the invoice actually being collected.
 * The second is the one the dictionary marks as recommended, and it is the honest one — a
 * commission earned on a sale that is never paid for is a commission paid out of nothing. The
 * setting is shown with that recommendation rather than as a bare dropdown.
 *
 * ── The tier is derived, not chosen ───────────────────────────────────────────────────────
 *
 * Achievement against target picks the band, and the band sets the rate. So the screen shows the
 * current tier and the distance to the next one: a percentage on its own does not tell anybody
 * whether pushing for two more deals is worth anything.
 *
 * ── Paying out is money leaving ───────────────────────────────────────────────────────────
 *
 * A payout is a real disbursement against a real bank account, so it asks first and names the
 * amount — and the ledger below records it like every other movement rather than the balance
 * quietly dropping.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Panel, Skeleton } from '@/components/page';

type Tier = { minPercent: number; maxPercent: number | null; commissionPercent: number; label: string };
type Settings = {
  commissionEnabled: boolean; commissionMode: string; pointsPerLead: number;
  commissionFlatAmount: number; commissionPercent: number; currencyCode: string;
  targetType: string; commissionTiers: Tier[];
  accrualTrigger?: string; autoJournalEnabled?: boolean;
  partialAccrualOnReceipt?: boolean; includeCommissionInPayroll?: boolean;
  policyRequiredSetting?: boolean; policyText?: string;
};
type Progress = {
  targetType: string; target: number; achieved: number;
  achievedLeads: number; achievedValue: number; achievementPercent: number;
  periodStart: string | null; periodEnd: string | null;
  currentTier: Tier | null; nextTier?: Tier | null;
};
type Account = {
  id: string; userId: string; userName: string; userEmail: string;
  pointsBalance: number; commissionBalance: number; currencyCode: string;
  convertedLeadsCount: number; targetLeads: number; targetValue: number;
  targetType: string; periodStart: string | null; periodEnd: string | null;
  commissionPolicyAcceptedAt: string | null;
  progress?: Progress;
};
type LedgerRow = {
  id: string; entryType: string; amount: number; points?: number;
  note?: string | null; createdAt: string;
};
type BankAccount = { id: string; name: string; currencyCode: string };

const MODES = ['POINTS', 'FLAT', 'PERCENT', 'MIXED'] as const;
const TRIGGERS = ['ON_CONVERT', 'ON_INVOICE_PAID'] as const;

export function SalesCommissions({ manage }: { manage: boolean }) {
  const { t, lang } = useI18n();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [me, setMe] = useState<{ account: Account | null; progress: Progress | null; ledger: LedgerRow[]; policyRequired: boolean; policyText?: string } | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState('');
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [payout, setPayout] = useState<{ amount: string; bankAccountId: string } | null>(null);

  const money = useCallback(
    (v: number, currency = 'EGP') => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(v),
    [lang],
  );
  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', { maximumFractionDigits: 1 }).format(v),
    [lang],
  );
  const date = useCallback(
    (v: string | null | undefined) => (v ? new Date(v.replace(' ', 'T')).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB') : '—'),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mine, all, bk] = await Promise.all([
        api<{ settings?: Settings; account?: Account; progress?: Progress; ledger?: LedgerRow[]; policyRequired?: boolean; policyText?: string }>('/sales/commissions/me'),
        manage
          ? api<{ settings?: Settings; accounts?: Account[] }>('/sales/commissions')
            .catch(() => ({} as { settings?: Settings; accounts?: Account[] }))
          : Promise.resolve({} as { settings?: Settings; accounts?: Account[] }),
        manage
          ? api<BankAccount[] | { items?: BankAccount[] }>('/bank-accounts').catch(() => [] as BankAccount[])
          : Promise.resolve([] as BankAccount[]),
      ]);
      const s = all.settings ?? mine.settings ?? null;
      setSettings(s);
      setDraft(s);
      setMe({
        account: mine.account ?? null,
        progress: mine.progress ?? mine.account?.progress ?? null,
        ledger: mine.ledger ?? [],
        policyRequired: mine.policyRequired ?? false,
        policyText: mine.policyText,
      });
      setAccounts(all.accounts ?? []);
      setBanks(Array.isArray(bk) ? bk : (bk.items ?? []));
    } catch {
      setError('common.error');
    } finally {
      setLoading(false);
    }
  }, [manage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(path: string, method: 'POST' | 'PUT' | 'PATCH', body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await api(path, { method, body });
      setFlash(ok);
      await load();
      return true;
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code ? `sales.error.${code}` : 'common.error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Panel><Skeleton rows={8} /></Panel>;

  if (settings && !settings.commissionEnabled && !manage) {
    return <Panel><p className="text-sm text-[var(--text-muted)]">{t('sales.commissions.disabled')}</p></Panel>;
  }

  const p = me?.progress;
  const cur = me?.account?.currencyCode ?? settings?.currencyCode ?? 'EGP';
  const chosen = accounts.find((a) => a.userId === selected || a.id === selected) ?? null;

  return (
    <div className="grid gap-4">
      {error && <p className="ae-flash ae-flash--error">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success">{t(flash)}</p>}

      {/* The policy gate comes before the numbers: the API withholds the detail until it is
          accepted, so showing an empty account first would look like a bug. */}
      {me?.policyRequired && (
        <Panel title={t('sales.commissions.policyTitle')}>
          <p className="mb-3 text-sm">{t('sales.commissions.policyRequired')}</p>
          {me.policyText && (
            <pre className="ae-input mb-3 whitespace-pre-wrap text-xs">{me.policyText}</pre>
          )}
          <button type="button" className="ae-btn-primary" disabled={busy}
            onClick={() => void call('/sales/commissions/me/accept-policy', 'POST', {}, 'sales.commissions.policyAccepted')}>
            {t('sales.commissions.policyAccept')}
          </button>
        </Panel>
      )}

      {me?.account && !me.policyRequired && (
        <Panel title={t('sales.commissions.myAccount')}>
          <div className="ae-counter-grid mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="ae-counter">
              <span className="ae-counter-label">{t('sales.commissions.balance')}</span>
              <span className="ae-counter-value">{money(me.account.commissionBalance, cur)}</span>
            </div>
            <div className="ae-counter">
              <span className="ae-counter-label">{t('sales.commissions.points')}</span>
              <span className="ae-counter-value">{num(me.account.pointsBalance)}</span>
            </div>
            <div className="ae-counter">
              <span className="ae-counter-label">{t('sales.commissions.convertedLeads')}</span>
              <span className="ae-counter-value">{num(me.account.convertedLeadsCount)}</span>
            </div>
            <div className="ae-counter">
              <span className="ae-counter-label">{t('sales.commissions.achievement')}</span>
              <span className="ae-counter-value">{p ? `${num(p.achievementPercent)}%` : '—'}</span>
              {p && (
                <span className="ae-counter-hint">
                  {num(p.achieved)} {t('sales.commissions.achievementOf')} {num(p.target)}
                </span>
              )}
            </div>
          </div>

          {p?.target === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('sales.commissions.noTarget')}</p>
          ) : p && (
            <p className="text-sm">
              <span className="font-bold">{t('sales.commissions.currentTier')}: </span>
              {p.currentTier
                ? `${p.currentTier.label} · ${num(p.currentTier.commissionPercent)}%`
                : '—'}
              {/* A percentage alone does not say whether the next two deals are worth
                  chasing; the distance to the next band does. */}
              {p.nextTier && (
                <span className="block text-xs text-[var(--text-muted)]">
                  {t('sales.commissions.nextTierHint')}: {num(p.nextTier.minPercent)}% ·
                  {' '}{p.nextTier.label} · {num(p.nextTier.commissionPercent)}%
                </span>
              )}
              {(p.periodStart || p.periodEnd) && (
                <span className="block text-xs text-[var(--text-muted)]">
                  {t('sales.commissions.period')}: {date(p.periodStart)} → {date(p.periodEnd)}
                </span>
              )}
            </p>
          )}

          {(me.ledger ?? []).length > 0 && (
            <div className="ae-table-wrap mt-4">
              <table className="ae-table">
                <thead>
                  <tr>
                    <th>{t('invoices.date')}</th>
                    <th>{t('sales.commissions.ledger')}</th>
                    <th>{t('bank.amount')}</th>
                    <th>{t('sales.commissions.note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {me.ledger.map((l) => (
                    <tr key={l.id}>
                      <td className="text-xs">{date(l.createdAt)}</td>
                      <td className="text-xs">{t(`sales.commissions.entryType.${l.entryType}`, l.entryType)}</td>
                      <td className={`font-bold ${l.amount < 0 ? 'text-[var(--danger,#dc2626)]' : ''}`}>
                        {money(l.amount, cur)}
                      </td>
                      <td className="text-xs">{l.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {manage && draft && (
        <Panel title={t('sales.commissions.settings')}>
          <p className="mb-3 text-xs text-[var(--text-muted)]">{t('sales.commissions.hint')}</p>

          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.commissionEnabled}
              onChange={(e) => setDraft({ ...draft, commissionEnabled: e.target.checked })} />
            <span>{t('sales.commissions.enabled')}</span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('sales.commissions.mode')}</span>
              <select className="ae-input" value={draft.commissionMode}
                onChange={(e) => setDraft({ ...draft, commissionMode: e.target.value })}>
                {MODES.map((m) => <option key={m} value={m}>{t(`sales.commissions.mode.${m}`)}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('sales.commissions.accrualTrigger')}</span>
              <select className="ae-input" value={draft.accrualTrigger ?? 'ON_INVOICE_PAID'}
                onChange={(e) => setDraft({ ...draft, accrualTrigger: e.target.value })}>
                {TRIGGERS.map((x) => (
                  <option key={x} value={x}>{t(`sales.commissions.accrualTrigger.${x}`)}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('sales.commissions.pointsPerLead')}</span>
              <input type="number" min="0" step="1" className="ae-input" value={draft.pointsPerLead}
                onChange={(e) => setDraft({ ...draft, pointsPerLead: Number(e.target.value) })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('sales.commissions.flatAmount')}</span>
              <input type="number" min="0" step="any" className="ae-input" value={draft.commissionFlatAmount}
                onChange={(e) => setDraft({ ...draft, commissionFlatAmount: Number(e.target.value) })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('sales.commissions.percent')}</span>
              <input type="number" min="0" max="100" step="any" className="ae-input" value={draft.commissionPercent}
                onChange={(e) => setDraft({ ...draft, commissionPercent: Number(e.target.value) })} />
            </label>
          </div>

          <div className="mt-3 grid gap-2">
            {([
              ['autoJournalEnabled', 'sales.commissions.autoJournalEnabled'],
              ['partialAccrualOnReceipt', 'sales.commissions.partialAccrualOnReceipt'],
              ['includeCommissionInPayroll', 'sales.commissions.includeCommissionInPayroll'],
              ['policyRequiredSetting', 'sales.commissions.policyRequiredSetting'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={Boolean(draft[key])}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} />
                <span>{t(label)}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t('sales.commissions.partialAccrualHint')}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t('sales.commissions.complianceHint')}</p>

          {draft.commissionTiers.length > 0 && (
            <div className="ae-table-wrap mt-4">
              <table className="ae-table">
                <thead>
                  <tr>
                    <th>{t('sales.commissions.currentTier')}</th>
                    <th>{t('sales.commissions.achievement')}</th>
                    <th>{t('sales.commissions.percent')}</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.commissionTiers.map((tier, i) => (
                    <tr key={i}>
                      <td>{tier.label}</td>
                      <td className="text-xs">
                        {num(tier.minPercent)}% → {tier.maxPercent === null ? '∞' : `${num(tier.maxPercent)}%`}
                      </td>
                      <td className="font-bold">{num(tier.commissionPercent)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button type="button" className="ae-btn-primary mt-3" disabled={busy}
            onClick={() => void call('/sales/commissions', 'PUT', draft as unknown as Record<string, unknown>,
              'sales.commissions.settingsSaved')}>
            {t('common.save')}
          </button>
        </Panel>
      )}

      {manage && accounts.length > 0 && (
        <Panel title={t('sales.commissions.allMarketers')}>
          <div className="ae-toolbar mb-3">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('sales.commissions.selectMarketer')}</span>
              <select className="ae-input" value={selected} onChange={(e) => { setSelected(e.target.value); setPayout(null); }}>
                <option value="">—</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.userName}</option>)}
              </select>
            </label>
          </div>

          <div className="ae-table-wrap">
            <table className="ae-table">
              <thead>
                <tr>
                  <th>{t('sales.team.member')}</th>
                  <th>{t('sales.commissions.balance')}</th>
                  <th>{t('sales.commissions.points')}</th>
                  <th>{t('sales.commissions.target')}</th>
                  {manage && <th aria-label={t('quotes.actions')} />}
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.userName}</td>
                    <td className="font-bold">{money(a.commissionBalance, a.currencyCode)}</td>
                    <td>{num(a.pointsBalance)}</td>
                    <td className="text-xs">
                      {a.targetType === 'LEADS' ? num(a.targetLeads) : money(a.targetValue, a.currencyCode)}
                    </td>
                    {manage && (
                      <td>
                        {/* Only meaningful when there is something to pay. */}
                        {a.commissionBalance > 0 && (
                          <button type="button" className="ae-btn-ghost px-2 py-1 text-xs"
                            onClick={() => {
                              setSelected(a.id);
                              setPayout({ amount: String(a.commissionBalance), bankAccountId: banks[0]?.id ?? '' });
                            }}>
                            {t('sales.commissions.payout')}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {payout && chosen && (
            <div className="ae-section-card mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('bank.amount')}</span>
                <input type="number" min="0" step="any" className="ae-input" value={payout.amount}
                  onChange={(e) => setPayout({ ...payout, amount: e.target.value })} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('sales.commissions.payoutBankAccount')}</span>
                <select className="ae-input" value={payout.bankAccountId}
                  onChange={(e) => setPayout({ ...payout, bankAccountId: e.target.value })}>
                  <option value="">—</option>
                  {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <div className="flex gap-2">
                <button type="button" className="ae-btn-primary" disabled={busy || Number(payout.amount) <= 0}
                  onClick={async () => {
                    // Money leaving: named amount, named recipient, asked before it goes.
                    if (!window.confirm(`${t('sales.commissions.payout')} · ${chosen.userName} · ${money(Number(payout.amount), chosen.currencyCode)}`)) return;
                    const ok = await call(`/sales/commissions/${chosen.id}/payout`, 'POST', {
                      amount: Number(payout.amount),
                      bankAccountId: payout.bankAccountId || null,
                    }, 'sales.commissions.payoutDone');
                    if (ok) setPayout(null);
                  }}>
                  {t('sales.commissions.payout')}
                </button>
                <button type="button" className="ae-btn-ghost" onClick={() => setPayout(null)}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
