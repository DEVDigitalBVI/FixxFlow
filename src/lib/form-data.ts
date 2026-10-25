/** Read text without trimming; individual fields decide whether whitespace matters. */
export function formString(
  form: Pick<FormData, 'get'>,
  name: string,
  fallback: string = '',
): string {
  return String(form.get(name) ?? fallback);
}
