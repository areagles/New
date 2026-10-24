'use client';

/**
 * Stock.
 *
 * The system already writes to this on its own: `ae_inventory_sync_invoice` and
 * `ae_inventory_sync_purchase` run on every document, and a finished job registers its output
 * as an item. So the shelf has been moving for a while with nowhere to look at it — the
 * dashboard's low-stock counter has been pointing at a screen that did not exist.
 *
 * ── Three movement types, and only one of them is free ────────────────────────────────────
 *
 * RECEIPT and ISSUE take a positive quantity and move the balance in the direction their name
 * implies; ADJUST takes a signed one, because a stocktake correction can go either way and
 * pretending otherwise would mean two buttons for one act of counting. The API refuses an
 * ISSUE that would take the balance below zero — `insufficient_stock` — so the remaining
 * quantity is shown next to the field rather than discovered on save.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────────────────────
 *
 * An item carries a standard cost and a moving average the system maintains from what was
 * actually paid. Both are shown because they answer different questions: what we expect a unit
 * to cost, and what it has cost. The movement form defaults to the effective one and lets it be
 * overridden, which is what the API does when the field is left out.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

type Item = {
  id: string; sku: string | null; name: string; unit: string;
  reorderLevel: number; standardCost: number; movingAvgCost: number;
  etaItemCode: string | null; isActive: boolean; notes: string | null;
  stockOnHand: number;
};

type MovementType = 'RECEIPT' | 'ISSUE' | 'ADJUST';

type Movement = {
  id: string; itemId: string; itemName: string; itemSku: string | null;
  movementDate: string; movementType: MovementType;
  quantity: number; unitCost: number; totalCost: number;
  journalPosted: boolean; notes: string | null;
};

type Warehouse = { id: string; code: string; name: string; isActive: boolean };

const TYPE_STYLE: Record<MovementType, string> = {
  RECEIPT: 'ae-badge-success',
  ISSUE: 'ae-badge-info',
  ADJUST: 'ae-badge-warn',
};

const ERROR_KEY: Record<string, string> = {
  item_name_required: 'inventory.error.item_name_required',
  item_not_found: 'inventory.error.item_not_found',
  invalid_movement: 'inventory.error.invalid_movement',
  invalid_quantity: 'inventory.error.invalid_quantity',
  insufficient_stock: 'inventory.error.insufficient_stock',
  insufficient_stock_at_warehouse: 'inventory.error.insufficient_stock_at_warehouse',
  warehouse_required: 'inventory.error.warehouse_required',
  period_closed: 'inventory.error.period_closed',
  inventory_journal_failed: 'inventory.error.inventory_journal_failed',
};

const BLANK_ITEM = { name: '', sku: '', unit: '', reorderLevel: '', standardCost: '', etaItemCode: '' };

export default function InventoryPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const [tab, setTab] = useState<'items' | 'movements' | 'warehouses'>('items');
  const [items, setItems] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [itemForm, setItemForm] = useState<typeof BLANK_ITEM & { id?: string }>({ ...BLANK_ITEM });
  const [editingItem, setEditingItem] = useState(false);
  const [moveFor, setMoveFor] = useState<Item | null>(null);
  const [move, setMove] = useState({
    movementType: 'RECEIPT' as MovementType,
    quantity: '', unitCost: '', warehouseId: '', notes: '',
    movementDate: new Date().toISOString().slice(0, 10),
  });

  const money = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency: 'EGP', maximumFractionDigits: 2,
    }).format(v),
    [lang],
  );
  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG').format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [i, m, w] = await Promise.all([
        api<Item[]>('/inventory/items'),
        api<Movement[]>('/inventory/movements'),
        api<{ items?: Warehouse[] }>('/inventory/warehouses'),
      ]);
      setItems(Array.isArray(i) ? i : []);
      setMovements(Array.isArray(m) ? m : []);
      setWarehouses(w.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? 'inventory.loadFailed' : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<void>, flashKey: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await fn();
      setFlash(flashKey);
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(ERROR_KEY[code] ?? 'common.error');
    } finally {
      setBusy(false);
    }
  }

  const manage = can('inventory.manage');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q) || (i.sku ?? '').toLowerCase().includes(q));
  }, [items, query]);

  const low = items.filter((i) => i.reorderLevel > 0 && i.stockOnHand <= i.reorderLevel);
  const stockValue = items.reduce((s, i) => s + i.stockOnHand * (i.movingAvgCost || i.standardCost), 0);

  /** What the API will charge this movement at when the field is left blank. */
  const effectiveCost = (i: Item) => i.movingAvgCost || i.standardCost;

  function openMovement(item: Item) {
    setMoveFor(item);
    setMove({
      movementType: 'RECEIPT', quantity: '', unitCost: String(effectiveCost(item) || ''),
      warehouseId: warehouses[0]?.id ?? '', notes: '',
      movementDate: new Date().toISOString().slice(0, 10),
    });
  }

  return (
    <div className="ae-page">
      <PageHero
        title={t('inventory.title')}
        actions={
          manage && tab === 'items' && !editingItem ? (
            <button type="button" className="ae-btn-primary"
              onClick={() => { setItemForm({ ...BLANK_ITEM }); setEditingItem(true); setMoveFor(null); }}>
              {t('inventory.addItem')}
            </button>
          ) : undefined
        }
      />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error)}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash)}</p>}

      <div className="ae-dash-metrics-grid mb-4">
        <div className="ae-stat-card">
          <p className="ae-stat-label">{t('inventory.totalItems')}</p>
          <p className="ae-stat-value">{num(items.length)}</p>
        </div>
        <div className="ae-stat-card">
          <p className="ae-stat-label">{t('inventory.lowStock')}</p>
          <p className={`ae-stat-value ${low.length ? 'ae-stat-value--warn' : ''}`}>{num(low.length)}</p>
        </div>
        <div className="ae-stat-card">
          <p className="ae-stat-label">{t('inventory.stockValue')}</p>
          <p className="ae-stat-value">{money(stockValue)}</p>
        </div>
      </div>

      <div className="ae-tab-pills mb-4">
        {(['items', 'movements', 'warehouses'] as const).map((x) => (
          <button key={x} type="button" onClick={() => { setTab(x); setError(null); setFlash(null); }}
            className={`ae-tab-pill ${tab === x ? 'is-active' : ''}`}>
            {t(`inventory.tab.${x}`)}
          </button>
        ))}
      </div>

      {tab === 'items' && editingItem && (
        <Panel title={t(itemForm.id ? 'inventory.editItem' : 'inventory.addItem')} className="ae-form-panel mb-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('inventory.itemName')}</span>
              <input value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} className="ae-input" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('inventory.sku')}</span>
              <input value={itemForm.sku} dir="ltr" onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value })} className="ae-input" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('inventory.unit')}</span>
              <input value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} className="ae-input" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('inventory.reorderLevel')}</span>
              <input type="number" min="0" step="any" value={itemForm.reorderLevel}
                onChange={(e) => setItemForm({ ...itemForm, reorderLevel: e.target.value })} className="ae-input" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('inventory.standardCost')}</span>
              <input type="number" min="0" step="any" value={itemForm.standardCost}
                onChange={(e) => setItemForm({ ...itemForm, standardCost: e.target.value })} className="ae-input" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('inventory.etaItemCode')}</span>
              <input value={itemForm.etaItemCode} dir="ltr"
                onChange={(e) => setItemForm({ ...itemForm, etaItemCode: e.target.value })} className="ae-input" />
            </label>
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t('inventory.etaItemCodeHint')}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="ae-btn-primary" disabled={busy || itemForm.name.trim() === ''}
              onClick={() => void run(async () => {
                const body = {
                  name: itemForm.name.trim(),
                  sku: itemForm.sku.trim() || null,
                  unit: itemForm.unit.trim() || undefined,
                  reorderLevel: Number(itemForm.reorderLevel || 0),
                  standardCost: Number(itemForm.standardCost || 0),
                  etaItemCode: itemForm.etaItemCode.trim() || null,
                };
                if (itemForm.id) await api(`/inventory/items/${itemForm.id}`, { method: 'PATCH', body });
                else await api('/inventory/items', { method: 'POST', body });
                setEditingItem(false);
              }, 'inventory.itemSaved')}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" className="ae-btn-ghost" onClick={() => setEditingItem(false)}>{t('common.cancel')}</button>
          </div>
        </Panel>
      )}

      {tab === 'items' && moveFor && (
        <Panel title={`${t('inventory.addMovement')} — ${moveFor.name}`} className="ae-form-panel mb-4">
          <div className="mb-4">
            <span className="mb-1 block text-sm font-bold">{t('inventory.movementType')}</span>
            <div className="ae-tab-pills">
              {(['RECEIPT', 'ISSUE', 'ADJUST'] as const).map((x) => (
                <button key={x} type="button" onClick={() => setMove({ ...move, movementType: x })}
                  className={`ae-tab-pill ${move.movementType === x ? 'is-active' : ''}`}>
                  {t(`inventory.type.${x}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('inventory.quantity')}</span>
              <input type="number" step="any"
                // ADJUST is the only one that takes a sign: a stocktake goes either way.
                min={move.movementType === 'ADJUST' ? undefined : '0'}
                value={move.quantity} onChange={(e) => setMove({ ...move, quantity: e.target.value })}
                className="ae-input" />
              <span className="mt-1 block text-xs text-[var(--text-muted)]">
                {t('inventory.onHand')}: {num(moveFor.stockOnHand)} {moveFor.unit}
              </span>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('pricing.unitPrice')}</span>
              <input type="number" min="0" step="any" value={move.unitCost}
                onChange={(e) => setMove({ ...move, unitCost: e.target.value })} className="ae-input" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('inventory.movementDate')}</span>
              <input type="date" value={move.movementDate}
                onChange={(e) => setMove({ ...move, movementDate: e.target.value })} className="ae-input" />
            </label>
            {warehouses.length > 0 && (
              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('inventory.movementWarehouse')}</span>
                <select value={move.warehouseId} onChange={(e) => setMove({ ...move, warehouseId: e.target.value })}
                  className="ae-input">
                  <option value="" />
                  {warehouses.filter((w) => w.isActive).map((w) => (
                    <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-bold">{t('treasury.description')}</span>
              <input value={move.notes} onChange={(e) => setMove({ ...move, notes: e.target.value })} className="ae-input" />
            </label>
          </div>

          {/* An issue larger than the shelf is refused by the API; say so before the round trip. */}
          {move.movementType === 'ISSUE' && Number(move.quantity || 0) > moveFor.stockOnHand && (
            <p className="ae-alert-pill ae-alert-pill--warn mt-3 block text-xs">
              {t('inventory.error.insufficient_stock')}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="ae-btn-primary"
              disabled={busy || Number(move.quantity || 0) === 0
                || (move.movementType === 'ISSUE' && Number(move.quantity) > moveFor.stockOnHand)}
              onClick={() => void run(async () => {
                await api('/inventory/movements', {
                  method: 'POST',
                  body: {
                    itemId: moveFor.id,
                    movementType: move.movementType,
                    quantity: Number(move.quantity),
                    unitCost: Number(move.unitCost || 0),
                    movementDate: move.movementDate,
                    warehouseId: move.warehouseId || undefined,
                    notes: move.notes.trim() || null,
                  },
                });
                setMoveFor(null);
              }, 'inventory.movementSaved')}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" className="ae-btn-ghost" onClick={() => setMoveFor(null)}>{t('common.cancel')}</button>
          </div>
        </Panel>
      )}

      {tab === 'items' && (
        <Panel
          actions={
            <div className="ae-toolbar">
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={t('inventory.sku')} className="ae-input" />
            </div>
          }
        >
          {loading ? (
            <Skeleton rows={6} />
          ) : shown.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
          ) : (
            <div className="ae-table-wrap">
              <table className="ae-table ae-table--rows">
                <thead>
                  <tr>
                    <th>{t('inventory.itemName')}</th>
                    <th>{t('inventory.onHand')}</th>
                    <th>{t('inventory.reorderLevel')}</th>
                    <th>{t('inventory.standardCost')}</th>
                    <th>{t('inventory.movingAvgCost')}</th>
                    {manage && <th>{t('users.actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i) => {
                    const isLow = i.reorderLevel > 0 && i.stockOnHand <= i.reorderLevel;
                    return (
                      <tr key={i.id} className={i.isActive ? undefined : 'opacity-60'}>
                        <td>
                          <span className="font-bold">{i.name}</span>
                          {i.sku && <span className="mt-0.5 block text-xs text-[var(--text-muted)]" dir="ltr">{i.sku}</span>}
                        </td>
                        <td>
                          <span className={isLow ? 'ae-stat-value--warn' : undefined}>
                            {num(i.stockOnHand)} {i.unit}
                          </span>
                          {isLow && (
                            <span className="ae-badge ae-badge-warn mt-1 block w-fit">{t('inventory.lowStock')}</span>
                          )}
                        </td>
                        <td>{i.reorderLevel > 0 ? num(i.reorderLevel) : '—'}</td>
                        <td>{i.standardCost > 0 ? money(i.standardCost) : '—'}</td>
                        {/* Blank until the system has actually paid for some. */}
                        <td>{i.movingAvgCost > 0 ? money(i.movingAvgCost) : t('inventory.noPurchaseHistory')}</td>
                        {manage && (
                          <td className="ae-actions-cell whitespace-nowrap">
                            <span className="ae-action-icons">
                              <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                                onClick={() => openMovement(i)}>
                                {t('inventory.addMovement')}
                              </button>
                              <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                                onClick={() => {
                                  setItemForm({
                                    id: i.id, name: i.name, sku: i.sku ?? '', unit: i.unit,
                                    reorderLevel: String(i.reorderLevel || ''),
                                    standardCost: String(i.standardCost || ''),
                                    etaItemCode: i.etaItemCode ?? '',
                                  });
                                  setEditingItem(true);
                                  setMoveFor(null);
                                }}>
                                {t('common.edit')}
                              </button>
                            </span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {tab === 'movements' && (
        <Panel title={t('inventory.tab.movements')}>
          {loading ? (
            <Skeleton rows={6} />
          ) : movements.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
          ) : (
            <div className="ae-table-wrap">
              <table className="ae-table ae-table--rows">
                <thead>
                  <tr>
                    <th>{t('inventory.movementDate')}</th>
                    <th>{t('inventory.item')}</th>
                    <th>{t('inventory.movementType')}</th>
                    <th>{t('inventory.quantity')}</th>
                    <th>{t('inventory.totalCost')}</th>
                    <th>{t('inventory.journal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td dir="ltr" className="whitespace-nowrap">{m.movementDate}</td>
                      <td>
                        {m.itemName}
                        {m.notes && <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{m.notes}</span>}
                      </td>
                      <td>
                        <span className={`ae-badge ${TYPE_STYLE[m.movementType]}`}>
                          {t(`inventory.type.${m.movementType}`)}
                        </span>
                      </td>
                      <td>{num(m.quantity)}</td>
                      <td>{m.totalCost > 0 ? money(m.totalCost) : '—'}</td>
                      <td>
                        {/* A movement with no cost posts no entry — worth distinguishing. */}
                        <span className={`ae-badge ${m.journalPosted ? 'ae-badge-success' : 'ae-badge-muted'}`}>
                          {t(m.journalPosted ? 'accounting.journals.status.POSTED' : 'accounting.journals.status.DRAFT')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {tab === 'warehouses' && (
        <Panel title={t('inventory.tab.warehouses')}>
          {warehouses.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
          ) : (
            <ul className="space-y-2">
              {warehouses.map((w) => (
                <li key={w.id} className="ae-dash-attention-row">
                  <span className="ae-dash-attention-label">
                    <span dir="ltr">{w.code}</span> · {w.name}
                  </span>
                  <span className="ae-dash-attention-detail">
                    {t(w.isActive ? 'settings.paymentActive' : 'users.reactivate')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}
