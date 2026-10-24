'use client';

/**
 * People and what they may do.
 *
 * This is what makes every lock built so far mean anything. `ae_job_stage_role_allowed` asks
 * whether you hold the current stage's role — designer, reviewer, purchaser, printer, producer,
 * delivery rep — and refuses the move otherwise. `ae_job_validate_transition_preconditions`
 * exempts `jobs.manage` from the stage's preconditions. Every `can(...)` in this rebuild hides
 * a button behind a permission. With one account holding every permission, none of it does
 * anything: the whole system behaves as though a manager were pressing every button, which is
 * exactly the state it is supposed to prevent.
 *
 * The fifteen roles are already seeded and their keys line up with the stage checks, so the
 * work here is assignment rather than invention.
 *
 * ── Passwords ─────────────────────────────────────────────────────────────────────────────
 *
 * A new account needs one, and the API enforces the tenant's policy on it. But an admin typing
 * a password they then have to tell someone is the worst version of this, so the two things
 * the API offers instead are on every row: a temporary password generated server-side and
 * shown once, and a reset link sent to the person's own address. The typed field exists for
 * creating the account and is never shown again afterwards.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

type Permission = { key: string; label: string; group: string };
type Role = {
  id: string; key: string; label: string; description: string | null;
  isSystem: boolean; userCount: number; permissions: Permission[];
  jobTypeScope: string[] | null;
};
type User = {
  id: string; email: string; name: string; isActive: boolean;
  twoFactorEnabled: boolean; lastLoginAt: string | null;
  roles: string[]; isLocked: boolean;
};

/**
 * The permission catalog has ten groups; `roles.group.*` only names four of them. The other
 * six are the system's own modules, so their existing titles are reused rather than writing
 * six new labels for the same things.
 */
const GROUP_LABEL: Record<string, string> = {
  crm: 'roles.group.crm',
  finance: 'roles.group.finance',
  identity: 'roles.group.identity',
  settings: 'roles.group.settings',
  accounting: 'dashboard.accounting.title',
  assets: 'dashboard.assets.title',
  hr: 'dashboard.hr.title',
  inventory: 'dashboard.inventory.title',
  jobs: 'jobs.title',
  sales: 'dashboard.sales.title',
};

const ERROR_KEY: Record<string, string> = {
  name_required: 'users.error.name_required',
  email_invalid: 'users.error.email_invalid',
  email_exists: 'users.error.email_exists',
  roles_required: 'users.error.roles_required',
  password_too_short: 'users.error.password_too_short',
  password_needs_number: 'users.error.password_needs_number',
  password_needs_special: 'users.error.password_needs_special',
  password_needs_uppercase: 'users.error.password_needs_uppercase',
  cannot_deactivate_self: 'users.error.cannot_deactivate_self',
  forbidden: 'users.error.forbidden',
  permissions_required: 'roles.error.permissions_required',
  cannot_delete_system_role: 'roles.error.cannot_delete_system_role',
  role_has_users: 'roles.error.role_has_users',
};

export default function UsersPage() {
  const { t, lang } = useI18n();
  const { user: me, can } = useSession();

  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalog, setCatalog] = useState<{ key: string; permissions: Permission[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', roleKeys: [] as string[] });
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editingRole, setEditingRole] = useState<Role | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, r, p] = await Promise.all([
        api<{ users?: User[] } | User[]>('/identity/users'),
        api<{ roles?: Role[] }>('/identity/roles'),
        api<{ groups?: { key: string; permissions: Permission[] }[] }>('/identity/permissions'),
      ]);
      setUsers(Array.isArray(u) ? u : u.users ?? []);
      setRoles(r.roles ?? []);
      setCatalog(p.groups ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? 'users.loadFailed' : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function fail(err: unknown) {
    const code = err instanceof ApiError ? err.code : '';
    setError(ERROR_KEY[code] ?? 'common.error');
  }

  async function run(fn: () => Promise<void>, flashKey?: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    setSecret(null);
    try {
      await fn();
      if (flashKey) setFlash(flashKey);
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const roleLabel = useCallback(
    (key: string) => roles.find((r) => r.key === key)?.label ?? key,
    [roles],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users, query]);

  const manage = can('identity.users.manage');

  if (loading) {
    return (
      <div className="ae-page">
        <PageHero title={t('users.title')} subtitle={t('users.subtitle')} />
        <Panel><Skeleton rows={6} /></Panel>
      </div>
    );
  }

  const toggle = (list: string[], key: string) =>
    list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

  return (
    <div className="ae-page">
      <PageHero
        title={t('users.title')}
        subtitle={t('users.subtitle')}
        actions={
          manage && tab === 'users' && !creating ? (
            <button type="button" className="ae-btn-primary" onClick={() => { setCreating(true); setEditingUser(null); }}>
              {t('users.addNew')}
            </button>
          ) : undefined
        }
      />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error)}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash)}</p>}
      {/* Shown once and never retrievable — the API does not store it in the clear. */}
      {secret && (
        <p className="ae-flash ae-flash--warn mb-4">
          {t('users.tempPasswordGenerated')} <span dir="ltr" className="font-bold">{secret}</span>
        </p>
      )}

      <div className="ae-tab-pills mb-4">
        {(['users', 'roles'] as const).map((x) => (
          <button key={x} type="button" onClick={() => { setTab(x); setError(null); setFlash(null); setSecret(null); }}
            className={`ae-tab-pill ${tab === x ? 'is-active' : ''}`}>
            {t(x === 'users' ? 'users.title' : 'roles.listTitle')}
          </button>
        ))}
      </div>

      {tab === 'users' && creating && (
        <Panel title={t('users.addNew')} className="ae-form-panel mb-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('users.name')}</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="ae-input" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('users.email')}</span>
              <input type="email" dir="ltr" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} className="ae-input" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('users.password')}</span>
              <input type="password" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} className="ae-input" />
            </label>
          </div>

          <div className="mt-4">
            <span className="mb-2 block text-sm font-bold">{t('users.roles')}</span>
            <div className="flex flex-wrap gap-3">
              {roles.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.roleKeys.includes(r.key)}
                    onChange={() => setForm({ ...form, roleKeys: toggle(form.roleKeys, r.key) })} />
                  <span>{r.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="ae-btn-primary"
              disabled={busy || form.name.trim() === '' || form.email.trim() === '' || form.roleKeys.length === 0}
              onClick={() => void run(async () => {
                await api('/identity/users', { method: 'POST', body: form });
                setCreating(false);
                setForm({ name: '', email: '', password: '', roleKeys: [] });
              }, 'users.added')}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" className="ae-btn-ghost" onClick={() => setCreating(false)}>{t('common.cancel')}</button>
          </div>
        </Panel>
      )}

      {tab === 'users' && (
        <Panel
          actions={
            <div className="ae-toolbar">
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={t('users.search')} className="ae-input" />
            </div>
          }
        >
          <div className="ae-table-wrap">
            <table className="ae-table ae-table--rows">
              <thead>
                <tr>
                  <th>{t('users.name')}</th>
                  <th>{t('users.roles')}</th>
                  <th>{t('users.status')}</th>
                  <th>{t('users.lastLogin')}</th>
                  {manage && <th>{t('users.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => {
                  const self = u.id === me?.id;
                  return (
                    <tr key={u.id} className={u.isActive ? undefined : 'opacity-60'}>
                      <td>
                        <span className="font-bold">{u.name}</span>
                        <span className="mt-0.5 block text-xs text-[var(--text-muted)]" dir="ltr">{u.email}</span>
                      </td>
                      <td>
                        <span className="flex flex-wrap gap-1">
                          {u.roles.map((k) => (
                            <span key={k} className="ae-badge ae-badge-muted">{roleLabel(k)}</span>
                          ))}
                        </span>
                      </td>
                      <td>
                        <span className={`ae-badge ${u.isLocked ? 'ae-badge-danger' : u.isActive ? 'ae-badge-success' : 'ae-badge-muted'}`}>
                          {u.isLocked ? t('users.locked') : t(u.isActive ? 'settings.paymentActive' : 'users.reactivate')}
                        </span>
                        {u.twoFactorEnabled && (
                          <span className="ae-badge ae-badge-info mt-1 block w-fit">{t('users.twoFactorOn')}</span>
                        )}
                      </td>
                      <td dir="ltr" className="whitespace-nowrap text-xs">{u.lastLoginAt ?? '—'}</td>
                      {manage && (
                        <td className="ae-actions-cell whitespace-nowrap">
                          <span className="ae-action-icons">
                            <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                              onClick={() => { setEditingUser(u); setCreating(false); }}>
                              {t('common.edit')}
                            </button>
                            <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                              onClick={() => {
                                if (!window.confirm(t('users.confirmTempPassword'))) return;
                                void run(async () => {
                                  const res = await api<{ password?: string; tempPassword?: string }>(
                                    `/identity/users/${u.id}/temp-password`, { method: 'POST' });
                                  setSecret(res.password ?? res.tempPassword ?? null);
                                });
                              }}>
                              {t('users.generateTempPassword')}
                            </button>
                            <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                              onClick={() => {
                                if (!window.confirm(t('users.confirmSendReset'))) return;
                                void run(async () => {
                                  const r = await api<{ sent?: boolean }>(`/identity/users/${u.id}/send-reset`, { method: 'POST' });
                                  setFlash(r.sent ? 'users.resetLinkSent' : 'users.resetLinkQueued');
                                });
                              }}>
                              {t('users.sendResetLink')}
                            </button>
                            {u.isLocked && (
                              <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                                onClick={() => {
                                  if (!window.confirm(t('users.confirmUnlock'))) return;
                                  void run(async () => {
                                    await api(`/identity/users/${u.id}/unlock`, { method: 'POST' });
                                  }, 'users.unlocked');
                                }}>
                                {t('users.unlock')}
                              </button>
                            )}
                            {/* The API refuses self-deactivation; not offering it is clearer. */}
                            {!self && (
                              <button type="button" className="ae-icon-btn ae-icon-btn-danger" disabled={busy}
                                aria-label={t(u.isActive ? 'users.confirmDeactivate' : 'users.reactivate')}
                                onClick={() => {
                                  if (u.isActive && !window.confirm(t('users.confirmDeactivate'))) return;
                                  void run(async () => {
                                    await api(`/identity/users/${u.id}`, {
                                      method: 'PATCH', body: { isActive: !u.isActive },
                                    });
                                  }, u.isActive ? 'users.deactivated' : 'users.reactivated');
                                }}>
                                {u.isActive ? '✕' : '↺'}
                              </button>
                            )}
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {tab === 'users' && editingUser && (
        <Panel title={t('users.editTitle')} className="ae-form-panel mt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('users.name')}</span>
              <input value={editingUser.name}
                onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })} className="ae-input" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('users.email')}</span>
              <input type="email" dir="ltr" value={editingUser.email}
                onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })} className="ae-input" />
            </label>
          </div>

          <div className="mt-4">
            <span className="mb-2 block text-sm font-bold">{t('users.roles')}</span>
            {editingUser.id === me?.id ? (
              <p className="ae-alert-pill ae-alert-pill--warn block text-xs">{t('users.cannotEditOwnRoles')}</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {roles.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={editingUser.roles.includes(r.key)}
                      onChange={() => setEditingUser({ ...editingUser, roles: toggle(editingUser.roles, r.key) })} />
                    <span>{r.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="ae-btn-primary" disabled={busy}
              onClick={() => void run(async () => {
                await api(`/identity/users/${editingUser.id}`, {
                  method: 'PATCH',
                  body: {
                    name: editingUser.name,
                    email: editingUser.email,
                    ...(editingUser.id === me?.id ? {} : { roleKeys: editingUser.roles }),
                  },
                });
                setEditingUser(null);
              }, 'users.saved')}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" className="ae-btn-ghost" onClick={() => setEditingUser(null)}>{t('common.cancel')}</button>
          </div>
        </Panel>
      )}

      {tab === 'roles' && (
        <>
          <p className="mb-4 text-sm text-[var(--text-muted)]">{t('roles.hint')}</p>
          <div className="ae-section-cards-grid">
            {roles.map((r) => (
              <article key={r.id} className="ae-section-card">
                <div className="ae-section-card-head">
                  <div className="ae-section-card-title-row">
                    <h3 className="ae-section-card-title">{r.label}</h3>
                    {r.isSystem && <span className="ae-badge ae-badge-info">{t('roles.system')}</span>}
                  </div>
                  {manage && (
                    <button type="button" className="ae-section-card-link"
                      onClick={() => setEditingRole(r)}>
                      {t('roles.customize')}
                    </button>
                  )}
                </div>
                <div className="p-4 text-sm">
                  {r.description && <p className="text-[var(--text-muted)]">{r.description}</p>}
                  <p className="mt-2 text-xs text-[var(--text-muted)]">
                    {r.permissions.length} {t('roles.permCount')} · {r.userCount} {t('roles.userCount')}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {tab === 'roles' && editingRole && (
        <Panel title={`${t('roles.editTitle')} — ${editingRole.label}`} className="ae-form-panel mt-4">
          {editingRole.isSystem && (
            <p className="ae-alert-pill ae-alert-pill--warn mb-3 block text-xs">{t('roles.systemHint')}</p>
          )}

          <div className="space-y-4">
            {catalog.map((g) => (
              <div key={g.key}>
                <p className="ae-stat-label">{t(GROUP_LABEL[g.key] ?? g.key, g.key)}</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {g.permissions.map((p) => {
                    const on = editingRole.permissions.some((x) => x.key === p.key);
                    return (
                      <label key={p.key} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={on}
                          onChange={() => setEditingRole({
                            ...editingRole,
                            permissions: on
                              ? editingRole.permissions.filter((x) => x.key !== p.key)
                              : [...editingRole.permissions, p],
                          })} />
                        <span>{p.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="ae-btn-primary" disabled={busy}
              onClick={() => void run(async () => {
                const wanted = editingRole.permissions.map((p) => p.key).sort();
                const res = await api<{ role?: Role }>(`/identity/roles/${editingRole.id}`, {
                  method: 'PATCH',
                  body: {
                    label: editingRole.label,
                    description: editingRole.description,
                    // `permissionKeys`, not `permissions`: the endpoint ignores an unknown
                    // field and still answers ok with the role untouched, so the wrong name
                    // reports a save that did not happen.
                    permissionKeys: wanted,
                  },
                });
                // Which is worth checking for rather than trusting, given the above.
                const got = (res.role?.permissions ?? []).map((p) => p.key).sort();
                if (got.join() !== wanted.join()) throw new ApiError('save_ignored', 200);
                setEditingRole(null);
              }, 'roles.saved')}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" className="ae-btn-ghost" onClick={() => setEditingRole(null)}>{t('common.cancel')}</button>
          </div>
        </Panel>
      )}
    </div>
  );
}
