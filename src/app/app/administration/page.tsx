import { notFound } from 'next/navigation';

import { AdministrationHub } from '@/features/administration/administration-hub';
import { requireViewer } from '@/lib/auth/viewer';

export default async function AdministrationPage() {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator') notFound();
  return <AdministrationHub organizationName={viewer.organizationName} />;
}
