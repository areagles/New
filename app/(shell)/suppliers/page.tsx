'use client';

import { PartyPage } from '@/components/party-page';

export default function SuppliersPage() {
  return (
    <PartyPage
      kind="supplier"
      endpoint="/suppliers"
      titleKey="suppliers.title"
      viewPerm="suppliers.view"
      managePerm="suppliers.manage"
    />
  );
}
