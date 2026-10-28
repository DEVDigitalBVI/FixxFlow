import { isObjectRecord as record } from '@/lib/validation';

export type CleanupRun = {
  trigger: 'schedule' | 'owner';
  startedAt: string;
  finishedAt: string | null;
  dedupDeleted: number;
  countsDeleted: number;
  complete: boolean;
};
export type RetentionStatus = {
  retentionDays: number;
  expiredKeys: number;
  expiredCounts: number;
  lastRun: CleanupRun | null;
};
export type CleanupResult =
  | { skipped: true }
  | {
      skipped: false;
      dedupDeleted: number;
      countsDeleted: number;
      complete: boolean;
      finishedAt: string;
    };

const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const time = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function isRetentionStatus(value: unknown): value is RetentionStatus {
  if (!record(value)) return false;
  const run = value.lastRun;
  return (
    count(value.retentionDays) &&
    count(value.expiredKeys) &&
    count(value.expiredCounts) &&
    (run === null ||
      (record(run) &&
        (run.trigger === 'schedule' || run.trigger === 'owner') &&
        time(run.startedAt) &&
        (run.finishedAt === null || time(run.finishedAt)) &&
        count(run.dedupDeleted) &&
        count(run.countsDeleted) &&
        typeof run.complete === 'boolean'))
  );
}

export function isCleanupResult(value: unknown): value is CleanupResult {
  if (!record(value)) return false;
  if (value.skipped === true) return true;
  return (
    value.skipped === false &&
    count(value.dedupDeleted) &&
    count(value.countsDeleted) &&
    typeof value.complete === 'boolean' &&
    time(value.finishedAt)
  );
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

export function cleanupMessage(result: CleanupResult) {
  if (result.skipped)
    return 'Another cleanup is already running. Refresh in a minute to see its result.';
  const removed = `Removed ${plural(result.dedupDeleted, 'expired deduplication key', 'expired deduplication keys')} and ${plural(result.countsDeleted, 'daily count', 'daily counts')} past retention.`;
  return result.complete
    ? `${removed} Nothing expired remains.`
    : `${removed} More expired rows remain; the next run continues automatically.`;
}

export function runSummary(run: CleanupRun) {
  return `${run.trigger === 'schedule' ? 'Scheduled' : 'Owner-started'} run removed ${plural(run.dedupDeleted, 'key', 'keys')} and ${plural(run.countsDeleted, 'daily count', 'daily counts')}${run.finishedAt ? '' : ' (did not finish)'}${run.finishedAt && !run.complete ? '; more remained' : ''}.`;
}
