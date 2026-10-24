'use client';

/**
 * الأتمتة — if this happens, do that.
 *
 * A rule binds a trigger the system already fires — a job changed stage, an invoice went
 * overdue, a leave request came in — to an action: send an email, call a webhook. Nothing here
 * invents an event; the list of triggers is whatever the API says it fires, and each one carries
 * the variables a template can use.
 *
 * ── Templates only know their own trigger's fields ────────────────────────────────────────
 *
 * `{{clientEmail}}` means something on an invoice event and nothing on a leave one. So the
 * available variables are shown for the selected trigger and change when it changes — a template
 * full of placeholders that will never be filled sends an email full of literal braces.
 *
 * ── The log is where a rule is judged ─────────────────────────────────────────────────────
 *
 * A rule that fires and fails is worse than one that never fires, because everyone assumes the
 * email went. The log shows both outcomes with the reason, and it is a tab rather than a footnote.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

type Action = { type: string; [k: string]: unknown };
type Condition = { field: string; value: string };
type Rule = {
  id: string; name: string; triggerEvent: string;
  conditions: Condition[]; actions: Action[]; isActive: boolean;
};
type EventDef = { label: string; fields: string[] };
type ActionDef = { label: string; fields: string[] };
type LogRow = {
  id: string; ruleId?: string; ruleName?: string | null; triggerEvent?: string;
  status: string; error?: string | null; createdAt: string;
};

const BLANK: Rule = { id: '', name: '', triggerEvent: '', conditions: [], actions: [], isActive: true };

/** The three email fields have their own labels; anything else falls back to its own name. */
const FIELD_LABEL: Record<string, string> = {
  to: 'automation.emailTo', subject: 'automation.emailSubject', body: 'automation.emailBody',
};

export default function AutomationPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const manage = can('automation.manage');

  const [tab, setTab] = useState<'rules' | 'log'>('rules');
  const [rules, setRules] = useState<Rule[]>([]);
  const [presets, setPresets] = useState<Rule[]>([]);
  const [events, setEvents] = useState<Record<string, EventDef>>({});
  const [actionTypes, setActionTypes] = useState<Record<string, ActionDef>>({});
  const [log, setLog] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Rule>({ ...BLANK });

  const date = useCallback(
    (v: string) => new Date(v.replace(' ', 'T')).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB'),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, p, e, l] = await Promise.all([
        api<{ items?: Rule[] }>('/automation/rules'),
        api<{ items?: Rule[] }>('/automation/presets').catch(() => ({ items: [] })),
        api<{ events?: Record<string, EventDef>; actionTypes?: Record<string, ActionDef> }>('/automation/events'),
        api<{ items?: LogRow[] }>('/automation/log?limit=100').catch(() => ({ items: [] })),
      ]);
      setRules(r.items ?? []);
      setPresets(p.items ?? []);
      setEvents(e.events ?? {});
      setActionTypes(e.actionTypes ?? {});
      setLog(l.items ?? []);
    } catch {
      setError('common.error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: Record<string, unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await api(path, { method, ...(body ? { body } : {}) });
      if (ok) setFlash(ok);
      await load();
      return true;
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(code ? `automation.error.${code}` : 'common.error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openForm(r?: Rule) {
    setEditing(true);
    setError(null);
    setForm(r
      ? { ...r, conditions: [...r.conditions], actions: r.actions.map((a) => ({ ...a })) }
      : { ...BLANK, triggerEvent: Object.keys(events)[0] ?? '' });
  }

  async function save() {
    const body = {
      name: form.name.trim(),
      triggerEvent: form.triggerEvent,
      conditions: form.conditions.filter((c) => c.field.trim() !== ''),
      actions: form.actions,
      isActive: form.isActive,
    };
    const ok = form.id
      ? await call(`/automation/rules/${form.id}`, 'PATCH', body, 'common.success')
      : await call('/automation/rules', 'POST', body, 'common.success');
    if (ok) setEditing(false);
  }

  /** Variables the selected trigger actually provides — the reason a template works or does not. */
  const fields = events[form.triggerEvent]?.fields ?? [];

  return (
    <div className="ae-page">
      <PageHero title={t('automation.title')} subtitle={t('automation.subtitle')}
        actions={manage && tab === 'rules' && (
          <button type="button" className="ae-btn-primary" onClick={() => openForm()}>
            {t('automation.newRule')}
          </button>
        )} />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error, t('common.error'))}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash)}</p>}

      <div className="ae-tab-pills mb-4">
        {(['rules', 'log'] as const).map((k) => (
          <button key={k} type="button" className={`ae-tab-pill ${tab === k ? 'is-active' : ''}`}
            onClick={() => { setTab(k); setError(null); setFlash(null); }}>
            {t(`automation.tab.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'rules' && (
        loading ? <Panel><Skeleton rows={6} /></Panel> : (
          <div className="grid gap-4">
            <Panel title={t('automation.tab.rules')}>
              {rules.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">{t('automation.noRules')}</p>
              ) : (
                <ul className="grid gap-3">
                  {rules.map((r) => (
                    <li key={r.id} className="ae-section-card grid gap-1 text-sm">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <strong>{r.name}</strong>
                        <span className={`ae-badge ${r.isActive ? 'ae-badge-success' : 'ae-badge-muted'} text-xs`}>
                          {t(r.isActive ? 'automation.active' : 'automation.inactive')}
                        </span>
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {t('automation.trigger')}: {events[r.triggerEvent]?.label ?? r.triggerEvent}
                        {' · '}{r.conditions.length} {t('automation.conditionsCount')}
                        {' · '}{r.actions.length} {t('automation.actionsCount')}
                      </span>
                      {manage && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          <button type="button" className="ae-btn-ghost px-2 py-1 text-xs"
                            onClick={() => openForm(r)}>{t('automation.editRule')}</button>
                          <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                            onClick={() => void call(`/automation/rules/${r.id}`, 'PATCH',
                              { ...r, isActive: !r.isActive }, 'common.success')}>
                            {t(r.isActive ? 'common.deactivate' : 'users.reactivate')}
                          </button>
                          <button type="button" className="ae-btn-ghost px-2 py-1 text-xs" disabled={busy}
                            onClick={() => {
                              if (!window.confirm(t('automation.deleteConfirm'))) return;
                              void call(`/automation/rules/${r.id}`, 'DELETE', undefined, 'common.success');
                            }}>
                            {t('common.delete')}
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {manage && presets.length > 0 && (
              <Panel title={t('automation.presetsTitle')}>
                <p className="mb-3 text-xs text-[var(--text-muted)]">{t('automation.presetsHint')}</p>
                <ul className="grid gap-2 text-sm">
                  {presets.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {p.name}
                        <span className="block text-xs text-[var(--text-muted)]">
                          {events[p.triggerEvent]?.label ?? p.triggerEvent}
                        </span>
                      </span>
                      <button type="button" className="ae-btn-secondary text-xs" disabled={busy}
                        onClick={() => void call('/automation/presets/apply', 'POST',
                          { presetId: p.id }, 'automation.presetApplied')}>
                        {t('common.save')}
                      </button>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        )
      )}

      {tab === 'log' && (
        <Panel title={t('automation.tab.log')}>
          {loading ? <Skeleton rows={5} /> : log.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('automation.noLog')}</p>
          ) : (
            <div className="ae-table-wrap">
              <table className="ae-table">
                <thead>
                  <tr>
                    <th>{t('automation.ruleName')}</th>
                    <th>{t('automation.trigger')}</th>
                    <th>{t('purchaseOrders.status')}</th>
                    <th>{t('common.lastUpdated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((l) => {
                    const ok = l.status === 'OK' || l.status === 'SENT';
                    return (
                      <tr key={l.id}>
                        <td>{l.ruleName ?? '—'}</td>
                        <td className="text-xs">
                          {l.triggerEvent ? (events[l.triggerEvent]?.label ?? l.triggerEvent) : '—'}
                        </td>
                        <td className="text-xs">
                          <span className={`ae-badge ${ok ? 'ae-badge-success' : 'ae-badge-danger'} text-xs`}>
                            {t(ok ? 'automation.ok' : 'automation.failed')}
                          </span>
                          {/* A rule that fired and failed is the case worth seeing; without the
                              reason it just gets re-enabled and fails the same way. */}
                          {l.error && <span className="block text-[var(--text-muted)]">{l.error}</span>}
                        </td>
                        <td className="text-xs">{date(l.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {editing && (
        <Panel title={form.id ? t('automation.editRule') : t('automation.newRule')} className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('automation.ruleName')}</span>
              <input className="ae-input" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('automation.trigger')}</span>
              <select className="ae-input" value={form.triggerEvent}
                onChange={(e) => setForm({ ...form, triggerEvent: e.target.value })}>
                {Object.entries(events).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
          </div>

          {fields.length > 0 && (
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              {t('automation.templateHint')} {fields.map((f) => `{{${f}}}`).join(' · ')}
            </p>
          )}

          <h4 className="mb-2 mt-4 text-sm font-bold">{t('automation.conditionsTitle')}</h4>
          <div className="grid gap-2">
            {form.conditions.map((c, i) => (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-bold">{t('accounting.name')}</span>
                  <select className="ae-input" value={c.field}
                    onChange={(e) => setForm({
                      ...form,
                      conditions: form.conditions.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)),
                    })}>
                    <option value="">—</option>
                    {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-bold">{t('automation.value')}</span>
                  <input className="ae-input" value={c.value}
                    onChange={(e) => setForm({
                      ...form,
                      conditions: form.conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                    })} />
                </label>
                <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                  onClick={() => setForm({ ...form, conditions: form.conditions.filter((_, j) => j !== i) })}>
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="ae-btn-secondary mt-2 text-xs"
            onClick={() => setForm({ ...form, conditions: [...form.conditions, { field: '', value: '' }] })}>
            {t('automation.addCondition')}
          </button>

          <h4 className="mb-2 mt-4 text-sm font-bold">{t('automation.actionsTitle')}</h4>
          <div className="grid gap-3">
            {form.actions.map((a, i) => (
              <div key={i} className="ae-section-card grid gap-2">
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-bold">{t('automation.actionsCount')}</span>
                  <select className="ae-input" value={a.type}
                    onChange={(e) => setForm({
                      ...form,
                      actions: form.actions.map((x, j) => (j === i ? { type: e.target.value } : x)),
                    })}>
                    {Object.entries(actionTypes).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </label>
                {/* The fields an action takes come from the API's own description of it, so a
                    new action type needs no change here to become configurable. */}
                {(actionTypes[a.type]?.fields ?? []).map((f) => (
                  <label key={f} className="text-sm">
                    <span className="mb-1 block text-xs font-bold">{t(FIELD_LABEL[f] ?? f, f)}</span>
                    {f === 'body' ? (
                      <textarea className="ae-input" rows={3} value={String(a[f] ?? '')}
                        onChange={(e) => setForm({
                          ...form,
                          actions: form.actions.map((x, j) => (j === i ? { ...x, [f]: e.target.value } : x)),
                        })} />
                    ) : (
                      <input className="ae-input" value={String(a[f] ?? '')}
                        onChange={(e) => setForm({
                          ...form,
                          actions: form.actions.map((x, j) => (j === i ? { ...x, [f]: e.target.value } : x)),
                        })} />
                    )}
                  </label>
                ))}
                <button type="button" className="ae-btn-ghost self-start px-3 py-1 text-xs"
                  onClick={() => setForm({ ...form, actions: form.actions.filter((_, j) => j !== i) })}>
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="ae-btn-secondary mt-2 text-xs"
            onClick={() => setForm({
              ...form,
              actions: [...form.actions, { type: Object.keys(actionTypes)[0] ?? 'send_email' }],
            })}>
            {t('automation.addAction')}
          </button>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="ae-btn-primary"
              disabled={busy || form.name.trim() === '' || form.triggerEvent === '' || form.actions.length === 0}
              onClick={() => void save()}>
              {t('common.save')}
            </button>
            <button type="button" className="ae-btn-ghost" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}
