'use client';

import { PartyPage } from '@/components/party-page';

export default function ClientsPage() {
  return (
    <PartyPage
      kind="client"
      endpoint="/clients"
      titleKey="clients.title"
      viewPerm="clients.view"
      managePerm="clients.manage"
    />
  );
}
