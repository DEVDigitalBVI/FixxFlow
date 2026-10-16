begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

select extensions.is(
  private.next_report_run('monthly', null, 31, 9, 'UTC', '2027-02-01 00:00:00+00'::timestamptz),
  '2027-02-28 09:00:00+00'::timestamptz,
  'monthly schedules clamp to the last day of a non-leap February'
);

select extensions.is(
  private.next_report_run('monthly', null, 31, 9, 'UTC', '2028-02-01 00:00:00+00'::timestamptz),
  '2028-02-29 09:00:00+00'::timestamptz,
  'monthly schedules clamp to leap day'
);

select extensions.is(
  private.next_report_run('monthly', null, 31, 9, 'UTC', '2027-02-28 10:00:00+00'::timestamptz),
  '2027-03-31 09:00:00+00'::timestamptz,
  'a completed monthly run advances to the requested day in the next month'
);

select extensions.is(
  private.next_report_run('weekly', 1, null, 9, 'UTC', '2027-02-01 10:00:00+00'::timestamptz),
  '2027-02-08 09:00:00+00'::timestamptz,
  'a completed weekly run advances seven days'
);

select * from extensions.finish();
rollback;
