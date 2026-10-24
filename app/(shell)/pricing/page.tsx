'use client';

/**
 * Print costing.
 *
 * This is where "كام؟" becomes a number. Everything downstream — the quote, the job, the
 * invoice — starts from a figure someone works out, and until now that was done on paper and
 * typed in. The API has carried the whole model all along; it just had no screen.
 *
 * ── The calculation is the server's, not this page's ──────────────────────────────────────
 *
 * Nothing here computes a cost. The form collects inputs, `POST /pricing/calculate` returns the
 * breakdown, and the page renders what came back. That matters more than usual: the arithmetic
 * runs from sheet size and grammage through yield, waste, trays and plate multipliers to risk
 * and profit, and a second implementation in the browser would eventually disagree with the one
 * that quotes get built from.
 *
 * ── Catalogue before calculator ───────────────────────────────────────────────────────────
 *
 * A paper carries a price per ton, a machine a tray price, a minimum and a plate cost, a
 * finishing operation its own unit. Choosing one fills the form; the numbers stay editable
 * afterwards, because a supplier quotes a different price for one job often enough that
 * forcing a catalogue edit to price a job would mean the catalogue stops being true.
 *
 * The catalogue is empty on a new system, so the master-data tab comes first in the order of
 * work even though the calculator is the reason to be here.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { selectableParties } from '@/lib/parties';
import { PageHero, Panel, Skeleton } from '@/components/page';
import { CartonPricing } from '@/components/carton-pricing';
import { PlasticPricing } from '@/components/plastic-pricing';
import { PriceLists } from '@/components/price-lists';

type Paper = { id: string; name: string; pricePerTon: number; isActive: boolean };
type Machine = {
  id: string; label: string; sheetClass: 'full' | 'half' | 'quarter';
  pricePerTray: number; minTrays: number; plateCost: number; isActive: boolean;
};
type FinishOp = {
  id: string; label: string; defaultUnit: string;
  pricePiece: number; priceTray: number; sheetSensitive: boolean; allowFaces: boolean; isActive: boolean;
};

type StageRow = { label: string; value: number };
type Client = { id: string; name: string; isActive?: boolean };
type PricingRecord = {
  id: string; title: string; clientId: string | null; clientName: string | null;
  total: number; createdAt: string; input: Record<string, unknown>;
};

type Result = {
  ok: boolean; error?: string;
  qty: number; unitCost: number; total: number; subtotal: number;
  sheetCost: number; sheetYield: number;
  sheetsWithWaste: number; trays: number; plateMultiplier: number; impressions: number;
  stageRows: StageRow[];
  finishingRows: StageRow[];
};

const PRINT_MODES = ['single', 'work_turn', 'double_plates'] as const;
const SHEET_CLASSES = ['full', 'half', 'quarter'] as const;

const BLANK = {
  qty: '', paperPricePerTon: '', sheetWidthCm: '', sheetHeightCm: '', sheetGsm: '',
  machineSheetClass: 'full', machinePricePerTray: '', machineMinTrays: '', machinePlateCost: '',
  printMode: 'single', colors: '', pantone: '', pantoneTrayPrice: '',
  sheetYield: '', wastePercent: '', rejectPercent: '',
  designHours: '', designHourRate: '', prepressSetupCost: '', deliveryCost: '',
  colorTestCost: '', miscCost: '', setupFee: '', profitPercent: '20', riskPercent: '5',
};

export default function PricingPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const [tab, setTab] = useState<'calculator' | 'carton' | 'plastic' | 'priceList' | 'supplierPrices' | 'records' | 'master'>('calculator');
  const [papers, setPapers] = useState<Paper[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [finishOps, setFinishOps] = useState<FinishOp[]>([]);
  const [cartonPapers, setCartonPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [form, setForm] = useState({ ...BLANK });
  /**
   * Each chosen operation carries how many faces it is applied to. Lamination on one side and
   * on both are different jobs at twice the price, and the API prices `faces: 2` accordingly.
   */
  const [chosenOps, setChosenOps] = useState<Record<string, { on: boolean; faces: 1 | 2 }>>({});
  const [result, setResult] = useState<Result | null>(null);
  /** Which catalogue paper was picked — the name travels to the job's printing specs. */
  const [pickedPaper, setPickedPaper] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [records, setRecords] = useState<PricingRecord[]>([]);
  /** What happens to the costing once it stands: kept, or turned into a work order. */
  const [outcome, setOutcome] = useState({ clientId: '', title: '', notes: '' });
  const [createdJob, setCreatedJob] = useState<{ id: string; number: string } | null>(null);
  /** The success line names the job, so it needs the number rather than a fixed sentence. */
  const [jobFlash, setJobFlash] = useState<string | null>(null);

  const [newPaper, setNewPaper] = useState({ name: '', pricePerTon: '' });
  const [newMachine, setNewMachine] = useState({ label: '', sheetClass: 'full', pricePerTray: '', minTrays: '1', plateCost: '' });
  const [newOp, setNewOp] = useState({ label: '', defaultUnit: 'piece', pricePiece: '', priceTray: '' });
  const [newCartonPaper, setNewCartonPaper] = useState({ name: '', pricePerTon: '' });

  const money = useCallback(
    (v: number, digits = 2) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency: 'EGP', maximumFractionDigits: digits,
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
      const [d, cs] = await Promise.all([
        api<{ papers?: Paper[]; machines?: Machine[]; finishOps?: FinishOp[] }>('/pricing/calc-data'),
        api<Client[]>('/clients').catch(() => [] as Client[]),
      ]);
      const cp = await api<{ items?: Paper[] }>('/pricing/carton-papers').catch(() => ({ items: [] }));
      setCartonPapers(cp.items ?? []);
      setPapers(d.papers ?? []);
      setMachines(d.machines ?? []);
      setFinishOps(d.finishOps ?? []);
      setClients(Array.isArray(cs) ? cs : []);
    } catch (err) {
      setError(err instanceof ApiError ? 'common.error' : null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRecords = useCallback(async () => {
    try {
      const d = await api<{ items?: PricingRecord[] }>('/pricing/records');
      setRecords(d.items ?? []);
    } catch {
      /* the saved list is secondary — a failure here must not blank the calculator */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadRecords();
  }, [load, loadRecords]);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));
  const n = (v: string) => Number(v || 0);

  /** Picking a catalogue row fills the numbers; they stay editable from there. */
  const pickPaper = (id: string) => {
    setPickedPaper(id);
    const p = papers.find((x) => x.id === id);
    if (p) set({ paperPricePerTon: String(p.pricePerTon) });
  };
  const pickMachine = (id: string) => {
    const m = machines.find((x) => x.id === id);
    if (m) set({
      machineSheetClass: m.sheetClass,
      machinePricePerTray: String(m.pricePerTray),
      machineMinTrays: String(m.minTrays),
      machinePlateCost: String(m.plateCost),
    });
  };

  /**
   * One payload for three endpoints. `/calculate` previews it, `/records` stores it, and
   * `/create-job` turns it into a work order — all three re-run the same server calculation,
   * so what was quoted and what gets made can never drift apart.
   */
  function buildPayload(): Record<string, unknown> {
    const ops = finishOps
      .filter((o) => chosenOps[o.id]?.on)
      .map((o) => ({
        // `enabled` is what the server actually checks; without it the op is skipped
        // silently and the finishing stage comes back at zero.
        enabled: true,
        label: o.label, unit: o.defaultUnit,
        pricePiece: o.pricePiece, priceTray: o.priceTray,
        sheetSensitive: o.sheetSensitive, allowFaces: o.allowFaces,
        faces: chosenOps[o.id]?.faces ?? 1,
      }));
    return {
      qty: n(form.qty),
      paperPricePerTon: n(form.paperPricePerTon),
      paperName: papers.find((x) => x.id === pickedPaper)?.name ?? '',
      sheetWidthCm: n(form.sheetWidthCm),
      sheetHeightCm: n(form.sheetHeightCm),
      sheetGsm: n(form.sheetGsm),
      machineSheetClass: form.machineSheetClass,
      machinePricePerTray: n(form.machinePricePerTray),
      machineMinTrays: n(form.machineMinTrays) || 1,
      machinePlateCost: n(form.machinePlateCost),
      printMode: form.printMode,
      colors: n(form.colors),
      pantone: n(form.pantone),
      pantoneTrayPrice: n(form.pantoneTrayPrice),
      // Left blank means "work it out from the sheet"; sent as 0 it would mean none.
      ...(form.sheetYield ? { sheetYield: n(form.sheetYield) } : {}),
      wastePercent: n(form.wastePercent),
      rejectPercent: n(form.rejectPercent),
      designHours: n(form.designHours),
      designHourRate: n(form.designHourRate),
      designRequired: n(form.designHours) > 0,
      prepressSetupCost: n(form.prepressSetupCost),
      deliveryCost: n(form.deliveryCost),
      colorTestCost: n(form.colorTestCost),
      miscCost: n(form.miscCost),
      setupFee: n(form.setupFee),
      profitPercent: n(form.profitPercent),
      riskPercent: n(form.riskPercent),
      finishOps: ops,
    };
  }

  async function calculate() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api<Result | { result?: Result }>('/pricing/calculate', {
        method: 'POST',
        body: buildPayload(),
      });
      const r = ('result' in res ? res.result : res) as Result;
      // The endpoint answers 200 with ok:false and a named reason for a bad input set.
      if (r.ok === false) {
        setError(`pricing.calc.error.${r.error}`);
        return;
      }
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiError ? 'common.error' : null);
    } finally {
      setBusy(false);
    }
  }

  /** Keep the costing. The record stores its own inputs, so it can be re-run or converted later. */
  async function saveRecord() {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await api('/pricing/records', {
        method: 'POST',
        body: { ...buildPayload(), title: outcome.title.trim(), clientId: outcome.clientId || null },
      });
      setFlash('common.success');
      await loadRecords();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code === 'title_required' ? 'pricing.calc.saveTitle' : 'common.error');
    } finally {
      setBusy(false);
    }
  }

  /**
   * The costing becomes a work order at the first stage of the board. No invoice is raised here:
   * a job is only billable once it reaches accounting, which is the point of the stage
   * discipline — the price is agreed now, the bill comes after the work.
   */
  async function createJob() {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await api<{ job?: { id: string; number?: string } }>('/pricing/create-job', {
        method: 'POST',
        body: {
          ...buildPayload(),
          clientId: outcome.clientId,
          title: outcome.title.trim(),
          notes: outcome.notes.trim(),
        },
      });
      setCreatedJob(res.job?.id ? { id: res.job.id, number: res.job.number ?? '' } : null);
      setJobFlash(res.job?.number ?? '');
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code === 'client_required' ? 'pricing.calc.needClient' : 'common.error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteRecord(id: string) {
    if (!window.confirm(t('pricing.calc.confirmDelete'))) return;
    setBusy(true);
    try {
      await api(`/pricing/records/${id}`, { method: 'DELETE' });
      await loadRecords();
    } catch {
      setError('common.error');
    } finally {
      setBusy(false);
    }
  }

  async function addRow(kind: 'papers' | 'machines' | 'finish-ops' | 'carton-papers', body: Record<string, unknown>, reset: () => void) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await api(`/pricing/${kind}`, { method: 'POST', body });
      reset();
      setFlash('common.save');
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code === 'name_required' ? 'users.error.name_required' : 'common.error');
    } finally {
      setBusy(false);
    }
  }

  async function removeRow(kind: 'papers' | 'machines' | 'finish-ops' | 'carton-papers', id: string) {
    if (!window.confirm(t('pricing.calc.confirmDelete'))) return;
    setBusy(true);
    try {
      await api(`/pricing/${kind}/${id}`, { method: 'DELETE' });
      await load();
    } catch {
      setError('common.error');
    } finally {
      setBusy(false);
    }
  }

  const manage = can('pricing.manage');

  const field = (key: keyof typeof BLANK, label: string, type: 'number' | 'text' = 'number') => (
    <label className="text-sm">
      <span className="mb-1 block font-bold">{t(label)}</span>
      <input type={type} min={type === 'number' ? '0' : undefined} step="any"
        value={form[key]} onChange={(e) => set({ [key]: e.target.value })} className="ae-input" />
    </label>
  );

  const ready = n(form.qty) > 0 && n(form.paperPricePerTon) > 0
    && n(form.sheetWidthCm) > 0 && n(form.sheetHeightCm) > 0 && n(form.sheetGsm) > 0;

  return (
    <div className="ae-page">
      <PageHero title={t('pricing.title')} subtitle={t('pricing.subtitle')} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash)}</p>}
      {jobFlash !== null && (
        <p className="ae-flash ae-flash--success mb-4">{t('pricing.calc.jobCreated', { job: jobFlash })}</p>
      )}

      <div className="ae-tab-pills mb-4">
        {([
          ['calculator', 'pricing.tab.calculator'],
          ['carton', 'pricing.tab.cartonCalculator'],
          ['plastic', 'pricing.tab.plasticCalculator'],
          ['priceList', 'pricing.tab.priceList'],
          ['supplierPrices', 'pricing.tab.supplierPrices'],
          ['records', 'pricing.tab.records'],
          ['master', 'pricing.calc.masterData'],
        ] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setTab(k); setError(null); setFlash(null); }}
            className={`ae-tab-pill ${tab === k ? 'is-active' : ''}`}>
            {t(l)}
          </button>
        ))}
      </div>

      {tab === 'calculator' && (
        <>
          {papers.length === 0 && machines.length === 0 && !loading && (
            <p className="ae-alert-pill ae-alert-pill--warn mb-4 block text-xs">{t('pricing.empty')}</p>
          )}

          <Panel title={t('pricing.calc.title')} className="ae-form-panel mb-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {field('qty', 'invoices.quantity')}

              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('pricing.calc.paperType')}</span>
                <select onChange={(e) => pickPaper(e.target.value)} className="ae-input" defaultValue="">
                  <option value="" />
                  {papers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              {field('paperPricePerTon', 'pricing.calc.pricePerTon')}
              {field('sheetGsm', 'pricing.calc.sheetGsm')}
              {field('sheetWidthCm', 'pricing.calc.sheetWidth')}
              {field('sheetHeightCm', 'pricing.calc.sheetHeight')}
              {field('sheetYield', 'pricing.calc.sheetYield')}

              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('pricing.calc.machine')}</span>
                <select onChange={(e) => pickMachine(e.target.value)} className="ae-input" defaultValue="">
                  <option value="" />
                  {machines.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('inventory.unit')}</span>
                <select value={form.machineSheetClass} onChange={(e) => set({ machineSheetClass: e.target.value })}
                  className="ae-input">
                  {SHEET_CLASSES.map((c) => <option key={c} value={c}>{t(`pricing.calc.sheetClass.${c}`)}</option>)}
                </select>
              </label>
              {field('machinePricePerTray', 'pricing.calc.pricePerTray')}
              {field('machineMinTrays', 'pricing.calc.minTrays')}
              {field('machinePlateCost', 'pricing.calc.plateCost')}

              <label className="text-sm">
                <span className="mb-1 block font-bold">{t('pricing.calc.printMode')}</span>
                <select value={form.printMode} onChange={(e) => set({ printMode: e.target.value })} className="ae-input">
                  {PRINT_MODES.map((m) => <option key={m} value={m}>{t(`pricing.calc.printMode.${m}`)}</option>)}
                </select>
              </label>
              {field('colors', 'pricing.calc.colors')}
              {field('pantone', 'pricing.calc.pantone')}
              {field('pantoneTrayPrice', 'pricing.calc.pantoneTrayPrice')}
              {field('wastePercent', 'pricing.calc.wastePercent')}
              {field('rejectPercent', 'pricing.calc.rejectPercent')}
              {field('designHours', 'pricing.calc.designCost')}
              {field('designHourRate', 'pricing.unitPrice')}
              {field('prepressSetupCost', 'pricing.calc.prepressSetupCost')}
              {field('deliveryCost', 'pricing.calc.deliveryCost')}
              {field('colorTestCost', 'pricing.calc.colorTestCost')}
              {field('miscCost', 'pricing.calc.miscCost')}
              {field('setupFee', 'pricing.calc.setupFee')}
              {field('riskPercent', 'pricing.calc.riskPercent')}
              {field('profitPercent', 'pricing.calc.profitPercent')}
            </div>

            {finishOps.length > 0 && (
              <div className="mt-4">
                <span className="mb-2 block text-sm font-bold">{t('pricing.calc.finishing')}</span>
                <div className="flex flex-wrap gap-3">
                  {finishOps.map((o) => {
                    const chosen = chosenOps[o.id];
                    return (
                      <span key={o.id} className="flex items-center gap-2 text-sm">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={chosen?.on === true}
                            onChange={(e) => setChosenOps({
                              ...chosenOps,
                              [o.id]: { on: e.target.checked, faces: chosen?.faces ?? 1 },
                            })} />
                          <span>{o.label} · {t(`pricing.calc.unit.${o.defaultUnit}`, o.defaultUnit)}</span>
                        </label>
                        {/* Offered only where the operation itself can be double-sided. */}
                        {chosen?.on && o.allowFaces && (
                          <label className="flex items-center gap-1 text-xs">
                            <input type="checkbox" checked={chosen.faces === 2}
                              onChange={(e) => setChosenOps({
                                ...chosenOps,
                                [o.id]: { on: true, faces: e.target.checked ? 2 : 1 },
                              })} />
                            <span>{t('pricing.calc.bothFaces')}</span>
                          </label>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="ae-btn-primary" disabled={busy || !ready} onClick={() => void calculate()}>
                {busy ? t('common.saving') : t('pricing.calc.calculate')}
              </button>
              <button type="button" className="ae-btn-ghost"
                onClick={() => { setForm({ ...BLANK }); setChosenOps({}); setResult(null); setError(null); }}>
                {t('common.cancel')}
              </button>
            </div>
          </Panel>

          {result && (
            <Panel title={t('pricing.calc.result')}>
              <div className="ae-dash-metrics-grid mb-4">
                <div className="ae-stat-card ae-stat-card--featured">
                  <p className="ae-stat-label">{t('pricing.calc.total')}</p>
                  <p className="ae-stat-value">{money(result.total, 0)}</p>
                </div>
                <div className="ae-stat-card">
                  <p className="ae-stat-label">{t('pricing.calc.unitCost')}</p>
                  <p className="ae-stat-value">{money(result.unitCost, 4)}</p>
                </div>
                <div className="ae-stat-card">
                  <p className="ae-stat-label">{t('pricing.calc.subtotal')}</p>
                  <p className="ae-stat-value">{money(result.subtotal, 0)}</p>
                </div>
              </div>

              {/* What the paper actually turns into, which is where a costing goes wrong. */}
              <p className="ae-alert-pill ae-alert-pill--info mb-4 block text-xs">
                {t('pricing.calc.sheetsSummary', {
                  sheets: num(result.sheetsWithWaste),
                  trays: num(result.trays),
                })}
                {' · '}{t('pricing.calc.sheetYield')} {num(result.sheetYield)}
              </p>

              <div className="ae-table-wrap">
                <table className="ae-table ae-table--rows">
                  <thead>
                    <tr>
                      <th>{t('quotes.description')}</th>
                      <th>{t('treasury.amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Zero stages are dropped: a costing with eleven rows, seven of them nil,
                        hides the four that made the number. */}
                    {result.stageRows.filter((r) => r.value !== 0).map((r) => (
                      <Fragment key={r.label}>
                        <tr>
                          <td>{t(`pricing.calc.${r.label}Cost`, r.label)}</td>
                          <td>{money(r.value)}</td>
                        </tr>
                        {/* Which operations made up the finishing figure, directly beneath it —
                            listed at the end of the table they read as separate costs. */}
                        {r.label === 'finishing' && result.finishingRows.map((f) => (
                          <tr key={`fin-${f.label}`} className="text-xs opacity-80">
                            <td>↳ {f.label}</td>
                            <td>{money(f.value)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>{t('pricing.calc.total')}</th>
                      <th>{money(result.total)}</th>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* A costing that stays on screen is a costing that gets retyped somewhere else.
                  From here it either becomes a saved record or a work order. */}
              {manage && (
                <div className="ae-section-card mt-4 grid gap-3">
                  <h3 className="text-sm font-bold">{t('pricing.calc.saveTitle')}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      <span className="mb-1 block font-bold">{t('quotes.client')}</span>
                      <select className="ae-input" value={outcome.clientId}
                        onChange={(e) => setOutcome({ ...outcome, clientId: e.target.value })}>
                        <option value="">{t('jobs.selectClient')}</option>
                        {selectableParties(clients, outcome.clientId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block font-bold">{t('jobs.fieldTitle')}</span>
                      <input className="ae-input" value={outcome.title}
                        onChange={(e) => setOutcome({ ...outcome, title: e.target.value })} />
                    </label>
                  </div>
                  <label className="text-sm">
                    <span className="mb-1 block font-bold">{t('jobs.fieldNotes')}</span>
                    <textarea className="ae-input" rows={2} value={outcome.notes}
                      onChange={(e) => setOutcome({ ...outcome, notes: e.target.value })} />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="ae-btn-ghost"
                      disabled={busy || outcome.title.trim() === ''} onClick={() => void saveRecord()}>
                      {t('pricing.calc.save')}
                    </button>
                    <button type="button" className="ae-btn-primary"
                      disabled={busy || outcome.clientId === ''} onClick={() => void createJob()}>
                      {t('pricing.calc.createJob')}
                    </button>
                  </div>
                  {createdJob && (
                    <a className="ae-btn-ghost self-start" href={`/jobs?id=${createdJob.id}`}>
                      {t('pricing.calc.openJob')} {createdJob.number}
                    </a>
                  )}
                </div>
              )}
            </Panel>
          )}
        </>
      )}

      {tab === 'carton' && <CartonPricing manage={manage} clients={clients} />}

      {tab === 'plastic' && <PlasticPricing manage={manage} clients={clients} />}

      {tab === 'priceList' && <PriceLists mode="sell" manage={manage} clients={clients} />}

      {tab === 'supplierPrices' && <PriceLists mode="buy" manage={manage} clients={clients} />}

      {tab === 'records' && (
        records.length === 0
          ? <Panel><p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p></Panel>
          : (
            <Panel title={t('pricing.tab.records')}>
              <div className="ae-table-wrap">
                <table className="ae-table">
                  <thead>
                    <tr>
                      <th>{t('jobs.fieldTitle')}</th>
                      <th>{t('quotes.client')}</th>
                      <th>{t('pricing.calc.total')}</th>
                      <th>{t('invoices.date')}</th>
                      <th aria-label={t('quotes.actions')} />
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id}>
                        <td>{r.title}</td>
                        <td>{r.clientName ?? '—'}</td>
                        <td>{money(r.total)}</td>
                        <td>{new Date(r.createdAt).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB')}</td>
                        <td>
                          {manage && (
                            <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                              disabled={busy} onClick={() => void deleteRecord(r.id)}>
                              {t('common.delete')}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )
      )}

      {tab === 'master' && (
        loading ? <Panel><Skeleton rows={6} /></Panel> : (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <Panel title={t('pricing.calc.paperType')}>
              {manage && (
                <div className="mb-3 grid gap-2">
                  <input value={newPaper.name} onChange={(e) => setNewPaper({ ...newPaper, name: e.target.value })}
                    placeholder={t('pricing.calc.paperName')} className="ae-input" />
                  <input type="number" min="0" step="any" value={newPaper.pricePerTon}
                    onChange={(e) => setNewPaper({ ...newPaper, pricePerTon: e.target.value })}
                    placeholder={t('pricing.calc.pricePerTon')} className="ae-input" />
                  <button type="button" className="ae-btn-secondary text-xs" disabled={busy || !newPaper.name.trim()}
                    onClick={() => void addRow('papers',
                      { name: newPaper.name.trim(), pricePerTon: Number(newPaper.pricePerTon || 0) },
                      () => setNewPaper({ name: '', pricePerTon: '' }))}>
                    {t('pricing.calc.addPaper')}
                  </button>
                </div>
              )}
              <ul className="space-y-2">
                {papers.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{p.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-bold">{money(p.pricePerTon, 0)}</span>
                      {manage && (
                        <button type="button" aria-label={t('common.delete')} className="ae-icon-btn ae-icon-btn-danger"
                          onClick={() => void removeRow('papers', p.id)}>✕</button>
                      )}
                    </span>
                  </li>
                ))}
                {papers.length === 0 && <li className="text-sm text-[var(--text-muted)]">{t('pricing.empty')}</li>}
              </ul>
            </Panel>

            <Panel title={t('cartonBoard.paperCatalog')}>
              {manage && (
                <div className="mb-3 grid gap-2">
                  <input value={newCartonPaper.name}
                    onChange={(e) => setNewCartonPaper({ ...newCartonPaper, name: e.target.value })}
                    placeholder={t('pricing.calc.paperName')} className="ae-input" />
                  <input type="number" min="0" step="any" value={newCartonPaper.pricePerTon}
                    onChange={(e) => setNewCartonPaper({ ...newCartonPaper, pricePerTon: e.target.value })}
                    placeholder={t('pricing.calc.pricePerTon')} className="ae-input" />
                  <button type="button" className="ae-btn-secondary text-xs"
                    disabled={busy || !newCartonPaper.name.trim()}
                    onClick={() => void addRow('carton-papers',
                      { name: newCartonPaper.name.trim(), pricePerTon: Number(newCartonPaper.pricePerTon || 0) },
                      () => setNewCartonPaper({ name: '', pricePerTon: '' }))}>
                    {t('pricing.calc.addPaper')}
                  </button>
                </div>
              )}
              <ul className="space-y-2">
                {cartonPapers.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{p.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-bold">{money(p.pricePerTon, 0)}</span>
                      {manage && (
                        <button type="button" aria-label={t('common.delete')} className="ae-icon-btn ae-icon-btn-danger"
                          onClick={() => void removeRow('carton-papers', p.id)}>✕</button>
                      )}
                    </span>
                  </li>
                ))}
                {cartonPapers.length === 0 && <li className="text-sm text-[var(--text-muted)]">{t('pricing.empty')}</li>}
              </ul>
            </Panel>

            <Panel title={t('pricing.calc.machine')}>
              {manage && (
                <div className="mb-3 grid gap-2">
                  <input value={newMachine.label} onChange={(e) => setNewMachine({ ...newMachine, label: e.target.value })}
                    placeholder={t('pricing.calc.machineLabel')} className="ae-input" />
                  <select value={newMachine.sheetClass} onChange={(e) => setNewMachine({ ...newMachine, sheetClass: e.target.value })}
                    className="ae-input">
                    {SHEET_CLASSES.map((c) => <option key={c} value={c}>{t(`pricing.calc.sheetClass.${c}`)}</option>)}
                  </select>
                  <input type="number" min="0" step="any" value={newMachine.pricePerTray}
                    onChange={(e) => setNewMachine({ ...newMachine, pricePerTray: e.target.value })}
                    placeholder={t('pricing.calc.pricePerTray')} className="ae-input" />
                  <input type="number" min="1" step="1" value={newMachine.minTrays}
                    onChange={(e) => setNewMachine({ ...newMachine, minTrays: e.target.value })}
                    placeholder={t('pricing.calc.minTrays')} className="ae-input" />
                  <input type="number" min="0" step="any" value={newMachine.plateCost}
                    onChange={(e) => setNewMachine({ ...newMachine, plateCost: e.target.value })}
                    placeholder={t('pricing.calc.plateCost')} className="ae-input" />
                  <button type="button" className="ae-btn-secondary text-xs" disabled={busy || !newMachine.label.trim()}
                    onClick={() => void addRow('machines', {
                      label: newMachine.label.trim(), sheetClass: newMachine.sheetClass,
                      pricePerTray: Number(newMachine.pricePerTray || 0),
                      minTrays: Number(newMachine.minTrays || 1),
                      plateCost: Number(newMachine.plateCost || 0),
                    }, () => setNewMachine({ label: '', sheetClass: 'full', pricePerTray: '', minTrays: '1', plateCost: '' }))}>
                    {t('pricing.calc.addMachine')}
                  </button>
                </div>
              )}
              <ul className="space-y-2">
                {machines.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {m.label}
                      <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                        {t(`pricing.calc.sheetClass.${m.sheetClass}`)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-bold">{money(m.pricePerTray, 0)}</span>
                      {manage && (
                        <button type="button" aria-label={t('common.delete')} className="ae-icon-btn ae-icon-btn-danger"
                          onClick={() => void removeRow('machines', m.id)}>✕</button>
                      )}
                    </span>
                  </li>
                ))}
                {machines.length === 0 && <li className="text-sm text-[var(--text-muted)]">{t('pricing.empty')}</li>}
              </ul>
            </Panel>

            <Panel title={t('pricing.calc.finishing')}>
              {manage && (
                <div className="mb-3 grid gap-2">
                  <input value={newOp.label} onChange={(e) => setNewOp({ ...newOp, label: e.target.value })}
                    placeholder={t('pricing.calc.finishOpLabel')} className="ae-input" />
                  <select value={newOp.defaultUnit} onChange={(e) => setNewOp({ ...newOp, defaultUnit: e.target.value })}
                    className="ae-input">
                    {(['piece', 'sheet', 'tray'] as const).map((u) => (
                      <option key={u} value={u}>{t(`pricing.calc.unit.${u}`)}</option>
                    ))}
                  </select>
                  <input type="number" min="0" step="any" value={newOp.pricePiece}
                    onChange={(e) => setNewOp({ ...newOp, pricePiece: e.target.value })}
                    placeholder={t('pricing.calc.pricePiece')} className="ae-input" />
                  <input type="number" min="0" step="any" value={newOp.priceTray}
                    onChange={(e) => setNewOp({ ...newOp, priceTray: e.target.value })}
                    placeholder={t('pricing.calc.priceTray')} className="ae-input" />
                  <button type="button" className="ae-btn-secondary text-xs" disabled={busy || !newOp.label.trim()}
                    onClick={() => void addRow('finish-ops', {
                      label: newOp.label.trim(), defaultUnit: newOp.defaultUnit,
                      pricePiece: Number(newOp.pricePiece || 0), priceTray: Number(newOp.priceTray || 0),
                      sheetSensitive: true, allowFaces: true,
                    }, () => setNewOp({ label: '', defaultUnit: 'piece', pricePiece: '', priceTray: '' }))}>
                    {t('pricing.calc.addFinishOp')}
                  </button>
                </div>
              )}
              <ul className="space-y-2">
                {finishOps.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {o.label}
                      <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                        {t(`pricing.calc.unit.${o.defaultUnit}`, o.defaultUnit)}
                      </span>
                    </span>
                    {manage && (
                      <button type="button" aria-label={t('common.delete')} className="ae-icon-btn ae-icon-btn-danger"
                        onClick={() => void removeRow('finish-ops', o.id)}>✕</button>
                    )}
                  </li>
                ))}
                {finishOps.length === 0 && <li className="text-sm text-[var(--text-muted)]">{t('pricing.empty')}</li>}
              </ul>
            </Panel>
          </div>
        )
      )}
    </div>
  );
}
