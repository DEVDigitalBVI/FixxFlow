export const attachmentTypes = [
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export function validAttachment(file: { type: string; size: number }) {
  return attachmentTypes.some(type => type === file.type) && file.size > 0 && file.size <= 10 * 1024 * 1024;
}

/** Only remove an upload after an explicit registration failure, never a lost response. */
export async function uploadAndRegister({ upload, register, remove }: {
  upload: () => PromiseLike<{ error: unknown }>;
  register: () => PromiseLike<{ error: unknown; confirmedFailure?: boolean }>;
  remove: () => PromiseLike<unknown>;
}): Promise<'saved' | 'upload-failed' | 'registration-failed' | 'unconfirmed'> {
  try {
    if ((await upload()).error) return 'upload-failed';
  } catch { return 'upload-failed'; }
  try {
    const result = await register();
    if (!result.error) return 'saved';
    // PostgREST can resolve network failures as error objects instead of throwing.
    // Only known rejected writes justify deleting the uploaded object.
    const code = typeof result.error === 'object' && result.error !== null && 'code' in result.error
      ? String(result.error.code) : '';
    if (!result.confirmedFailure && !/^(?:22...|23...|28...|42...|P0001|PGRST1\d\d|PGRST30[12])$/.test(code)) return 'unconfirmed';
  } catch {
    // Registration may have committed. Deleting now could break a saved record.
    return 'unconfirmed';
  }
  try { await remove(); } catch { /* Cleanup cannot block recovery in the form. */ }
  return 'registration-failed';
}
