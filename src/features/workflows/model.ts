import {isUuid} from '@/features/tickets/communications';
export const workflowKinds={incident:'Incident response',maintenance:'Planned maintenance',procedure:'General procedure'} as const;
export type WorkflowKind=keyof typeof workflowKinds;
export type ProcedureStep={id:string;title:string;instructions:string;assignee:'owner'|'backup';due_minutes:number|null;approval_required:boolean;approval_minutes:number|null};
export type WorkflowDefinition={schema_version:1;name:string;kind:WorkflowKind;description:string;steps:ProcedureStep[];communication:{guidance:string;group_names:string[];next_update_minutes:number|null};escalation:{enabled:boolean;acknowledgement_minutes:number;overdue_minutes:number}};
export type WorkflowTemplate={id:string;organization_id:string;name:string;kind:WorkflowKind;description:string;revision:number;latest_version:number;archived:boolean;created_by:string;created_at:string;updated_at:string};
export type TemplateDraft={template_id:string;organization_id:string;definition:WorkflowDefinition;updated_at:string};
export type TemplateVersion={organization_id:string;template_id:string;version:number;definition:WorkflowDefinition;change_note:string;published_by:string;published_at:string};
export type TicketWorkflow={ticket_id:string;organization_id:string;kind:WorkflowKind;owner_id:string;revision:number;created_at:string};
export type WorkflowApplication={id:string;organization_id:string;ticket_id:string;template_id:string;template_version:number;definition_snapshot:WorkflowDefinition;assignment_snapshot:{owner_id:string;backup_id:string|null;approver_id:string|null};fingerprint:string;step_ids:string[];group_ids:string[];applied_by:string;applied_at:string};
export function newProcedureStep(id=crypto.randomUUID()):ProcedureStep{return {id,title:'',instructions:'',assignee:'owner',due_minutes:null,approval_required:false,approval_minutes:60};}
export function newWorkflowDefinition(id=crypto.randomUUID()):WorkflowDefinition{return {schema_version:1,name:'',kind:'procedure',description:'',steps:[newProcedureStep(id)],communication:{guidance:'',group_names:[],next_update_minutes:null},escalation:{enabled:false,acknowledgement_minutes:30,overdue_minutes:15}};}
export function needsBackup(def:WorkflowDefinition){return def.escalation.enabled||def.steps.some(s=>s.assignee==='backup');}
export function needsApprover(def:WorkflowDefinition){return def.steps.some(s=>s.approval_required);}
const integer=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max;
const text=(v:unknown,min:number,max:number):v is string=>typeof v==='string'&&v.trim().length>=min&&v.length<=max;
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));
export function validateWorkflowDefinition(value:unknown):string|undefined{
 if(!object(value)||!keys(value,['schema_version','name','kind','description','steps','communication','escalation'])||value.schema_version!==1||!text(value.name,3,100)||typeof value.kind!=='string'||!Object.hasOwn(workflowKinds,value.kind)||!text(value.description,0,2000))return 'Enter a procedure name (3–100 characters), type and description up to 2,000 characters.';
 if(!Array.isArray(value.steps)||value.steps.length<1||value.steps.length>20)return 'Add 1–20 response steps.';
 const ids=new Set<string>();
 for(const s of value.steps){if(!object(s)||!keys(s,['id','title','instructions','assignee','due_minutes','approval_required','approval_minutes'])||typeof s.id!=='string'||!isUuid(s.id)||ids.has(s.id.toLowerCase())||!text(s.title,3,180)||!text(s.instructions,0,4000)||!['owner','backup'].includes(String(s.assignee))||typeof s.approval_required!=='boolean'||(s.due_minutes!==null&&!integer(s.due_minutes,1,43200))||(s.approval_minutes!==null&&!integer(s.approval_minutes,1,43200))||(s.approval_required&&s.approval_minutes===null))return 'Each step needs a unique ID, a title (3–180 characters), valid assignment and deadlines of 1–43,200 minutes. Instructions can contain up to 4,000 characters.';ids.add(s.id.toLowerCase());}
 const c=value.communication,e=value.escalation;
 if(!object(c)||!keys(c,['guidance','group_names','next_update_minutes'])||!text(c.guidance,0,4000)||!Array.isArray(c.group_names)||c.group_names.length>10||c.group_names.some(n=>!text(n,2,100))||new Set(c.group_names.map(n=>String(n).trim().toLowerCase())).size!==c.group_names.length||(c.next_update_minutes!==null&&!integer(c.next_update_minutes,1,43200)))return 'Use up to 10 distinct stakeholder group names (2–100 characters), guidance up to 4,000 characters and an optional reminder of 1–43,200 minutes.';
 if(!object(e)||!keys(e,['enabled','acknowledgement_minutes','overdue_minutes'])||typeof e.enabled!=='boolean'||!integer(e.acknowledgement_minutes,1,1440)||!integer(e.overdue_minutes,0,1440))return 'Set acknowledgement to 1–1,440 minutes and overdue grace to 0–1,440 minutes.';
 if(new TextEncoder().encode(JSON.stringify(value)).length>131072)return 'This procedure is too large. Reduce its instructions.';
}
