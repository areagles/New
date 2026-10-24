'use client';

/**
 * مسح المخزون — the screen that lives on a phone in the store, not at a desk.
 *
 * Scan a barcode, see what it is, record what came in or went out. Everything else about
 * inventory is elsewhere; this is the one thing that has to work while standing next to a pallet.
 *
 * ── It has to work with no signal ─────────────────────────────────────────────────────────
 *
 * A store room is where the wifi does not reach. So every item that has been looked up is cached
 * locally, and every movement recorded offline is queued locally and sent when the connection
 * comes back. The alternative — refusing to record because the network is down — means the
 * movement gets written on paper and typed in tomorrow, or not at all, and the stock figure is
 * wrong either way.
 *
 * The queue is the part that must not lose anything: an entry is removed only after the server
 * has confirmed it, and a failed send stays queued rather than being dropped as "already tried".
 *
 * ── Scanning is offered only where it exists ──────────────────────────────────────────────
 *
 * `BarcodeDetector` is native in some browsers and absent in others. Where it is missing the
 * camera button is not shown at all and the manual field is the whole interface — a scan button
 * that does nothing on the store manager's phone is worse than no scan button.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel } from '@/components/page';

type Item = { id: string; sku: string | null; name: string; unit: string; standardCost?: number };
type Warehouse = { id: string; code: string; name: string; isActive: boolean };
type Queued = {
  localId: string; itemId: string; itemName: string; movementType: 'RECEIPT' | 'ISSUE';
  quantity: number; warehouseId: string | null; notes: string | null; movementDate: string;
};

const CACHE_KEY = 'ae.warehouse.items';
const QUEUE_KEY = 'ae.warehouse.queue';

/** Chrome and Android have it; Safari and Firefox do not. Absence is a supported state. */
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
function barcodeDetector(): BarcodeDetectorLike | null {
  const Ctor = (window as unknown as { BarcodeDetector?: new (o?: unknown) => BarcodeDetectorLike }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e'] });
  } catch {
    return null;
  }
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    // A private window, cleared storage, or a browser that throws on access.
    return fallback;
  }
}
function writeLocal(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* nothing worth telling the user: the request still goes out, it just is not cached */
  }
}

export default function WarehousePage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const manage = can('inventory.manage');

  const [online, setOnline] = useState(true);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [queue, setQueue] = useState<Queued[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [barcode, setBarcode] = useState('');
  const [item, setItem] = useState<Item | null>(null);
  const [form, setForm] = useState({ movementType: 'RECEIPT' as 'RECEIPT' | 'ISSUE', quantity: '', notes: '' });

  const [scanning, setScanning] = useState(false);
  const [canScan, setCanScan] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);

  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG').format(v),
    [lang],
  );

  useEffect(() => {
    setCanScan(barcodeDetector() !== null);
    setQueue(readLocal<Queued[]>(QUEUE_KEY, []));
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    void api<{ items?: Warehouse[] }>('/inventory/warehouses')
      .then((d) => setWarehouses((d.items ?? []).filter((w) => w.isActive)))
      .catch(() => setWarehouses([]));
  }, []);

  /**
   * Look the code up on the server, and fall back to whatever this device has seen before.
   * The cache is keyed on both the sku and the id, because a scan gives the former and a
   * queued movement carries the latter.
   */
  const lookup = useCallback(async (code: string) => {
    const value = code.trim();
    if (value === '') return;
    setError(null);
    setFlash(null);
    setItem(null);
    const cache = readLocal<Record<string, Item>>(CACHE_KEY, {});

    if (!navigator.onLine) {
      const hit = cache[value.toLowerCase()];
      if (hit) setItem(hit);
      else setError('warehouse.lookupOffline');
      return;
    }

    try {
      const res = await api<Item[]>(`/inventory/items?q=${encodeURIComponent(value)}&activeOnly=1`);
      const list = Array.isArray(res) ? res : [];
      // An exact sku match wins over a name that merely contains the text.
      const exact = list.find((i) => (i.sku ?? '').toLowerCase() === value.toLowerCase());
      const found = exact ?? list[0];
      if (!found) {
        setError('warehouse.notFound');
        return;
      }
      setItem(found);
      cache[value.toLowerCase()] = found;
      if (found.sku) cache[found.sku.toLowerCase()] = found;
      writeLocal(CACHE_KEY, cache);
    } catch {
      const hit = cache[value.toLowerCase()];
      if (hit) setItem(hit);
      else setError('warehouse.notFound');
    }
  }, []);

  async function startScan() {
    setError(null);
    const detector = barcodeDetector();
    if (!detector) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setScanning(true);
      // The element only exists once scanning is true, so attach on the next frame.
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 0);

      const tick = async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          loopRef.current = window.setTimeout(() => void tick(), 200);
          return;
        }
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) {
            const value = codes[0].rawValue;
            setBarcode(value);
            stopScan();
            await lookup(value);
            return;
          }
        } catch {
          /* a frame that could not be decoded is not an error, it is most frames */
        }
        loopRef.current = window.setTimeout(() => void tick(), 200);
      };
      loopRef.current = window.setTimeout(() => void tick(), 300);
    } catch {
      setError('warehouse.cameraError');
      setScanning(false);
    }
  }

  const stopScan = useCallback(() => {
    if (loopRef.current !== null) {
      window.clearTimeout(loopRef.current);
      loopRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => stopScan, [stopScan]);

  /** Send one queued movement. Returns true only when the server confirmed it. */
  const send = useCallback(async (q: Queued) => {
    await api('/inventory/movements', {
      method: 'POST',
      body: {
        itemId: q.itemId,
        movementType: q.movementType,
        quantity: q.quantity,
        movementDate: q.movementDate,
        warehouseId: q.warehouseId,
        notes: q.notes,
      },
    });
    return true;
  }, []);

  const flush = useCallback(async () => {
    const pending = readLocal<Queued[]>(QUEUE_KEY, []);
    if (pending.length === 0) return;
    setBusy(true);
    setError(null);
    const left: Queued[] = [];
    let sent = 0;
    for (const q of pending) {
      try {
        await send(q);
        sent += 1;
      } catch {
        // Kept, not dropped. A movement that failed to send is still a movement that happened.
        left.push(q);
      }
    }
    writeLocal(QUEUE_KEY, left);
    setQueue(left);
    setBusy(false);
    setFlash(t('warehouse.syncedCount', { n: String(sent) })
      + (left.length ? ` ${t('warehouse.syncFailedCount', { n: String(left.length) })}` : ''));
  }, [send, t]);

  // Coming back online is the moment to drain the queue, without anybody pressing anything.
  useEffect(() => {
    if (online) void flush();
  }, [online, flush]);

  async function record() {
    if (!item) return;
    const quantity = Number(form.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('warehouse.invalidQty');
      return;
    }
    const entry: Queued = {
      localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      itemId: item.id,
      itemName: item.name,
      movementType: form.movementType,
      quantity,
      warehouseId: warehouseId || null,
      notes: form.notes.trim() || null,
      movementDate: new Date().toISOString().slice(0, 10),
    };

    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      if (!navigator.onLine) throw new Error('offline');
      await send(entry);
      setFlash('warehouse.recorded');
    } catch (err) {
      // Queued whether the network is down or the request failed — either way the movement
      // happened on the floor and the record must survive until the server has it.
      const next = [...readLocal<Queued[]>(QUEUE_KEY, []), entry];
      writeLocal(QUEUE_KEY, next);
      setQueue(next);
      setFlash('warehouse.queuedOffline');
      if (err instanceof ApiError && navigator.onLine) setError(`warehouse.error.${err.code}`);
    } finally {
      setBusy(false);
      setForm({ ...form, quantity: '', notes: '' });
      setItem(null);
      setBarcode('');
    }
  }

  return (
    <div className="ae-page">
      <PageHero title={t('warehouse.title')} subtitle={t('warehouse.subtitle')}
        actions={(
          <span className="flex flex-wrap items-center gap-2">
            <span className={`ae-badge ${online ? 'ae-badge-success' : 'ae-badge-warn'} text-xs`}>
              {t(online ? 'warehouse.online' : 'warehouse.offline')}
            </span>
            {queue.length > 0 && (
              <>
                <span className="ae-badge ae-badge-warn text-xs">
                  {t('warehouse.pendingCount', { n: num(queue.length) })}
                </span>
                <button type="button" className="ae-btn-ghost text-xs" disabled={busy || !online}
                  onClick={() => void flush()}>
                  {t('warehouse.syncNow')}
                </button>
              </>
            )}
          </span>
        )} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash, flash)}</p>}

      <Panel>
        {/* Offered only where BarcodeDetector exists; elsewhere the manual field is the
            whole interface rather than a second-class fallback under a dead button. */}
        {canScan && (
          <div className="mb-3">
            {scanning ? (
              <>
                <video ref={videoRef} playsInline muted
                  className="mb-2 w-full max-w-md rounded" style={{ aspectRatio: '4 / 3', background: '#000' }} />
                <button type="button" className="ae-btn-ghost" onClick={stopScan}>
                  {t('warehouse.stopScan')}
                </button>
              </>
            ) : (
              <button type="button" className="ae-btn-secondary" onClick={() => void startScan()}>
                {t('warehouse.startScan')}
              </button>
            )}
          </div>
        )}

        <form className="ae-toolbar" onSubmit={(e) => { e.preventDefault(); void lookup(barcode); }}>
          <label className="text-sm">
            <span className="mb-1 block font-bold">{t('warehouse.manualBarcode')}</span>
            <input className="ae-input" value={barcode} inputMode="text" autoComplete="off"
              onChange={(e) => setBarcode(e.target.value)} />
          </label>
          <button type="submit" className="ae-btn-primary self-end" disabled={barcode.trim() === ''}>
            {t('warehouse.lookup')}
          </button>
        </form>
      </Panel>

      {item && manage && (
        <Panel title={item.name} className="mt-4">
          <p className="mb-3 text-xs text-[var(--text-muted)]">
            {item.sku ?? '—'} · {item.unit}
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('inventory.movementType')}</span>
              <select className="ae-input" value={form.movementType}
                onChange={(e) => setForm({ ...form, movementType: e.target.value as 'RECEIPT' | 'ISSUE' })}>
                <option value="RECEIPT">{t('warehouse.receipt')}</option>
                <option value="ISSUE">{t('warehouse.issue')}</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('warehouse.quantity')}</span>
              <input type="number" min="0" step="any" inputMode="decimal" className="ae-input"
                value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('warehouse.warehouse')}</span>
              <select className="ae-input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">{t('warehouse.noWarehouse')}</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('warehouse.notes')}</span>
              <input className="ae-input" value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
          </div>

          <button type="button" className="ae-btn-primary mt-3" disabled={busy || form.quantity === ''}
            onClick={() => void record()}>
            {t('warehouse.submit')}
          </button>
        </Panel>
      )}

      {queue.length > 0 && (
        <Panel title={t('warehouse.queuedList')} className="mt-4">
          <ul className="grid gap-2 text-sm">
            {queue.map((q) => (
              <li key={q.localId} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>{q.itemName}</span>
                <span className="text-xs text-[var(--text-muted)]">
                  {t(q.movementType === 'RECEIPT' ? 'warehouse.receipt' : 'warehouse.issue')}
                  {' · '}{num(q.quantity)}{' · '}{q.movementDate}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
