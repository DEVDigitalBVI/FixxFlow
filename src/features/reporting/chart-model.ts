/** Display helpers retain missing samples; a missing day is never plotted as zero. */
export function elapsedLabel(minutes: number) {
  if (minutes === 0) return '0m';
  if (minutes < 1) return '<1m';
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60),
    remainder = rounded % 60;
  return hours ? `${hours}h${remainder ? ` ${remainder}m` : ''}` : `${rounded}m`;
}
export function chartDate(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? day
    : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
        date,
      );
}
export function chartScale(max: number, time: boolean) {
  const target = Math.max(1, max) / 4;
  const timeSteps = [1, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440, 2880, 7200];
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const numericStep =
    [1, 2, 5, 10].map((n) => n * magnitude).find((n) => n >= target) ?? magnitude * 10;
  const step = time
    ? (timeSteps.find((n) => n >= target) ?? numericStep)
    : Math.max(1, numericStep);
  return { max: step * 4, ticks: [4, 3, 2, 1, 0].map((n) => n * step) };
}
