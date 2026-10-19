import {randomUUID} from 'node:crypto';
import {notFound} from 'next/navigation';
import {requireViewer} from '@/lib/auth/viewer';
import {PageHeader} from '@/components/ui/page-header';
import {TemplateBuilder} from '@/features/workflows/template-builder';
import {newWorkflowDefinition} from '@/features/workflows/model';
export default async function Page(){const viewer=await requireViewer();if(viewer.role!=='administrator')notFound();return <div className="page page-narrow"><PageHeader title="Create workflow template" description="Build a company procedure for incidents, maintenance or other repeatable work." back={{href:'/app/administration/workflows',label:'Back to templates'}}/><section className="settings-card"><TemplateBuilder templateId={randomUUID()} revision={0} initial={newWorkflowDefinition(randomUUID())}/></section></div>;}
