'use client';

/**
 * Turning a document into a link the client can open.
 *
 * Nothing is public until someone here says so. `ae_fetch_public_document` matches on
 * `share_token` *and* `share_enabled`, so switching the preview off revokes an already-sent
 * link without changing the token — the same link works again when it is switched back on.
 * That is worth knowing before pressing it: this is not a draft toggle, it is the difference
 * between a client being able to read the document and getting a "not available" page.
 *
 * The link is what the client approves a quote or reports a payment from, so on documents that
 * accept those it is the only route to them.
 */

import { useCallback, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Panel } from '@/components/page';

type ShareState = { shareToken: string | null; shareEnabled: boolean; shareUrl?: string | null };

export function DocumentShare({
  docType,
  docId,
  initial,
}: {
  docType: 'quote' | 'invoice' | 'receipt' | 'purchase';
  docId: string;
  initial: { shareToken?: string | null; shareEnabled?: boolean | null };
}) {
  const { t } = useI18n();

  const [state, setState] = useState<ShareState>({
    shareToken: initial.shareToken ?? null,
    shareEnabled: initial.shareEnabled === true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = state.shareUrl
    ?? (state.shareToken ? `${window.location.origin}/p/?token=${state.shareToken}` : null);

  const toggle = useCallback(async () => {
    setBusy(true);
    setError(false);
    setCopied(false);
    try {
      const res = await api<ShareState>(`/documents/${docType}/${docId}/share`, {
        method: 'POST',
        body: { enabled: !state.shareEnabled },
      });
      setState({
        shareToken: res.shareToken ?? null,
        shareEnabled: res.shareEnabled === true,
        shareUrl: res.shareUrl ?? null,
      });
    } catch (err) {
      setError(err instanceof ApiError);
    } finally {
      setBusy(false);
    }
  }, [docType, docId, state.shareEnabled]);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError(true);
    }
  }

  return (
    <Panel title={t('clientPortal.title', t('portal.client.title'))} className="mb-4">
      {error && <p className="ae-flash ae-flash--error mb-3">{t('share.failed')}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="ae-btn-secondary" disabled={busy} onClick={() => void toggle()}>
          {t(state.shareEnabled ? 'share.previewOff' : 'share.previewOn')}
        </button>

        {state.shareEnabled && url && (
          <>
            <button type="button" className="ae-btn-ghost" onClick={() => void copy()}>
              {t(copied ? 'share.copied' : 'share.copyLink')}
            </button>
            <a href={url} target="_blank" rel="noopener noreferrer" className="ae-dash-section-link">
              {t('share.view')}
            </a>
          </>
        )}
      </div>

      {state.shareEnabled && url && (
        <p className="mt-3 break-all text-xs text-[var(--text-muted)]" dir="ltr">{url}</p>
      )}
    </Panel>
  );
}
