import Link from 'next/link';
import { notFound } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { AssetForm } from '@/features/assets/asset-form';
import { requireViewer } from '@/lib/auth/viewer';

export default async function NewAssetPage() {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') notFound();
  return (
    <div className="page">
      <PageHeader
        title="Add asset"
        eyebrow="Assets"
        description="Give equipment a unique tag so it can be found and linked to support tickets."
        back={{ href: '/app/assets', label: 'Assets' }}
        actions={
          <Link className={buttonVariants({ variant: 'secondary' })} href="/app/assets/import">
            Import spreadsheet
          </Link>
        }
      />
      <AssetForm />
    </div>
  );
}
