import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth/viewer';
import { AdministrationHub } from '@/features/administration/administration-hub';

export default async function AdministrationPage() {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator') notFound();
  return <AdministrationHub organizationName={viewer.organizationName}/>;
}
