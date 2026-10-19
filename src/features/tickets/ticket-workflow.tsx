'use client';

import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {TicketStatus} from '@/types/database';

const workflowSteps=[
 {title:'Review request',hint:'Understand the issue and check the files before you begin.',hash:'ticket-review'},
 {title:'Assign & start',hint:'Choose who owns the ticket, then start work when you are ready.',hash:'ticket-assignment'},
 {title:'Coordinate',hint:'',hash:'ticket-workflow-tools'},
 {title:'Respond',hint:'Reply to the requester or choose Internal note for private troubleshooting.',hash:'ticket-conversation'},
 {title:'Resolve',hint:'Confirm the issue is fixed, then mark the ticket resolved. Use another status if work is continuing.',hash:'ticket-resolution'},
 {title:'Activity history',hint:'Review the recorded changes, decisions and updates for this ticket.',hash:'ticket-activity'},
];
const stepsWithoutCoordination=workflowSteps.filter(step=>step.hash!=='ticket-workflow-tools');
export function TicketWorkflow({status,assigned,review,assignment,conversation,resolution,tools,activeWorkflow,history}:{status:TicketStatus;assigned:boolean;review:ReactNode;assignment:ReactNode;conversation:ReactNode;resolution:ReactNode;tools:ReactNode;activeWorkflow:boolean;history:ReactNode}){
 const steps=tools?workflowSteps:stepsWithoutCoordination;
 const initialHash=status==='resolved'||status==='closed'?'ticket-resolution':assigned?(status==='new'||status==='open'?'ticket-assignment':'ticket-conversation'):'ticket-review';
 const initial=steps.findIndex(item=>item.hash===initialHash);
 const [step,setStep]=useState(initial);
 const headings=useRef<Array<HTMLHeadingElement|null>>([]);
 const focusNext=useRef(false);
 useEffect(()=>{
  const followHash=()=>{const hash=window.location.hash;const index=hash==='#ticket-details'?steps.findIndex(s=>s.hash==='ticket-assignment'):steps.findIndex(s=>`#${s.hash}`===hash);if(index>=0){focusNext.current=true;setStep(index);}};
  followHash();window.addEventListener('hashchange',followHash);return()=>window.removeEventListener('hashchange',followHash);
 },[steps]);
 useEffect(()=>{if(focusNext.current){headings.current[step]?.focus();focusNext.current=false;}},[step]);
 const go=(index:number)=>{if(index===step)return;focusNext.current=true;setStep(index);window.history.replaceState(window.history.state,'',`#${steps[index].hash}`);};
 const panels:Record<string,ReactNode>={'ticket-review':review,'ticket-assignment':assignment,'ticket-workflow-tools':tools,'ticket-conversation':conversation,'ticket-resolution':resolution,'ticket-activity':history};
 const hint=(item:typeof workflowSteps[number])=>item.hash==='ticket-workflow-tools'?(activeWorkflow?'This ticket has active coordination work. Review its checklist, approvals and stakeholder updates before continuing.':'Optional for routine tickets. Apply a company procedure or declare a wider incident here, or continue to Respond.'):item.hint;
 return <div className="ticket-wizard">
  <nav aria-label="Ticket workflow"><ol className="ticket-wizard-steps">{steps.map((item,index)=><li key={item.hash}><button type="button" aria-current={step===index?'step':undefined} onClick={()=>go(index)}><span className="ticket-step-number" aria-hidden="true">{index+1}</span><span>{item.title}</span></button></li>)}</ol></nav>
  <p className="muted ticket-wizard-progress" role="status">Step {step+1} of {steps.length} · {steps[step].title}</p>
  {steps.map((item,index)=><section key={item.hash} id={item.hash} hidden={step!==index} aria-labelledby={`${item.hash}-heading`} className="ticket-wizard-panel">
   <header className="ticket-step-heading"><h2 id={`${item.hash}-heading`} ref={node=>{headings.current[index]=node;}} tabIndex={-1}>{item.title}</h2><p className="muted">{hint(item)}</p></header>
   <div className="ticket-step-content">{panels[item.hash]}</div>
  </section>)}
  <div className="ticket-wizard-navigation">{step>0?<button type="button" className="button button-secondary" onClick={()=>go(step-1)}>Back: {steps[step-1].title}</button>:<span/>}{step<steps.length-1?<button type="button" className="button button-primary" onClick={()=>go(step+1)}>Next: {steps[step+1].title}</button>:<p className="muted">{status==='resolved'||status==='closed'?'This ticket is resolved. You can review any step or return to the queue.':'Return to Resolve to update the ticket status, or review any earlier step.'}</p>}</div>

 </div>;
}
