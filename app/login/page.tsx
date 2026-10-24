'use client';

/**
 * Sign-in.
 *
 * Built on the `login-*` components the design system already ships — `login-mesh` for the
 * ground, `login-form`, `login-label`, `login-submit`, `login-alert`, `login-ghost` — rather
 * than generic ones. They carry the details that make the screen feel finished: the gold
 * glow under the button, the shake on a rejected password, the RTL-aware swap when the form
 * changes between the password and the code step.
 *
 * No marketing copy. The mark, the mesh and the orbs carry the identity; the words are only
 * what signing in requires.
 *
 * Login is two-step: a password can come back with `requires2fa` and a challenge token to
 * exchange for a session, and the account locks out server-side after repeated failures.
 */

import Image from 'next/image';
import { useState } from 'react';
import { api, ApiError, setToken } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type LoginResponse = {
  sessionToken?: string;
  requires2fa?: boolean;
  challengeToken?: string;
};

const ERROR_KEY: Record<string, string> = {
  invalid_credentials: 'login.invalid',
  account_locked: 'login.accountLocked',
  totp_invalid: 'login.totpInvalid',
};

export default function LoginPage() {
  const { t, lang, setLang } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (challenge) {
        const res = await api<LoginResponse>('/identity/login/verify-2fa', {
          method: 'POST',
          quiet: true,
          body: { challengeToken: challenge, code: code.trim() },
        });
        if (res.sessionToken) {
          setToken(res.sessionToken);
          window.location.href = '/my-loans/';
        }
        return;
      }

      const res = await api<LoginResponse>('/identity/login', {
        method: 'POST',
        quiet: true,
        body: { email: email.trim().toLowerCase(), password, tenantSlug: 'sys' },
      });
      if (res.requires2fa && res.challengeToken) {
        setChallenge(res.challengeToken);
        return;
      }
      if (res.sessionToken) {
        setToken(res.sessionToken);
        window.location.href = '/my-loans/';
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'login.failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-root flex min-h-dvh items-center justify-center">
      <div className="login-mesh absolute inset-0" aria-hidden />
      <span className="login-orb login-orb--1" aria-hidden />
      <span className="login-orb login-orb--2" aria-hidden />
      <span className="login-orb login-orb--3" aria-hidden />

      <div className="login-panel-wrap">
        <div className="login-panel">
          <div className="login-panel-top">
            <Image
              src="/icon-512.png"
              alt="Arab Eagles"
              width={44}
              height={44}
              priority
              className="login-showcase-logo"
            />
            <button
              type="button"
              className="ae-lang-btn rounded-[var(--radius-sm)] px-2.5 py-1 text-xs font-bold transition"
              onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
            >
              {lang === 'ar' ? 'EN' : 'ع'}
            </button>
          </div>

          <div className="login-card">
            <div className="login-card-head">
              <p className="login-card-kicker">{t('login.secureGate')}</p>
              <h1 className="text-2xl font-extrabold">{t('login.welcome')}</h1>
            </div>

            {error && (
              <p className="login-alert login-alert--error mb-3">
                {t(ERROR_KEY[error] ?? 'login.failed')}
              </p>
            )}

            <form onSubmit={submit} className="login-form" key={challenge ? 'totp' : 'password'}>
              {challenge ? (
                <label>
                  <span className="login-label mb-1">{t('login.totpCode')}</span>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    required
                    className="ae-input w-full text-center text-lg tracking-[0.4em]"
                  />
                </label>
              ) : (
                <>
                  <label>
                    <span className="login-label mb-1">{t('login.email')}</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="username"
                      dir="ltr"
                      required
                      className="ae-input w-full"
                    />
                  </label>
                  <label>
                    <span className="login-label mb-1">{t('login.password')}</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      className="ae-input w-full"
                    />
                  </label>
                </>
              )}

              <button type="submit" disabled={busy} className="login-submit">
                {busy
                  ? t(challenge ? 'login.totpVerifying' : 'login.submitting')
                  : t(challenge ? 'login.totpSubmit' : 'login.submit')}
              </button>

              {challenge && (
                <button
                  type="button"
                  className="login-ghost"
                  onClick={() => { setChallenge(null); setCode(''); setError(null); }}
                >
                  {t('login.totpBack')}
                </button>
              )}
            </form>

            {challenge && <p className="login-hint">{t('login.totpHint')}</p>}
          </div>
        </div>
      </div>
    </main>
  );
}
