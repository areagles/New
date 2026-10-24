'use client';

/**
 * The treasury — what cash exists, in which currency, and every movement of it.
 *
 * Balances here are not a summary. Unlike the dashboard, which drops the currencies holding
 * nothing because they are noise beside the ones that matter, this page lists every currency
 * the tenant has an account in: an account at zero is still an account, and its absence would
 * read as though it had never been opened.
 *
 * Most movements are not made here. A receipt collected or paid moves the treasury by itself,
 * which is why the ledger shows RECEIPT_IN and RECEIPT_OUT rows nobody typed. The two things
 * this screen can do are the two the rest of the system has no document for: moving cash in or
 * out without a receipt behind it, and converting between currencies.
 *
 * A conversion is stored as two rows — CONVERT_OUT from one currency, CONVERT_IN into the
 * other — because that is what happened to the two accounts. Each row names its counterpart
 * so the pair still reads as one event.
 *
 * The conversion preview does the server's arithmetic with the server's own published rates:
 * `to = amount × rateToBase(from) ÷ rateToBase(to)`. It is a preview, not an authority — the
 * rate is re-read when the conversion is actually made, and a refresh in between will move it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

type Balance = { currencyCode: string; balance: number; label: string; symbol: string; updatedAt: string };
type Currency = { code: string; label: string; isBase: boolean; isActive: boolean; rateToBase: number };

type MoveType = 'RECEIPT_IN' | 'RECEIPT_OUT' | 'MANUAL_IN' | 'MANUAL_OUT' | 'CONVERT_IN' | 'CONVERT_OUT';

type Move = {
  id: string;
  moveType: MoveType;
  currencyCode: string;
  amount: number;
  amountBase: number;
  baseCurrency: string;
  pairCurrencyCode: string | null;
  pairAmount: number | null;
  description: string | null;
  createdAt: string;
};

/**
 * `inventory.error.insufficient_stock` reads "الرصيد غير كافٍ" — the system's own wording for
 * exactly this condition, and the only entry either dictionary has for it.
 */
const ERROR_KEY: Record<string, string> = {
  insufficient_balance: 'inventory.error.insufficient_stock',
  invalid_manual_move: 'treasury.manualFailed',
  invalid_convert: 'treasury.convertFailed',
};

export default function TreasuryPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const [balances, setBalances] = useState<Balance[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [panel, setPanel] = useState<null | 'manual' | 'convert'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [currencyCode, setCurrencyCode] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [fromCurrency, setFromCurrency] = useState('');
  const [toCurrency, setToCurrency] = useState('');

  const money = useCallback(
    (v: number, currency: string) =>
      new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
        style: 'currency', currency, maximumFractionDigits: 2,
      }).format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [b, c, m] = await Promise.all([
        api<Balance[]>('/treasury/balances'),
        api<Currency[]>('/currencies'),
        api<Move[]>('/treasury/moves'),
      ]);
      setBalances(Array.isArray(b) ? b : []);
      setCurrencies((Array.isArray(c) ? c : []).filter((x) => x.isActive));
      setMoves(Array.isArray(m) ? m : []);
    } catch (err) {
      setFailed(err instanceof ApiError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const base = currencies.find((c) => c.isBase);

  // Seed the selectors once the currency list is known, rather than guessing a code.
  useEffect(() => {
    if (!base) return;
    setCurrencyCode((v) => v || base.code);
    setFromCurrency((v) => v || base.code);
    setToCurrency((v) => v || currencies.find((c) => !c.isBase)?.code || '');
  }, [base, currencies]);

  const rate = useCallback(
    (code: string) => currencies.find((c) => c.code === code)?.rateToBase ?? 1,
    [currencies],
  );

  /** Every account restated in the base currency — the one figure that adds up. */
  const totalBase = useMemo(
    () => balances.reduce((s, b) => s + b.balance * rate(b.currencyCode), 0),
    [balances, rate],
  );

  const converted = useMemo(() => {
    const n = Number(amount || 0);
    if (!n || !fromCurrency || !toCurrency || fromCurrency === toCurrency) return null;
    return (n * rate(fromCurrency)) / rate(toCurrency);
  }, [amount, fromCurrency, toCurrency, rate]);

  function openPanel(which: 'manual' | 'convert') {
    setPanel(which);
    setError(null);
    setFlash(null);
    setAmount('');
    setDescription('');
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      if (panel === 'manual') {
        await api('/treasury/manual', {
          method: 'POST',
          body: { direction, currencyCode, amount: Number(amount), description: description.trim() || undefined },
        });
        setFlash('treasury.manualSaved');
      } else {
        await api('/treasury/convert', {
          method: 'POST',
          body: { fromCurrency, toCurrency, amount: Number(amount) },
        });
        setFlash('treasury.converted');
      }
      setPanel(null);
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(ERROR_KEY[code] ?? (panel === 'manual' ? 'treasury.manualFailed' : 'treasury.convertFailed'));
    } finally {
      setBusy(false);
    }
  }

  const manage = can('finance.treasury.manage');

  const manualReady = currencyCode !== '' && Number(amount) > 0;
  const convertReady =
    fromCurrency !== '' && toCurrency !== '' && fromCurrency !== toCurrency && Number(amount) > 0;

  /**
   * Direction comes from the type, never from the number.
   *
   * `ae_treasury_record_move` is handed a signed amount but stores `abs()` of it — the sign is
   * applied to the balance and the ledger keeps magnitudes. So every row's amount is positive,
   * and `_OUT` is the only thing that says money left.
   */
  const isOutflow = (m: Move) => m.moveType.endsWith('_OUT');

  return (
    <div className="ae-page">
      <PageHero
        title={t('treasury.title')}
        actions={
          manage && panel === null ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="ae-btn-primary" onClick={() => openPanel('manual')}>
                {t('treasury.manualMove')}
              </button>
              <button type="button" className="ae-btn-secondary" onClick={() => openPanel('convert')}>
                {t('treasury.convert')}
              </button>
            </div>
          ) : undefined
        }
      />

      {failed && <p className="ae-flash ae-flash--error mb-4">{t('treasury.loadFailed')}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash)}</p>}

      {panel !== null && (
        <Panel
          title={t(panel === 'manual' ? 'treasury.manualMove' : 'treasury.convert')}
          className="ae-form-panel mb-4"
        >
          {error && <p className="ae-flash ae-flash--error mb-3">{t(error)}</p>}

          {panel === 'manual' ? (
            <>
              <div className="mb-4">
                <span className="mb-1 block text-sm font-bold">{t('treasury.direction')}</span>
                <div className="ae-tab-pills">
                  {(['IN', 'OUT'] as const).map((d) => (
                    <button key={d} type="button" onClick={() => setDirection(d)}
                      className={`ae-tab-pill ${direction === d ? 'is-active' : ''}`}>
                      {t(d === 'IN' ? 'treasury.deposit' : 'treasury.withdraw')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('treasury.currency')}</span>
                  <select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} className="ae-input w-full">
                    {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('treasury.amount')}</span>
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={amount}
                    onChange={(e) => setAmount(e.target.value)} className="ae-input w-full" />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('treasury.description')}</span>
                  <input value={description} onChange={(e) => setDescription(e.target.value)} className="ae-input w-full" />
                </label>
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('treasury.fromCurrency')}</span>
                  <select value={fromCurrency} onChange={(e) => setFromCurrency(e.target.value)} className="ae-input w-full">
                    {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('treasury.toCurrency')}</span>
                  <select value={toCurrency} onChange={(e) => setToCurrency(e.target.value)} className="ae-input w-full">
                    {currencies.filter((c) => c.code !== fromCurrency)
                      .map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('treasury.amount')}</span>
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={amount}
                    onChange={(e) => setAmount(e.target.value)} className="ae-input w-full" />
                </label>
              </div>

              {converted != null && (
                <p className="ae-alert-pill ae-alert-pill--info mt-4 inline-block text-xs">
                  {t('treasury.preview')} {money(converted, toCurrency)}
                </p>
              )}
            </>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="ae-btn-primary"
              disabled={busy || !(panel === 'manual' ? manualReady : convertReady)}
              onClick={() => void submit()}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" className="ae-btn-ghost" onClick={() => setPanel(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </Panel>
      )}

      <Panel title={t('treasury.balances')} className="mb-4">
        {loading ? (
          <Skeleton rows={2} />
        ) : (
          <div className="ae-dash-metrics-grid">
            {base && (
              <div className="ae-stat-card ae-stat-card--featured">
                <p className="ae-stat-label">{t('accounting.balance')}</p>
                <p className={`ae-stat-value ${totalBase < 0 ? 'ae-stat-value--danger' : ''}`}>
                  {money(totalBase, base.code)}
                </p>
              </div>
            )}
            {balances.map((b) => (
              <div key={b.currencyCode} className="ae-stat-card">
                <p className="ae-stat-label">{b.label}</p>
                <p className={`ae-stat-value ${b.balance < 0 ? 'ae-stat-value--danger' : ''}`}>
                  {money(b.balance, b.currencyCode)}
                </p>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={t('treasury.moves')}>
        {loading ? (
          <Skeleton rows={6} />
        ) : moves.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
        ) : (
          <div className="ae-table-wrap">
            <table className="ae-table ae-table--rows">
              <thead>
                <tr>
                  <th>{t('treasury.date')}</th>
                  <th>{t('treasury.moveType')}</th>
                  <th>{t('treasury.amount')}</th>
                  <th>{t('treasury.description')}</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td dir="ltr" className="whitespace-nowrap">{m.createdAt}</td>
                    <td>
                      <span className={`ae-badge ${isOutflow(m) ? 'ae-badge-info' : 'ae-badge-success'}`}>
                        {t(`treasury.moveType.${m.moveType}`)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      {/* The stored figure is a magnitude; the sign is restored for reading. */}
                      <span className={isOutflow(m) ? undefined : 'ae-stat-value--success'}>
                        {isOutflow(m) ? '−' : ''}{money(m.amount, m.currencyCode)}
                      </span>
                      {/* A conversion is two rows; each names the other so the pair reads as one. */}
                      {m.pairCurrencyCode && m.pairAmount != null && (
                        <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                          {isOutflow(m) ? t('treasury.toCurrency') : t('treasury.fromCurrency')}{' '}
                          {money(m.pairAmount, m.pairCurrencyCode)}
                        </span>
                      )}
                      {/* Foreign currency only means something restated in the base one. */}
                      {m.currencyCode !== m.baseCurrency && (
                        <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                          {isOutflow(m) ? '−' : ''}{money(m.amountBase, m.baseCurrency)}
                        </span>
                      )}
                    </td>
                    <td>{m.description ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
