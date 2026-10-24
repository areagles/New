'use client';

/**
 * Carton board costing.
 *
 * A corrugated board is a stack of liners and flutes — three to twenty-five of them — each cut
 * from its own paper at its own grammage. The cost of one running metre of board is the sum of
 * what each layer costs over the roll's width, using the same weight-from-grammage formula the
 * print calculator uses for a sheet.
 *
 * ── What this number is, and what it is not ───────────────────────────────────────────────
 *
 * It is the board material, and nothing else. The server's own note says the production,
 * finishing and margin stages are still to come, so a metre rate here is a cost floor, not a
 * price. The screen says so rather than letting the figure be mistaken for one — quoting off it
 * unchanged would sell the board at what the paper cost.
 *
 * ── No preview ────────────────────────────────────────────────────────────────────────────
 *
 * The API costs a board when it stores it; there is no calculate-without-saving endpoint. Rather
 * than reimplement the layer arithmetic here to fill that gap — a second version that would
 * drift from the one records are made of — the entry is saved and the cost comes back with it.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Panel, Skeleton } from '@/components/page';
import { selectableParties } from '@/lib/parties';

type CartonPaper = { id: string; name: string; pricePerTon: number; isActive?: boolean };
type Layer = { paperId: string; gsm: number; paperName?: string | null; costPerRunningMeter?: number };
type BoardRecord = {
  id: string; jobId: string | null; lineType: string; rollWidthCm: number;
  layerCount: number; layers: Layer[]; fluteShape: string; cuttingMethod: string;
  costPerRunningMeter: number; createdAt: string;
};
type Client = { id: string; name: string; isActive?: boolean };

const FLUTES = ['E', 'B', 'C', 'BC', 'Micro'] as const;
const CUTTING = ['opening', 'breaking'] as const;
/** The server rejects anything outside this; the form holds itself to the same bounds. */
const MIN_LAYERS = 3;
const MAX_LAYERS = 25;

export function CartonPricing({ manage, clients }: { manage: boolean; clients: Client[] }) {
  const { t, lang } = useI18n();

  const [papers, setPapers] = useState<CartonPaper[]>([]);
  const [records, setRecords] = useState<BoardRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lineType, setLineType] = useState('');
  const [rollWidthCm, setRollWidthCm] = useState('');
  const [fluteShape, setFluteShape] = useState<string>('B');
  const [cuttingMethod, setCuttingMethod] = useState<string>('opening');
  const [layers, setLayers] = useState<{ paperId: string; gsm: string }[]>(
    Array.from({ length: MIN_LAYERS }, () => ({ paperId: '', gsm: '' })),
  );

  /** Turning a board into a work order needs a client and how many metres of it are wanted. */
  const [convert, setConvert] = useState<{ id: string; clientId: string; meters: string } | null>(null);

  const money = useCallback(
    (v: number, digits = 2) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency: 'EGP', maximumFractionDigits: digits,
    }).format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, r] = await Promise.all([
        api<{ items?: CartonPaper[] }>('/pricing/carton-papers'),
        api<{ items?: BoardRecord[] }>('/pricing/carton-boards'),
      ]);
      setPapers(p.items ?? []);
      setRecords(r.items ?? []);
    } catch {
      setError('common.error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setLayer = (i: number, patch: Partial<{ paperId: string; gsm: string }>) =>
    setLayers((ls) => ls.map((l, x) => (x === i ? { ...l, ...patch } : l)));

  const complete = lineType.trim() !== '' && Number(rollWidthCm) > 0
    && layers.every((l) => l.paperId !== '' && Number(l.gsm) > 0);

  async function saveBoard() {
    setBusy(true);
    setError(null);
    try {
      await api('/pricing/carton-boards', {
        method: 'POST',
        body: {
          lineType: lineType.trim(),
          rollWidthCm: Number(rollWidthCm),
          fluteShape,
          cuttingMethod,
          layers: layers.map((l) => ({ paperId: l.paperId, gsm: Number(l.gsm) })),
        },
      });
      setLineType('');
      setRollWidthCm('');
      setLayers(Array.from({ length: MIN_LAYERS }, () => ({ paperId: '', gsm: '' })));
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      // The server names what it rejected; anything else would leave the user guessing.
      setError(code ? `carton.error.${code}` : 'common.error');
    } finally {
      setBusy(false);
    }
  }

  async function toJob() {
    if (!convert) return;
    setBusy(true);
    setError(null);
    try {
      await api('/pricing/create-job-from-record', {
        method: 'POST',
        body: {
          recordType: 'carton_board',
          recordId: convert.id,
          clientId: convert.clientId,
          quantity: Number(convert.meters),
        },
      });
      setConvert(null);
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code === 'already_linked' ? 'carton.error.already_linked' : 'common.error');
    } finally {
      setBusy(false);
    }
  }

  async function removeRecord(id: string) {
    if (!window.confirm(t('pricing.calc.confirmDelete'))) return;
    setBusy(true);
    try {
      await api(`/pricing/carton-boards/${id}`, { method: 'DELETE' });
      await load();
    } catch {
      setError('common.error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Panel><Skeleton rows={6} /></Panel>;

  return (
    <div className="grid gap-4">
      {error && <p className="ae-flash ae-flash--error">{t(error, t('common.error'))}</p>}

      {papers.length === 0 && (
        <p className="ae-alert-pill ae-alert-pill--warn block text-xs">{t('pricing.empty')}</p>
      )}

      {manage && papers.length > 0 && (
        <Panel title={t('cartonBoard.title')} className="ae-form-panel">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('cartonBoard.lineType')}</span>
              <input className="ae-input" value={lineType} onChange={(e) => setLineType(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('cartonBoard.rollWidth')}</span>
              <input type="number" min="0" step="any" className="ae-input"
                value={rollWidthCm} onChange={(e) => setRollWidthCm(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('cartonBoard.fluteShape')}</span>
              <select className="ae-input" value={fluteShape} onChange={(e) => setFluteShape(e.target.value)}>
                {FLUTES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('cartonBoard.cuttingMethod')}</span>
              <select className="ae-input" value={cuttingMethod} onChange={(e) => setCuttingMethod(e.target.value)}>
                {CUTTING.map((c) => (
                  <option key={c} value={c}>{t(`cartonBoard.cuttingMethod.${c}`)}</option>
                ))}
              </select>
            </label>
          </div>

          <h4 className="mb-2 mt-4 text-sm font-bold">{t('cartonBoard.layers')} ({layers.length})</h4>
          <div className="grid gap-2">
            {layers.map((l, i) => (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_10rem_auto]">
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-bold">{t('cartonBoard.paperType')} {i + 1}</span>
                  <select className="ae-input" value={l.paperId}
                    onChange={(e) => setLayer(i, { paperId: e.target.value })}>
                    <option value="">—</option>
                    {papers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-bold">{t('cartonBoard.weight')}</span>
                  <input type="number" min="0" step="any" className="ae-input"
                    value={l.gsm} onChange={(e) => setLayer(i, { gsm: e.target.value })} />
                </label>
                <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                  disabled={layers.length <= MIN_LAYERS}
                  onClick={() => setLayers((ls) => ls.filter((_, x) => x !== i))}>
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="ae-btn-secondary text-xs"
              disabled={layers.length >= MAX_LAYERS}
              onClick={() => setLayers((ls) => [...ls, { paperId: '', gsm: '' }])}>
              {t('carton.addLayer')}
            </button>
            <button type="button" className="ae-btn-primary" disabled={busy || !complete}
              onClick={() => void saveBoard()}>
              {t('common.save')}
            </button>
          </div>
        </Panel>
      )}

      <Panel title={t('cartonBoard.costPerRunningMeter')}>
        {/* Stated once, where the number is read. The server's own module note says the
            production and margin stages are still to come. */}
        <p className="mb-3 text-xs text-[var(--text-muted)]">{t('carton.materialOnly')}</p>
        {records.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t('cartonBoard.empty')}</p>
        ) : (
          <div className="ae-table-wrap">
            <table className="ae-table">
              <thead>
                <tr>
                  <th>{t('cartonBoard.lineType')}</th>
                  <th>{t('cartonBoard.rollWidth')}</th>
                  <th>{t('cartonBoard.layerCount')}</th>
                  <th>{t('cartonBoard.fluteShape')}</th>
                  <th>{t('cartonBoard.cuttingMethod')}</th>
                  <th>{t('cartonBoard.costPerRunningMeter')}</th>
                  <th aria-label={t('quotes.actions')} />
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td>{r.lineType}</td>
                    <td>{r.rollWidthCm} {t('cartonBoard.cm')}</td>
                    <td>{r.layerCount}</td>
                    <td>{r.fluteShape}</td>
                    <td>{t(`cartonBoard.cuttingMethod.${r.cuttingMethod}`, r.cuttingMethod)}</td>
                    <td>{money(r.costPerRunningMeter, 4)} / {t('cartonBoard.meter')}</td>
                    <td><span className="flex flex-wrap gap-1">
                      {manage && (
                        r.jobId
                          // A board already turned into a job cannot be converted twice; the API
                          // answers already_linked, so the link is offered instead of the button.
                          ? <a className="ae-btn-ghost px-3 py-1 text-xs" href={`/jobs?id=${r.jobId}`}>
                              {t('pricing.calc.openJob')}
                            </a>
                          : <>
                              <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                                onClick={() => setConvert({ id: r.id, clientId: '', meters: '' })}>
                                {t('pricing.calc.createJob')}
                              </button>
                              <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                                disabled={busy} onClick={() => void removeRecord(r.id)}>
                                {t('common.delete')}
                              </button>
                            </>
                      )}
                    </span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {convert && (
          <div className="ae-section-card mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('quotes.client')}</span>
              <select className="ae-input" value={convert.clientId}
                onChange={(e) => setConvert({ ...convert, clientId: e.target.value })}>
                <option value="">{t('jobs.selectClient')}</option>
                {selectableParties(clients, convert.clientId).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('cartonBoard.metersQty')}</span>
              <input type="number" min="1" step="any" className="ae-input"
                value={convert.meters} onChange={(e) => setConvert({ ...convert, meters: e.target.value })} />
            </label>
            <div className="flex gap-2">
              <button type="button" className="ae-btn-primary"
                disabled={busy || convert.clientId === '' || Number(convert.meters) <= 0}
                onClick={() => void toJob()}>
                {t('pricing.calc.createJob')}
              </button>
              <button type="button" className="ae-btn-ghost" onClick={() => setConvert(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
