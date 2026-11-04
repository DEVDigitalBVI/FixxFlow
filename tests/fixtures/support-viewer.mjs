/** Synthetic support insights for the local interface preview only. */
export const sharedIncident = {
  ticket_id: '70000000-0000-4000-8000-000000000001',
  ticket_number: 1042,
  title: 'Office network interruption',
  overview:
    'Some employees were unable to connect to office Wi-Fi. IT identified a faulty network switch and restored connectivity across the affected floor.',
  resolution:
    'Replaced the faulty switch, verified connectivity with affected teams, and added monitoring. Please contact IT if your connection remains unstable.',
  status: 'resolved',
  priority: 'high',
  ticket_type: 'incident',
  published: true,
  revision: 1,
  updated_at: '2026-11-04T13:15:00Z',
};
export const dashboard = {
  report: {
    asOf: '2026-11-04T14:00:00Z',
    timezone: 'America/Tortola',
    today: '2026-11-04',
    summary: { created: 8, resolved: 6, open: 12, overdue: 2, response: 26, resolution: 194 },
    daily: Array.from({ length: 14 }, (_, i) => ({
      day: new Date(Date.UTC(2026, 9, 22 + i)).toISOString().slice(0, 10),
      created: 3 + (i % 5),
      resolved: 2 + (i % 4),
      reopened: 0,
      response: i === 3 ? null : 18 + ((i * 7) % 32),
      resolution: 180 + i * 4,
    })),
    breakdowns: [],
    sla: [],
  },
  workload: [
    { label: 'Jordan Morgan', active: true, open_count: 5, waiting_count: 2, overdue_count: 1 },
    { label: 'Alex Rivera', active: true, open_count: 4, waiting_count: 1, overdue_count: 1 },
    { label: 'Unassigned', active: true, open_count: 3, waiting_count: 0, overdue_count: 0 },
  ],
};
export function supportPreviewMocks(mocks) {
  mocks['@/features/support-viewer/access'] =
    `exports.requireInsightAccess=async()=>({dashboard:true,sharedIncidents:true});`;
  mocks['./actions'] +=
    `exports.saveInsightAccess=async()=>({success:'Preview: access form submitted. No workspace data was changed.'});exports.saveSharedIncident=async()=>({success:'Preview: summary form submitted. No workspace data was changed.'});`;
  mocks['@/lib/supabase/server'] +=
    `const original=exports.createClient;exports.createClient=async()=>{const db=await original();const rpc=db.rpc;db.rpc=(name,args)=>name==='support_viewer_dashboard'?Promise.resolve({data:${JSON.stringify(dashboard)},error:null}):name==='shared_incidents'?Promise.resolve({data:{count:1,rows:[${JSON.stringify(sharedIncident)}]},error:null}):rpc(name,args);return db;};`;
}
