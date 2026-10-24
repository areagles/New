'use client';

/**
 * The two price books, both keyed on an inventory item.
 *
 * ── قائمة الأسعار — what we sell it for ──────────────────────────────────────────────────
 *
 * An entry is a price for an item, optionally for one client, optionally from a minimum
 * quantity, optionally inside a date window. Several can apply at once, so the lookup decides:
 * a client's own price beats the general one, and among those the highest minimum quantity the
 * order clears wins — which is how a tiered price ("from 5,000 up") is expressed here.
 *
 * The lookup is offered on this screen rather than left as an API detail. Entering four
 * overlapping tiers and not being able to ask which one a given order would actually get is how
 * a price book quietly starts lying.
 *
 * ── أسعار الموردين — what we pay for it ──────────────────────────────────────────────────
 *
 * The same item quoted by several suppliers, each with a lead time. The cheapest is marked, but
 * cheapest is not always the answer — a supplier three days faster can be worth the difference —
 * so the mark sits next to the lead time rather than replacing the comparison.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Panel, Skeleton } from '@/components/page';
import { selectableParties } from '@/lib/parties';

type Item = { id: string; name: string; isActive?: boolean };
type Party = { id: string; name: string; isActive?: boolean };

type PriceEntry = {
  id: string; itemId: string; itemName: string | null; clientId: string | null; clientName: string | null;
  unitPrice: number; minQuantity: number; currencyCode: string;
  validFrom: string | null; validTo: string | null; notes: string | null;
};
type SupplierPrice = {
  id: string; supplierId: string; supplierName: string | null; itemId: string; itemName: string | null;
  unitPrice: number; minQuantity: number; currencyCode: string; quotedAt: string;
  validFrom: string | null; validTo: string | null; leadTimeDays: number | null; notes: string | null;
};

export function PriceLists({ mode, manage, clients }: {
  mode: 'sell' | 'buy';
  manage: boolean;
  clients: Party[];
}) {
  const { t, lang } = useI18n();

  const [items, setItems] = useState<Item[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [entries, setEntries] = useState<PriceEntry[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<SupplierPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [itemFilter, setItemFilter] = useState('');
  const [newEntry, setNewEntry] = useState({ itemId: '', clientId: '', unitPrice: '', minQuantity: '', validFrom: '', validTo: '' });
  const [newSupplier, setNewSupplier] = useState({ itemId: '', supplierId: '', unitPrice: '', minQuantity: '', leadTimeDays: '', validFrom: '', validTo: '' });

  /** Asking the price book what an order of this size, for this client, would actually get. */
  const [probe, setProbe] = useState({ itemId: '', clientId: '', qty: '' });
  const [probeResult, setProbeResult] = useState<PriceEntry | null | 'none'>(null);

  const money = useCallback(
    (v: number, currency = 'EGP') => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(v),
    [lang],
  );
  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG').format(v),
    [lang],
  );
  /** Dates arrive as plain ISO strings; left raw they read in Latin digits beside Arabic ones. */
  const date = useCallback(
    (v: string | null) => (v ? new Date(v).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB') : '—'),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = itemFilter ? `?itemId=${encodeURIComponent(itemFilter)}` : '';
      const [it, sp, rows] = await Promise.all([
        api<Item[]>('/inventory/items').catch(() => [] as Item[]),
        mode === 'buy' ? api<Party[]>('/suppliers').catch(() => [] as Party[]) : Promise.resolve([] as Party[]),
        mode === 'sell'
          ? api<{ items?: PriceEntry[] }>(`/pricing/price-list${q}`)
          : api<{ items?: SupplierPrice[] }>(`/pricing/supplier-prices${q}`),
      ]);
      setItems(Array.isArray(it) ? it : []);
      setSuppliers(Array.isArray(sp) ? sp : []);
      if (mode === 'sell') setEntries((rows as { items?: PriceEntry[] }).items ?? []);
      else setSupplierPrices((rows as { items?: SupplierPrice[] }).items ?? []);
    } catch {
      setError('common.error');
    } finally {
      setLoading(false);
    }
  }, [mode, itemFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(path: string, body: Record<string, unknown>, reset: () => void) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body });
      reset();
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code === 'invalid_payload' ? 'priceList.error.invalid_payload' : 'common.error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(path: string) {
    if (!window.confirm(t('pricing.calc.confirmDelete'))) return;
    setBusy(true);
    try {
      await api(path, { method: 'DELETE' });
      await load();
    } catch {
      setError('common.error');
    } finally {
      setBusy(false);
    }
  }

  async function runProbe() {
    setBusy(true);
    setError(null);
    setProbeResult(null);
    try {
      const params = new URLSearchParams({ itemId: probe.itemId, qty: probe.qty || '1' });
      if (probe.clientId) params.set('clientId', probe.clientId);
      const res = await api<{ match?: PriceEntry | null }>(`/pricing/price-list/lookup?${params}`);
      // A null match is an answer, not a failure: nothing in the book covers this order.
      setProbeResult(res.match ?? 'none');
    } catch {
      setError('common.error');
    } finally {
      setBusy(false);
    }
  }

  /** Cheapest per item, so a row can be marked without recomputing it in the render. */
  const cheapestByItem = supplierPrices.reduce<Record<string, number>>((acc, p) => {
    if (acc[p.itemId] === undefined || p.unitPrice < acc[p.itemId]) acc[p.itemId] = p.unitPrice;
    return acc;
  }, {});

  if (loading) return <Panel><Skeleton rows={6} /></Panel>;

  const itemSelect = (value: string, onChange: (v: string) => void, blank: string) => (
    <select className="ae-input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{blank}</option>
      {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
    </select>
  );

  return (
    <div className="grid gap-4">
      {error && <p className="ae-flash ae-flash--error">{t(error, t('common.error'))}</p>}

      {items.length === 0 && (
        <p className="ae-alert-pill ae-alert-pill--warn block text-xs">{t('pricing.empty')}</p>
      )}

      {mode === 'sell' && items.length > 0 && (
        <Panel title={t('pricing.tab.priceList')} className="ae-form-panel">
          {manage && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('pricing.item')}</span>
                {itemSelect(newEntry.itemId, (v) => setNewEntry({ ...newEntry, itemId: v }), '—')}
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('quotes.client')}</span>
                <select className="ae-input" value={newEntry.clientId}
                  onChange={(e) => setNewEntry({ ...newEntry, clientId: e.target.value })}>
                  {/* Left empty the entry is the general price, which is why the blank option
                      says so rather than reading as an unmade choice. */}
                  <option value="">{t('pricing.generalPrice')}</option>
                  {selectableParties(clients, newEntry.clientId).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('pricing.unitPrice')}</span>
                <input type="number" min="0" step="any" className="ae-input" value={newEntry.unitPrice}
                  onChange={(e) => setNewEntry({ ...newEntry, unitPrice: e.target.value })} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('pricing.minQuantity')}</span>
                <input type="number" min="0" step="any" className="ae-input" value={newEntry.minQuantity}
                  onChange={(e) => setNewEntry({ ...newEntry, minQuantity: e.target.value })} />
                <span className="mt-1 block text-xs text-[var(--text-muted)]">{t('pricing.minQuantityHint')}</span>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('pricing.validity')}</span>
                <input type="date" className="ae-input" value={newEntry.validFrom}
                  onChange={(e) => setNewEntry({ ...newEntry, validFrom: e.target.value })} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-bold">&nbsp;</span>
                <input type="date" className="ae-input" value={newEntry.validTo}
                  onChange={(e) => setNewEntry({ ...newEntry, validTo: e.target.value })} />
              </label>
              <button type="button" className="ae-btn-secondary self-end text-xs"
                disabled={busy || newEntry.itemId === '' || Number(newEntry.unitPrice) <= 0}
                onClick={() => void add('/pricing/price-list', {
                  itemId: newEntry.itemId,
                  clientId: newEntry.clientId || null,
                  unitPrice: Number(newEntry.unitPrice),
                  minQuantity: Number(newEntry.minQuantity || 0),
                  validFrom: newEntry.validFrom || null,
                  validTo: newEntry.validTo || null,
                }, () => setNewEntry({ itemId: '', clientId: '', unitPrice: '', minQuantity: '', validFrom: '', validTo: '' }))}>
                {t('common.save')}
              </button>
            </div>
          )}

          {/* Overlapping tiers are the point of the book and the risk in it — this says which
              one an order of a given size would actually be charged. */}
          <div className="ae-section-card grid gap-3 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('pricing.item')}</span>
              {itemSelect(probe.itemId, (v) => { setProbe({ ...probe, itemId: v }); setProbeResult(null); }, '—')}
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('quotes.client')}</span>
              <select className="ae-input" value={probe.clientId}
                onChange={(e) => { setProbe({ ...probe, clientId: e.target.value }); setProbeResult(null); }}>
                <option value="">{t('pricing.generalPrice')}</option>
                {selectableParties(clients, probe.clientId).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('quotes.quantity')}</span>
              <input type="number" min="1" step="any" className="ae-input" value={probe.qty}
                onChange={(e) => { setProbe({ ...probe, qty: e.target.value }); setProbeResult(null); }} />
            </label>
            <button type="button" className="ae-btn-primary" disabled={busy || probe.itemId === ''}
              onClick={() => void runProbe()}>
              {t('pricing.calc.calculate')}
            </button>
            {probeResult !== null && (
              <p className="text-sm sm:col-span-4">
                {probeResult === 'none'
                  ? <span className="text-[var(--text-muted)]">{t('common.noResults')}</span>
                  : (
                    <span className="font-bold">
                      {money(probeResult.unitPrice, probeResult.currencyCode)}
                      {' — '}
                      {probeResult.clientName ?? t('pricing.generalPrice')}
                      {probeResult.minQuantity > 0 && ` · ${t('pricing.minQuantity')} ${num(probeResult.minQuantity)}`}
                    </span>
                  )}
              </p>
            )}
          </div>
        </Panel>
      )}

      {mode === 'buy' && items.length > 0 && manage && (
        <Panel title={t('pricing.tab.supplierPrices')} className="ae-form-panel">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('pricing.item')}</span>
              {itemSelect(newSupplier.itemId, (v) => setNewSupplier({ ...newSupplier, itemId: v }), '—')}
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('purchases.supplier')}</span>
              <select className="ae-input" value={newSupplier.supplierId}
                onChange={(e) => setNewSupplier({ ...newSupplier, supplierId: e.target.value })}>
                <option value="">—</option>
                {selectableParties(suppliers, newSupplier.supplierId).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('pricing.unitPrice')}</span>
              <input type="number" min="0" step="any" className="ae-input" value={newSupplier.unitPrice}
                onChange={(e) => setNewSupplier({ ...newSupplier, unitPrice: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('pricing.minQuantity')}</span>
              <input type="number" min="0" step="any" className="ae-input" value={newSupplier.minQuantity}
                onChange={(e) => setNewSupplier({ ...newSupplier, minQuantity: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('priceList.leadTimeDays')}</span>
              <input type="number" min="0" step="1" className="ae-input" value={newSupplier.leadTimeDays}
                onChange={(e) => setNewSupplier({ ...newSupplier, leadTimeDays: e.target.value })} />
            </label>
            <button type="button" className="ae-btn-secondary self-end text-xs"
              disabled={busy || newSupplier.itemId === '' || newSupplier.supplierId === '' || Number(newSupplier.unitPrice) <= 0}
              onClick={() => void add('/pricing/supplier-prices', {
                itemId: newSupplier.itemId,
                supplierId: newSupplier.supplierId,
                unitPrice: Number(newSupplier.unitPrice),
                minQuantity: Number(newSupplier.minQuantity || 0),
                leadTimeDays: newSupplier.leadTimeDays === '' ? null : Number(newSupplier.leadTimeDays),
              }, () => setNewSupplier({ itemId: '', supplierId: '', unitPrice: '', minQuantity: '', leadTimeDays: '', validFrom: '', validTo: '' }))}>
              {t('common.save')}
            </button>
          </div>
        </Panel>
      )}

      <Panel title={t(mode === 'sell' ? 'pricing.tab.priceList' : 'pricing.tab.supplierPrices')}>
        {items.length > 0 && (
          <div className="ae-toolbar mb-3">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('pricing.item')}</span>
              {itemSelect(itemFilter, setItemFilter, t('common.all'))}
            </label>
          </div>
        )}

        {mode === 'sell' ? (
          entries.length === 0 ? <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p> : (
            <div className="ae-table-wrap">
              <table className="ae-table">
                <thead>
                  <tr>
                    <th>{t('pricing.item')}</th>
                    <th>{t('quotes.client')}</th>
                    <th>{t('pricing.unitPrice')}</th>
                    <th>{t('pricing.minQuantity')}</th>
                    <th>{t('pricing.validity')}</th>
                    <th aria-label={t('quotes.actions')} />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td>{e.itemName ?? '—'}</td>
                      <td>{e.clientName ?? t('pricing.generalPrice')}</td>
                      <td className="font-bold">{money(e.unitPrice, e.currencyCode)}</td>
                      <td>{e.minQuantity > 0 ? num(e.minQuantity) : '—'}</td>
                      <td className="text-xs">
                        {e.validFrom || e.validTo ? `${date(e.validFrom)} → ${date(e.validTo)}` : '—'}
                      </td>
                      <td>
                        {manage && (
                          <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                            onClick={() => void remove(`/pricing/price-list/${e.id}`)}>{t('common.delete')}</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          supplierPrices.length === 0 ? <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p> : (
            <div className="ae-table-wrap">
              <table className="ae-table">
                <thead>
                  <tr>
                    <th>{t('pricing.item')}</th>
                    <th>{t('purchases.supplier')}</th>
                    <th>{t('pricing.unitPrice')}</th>
                    <th>{t('pricing.minQuantity')}</th>
                    <th>{t('priceList.leadTimeDays')}</th>
                    <th>{t('pricing.quotedAt')}</th>
                    <th aria-label={t('quotes.actions')} />
                  </tr>
                </thead>
                <tbody>
                  {supplierPrices.map((p) => (
                    <tr key={p.id}>
                      <td>{p.itemName ?? '—'}</td>
                      <td>{p.supplierName ?? '—'}</td>
                      <td className="font-bold">
                        {money(p.unitPrice, p.currencyCode)}
                        {cheapestByItem[p.itemId] === p.unitPrice && (
                          <span className="ae-badge ae-badge-success ms-2 text-xs">{t('pricing.bestPrice')}</span>
                        )}
                      </td>
                      <td>{p.minQuantity > 0 ? num(p.minQuantity) : '—'}</td>
                      <td>{p.leadTimeDays !== null ? num(p.leadTimeDays) : '—'}</td>
                      <td className="text-xs">{date(p.quotedAt)}</td>
                      <td>
                        {manage && (
                          <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                            onClick={() => void remove(`/pricing/supplier-prices/${p.id}`)}>{t('common.delete')}</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </Panel>
    </div>
  );
}
