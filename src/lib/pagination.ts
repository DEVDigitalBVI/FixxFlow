/** Parse a single decimal page parameter and bound database offsets. */
export function pageNumber(value: string | string[] | undefined, maximum = 100000) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return 1;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : 1;
}
