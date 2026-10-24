'use client';

/**
 * Plastic costing — three stages that hand results to each other.
 *
 *   السحب     a blend of materials is extruded into a roll: total kg, width, thickness.
 *   الطباعة   colours are printed at a coverage each, priced per colour by machine type.
 *   التقطيع   the roll is cut into pieces — or delivered as rolls and not cut at all.
 *
 * The chain is what makes this more than three calculators on one screen. Extrusion stores the
 * blend's weighted-average density along with the roll's width and thickness, so cutting can
 * work out what one piece of a given length weighs, and from the batch weight how many pieces
 * come out of it. That is why cutting asks for an extrusion entry rather than re-asking for the
 * blend: the piece count is derived, never typed, and cannot contradict the batch it came from.
 *
 * Each stage is costed by the server when it is stored — as in the carton module, there is no
 * preview endpoint, and reimplementing the arithmetic here would create a second version of it.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Panel, Skeleton } from '@/components/page';
import { selectableParties } from '@/lib/parties';

type Material = { id: string; name: string; pricePerKg: number; densityKgM3: number };
type ExtMachine = { id: string; name: string; runningCostPerKg: number; electricityCostPerKg: number; laborCostPerKg: number };
type PrnMachine = { id: string; name: string; machineType: string; pricePerColor: number };
type CutMachine = { id: string; name: string; runningCostPerPiece: number; electricityCostPerPiece: number; laborCostPerPiece: number };

type ExtRecord = {
  id: string; jobId: string | null; totalKg: number; rollWidthCm: number; thicknessMicron: number;
  effectiveDensityKgM3: number; materials: { materialName?: string | null; ratioPercent: number; kg?: number; cost?: number }[];
  materialsCost: number; machineName: string | null; wastePercent: number;
  extrusionCost: number; totalCost: number;
};
type PrnRecord = {
  id: string; jobId: string | null; machineName: string | null; machineType: string | null;
  colors: { name: string; coveragePercent: number; cost: number }[]; printingCost: number;
};
type CutRecord = {
  id: string; jobId: string | null; deliverAsRolls: boolean; lengthCm: number;
  weightPerPieceKg: number; quantityPieces: number; machineName: string | null; cuttingCost: number;
};
type Client = { id: string; name: string; isActive?: boolean };

const MACHINE_TYPES = ['roto', 'center_drum', 'flexo'] as const;

type Stage = 'extrusion' | 'printing' | 'cutting' | 'master';

export function PlasticPricing({ manage, clients }: { manage: boolean; clients: Client[] }) {
  const { t, lang } = useI18n();

  const [stage, setStage] = useState<Stage>('extrusion');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [materials, setMaterials] = useState<Material[]>([]);
  const [extMachines, setExtMachines] = useState<ExtMachine[]>([]);
  const [prnMachines, setPrnMachines] = useState<PrnMachine[]>([]);
  const [cutMachines, setCutMachines] = useState<CutMachine[]>([]);
  const [extRecords, setExtRecords] = useState<ExtRecord[]>([]);
  const [prnRecords, setPrnRecords] = useState<PrnRecord[]>([]);
  const [cutRecords, setCutRecords] = useState<CutRecord[]>([]);

  const [ext, setExt] = useState({ totalKg: '', rollWidthCm: '', thicknessMicron: '', machineId: '', wastePercent: '' });
  const [blend, setBlend] = useState<{ materialId: string; ratioPercent: string }[]>([{ materialId: '', ratioPercent: '' }]);
  const [prn, setPrn] = useState({ machineId: '', cylinderCount: '', repeatLength: '', printProcess: '', inkType: '', printSides: '', colorSequence: '' });
  const [colors, setColors] = useState<{ name: string; coveragePercent: string }[]>([{ name: '', coveragePercent: '' }]);
  const [cut, setCut] = useState({ deliverAsRolls: false, extrusionRecordId: '', lengthCm: '', machineId: '', wastePercent: '' });

  const [newMaterial, setNewMaterial] = useState({ name: '', pricePerKg: '', densityKgM3: '' });
  const [newExtM, setNewExtM] = useState({ name: '', runningCostPerKg: '', electricityCostPerKg: '', laborCostPerKg: '' });
  const [newPrnM, setNewPrnM] = useState({ name: '', machineType: 'roto', pricePerColor: '' });
  const [newCutM, setNewCutM] = useState({ name: '', runningCostPerPiece: '', electricityCostPerPiece: '', laborCostPerPiece: '' });

  /**
   * Extrusion carries its batch weight and cutting its derived piece count, so converting those
   * needs only a client. Printing is priced per piece and carries no quantity of its own — the
   * server multiplies by whatever is sent and defaults to one, so it has to be asked for.
   */
  const [convert, setConvert] = useState<{ type: string; id: string; clientId: string; quantity: string } | null>(null);

  const money = useCallback(
    (v: number, digits = 2) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency: 'EGP', maximumFractionDigits: digits,
    }).format(v),
    [lang],
  );
  const num = useCallback(
    (v: number, digits = 2) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', { maximumFractionDigits: digits }).format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, em, pm, cm, er, pr, cr] = await Promise.all([
        api<{ items?: Material[] }>('/pricing/plastic-materials'),
        api<{ items?: ExtMachine[] }>('/pricing/plastic-extrusion-machines'),
        api<{ items?: PrnMachine[] }>('/pricing/plastic-printing-machines'),
        api<{ items?: CutMachine[] }>('/pricing/plastic-cutting-machines'),
        api<{ items?: ExtRecord[] }>('/pricing/plastic-extrusion-records'),
        api<{ items?: PrnRecord[] }>('/pricing/plastic-printing-records'),
        api<{ items?: CutRecord[] }>('/pricing/plastic-cutting-records'),
      ]);
      setMaterials(m.items ?? []);
      setExtMachines(em.items ?? []);
      setPrnMachines(pm.items ?? []);
      setCutMachines(cm.items ?? []);
      setExtRecords(er.items ?? []);
      setPrnRecords(pr.items ?? []);
      setCutRecords(cr.items ?? []);
    } catch {
      setError('common.error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(path: string, body: Record<string, unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body });
      after?.();
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      // The module names each rejection; showing the name beats a generic failure.
      setError(code ? `plastic.error.${code}` : 'common.error');
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

  async function toJob() {
    if (!convert) return;
    setBusy(true);
    setError(null);
    try {
      await api('/pricing/create-job-from-record', {
        method: 'POST',
        body: {
          recordType: convert.type, recordId: convert.id, clientId: convert.clientId,
          ...(convert.type === 'plastic_printing' ? { quantity: Number(convert.quantity) } : {}),
        },
      });
      setConvert(null);
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code ? `plastic.error.${code}` : 'common.error');
    } finally {
      setBusy(false);
    }
  }

  /** The blend must add up to exactly 100 — the server rejects anything half a point off. */
  const ratioTotal = blend.reduce((sum, b) => sum + Number(b.ratioPercent || 0), 0);
  const blendOk = Math.abs(ratioTotal - 100) <= 0.5 && blend.every((b) => b.materialId !== '');
  const extOk = Number(ext.totalKg) > 0 && Number(ext.rollWidthCm) > 0
    && Number(ext.thicknessMicron) > 0 && ext.machineId !== '' && blendOk;

  const field = (label: string, value: string, onChange: (v: string) => void, type: 'number' | 'text' = 'number') => (
    <label className="text-sm">
      <span className="mb-1 block font-bold">{t(label)}</span>
      <input type={type} min={type === 'number' ? '0' : undefined} step="any" className="ae-input"
        value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );

  const jobCell = (type: string, id: string, jobId: string | null, deletePath: string) => (
    <td><span className="flex flex-wrap gap-1">
      {manage && (
        jobId
          ? <a className="ae-btn-ghost px-3 py-1 text-xs" href={`/jobs?id=${jobId}`}>{t('pricing.calc.openJob')}</a>
          : <>
              <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                onClick={() => setConvert({ type, id, clientId: '', quantity: '' })}>{t('pricing.calc.createJob')}</button>
              <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                disabled={busy} onClick={() => void remove(deletePath)}>{t('common.delete')}</button>
            </>
      )}
      </span></td>
  );

  if (loading) return <Panel><Skeleton rows={8} /></Panel>;

  return (
    <div className="grid gap-4">
      {error && <p className="ae-flash ae-flash--error">{t(error, t('common.error'))}</p>}

      <div className="ae-tab-pills">
        {([
          ['extrusion', 'plasticExtrusion.title'],
          ['printing', 'plasticPrinting.title'],
          ['cutting', 'plasticCutting.title'],
          ['master', 'plasticPricing.masterData'],
        ] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setStage(k); setError(null); }}
            className={`ae-tab-pill ${stage === k ? 'is-active' : ''}`}>{t(l)}</button>
        ))}
      </div>

      {stage === 'extrusion' && (
        <>
          {manage && materials.length > 0 && extMachines.length > 0 && (
            <Panel title={t('plasticExtrusion.title')} className="ae-form-panel">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {field('plasticExtrusion.totalKg', ext.totalKg, (v) => setExt({ ...ext, totalKg: v }))}
                {field('plasticExtrusion.rollWidthCm', ext.rollWidthCm, (v) => setExt({ ...ext, rollWidthCm: v }))}
                {field('plasticExtrusion.thicknessMicron', ext.thicknessMicron, (v) => setExt({ ...ext, thicknessMicron: v }))}
                {field('plasticExtrusion.wastePercent', ext.wastePercent, (v) => setExt({ ...ext, wastePercent: v }))}
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('plasticExtrusion.machine')}</span>
                  <select className="ae-input" value={ext.machineId} onChange={(e) => setExt({ ...ext, machineId: e.target.value })}>
                    <option value="">—</option>
                    {extMachines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
              </div>

              <h4 className="mb-2 mt-4 text-sm font-bold">
                {t('plasticExtrusion.materialsBlend')} — {t('plasticExtrusion.ratioTotal')} {num(ratioTotal)}%
              </h4>
              <div className="grid gap-2">
                {blend.map((b, i) => (
                  <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_10rem_auto]">
                    <label className="text-sm">
                      <span className="mb-1 block text-xs font-bold">{t('plasticExtrusion.material')}</span>
                      <select className="ae-input" value={b.materialId}
                        onChange={(e) => setBlend(blend.map((x, j) => (j === i ? { ...x, materialId: e.target.value } : x)))}>
                        <option value="">—</option>
                        {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs font-bold">%</span>
                      <input type="number" min="0" max="100" step="any" className="ae-input" value={b.ratioPercent}
                        onChange={(e) => setBlend(blend.map((x, j) => (j === i ? { ...x, ratioPercent: e.target.value } : x)))} />
                    </label>
                    <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={blend.length <= 1}
                      onClick={() => setBlend(blend.filter((_, j) => j !== i))}>{t('common.delete')}</button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="ae-btn-secondary text-xs"
                  onClick={() => setBlend([...blend, { materialId: '', ratioPercent: '' }])}>
                  {t('plasticExtrusion.addMaterial')}
                </button>
                <button type="button" className="ae-btn-primary" disabled={busy || !extOk}
                  onClick={() => void post('/pricing/plastic-extrusion-records', {
                    totalKg: Number(ext.totalKg), rollWidthCm: Number(ext.rollWidthCm),
                    thicknessMicron: Number(ext.thicknessMicron), machineId: ext.machineId,
                    wastePercent: Number(ext.wastePercent || 0),
                    materials: blend.map((b) => ({ materialId: b.materialId, ratioPercent: Number(b.ratioPercent || 0) })),
                  }, () => { setExt({ totalKg: '', rollWidthCm: '', thicknessMicron: '', machineId: '', wastePercent: '' }); setBlend([{ materialId: '', ratioPercent: '' }]); })}>
                  {t('common.save')}
                </button>
              </div>
            </Panel>
          )}

          <Panel title={t('plasticExtrusion.title')}>
            {extRecords.length === 0 ? <p className="text-sm text-[var(--text-muted)]">{t('plasticExtrusion.empty')}</p> : (
              <div className="ae-table-wrap">
                <table className="ae-table">
                  <thead>
                    <tr>
                      <th>{t('plasticExtrusion.totalKg')}</th>
                      <th>{t('plasticExtrusion.rollWidthCm')}</th>
                      <th>{t('plasticExtrusion.thicknessMicron')}</th>
                      <th>{t('plasticPricing.densityKgM3')}</th>
                      <th>{t('plasticExtrusion.machine')}</th>
                      <th>{t('plasticExtrusion.materialsCost')}</th>
                      <th>{t('plasticExtrusion.extrusionCost')}</th>
                      <th>{t('plasticExtrusion.totalCost')}</th>
                      <th aria-label={t('quotes.actions')} />
                    </tr>
                  </thead>
                  <tbody>
                    {extRecords.map((r) => (
                      <tr key={r.id}>
                        <td>{num(r.totalKg)} {t('plasticPricing.kg')}</td>
                        <td>{num(r.rollWidthCm)}</td>
                        <td>{num(r.thicknessMicron)}</td>
                        <td>{num(r.effectiveDensityKgM3)}</td>
                        <td>{r.machineName ?? '—'}</td>
                        <td>{money(r.materialsCost)}</td>
                        <td>{money(r.extrusionCost)}</td>
                        <td className="font-bold">{money(r.totalCost)}</td>
                        {jobCell('plastic_extrusion', r.id, r.jobId, `/pricing/plastic-extrusion-records/${r.id}`)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      {stage === 'printing' && (
        <>
          {manage && prnMachines.length > 0 && (
            <Panel title={t('plasticPrinting.title')} className="ae-form-panel">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('plasticPrinting.machine')}</span>
                  <select className="ae-input" value={prn.machineId} onChange={(e) => setPrn({ ...prn, machineId: e.target.value })}>
                    <option value="">—</option>
                    {prnMachines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · {t(`plasticPrinting.machineType.${m.machineType}`, m.machineType)}
                      </option>
                    ))}
                  </select>
                </label>
                {field('plasticPrinting.cylinderCount', prn.cylinderCount, (v) => setPrn({ ...prn, cylinderCount: v }))}
                {field('plasticPrinting.repeatLength', prn.repeatLength, (v) => setPrn({ ...prn, repeatLength: v }))}
                {field('plasticPrinting.inkType', prn.inkType, (v) => setPrn({ ...prn, inkType: v }), 'text')}
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('plasticPrinting.printProcess')}</span>
                  <select className="ae-input" value={prn.printProcess} onChange={(e) => setPrn({ ...prn, printProcess: e.target.value })}>
                    <option value="">—</option>
                    {(['gravure', 'flexo'] as const).map((k) => (
                      <option key={k} value={k}>{t(`plasticPrinting.printProcess.${k}`)}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('plasticPrinting.printSides')}</span>
                  <select className="ae-input" value={prn.printSides} onChange={(e) => setPrn({ ...prn, printSides: e.target.value })}>
                    <option value="">—</option>
                    {(['single', 'double'] as const).map((k) => (
                      <option key={k} value={k}>{t(`plasticPrinting.printSides.${k}`)}</option>
                    ))}
                  </select>
                </label>
                {field('plasticPrinting.colorSequence', prn.colorSequence, (v) => setPrn({ ...prn, colorSequence: v }), 'text')}
              </div>

              <h4 className="mb-2 mt-4 text-sm font-bold">{t('plasticPrinting.colors')} ({colors.length})</h4>
              <div className="grid gap-2">
                {colors.map((c, i) => (
                  <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_10rem_auto]">
                    <label className="text-sm">
                      <span className="mb-1 block text-xs font-bold">{t('plasticPrinting.colorName')}</span>
                      <input className="ae-input" value={c.name}
                        onChange={(e) => setColors(colors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs font-bold">{t('plasticPrinting.coveragePercent')}</span>
                      <input type="number" min="0" max="100" step="any" className="ae-input" value={c.coveragePercent}
                        onChange={(e) => setColors(colors.map((x, j) => (j === i ? { ...x, coveragePercent: e.target.value } : x)))} />
                    </label>
                    <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={colors.length <= 1}
                      onClick={() => setColors(colors.filter((_, j) => j !== i))}>{t('common.delete')}</button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="ae-btn-secondary text-xs"
                  onClick={() => setColors([...colors, { name: '', coveragePercent: '' }])}>
                  {t('plasticPrinting.addColor')}
                </button>
                <button type="button" className="ae-btn-primary"
                  disabled={busy || prn.machineId === '' || colors.every((c) => Number(c.coveragePercent) <= 0)}
                  onClick={() => void post('/pricing/plastic-printing-records', {
                    ...prn,
                    colors: colors.map((c) => ({ name: c.name.trim(), coveragePercent: Number(c.coveragePercent || 0) })),
                  }, () => { setPrn({ machineId: '', cylinderCount: '', repeatLength: '', printProcess: '', inkType: '', printSides: '', colorSequence: '' }); setColors([{ name: '', coveragePercent: '' }]); })}>
                  {t('common.save')}
                </button>
              </div>
            </Panel>
          )}

          <Panel title={t('plasticPrinting.title')}>
            {prnRecords.length === 0 ? <p className="text-sm text-[var(--text-muted)]">{t('plasticPrinting.empty')}</p> : (
              <div className="ae-table-wrap">
                <table className="ae-table">
                  <thead>
                    <tr>
                      <th>{t('plasticPrinting.machine')}</th>
                      <th>{t('plasticPrinting.colors')}</th>
                      <th>{t('plasticPrinting.printingCost')}</th>
                      <th aria-label={t('quotes.actions')} />
                    </tr>
                  </thead>
                  <tbody>
                    {prnRecords.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.machineName ?? '—'}
                          {r.machineType && ` · ${t(`plasticPrinting.machineType.${r.machineType}`, r.machineType)}`}
                        </td>
                        <td className="text-xs">
                          {r.colors.map((c) => `${c.name || t('plasticPricing.color')} ${num(c.coveragePercent)}%`).join(' · ')}
                        </td>
                        <td className="font-bold">{money(r.printingCost, 4)} / {t('plasticPricing.piece')}</td>
                        {jobCell('plastic_printing', r.id, r.jobId, `/pricing/plastic-printing-records/${r.id}`)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      {stage === 'cutting' && (
        <>
          {manage && (
            <Panel title={t('plasticCutting.title')} className="ae-form-panel">
              <label className="mb-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cut.deliverAsRolls}
                  onChange={(e) => setCut({ ...cut, deliverAsRolls: e.target.checked })} />
                <span>{t('plasticCutting.deliverAsRolls')}</span>
              </label>

              {/* Rolls go out uncut, so none of the cutting inputs apply and the server
                  discards them. Hiding them is the honest form of that. */}
              {!cut.deliverAsRolls && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="text-sm">
                    <span className="mb-1 block font-bold">{t('plasticCutting.extrusionRecord')}</span>
                    <select className="ae-input" value={cut.extrusionRecordId}
                      onChange={(e) => setCut({ ...cut, extrusionRecordId: e.target.value })}>
                      <option value="">—</option>
                      {extRecords.map((r) => (
                        <option key={r.id} value={r.id}>
                          {num(r.totalKg)} {t('plasticPricing.kg')} · {num(r.rollWidthCm)} {t('cartonBoard.cm')} · {num(r.thicknessMicron)} {t('plastic.micron')}
                        </option>
                      ))}
                    </select>
                  </label>
                  {field('plasticCutting.lengthCm', cut.lengthCm, (v) => setCut({ ...cut, lengthCm: v }))}
                  {field('plasticCutting.wastePercent', cut.wastePercent, (v) => setCut({ ...cut, wastePercent: v }))}
                  <label className="text-sm">
                    <span className="mb-1 block font-bold">{t('plasticCutting.machine')}</span>
                    <select className="ae-input" value={cut.machineId} onChange={(e) => setCut({ ...cut, machineId: e.target.value })}>
                      <option value="">—</option>
                      {cutMachines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </label>
                </div>
              )}

              <button type="button" className="ae-btn-primary mt-3"
                disabled={busy || (!cut.deliverAsRolls && (cut.extrusionRecordId === '' || Number(cut.lengthCm) <= 0 || cut.machineId === ''))}
                onClick={() => void post('/pricing/plastic-cutting-records', {
                  deliverAsRolls: cut.deliverAsRolls,
                  extrusionRecordId: cut.extrusionRecordId,
                  lengthCm: Number(cut.lengthCm || 0),
                  machineId: cut.machineId,
                  wastePercent: Number(cut.wastePercent || 0),
                }, () => setCut({ deliverAsRolls: false, extrusionRecordId: '', lengthCm: '', machineId: '', wastePercent: '' }))}>
                {t('common.save')}
              </button>
            </Panel>
          )}

          <Panel title={t('plasticCutting.title')}>
            {cutRecords.length === 0 ? <p className="text-sm text-[var(--text-muted)]">{t('plasticCutting.empty')}</p> : (
              <div className="ae-table-wrap">
                <table className="ae-table">
                  <thead>
                    <tr>
                      <th>{t('plasticCutting.machine')}</th>
                      <th>{t('plasticCutting.lengthCm')}</th>
                      <th>{t('plasticCutting.weightPerPiece')}</th>
                      <th>{t('plasticCutting.derivedQuantity')}</th>
                      <th>{t('plasticCutting.cuttingCost')}</th>
                      <th aria-label={t('quotes.actions')} />
                    </tr>
                  </thead>
                  <tbody>
                    {cutRecords.map((r) => (
                      <tr key={r.id}>
                        <td>{r.deliverAsRolls ? t('plasticCutting.deliverAsRolls') : (r.machineName ?? '—')}</td>
                        <td>{r.deliverAsRolls ? '—' : num(r.lengthCm)}</td>
                        <td>{r.deliverAsRolls ? '—' : `${num(r.weightPerPieceKg, 6)} ${t('plasticPricing.kg')}`}</td>
                        <td>{r.deliverAsRolls ? '—' : `${num(r.quantityPieces, 0)} ${t('plasticPricing.piece')}`}</td>
                        <td className="font-bold">{r.deliverAsRolls ? '—' : money(r.cuttingCost)}</td>
                        {jobCell('plastic_cutting', r.id, r.jobId, `/pricing/plastic-cutting-records/${r.id}`)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      {stage === 'master' && (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <Panel title={t('plasticExtrusion.material')}>
            {manage && (
              <div className="mb-3 grid gap-2">
                <input className="ae-input" placeholder={t('plasticPricing.materialName')} value={newMaterial.name}
                  onChange={(e) => setNewMaterial({ ...newMaterial, name: e.target.value })} />
                <input type="number" min="0" step="any" className="ae-input" placeholder={t('plasticPricing.pricePerKg')}
                  value={newMaterial.pricePerKg} onChange={(e) => setNewMaterial({ ...newMaterial, pricePerKg: e.target.value })} />
                <input type="number" min="0" step="any" className="ae-input" placeholder={t('plasticPricing.densityKgM3')}
                  value={newMaterial.densityKgM3} onChange={(e) => setNewMaterial({ ...newMaterial, densityKgM3: e.target.value })} />
                <button type="button" className="ae-btn-secondary text-xs" disabled={busy || !newMaterial.name.trim()}
                  onClick={() => void post('/pricing/plastic-materials', {
                    name: newMaterial.name.trim(), pricePerKg: Number(newMaterial.pricePerKg || 0),
                    densityKgM3: Number(newMaterial.densityKgM3 || 0),
                  }, () => setNewMaterial({ name: '', pricePerKg: '', densityKgM3: '' }))}>
                  {t('plasticPricing.addMaterial')}
                </button>
              </div>
            )}
            <ul className="space-y-2 text-sm">
              {materials.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span>{m.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-bold">{money(m.pricePerKg)} · {num(m.densityKgM3)}</span>
                    {manage && (
                      <button type="button" aria-label={t('common.delete')} className="ae-icon-btn ae-icon-btn-danger"
                        onClick={() => void remove(`/pricing/plastic-materials/${m.id}`)}>✕</button>
                    )}
                  </span>
                </li>
              ))}
              {materials.length === 0 && <li className="text-[var(--text-muted)]">{t('pricing.empty')}</li>}
            </ul>
          </Panel>

          <Panel title={t('plasticExtrusion.machine')}>
            {manage && (
              <div className="mb-3 grid gap-2">
                <input className="ae-input" placeholder={t('plasticPricing.machineName')} value={newExtM.name}
                  onChange={(e) => setNewExtM({ ...newExtM, name: e.target.value })} />
                {(['runningCostPerKg', 'electricityCostPerKg', 'laborCostPerKg'] as const).map((k) => (
                  <input key={k} type="number" min="0" step="any" className="ae-input"
                    placeholder={t(`plasticExtrusion.${k}`)} value={newExtM[k]}
                    onChange={(e) => setNewExtM({ ...newExtM, [k]: e.target.value })} />
                ))}
                <button type="button" className="ae-btn-secondary text-xs" disabled={busy || !newExtM.name.trim()}
                  onClick={() => void post('/pricing/plastic-extrusion-machines', {
                    name: newExtM.name.trim(),
                    runningCostPerKg: Number(newExtM.runningCostPerKg || 0),
                    electricityCostPerKg: Number(newExtM.electricityCostPerKg || 0),
                    laborCostPerKg: Number(newExtM.laborCostPerKg || 0),
                  }, () => setNewExtM({ name: '', runningCostPerKg: '', electricityCostPerKg: '', laborCostPerKg: '' }))}>
                  {t('plasticPricing.addExtrusionMachine')}
                </button>
              </div>
            )}
            <ul className="space-y-2 text-sm">
              {extMachines.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span>{m.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-bold">{money(m.runningCostPerKg + m.electricityCostPerKg + m.laborCostPerKg, 4)}</span>
                    {manage && (
                      <button type="button" aria-label={t('common.delete')} className="ae-icon-btn ae-icon-btn-danger"
                        onClick={() => void remove(`/pricing/plastic-extrusion-machines/${m.id}`)}>✕</button>
                    )}
                  </span>
                </li>
              ))}
              {extMachines.length === 0 && <li className="text-[var(--text-muted)]">{t('pricing.empty')}</li>}
            </ul>
          </Panel>

          <Panel title={t('plasticPrinting.machine')}>
            {manage && (
              <div className="mb-3 grid gap-2">
                <input className="ae-input" placeholder={t('plasticPricing.machineName')} value={newPrnM.name}
                  onChange={(e) => setNewPrnM({ ...newPrnM, name: e.target.value })} />
                <select className="ae-input" value={newPrnM.machineType}
                  onChange={(e) => setNewPrnM({ ...newPrnM, machineType: e.target.value })}>
                  {MACHINE_TYPES.map((k) => <option key={k} value={k}>{t(`plasticPrinting.machineType.${k}`)}</option>)}
                </select>
                <input type="number" min="0" step="any" className="ae-input" placeholder={t('plasticPrinting.pricePerColor')}
                  value={newPrnM.pricePerColor} onChange={(e) => setNewPrnM({ ...newPrnM, pricePerColor: e.target.value })} />
                <button type="button" className="ae-btn-secondary text-xs" disabled={busy || !newPrnM.name.trim()}
                  onClick={() => void post('/pricing/plastic-printing-machines', {
                    name: newPrnM.name.trim(), machineType: newPrnM.machineType,
                    pricePerColor: Number(newPrnM.pricePerColor || 0),
                  }, () => setNewPrnM({ name: '', machineType: 'roto', pricePerColor: '' }))}>
                  {t('plasticPricing.addPrintingMachine')}
                </button>
              </div>
            )}
            <ul className="space-y-2 text-sm">
              {prnMachines.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span>{m.name} · {t(`plasticPrinting.machineType.${m.machineType}`, m.machineType)}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-bold">{money(m.pricePerColor, 4)}</span>
                    {manage && (
                      <button type="button" aria-label={t('common.delete')} className="ae-icon-btn ae-icon-btn-danger"
                        onClick={() => void remove(`/pricing/plastic-printing-machines/${m.id}`)}>✕</button>
                    )}
                  </span>
                </li>
              ))}
              {prnMachines.length === 0 && <li className="text-[var(--text-muted)]">{t('pricing.empty')}</li>}
            </ul>
          </Panel>

          <Panel title={t('plasticCutting.machine')}>
            {manage && (
              <div className="mb-3 grid gap-2">
                <input className="ae-input" placeholder={t('plasticPricing.machineName')} value={newCutM.name}
                  onChange={(e) => setNewCutM({ ...newCutM, name: e.target.value })} />
                {(['runningCostPerPiece', 'electricityCostPerPiece', 'laborCostPerPiece'] as const).map((k) => (
                  <input key={k} type="number" min="0" step="any" className="ae-input"
                    placeholder={t(`plasticCutting.${k}`)} value={newCutM[k]}
                    onChange={(e) => setNewCutM({ ...newCutM, [k]: e.target.value })} />
                ))}
                <button type="button" className="ae-btn-secondary text-xs" disabled={busy || !newCutM.name.trim()}
                  onClick={() => void post('/pricing/plastic-cutting-machines', {
                    name: newCutM.name.trim(),
                    runningCostPerPiece: Number(newCutM.runningCostPerPiece || 0),
                    electricityCostPerPiece: Number(newCutM.electricityCostPerPiece || 0),
                    laborCostPerPiece: Number(newCutM.laborCostPerPiece || 0),
                  }, () => setNewCutM({ name: '', runningCostPerPiece: '', electricityCostPerPiece: '', laborCostPerPiece: '' }))}>
                  {t('plasticPricing.addCuttingMachine')}
                </button>
              </div>
            )}
            <ul className="space-y-2 text-sm">
              {cutMachines.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span>{m.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-bold">{money(m.runningCostPerPiece + m.electricityCostPerPiece + m.laborCostPerPiece, 4)}</span>
                    {manage && (
                      <button type="button" aria-label={t('common.delete')} className="ae-icon-btn ae-icon-btn-danger"
                        onClick={() => void remove(`/pricing/plastic-cutting-machines/${m.id}`)}>✕</button>
                    )}
                  </span>
                </li>
              ))}
              {cutMachines.length === 0 && <li className="text-[var(--text-muted)]">{t('pricing.empty')}</li>}
            </ul>
          </Panel>
        </div>
      )}

      {convert && (
        <Panel>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
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
            {convert.type === 'plastic_printing' && (
              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('plasticPrinting.quantityPieces')}</span>
                <input type="number" min="1" step="any" className="ae-input" value={convert.quantity}
                  onChange={(e) => setConvert({ ...convert, quantity: e.target.value })} />
              </label>
            )}
            <div className="flex gap-2">
              <button type="button" className="ae-btn-primary"
                disabled={busy || convert.clientId === ''
                  || (convert.type === 'plastic_printing' && Number(convert.quantity) <= 0)}
                onClick={() => void toJob()}>{t('pricing.calc.createJob')}</button>
              <button type="button" className="ae-btn-ghost" onClick={() => setConvert(null)}>{t('common.cancel')}</button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
