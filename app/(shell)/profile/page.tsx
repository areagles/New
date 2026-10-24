'use client';

/**
 * The signed-in user's own account: display name, password, and two-factor status.
 *
 * Changing the password revokes every other session server-side, so anyone signed in
 * elsewhere is logged out — the form says so rather than letting it come as a surprise.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel } from '@/components/page';

type TwoFactor = { enabled?: boolean; pending?: boolean };

export default function ProfilePage() {
  const { t } = useI18n();
  const { user, tenant, reload } = useSession();

  const [name, setName] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMsg, setNameMsg] = useState<{ kind: 'ok' | 'error'; code: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'error'; code: string } | null>(null);

  const [twoFactor, setTwoFactor] = useState<TwoFactor | null>(null);

  useEffect(() => {
    if (user?.name) setName(user.name);
  }, [user?.name]);

  const loadTwoFactor = useCallback(async () => {
    try {
      const res = await api<{ twoFactor?: TwoFactor }>('/identity/me/2fa', { quiet: true });
      setTwoFactor(res.twoFactor ?? null);
    } catch {
      // Not fatal — the section just stays hidden if the endpoint is unavailable.
    }
  }, []);

  useEffect(() => {
    void loadTwoFactor();
  }, [loadTwoFactor]);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameBusy(true);
    setNameMsg(null);
    try {
      await api('/identity/me', { method: 'PATCH', body: { name: name.trim() } });
      await reload();
      setNameMsg({ kind: 'ok', code: 'saved' });
    } catch (err) {
      setNameMsg({ kind: 'error', code: err instanceof ApiError ? err.code : 'unexpected_response' });
    } finally {
      setNameBusy(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPwMsg({ kind: 'error', code: 'passwords_do_not_match' });
      return;
    }
    setPwBusy(true);
    setPwMsg(null);
    try {
      await api('/identity/me/password', {
        method: 'PATCH',
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwMsg({ kind: 'ok', code: 'password_changed' });
    } catch (err) {
      setPwMsg({ kind: 'error', code: err instanceof ApiError ? err.code : 'unexpected_response' });
    } finally {
      setPwBusy(false);
    }
  }

  const flash = (msg: { kind: 'ok' | 'error'; code: string } | null) =>
    msg && (
      <p className={`ae-flash ${msg.kind === 'ok' ? 'ae-flash--success' : 'ae-flash--error'}`}>
        {t(`profile.${msg.code}`, msg.code)}
      </p>
    );

  return (
    <div className="ae-page space-y-4">
      <PageHero title={t('profile.title')} subtitle={t('profile.subtitle')} />

      <Panel title={t('profile.name')} className="ae-form-panel">
        {flash(nameMsg)}
        <p className="mb-3 text-sm text-[var(--text-muted)]" dir="ltr">
          {user?.email}
          {tenant?.name ? ` · ${tenant.name}` : ''}
        </p>
        <form onSubmit={saveName} className="grid gap-3 md:max-w-md">
          <label className="text-sm">
            <span className="mb-1 block">{t('profile.name')}</span>
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              required className="ae-input w-full"
            />
          </label>
          <div>
            <button type="submit" disabled={nameBusy} className="ae-btn-primary">
              {nameBusy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </Panel>

      <Panel title={t('profile.changePassword')} className="ae-form-panel">
        {flash(pwMsg)}
        <form onSubmit={savePassword} className="grid gap-3 md:max-w-md">
          <label className="text-sm">
            <span className="mb-1 block">{t('profile.currentPassword')}</span>
            <input
              type="password" autoComplete="current-password" required
              value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
              className="ae-input w-full"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block">{t('profile.newPassword')}</span>
            <input
              type="password" autoComplete="new-password" required
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              className="ae-input w-full"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block">{t('profile.confirmPassword')}</span>
            <input
              type="password" autoComplete="new-password" required
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              className="ae-input w-full"
            />
          </label>
          <div>
            <button type="submit" disabled={pwBusy} className="ae-btn-primary">
              {pwBusy ? t('common.saving') : t('profile.updatePassword')}
            </button>
          </div>
        </form>
      </Panel>

      {twoFactor && (
        <Panel title={t('twoFactor.enable')} className="ae-form-panel">
          <span className={`ae-badge ${twoFactor.enabled ? 'ae-badge-success' : 'ae-badge-muted'}`}>
            {t(twoFactor.enabled ? 'twoFactor.enabled' : 'twoFactor.disabled')}
          </span>
        </Panel>
      )}
    </div>
  );
}
