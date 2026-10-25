'use client';

import { useState } from 'react';

import { RetryButton } from '@/components/ui/retry-button';

import { chatMediaKind } from './media';

type MediaFile = { file_name: string; size_bytes: number; content_type?: string; url?: string };
export function ChatMediaAttachment({ file, onReady }: { file: MediaFile; onReady?: () => void }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const kind = chatMediaKind(file.content_type);
  const available = file.url && failedUrl !== file.url;
  const failed = () => setFailedUrl(file.url ?? null);
  return (
    <div className="chat-media">
      {available && kind === 'image' && (
        <a
          href={file.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open image: ${file.file_name} (opens in a new tab)`}
        >
          {/* Signed private URLs must bypass the public image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={file.url}
            alt={file.file_name}
            loading="lazy"
            onLoad={onReady}
            onError={failed}
          />
        </a>
      )}
      {/* User uploads have no caption track. A visible prompt asks for a text description; native controls never autoplay. */}
      {available && kind === 'video' && (
        <video
          src={file.url}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={onReady}
          aria-label={`Video: ${file.file_name}`}
          onError={failed}
        />
      )}
      {available && kind === 'audio' && (
        <audio
          src={file.url}
          controls
          preload="metadata"
          onLoadedMetadata={onReady}
          aria-label={`Audio: ${file.file_name}`}
          onError={failed}
        />
      )}
      <div className="chat-media-caption">
        {file.url ? (
          <a href={file.url} target="_blank" rel="noreferrer">
            {file.file_name}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <strong>{file.file_name}</strong>
        )}
        <span>{Math.ceil(file.size_bytes / 1024)} KB</span>
      </div>
      {!available && (
        <p role="status">
          Media unavailable. Refresh to renew its private link. <RetryButton />
        </p>
      )}
    </div>
  );
}
