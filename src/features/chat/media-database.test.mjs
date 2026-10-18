import assert from 'node:assert/strict';
import test from 'node:test';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';
const org='20000000-0000-0000-0000-000000000801',worker='10000000-0000-0000-0000-000000000801',employee='10000000-0000-0000-0000-000000000802',outsider='10000000-0000-0000-0000-000000000803',chat='40000000-0000-0000-0000-000000000801';
const identity=async(db,id)=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,aal:'aal1'})]);};
const upload=(db,author,name,type)=>db.query('insert into public.chat_attachments(organization_id,conversation_id,uploaded_by,storage_path,file_name,content_type,size_bytes)values($1,$2,$3,$4,$5,$6,1024) returning id',[org,chat,author,`${org}/${chat}/${author}/${name}`,name,type]);

test('chat media keeps private storage, participant RLS and recipient-scoped notifications',async()=>{
 const db=await migratedPostgres();
 try {
  const bucket=(await db.query("select * from storage.buckets where id='chat-attachments'")).rows[0];
  assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),10*1024*1024);
  for(const type of ['video/mp4','video/webm','video/quicktime','audio/mpeg','audio/ogg'])assert.ok(bucket.allowed_mime_types.includes(type));
  assert.ok(!(await db.query("select allowed_mime_types from storage.buckets where id='ticket-attachments'")).rows[0].allowed_mime_types.includes('video/mp4'));
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$4,now()),($2,$5,now()),($3,$6,now())',[worker,employee,outsider,'media-worker@example.invalid','media-employee@example.invalid','media-outsider@example.invalid']);
  await db.query("insert into public.organizations(id,name,slug)values($1,'Media test','media-test')",[org]);
  await db.query("insert into public.organization_memberships(organization_id,user_id,role)values($1,$2,'administrator'),($1,$3,'end_user'),($1,$4,'end_user')",[org,worker,employee,outsider]);
  await db.query("insert into public.chat_conversations(id,organization_id,requester_id,assigned_technician_id,topic)values($1,$2,$3,$4,'Media upload')",[chat,org,employee,worker]);
  await identity(db,employee);await upload(db,employee,'screen-recording.mp4','video/mp4');
  assert.equal((await db.query('select * from public.notifications')).rows.length,0,'No alert to the uploader');
  await db.exec('reset role');
  assert.equal((await db.query("select * from public.notifications where conversation_id=$1 and recipient_id=$2 and kind='user_replied'",[chat,worker])).rows.length,1);
  await identity(db,worker);await upload(db,worker,'voice-note.mp3','audio/mpeg');
  await db.exec('reset role');
  assert.equal((await db.query("select * from public.notifications where conversation_id=$1 and recipient_id=$2 and kind='chat_response'",[chat,employee])).rows.length,1);
  await identity(db,outsider);assert.equal((await db.query('select * from public.chat_attachments')).rows.length,0);
  await assert.rejects(upload(db,outsider,'forbidden.mp4','video/mp4'),/row-level security/);
  await identity(db,employee);assert.equal((await db.query('select * from public.chat_attachments')).rows.length,2);
  await db.query('update public.notifications set read_at=now() where conversation_id=$1',[chat]);
  await db.exec('reset role');assert.equal((await db.query('select * from public.notifications where conversation_id=$1 and recipient_id=$2 and read_at is null',[chat,worker])).rows.length,2,'Employee cannot mark worker alerts read');
  assert.equal((await db.query("select count(*)::int n from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id where n.conversation_id=$1",[chat])).rows[0].n,3);
  await db.query("update public.chat_conversations set status='closed' where id=$1",[chat]);await identity(db,employee);
  await assert.rejects(upload(db,employee,'closed.mp4','video/mp4'),/row-level security/);
 }finally{await db.close();}
});
