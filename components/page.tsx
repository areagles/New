'use client';

/**
 * The page furniture the design system already defines: a hero with its gold accent bar, a
 * titled panel, and a skeleton for loading.
 *
 * The skeleton exists so a loading state does not need a sentence to say it is loading —
 * the shape of what is coming says it, and one fewer string ends up on screen.
 */

import type { ReactNode } from 'react';

export function PageHero({
  title,
  subtitle,
  actions,
}: {
  title: string;
  /** One line saying what the page is for. The design system styles it; most pages have one
      in the dictionary already, so leaving it out drops a string the old system showed. */
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="ae-page-hero--lite mb-5">
      <span className="ae-page-hero-accent mb-3 block h-1 w-16" aria-hidden />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="ae-page-hero-title">{title}</h1>
          {subtitle && <p className="ae-page-hero-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="ae-page-hero-actions">{actions}</div>}
      </div>
    </header>
  );
}

export function Panel({
  title,
  actions,
  children,
  className = '',
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ae-panel ${className}`}>
      {(title || actions) && (
        <div className="ae-panel-head">
          {title && <h2 className="ae-panel-title">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Placeholder rows shaped like the content they stand in for. */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ae-skeleton h-9 w-full" />
      ))}
    </div>
  );
}
