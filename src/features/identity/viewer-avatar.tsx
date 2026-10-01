import 'server-only';
import { Suspense } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { requireViewerAvatarUrl } from '@/lib/auth/viewer';

type Props = { name: string; size?: 'small' | 'medium' | 'large' };

async function Photo(props: Props) {
  return <Avatar {...props} src={await requireViewerAvatarUrl()} />;
}

/** Keep the shell and page usable while private photo signing finishes. */
export function ViewerAvatar(props: Props) {
  return <Suspense fallback={<Avatar {...props} />}><Photo {...props} /></Suspense>;
}
