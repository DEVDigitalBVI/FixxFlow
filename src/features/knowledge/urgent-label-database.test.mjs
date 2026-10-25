import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const original =
  'Critical targets are 15 minutes for first public staff response and 4 hours for resolution; High is 1 hour and 8 hours.';
const paragraph = (text) => JSON.stringify([{ type: 'paragraph', text }]);

test('urgent label migration renames the imported SLA sentence and preserves edited articles', async () => {
  const org = randomUUID(),
    pristine = randomUUID(),
    edited = randomUUID();
  const db = await migratedPostgres({
    beforeMigration: async (db, name) => {
      if (!name.endsWith('_urgent_priority_email_label.sql')) return;
      await db.query(
        "insert into public.organizations(id,name,slug) values($1,'Urgent label','urgent-label')",
        [org],
      );
      await db.query(
        `insert into public.knowledge_articles(id,organization_id,category,title,content)
         values($1,$3,'Software','SLA guide',$4::jsonb),($2,$3,'Software','Our SLA notes',$5::jsonb)`,
        [
          pristine,
          edited,
          org,
          paragraph(original),
          paragraph('Critical work is paged to the on-call lead.'),
        ],
      );
    },
  });
  try {
    const content = async (id) =>
      (await db.query('select content from public.knowledge_articles where id=$1', [id])).rows[0]
        .content[0].text;
    assert.equal(await content(pristine), original.replace('Critical targets', 'Urgent targets'));
    assert.equal(await content(edited), 'Critical work is paged to the on-call lead.');
  } finally {
    await db.close();
  }
});
