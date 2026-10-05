import assert from 'node:assert/strict';
import test from 'node:test';
import { renderTicketQueue, queueRows } from '../../../tests/fixtures/ticket-queue.mjs';

test('queue presents scoped page counts and all accessible row actions without inventing totals',async()=>{
 const html=await renderTicketQueue();
 assert.equal((html.match(/<h1>/g)||[]).length,1);
 assert.match(html,/aria-labelledby="ticket-queue-heading"/);
 assert.match(html,/6 on this page/);
 assert.match(html,/Showing 1–6/);
 assert.match(html,/aria-label="Tickets" tabindex="0"/);
 assert.equal((html.match(/name="ticketIds"/g)||[]).length,6);
 assert.match(html,/Select ticket 1842/);
 assert.match(html,/<strong>VPN disconnects during video calls<\/strong>/);
 assert.match(html,/dateTime="2026-10-03T09:30:00Z"/i);
 assert.match(html,/aria-current="page">All tickets/);
});

test('individual filter removal preserves other filters and sort while returning to page one',async()=>{
 const html=await renderTicketQueue({filters:{q:'VPN & display',view:'mine',status:'open',priority:'high',page:'3',sort:'oldest'}});
 assert.match(html,/aria-label="Applied ticket filters"/);
 assert.match(html,/href="\/app\/tickets\?q=VPN\+%26\+display&amp;view=mine&amp;priority=high&amp;sort=oldest" aria-label="Remove status filter: Open"/);
 assert.match(html,/href="\/app\/tickets\?view=mine&amp;status=open&amp;priority=high&amp;sort=oldest" aria-label="Remove search filter: Search: VPN &amp; display"/);
 assert.match(html,/Filters and sort · 2 active/);
 assert.match(html,/Oldest update/);
});

test('queue empty, later-page and failure states offer useful recovery without false zero counts',async()=>{
 assert.match(await renderTicketQueue({rows:[],filters:{q:'unmatched'}}),/No matching tickets/);
 const later=await renderTicketQueue({rows:[],filters:{page:'2',view:'mine'}});
 assert.match(later,/Back to first page/);assert.match(later,/href="\/app\/tickets\?view=mine&amp;page=1"/);
 const failed=await renderTicketQueue({error:{message:'Internal detail'}});
 assert.match(failed,/Queue unavailable/);assert.match(failed,/role="alert"/);assert.match(failed,/Try again/);
 assert.doesNotMatch(failed,/0 on this page|Internal detail|name="ticketIds"/);
});

test('queue keeps selection and mutations out of the employee view and escapes long content',async()=>{
 const html=await renderTicketQueue({role:'end_user'});
 assert.match(html,/My tickets/);assert.doesNotMatch(html,/ticket-queue-panel|bulk-ticket-form|Filters and sort/);
 const long=await renderTicketQueue({rows:[{...queueRows[0],title:'<script>unsafe</script> '+ 'long'.repeat(100)}]});
 assert.match(long,/&lt;script&gt;unsafe&lt;\/script&gt;/);assert.doesNotMatch(long,/<script>unsafe/);
});
