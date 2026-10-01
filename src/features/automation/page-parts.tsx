import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { automationPath } from './ui-model';
export function AutomationHeader({title,description,back=automationPath,backLabel,actions}:{title:string;description:string;back?:string;backLabel?:string;actions?:ReactNode}) {return <PageHeader title={title} description={description} eyebrow="Administration" back={{href:back,label:backLabel??(back==='/app/administration'?'Administration':'Automations')}} actions={actions}/>;}
export function AutomationPages({page,hasNext,href}:{page:number;hasNext:boolean;href:(page:number)=>string}) {return <nav className="queue-views" aria-label="Automation pages">{page>1&&<Link className="button button-secondary" href={href(page-1)}>Previous</Link>}<span>Page {page}</span>{hasNext&&<Link className="button button-secondary" href={href(page+1)}>Next</Link>}</nav>;}
