import { RetryButton } from '@/components/ui/retry-button';
import { Timestamp } from '@/features/timezones/provider';
import type { createClient } from '@/lib/supabase/server';

/** Signing can fail independently of the metadata read, including per-object errors. */
export async function ticketAttachmentUrls(
  database: Awaited<ReturnType<typeof createClient>>,
  paths: string[],
): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  try {
    const { data, error } = await database.storage
      .from('ticket-attachments')
      .createSignedUrls(paths, 3600);
    return new Map(
      (error ? [] : (data ?? [])).flatMap((item) =>
        !item.error && item.path && item.signedUrl ? [[item.path, item.signedUrl]] : [],
      ),
    );
  } catch {
    return new Map();
  }
}

type Attachment = {
  id: string;
  file_name: string;
  storage_path: string;
  size_bytes: number;
  created_at?: string;
  is_internal?: boolean;
};

export function TicketAttachmentList({
  files,
  urls,
  error = false,
  staff = false,
}: {
  files: Attachment[];
  urls: Map<string, string>;
  error?: boolean;
  staff?: boolean;
}) {
  const signingFailed = files.some((file) => !urls.has(file.storage_path));
  return (
    <>
      {(error || signingFailed) && (
        <p role="alert">
          {error ? 'Attachments could not load.' : 'Some attachment download links could not load.'}{' '}
          <RetryButton label={error ? 'Try again' : 'Retry downloads'} />
        </p>
      )}
      <div className="attachment-list">
        {files.map((file) => {
          const url = urls.get(file.storage_path);
          const content = staff ? (
            <>
              <strong>{file.file_name}</strong>
              <span>
                {file.is_internal ? 'Internal email attachment · ' : ''}
                {Math.ceil(file.size_bytes / 1024)} KB
                {file.created_at && (
                  <>
                    {' '}
                    · <Timestamp value={file.created_at} />
                  </>
                )}
              </span>
            </>
          ) : (
            <>
              {file.file_name} · {Math.ceil(file.size_bytes / 1024)} KB
            </>
          );
          return url ? (
            <a key={file.id} href={url} target="_blank" rel="noreferrer">
              {content}
            </a>
          ) : (
            <div key={file.id} className="attachment-unavailable">
              {content}
              <span>Download unavailable</span>
            </div>
          );
        })}
        {!error && !files.length && (
          <p className="muted">{staff ? 'No attachments.' : 'No files attached.'}</p>
        )}
      </div>
    </>
  );
}
