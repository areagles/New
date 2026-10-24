'use client';

/**
 * The application shell.
 *
 * Visibility is left entirely to the recovered stylesheet rather than driven by utility
 * classes: `.ae-shell-aside` is `display:none` until 1024px, and below that the system uses
 * a separate `.ae-nav-sheet-*` drawer rather than sliding the sidebar in. Adding
 * `hidden md:flex` on top of that fought the cascade and broke both breakpoints.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import navigation from '@/lib/navigation.json';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { BUILT, PAGE_PERMISSIONS } from '@/lib/built';

type NavItem = { href: string; key: string; icon: string; labelAr: string | null; labelEn: string | null };
type NavSection = { key: string; labelAr: string | null; labelEn: string | null; items: NavItem[] };

const sections = navigation.sections as NavSection[];

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t, lang, setLang } = useI18n();
  const { user, tenant, loading, signOut, can } = useSession();
  const [sheetOpen, setSheetOpen] = useState(false);

  // A tap that navigates should leave the drawer behind it.
  useEffect(() => {
    setSheetOpen(false);
  }, [pathname]);

  const label = (item: NavItem) =>
    t(item.key, (lang === 'ar' ? item.labelAr : item.labelEn) ?? item.key);
  const sectionLabel = (s: NavSection) =>
    t(s.key, (lang === 'ar' ? s.labelAr : s.labelEn) ?? s.key);
  const isActive = (href: string) => pathname === href || pathname === `${href}/`;

  const navBody = (variant: 'aside' | 'sheet') =>
    sections.map((section) => (
      <div key={section.key} className={variant === 'sheet' ? 'ae-nav-sheet-section' : 'mb-3'}>
        <p className={variant === 'sheet' ? 'ae-nav-sheet-title' : 'ae-nav-section-label text-xs'}>
          {sectionLabel(section)}
        </p>
        <div className={variant === 'sheet' ? 'ae-nav-sheet-list' : undefined}>
          {section.items.map((item) => {
            const cls = variant === 'sheet' ? 'ae-nav-sheet-link' : 'ae-nav-link';
            const iconCls = variant === 'sheet' ? 'ae-nav-sheet-icon' : 'ae-nav-icon';
            const inner = (
              <>
                <span className={iconCls}>{item.icon}</span>
                <span className="truncate">{label(item)}</span>
              </>
            );
            // A link to a page the API will refuse is worse than no link at all.
            const needs = PAGE_PERMISSIONS[item.href];
            if (needs && !can(...needs)) return null;

            return BUILT.has(item.href) ? (
              <Link
                key={item.href}
                href={item.href}
                className={`${cls} ${isActive(item.href) ? 'is-active' : ''}`}
              >
                {inner}
              </Link>
            ) : (
              <span
                key={item.href}
                aria-disabled="true"
                title={t('nav.pendingMigration')}
                className={`${cls} pointer-events-none opacity-40`}
              >
                {inner}
              </span>
            );
          })}
        </div>
      </div>
    ));

  return (
    <div className="ae-shell flex min-h-dvh">
      <aside className="ae-shell-aside flex-col">
        <div className="ae-shell-aside-head px-4 py-4">
          <p className="ae-shell-brand-title text-lg">Arab Eagles</p>
          <p className="ae-shell-brand-sub text-xs">{tenant?.name ?? tenant?.slug ?? ''}</p>
        </div>

        <nav className="ae-shell-nav px-2">{navBody('aside')}</nav>

        <div className="ae-user-panel px-4 py-3">
          <p className="truncate text-sm font-bold">{loading ? '…' : user?.name ?? ''}</p>
          <p className="truncate text-xs">{user?.email ?? ''}</p>
          <button type="button" onClick={signOut} className="ae-logout-btn mt-2 text-xs">
            {t('common.signOut')}
          </button>
        </div>
      </aside>

      <div className="ae-shell-content flex min-w-0 flex-1 flex-col">
        <header className="ae-shell-mobile-bar flex items-center justify-between gap-3">
          <button
            type="button"
            className="ae-icon-btn"
            onClick={() => setSheetOpen(true)}
            aria-label={t('common.menu')}
            aria-expanded={sheetOpen}
          >
            ☰
          </button>
          <span className="ae-shell-top-brand text-sm font-semibold">Arab Eagles</span>
          <button
            type="button"
            className="ae-lang-btn px-2.5 py-1 text-xs font-bold"
            onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
          >
            {lang === 'ar' ? 'EN' : 'ع'}
          </button>
        </header>

        <main className="ae-shell-main flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>

      {sheetOpen && (
        <div className="ae-nav-sheet-root" role="dialog" aria-modal="true">
          <button
            type="button"
            className="ae-nav-sheet-backdrop"
            aria-label={t('common.close')}
            onClick={() => setSheetOpen(false)}
          />
          <div className="ae-nav-sheet">
            <div className="ae-nav-sheet-head">
              <span className="text-sm font-bold">{user?.name ?? 'Arab Eagles'}</span>
              <button type="button" className="ae-icon-btn" onClick={() => setSheetOpen(false)}>
                ✕
              </button>
            </div>
            <div className="ae-nav-sheet-body">{navBody('sheet')}</div>
            <div className="ae-nav-sheet-foot">
              <button type="button" onClick={signOut} className="ae-logout-btn text-xs">
                {t('common.signOut')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
