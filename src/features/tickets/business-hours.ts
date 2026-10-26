/** Fixed support coverage, evaluated in the ticket's workspace timezone. */
export const SUPPORT_HOURS = '7 AM–10 PM, every day';
const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(at: number, zone: string) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(zone, formatter);
  }
  const values = Object.fromEntries(
    formatter.formatToParts(at).map(({ type, value }) => [type, Number(value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}
function localHourUtc(day: number, hour: number, zone: string) {
  const target = day + hour * 3600000;
  let guess = target;
  // Resolve the offset at the requested local hour, including DST changes.
  for (let iteration = 0; iteration < 3; iteration++) {
    const p = parts(guess, zone);
    const rendered = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const correction = target - rendered;
    if (!correction) break;
    guess += correction;
  }
  return guess;
}
export function withinSupportHours(at: number, zone: string) {
  const { hour } = parts(at, zone);
  return hour >= 7 && hour < 22;
}
export function businessMillisecondsBetween(start: number, end: number, zone: string): number {
  if (end < start) return -businessMillisecondsBetween(end, start, zone);
  const first = parts(start, zone),
    last = parts(end, zone);
  const finalDay = Date.UTC(last.year, last.month - 1, last.day);
  let total = 0;
  for (
    let day = Date.UTC(first.year, first.month - 1, first.day);
    day <= finalDay;
    day += 86400000
  ) {
    total += Math.max(
      0,
      Math.min(end, localHourUtc(day, 22, zone)) - Math.max(start, localHourUtc(day, 7, zone)),
    );
  }
  return total;
}
