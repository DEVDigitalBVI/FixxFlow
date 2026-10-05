import {redirect} from 'next/navigation';
import {requirePlatformOwner} from '@/lib/auth/platform';
export default async function PlatformPage(){await requirePlatformOwner();redirect('/platform/customers');}
