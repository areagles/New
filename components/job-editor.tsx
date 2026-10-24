'use client';

/**
 * Opening a work order.
 *
 * The type decides everything that follows: each of the six has its own chain of stages, and
 * the job is dropped onto that chain the moment it is created. It cannot be changed later
 * without changing what the job *is*, which is why it is chosen here and nowhere else.
 *
 * Design status is the other decision with consequences. A job whose design is already ready
 * skips the design and client-review stages entirely — the API starts it further down the
 * chain — so the two options are shown as what they mean rather than as a checkbox.
 *
 * Everything else on a job — proofs, source files, materials, costs, the team — is added from
 * the job's own view once it exists, because most of it only makes sense against a stage.
 */

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { selectableParties } from '@/lib/parties';
import { Panel } from '@/components/page';

type Client = { id: string; name: string; isActive: boolean };
type Currency = { code: string; label: string; isActive: boolean };
export type JobType = { typeKey: string; nameAr: string; nameEn: string; icon: string; isActive: boolean };

const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export function JobEditor({
  types,
  onClose,
  onSaved,
}: {
  types: JobType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();

  const [clients, setClients] = useState<Client[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);

  const [clientId, setClientId] = useState('');
  const [title, setTitle] = useState('');
  const [jobType, setJobType] = useState(types[0]?.typeKey ?? 'print');
  const [designStatus, setDesignStatus] = useState<'needed' | 'ready'>('needed');
  const [deliveryDate, setDeliveryDate] = useState(plusDays(14));
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [currencyCode, setCurrencyCode] = useState('EGP');
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [c, cur] = await Promise.all([
          api<Client[]>('/clients'),
          api<Currency[]>('/currencies'),
        ]);
        setClients(Array.isArray(c) ? c : []);
        setCurrencies((Array.isArray(cur) ? cur : []).filter((x) => x.isActive));
      } catch {
        setError('common.error');
      }
    })();
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('/jobs', {
        method: 'POST',
        body: {
          clientId,
          title: title.trim(),
          jobType,
          designStatus,
          deliveryDate,
          quantity: Number(quantity || 0),
          price: Number(price || 0),
          currencyCode,
          notes: notes.trim() || null,
        },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'common.error');
    } finally {
      setBusy(false);
    }
  }

  const ready = clientId !== '' && title.trim() !== '';
  const typeName = (x: JobType) => (lang === 'ar' ? x.nameAr : x.nameEn);

  return (
    <Panel title={t('jobs.createTitle')} className="ae-form-panel mb-4">
      {error && <p className="ae-flash ae-flash--error mb-3">{t(error, t('common.error'))}</p>}

      <div className="mb-4">
        <span className="mb-1 block text-sm font-bold">{t('jobs.fieldType')}</span>
        <div className="ae-tab-pills">
          {types.map((x) => (
            <button key={x.typeKey} type="button" onClick={() => setJobType(x.typeKey)}
              className={`ae-tab-pill ${jobType === x.typeKey ? 'is-active' : ''}`}>
              <span aria-hidden>{x.icon}</span> {typeName(x)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('jobs.fieldClient')}</span>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} required className="ae-input w-full">
            <option value="">{t('jobs.selectClient')}</option>
            {selectableParties(clients, clientId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-bold">{t('jobs.fieldTitle')}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required className="ae-input w-full" />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('jobs.fieldDelivery')}</span>
          <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)}
            className="ae-input w-full" />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('jobs.fieldQuantity')}</span>
          <input type="number" min="0" step="any" inputMode="decimal" value={quantity}
            onChange={(e) => setQuantity(e.target.value)} className="ae-input w-full" />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('jobs.fieldPrice')}</span>
          <input type="number" min="0" step="any" inputMode="decimal" value={price}
            onChange={(e) => setPrice(e.target.value)} className="ae-input w-full" />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-bold">{t('jobs.fieldCurrency')}</span>
          <select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} className="ae-input w-full">
            {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
          </select>
        </label>

        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-bold">{t('jobs.fieldNotes')}</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder={t('jobs.fieldSpecsHint')} className="ae-input w-full" />
        </label>
      </div>

      <div className="mt-4">
        <span className="mb-1 block text-sm font-bold">{t('jobs.fieldDesign')}</span>
        <div className="ae-tab-pills">
          {(['needed', 'ready'] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDesignStatus(d)}
              className={`ae-tab-pill ${designStatus === d ? 'is-active' : ''}`}>
              {t(d === 'needed' ? 'jobs.designNeeded' : 'jobs.designReady')}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !ready} className="ae-btn-primary" onClick={() => void save()}>
          {busy ? t('common.saving') : t('jobs.create')}
        </button>
        <button type="button" className="ae-btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </Panel>
  );
}
