/**
 * The pages this rebuild ships.
 *
 * The API hands out hrefs for the whole system — pulse cards, onboarding steps, shortcuts —
 * and most of them still point at screens that have not been migrated yet. A link that goes
 * nowhere is worse than no link, so anything that offers a destination checks it here first
 * and renders as plain text when the target is not ready.
 */
export const BUILT = new Set([
  '/dashboard',
  '/my-loans',
  '/profile',
  '/approvals',
  '/clients',
  '/suppliers',
  '/invoices',
  '/receipts',
  '/quotes',
  '/purchases',
  '/treasury',
  '/jobs',
  '/settings',
  '/users',
  '/reports',
  '/journals',
  '/inventory',
  '/hr',
  '/cheques',
  '/pricing',
  '/morning',
  '/owner',
  '/archive',
  '/dunning',
  '/scheduling',
  '/maintenance',
  '/follow-up',
  '/purchase-orders',
  '/rfq-inbox',
  '/recurring-invoices',
  '/bank-reconciliation',
  '/accounting',
  '/assets',
  '/warehouse',
  '/automation',
  '/eta-pull',
  '/my-leave',
  '/sales',
]);

/** The href if it leads somewhere, otherwise nothing. Query strings are ignored when matching. */
export function builtHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const path = href.split('?')[0].replace(/\/$/, '') || '/';
  return BUILT.has(path) ? href : null;
}

/**
 * What a page needs before it is worth linking to.
 *
 * The recovered navigation carries no permission metadata — the old build must have filtered
 * the sidebar somewhere this rebuild did not recover — so these are read straight off the
 * `ae_require_perm(...)` call that guards each list endpoint. Holding any one of a page's keys
 * is enough, which is how `ae_require_perm` itself treats them.
 *
 * It stopped being academic the moment a second account existed: before that one login held
 * all forty-three permissions and nothing was ever refused, so every link worked. A designer
 * holding only `jobs.view` sees the same sidebar and gets a 403 from most of it.
 *
 * Anything absent here is a page nobody is gated out of — the dashboard filters its own
 * payload by permission, and profile and my-loans are a person's own records.
 */
export const PAGE_PERMISSIONS: Record<string, string[]> = {
  '/jobs': ['jobs.view', 'jobs.create', 'jobs.manage'],
  '/quotes': ['finance.view', 'finance.quotes.manage'],
  '/invoices': ['finance.view', 'finance.invoices.manage'],
  '/receipts': ['finance.receipts.manage', 'settings.manage'],
  '/purchases': ['finance.view', 'finance.purchases.manage'],
  '/treasury': ['finance.view', 'finance.treasury.manage'],
  '/clients': ['clients.view', 'clients.manage'],
  '/suppliers': ['suppliers.view', 'suppliers.manage'],
  '/approvals': ['approvals.view', 'approvals.manage'],
  '/users': ['identity.users.manage'],
  '/settings': ['settings.manage', 'finance.view'],
  '/reports': ['finance.view', 'finance.reports.view', 'finance.reports.manage'],
  '/inventory': ['inventory.view', 'inventory.manage'],
  '/hr': ['hr.view', 'hr.manage', 'hr.payroll.manage'],
  '/cheques': ['finance.view', 'finance.receipts.manage'],
  '/pricing': ['pricing.view', 'pricing.manage'],
  // /dashboard/morning filters its own items by permission and guards nothing, so the page
  // is open; /owner/kpis is guarded by the two admin keys.
  '/owner': ['settings.manage', 'identity.users.manage'],
  '/dunning': ['finance.view', 'finance.invoices.manage'],
  '/follow-up': ['crm.followup.view', 'crm.followup.manage'],
  '/purchase-orders': ['finance.view', 'finance.purchases.manage'],
  '/rfq-inbox': ['jobs.view', 'jobs.manage'],
  '/recurring-invoices': ['finance.view', 'finance.invoices.manage'],
  '/bank-reconciliation': ['finance.view', 'finance.bank.view'],
  '/scheduling': ['scheduling.view', 'scheduling.manage'],
  '/maintenance': ['scheduling.view', 'scheduling.manage'],
  // /archive guards nothing and returns an empty result per type the viewer cannot see;
  // the page filters its own tabs the same way.
  '/accounting': ['accounting.view', 'accounting.manage'],
  '/assets': ['assets.view', 'assets.manage'],
  '/automation': ['automation.view', 'automation.manage'],
  '/eta-pull': ['finance.view', 'finance.purchases.manage'],
  '/sales': ['sales.view', 'sales.manage'],
  // /my-leave is self-service: hr/me/leave needs no hr.* permission, only a linked employee.
  '/warehouse': ['inventory.view', 'inventory.manage'],
  '/journals': ['accounting.view', 'accounting.manage', 'accounting.journals.create', 'accounting.journals.approve'],
};
