import { useRouter } from 'next/navigation';
import { useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';

import { HISTORY_PAGE_SIZE } from '@/features/conversations/history';
import type { createClient } from '@/lib/supabase/client';
import { uploadAndRegister } from '@/lib/uploads';

import { validChatAttachment } from './media';
import type { RoomAttachment } from './message-model';

type UploadOptions = {
  supabase: ReturnType<typeof createClient>;
  open: boolean;
  noteMode: boolean;
  organizationId: string;
  conversationId: string;
  viewerId: string;
  followLatestRef: RefObject<boolean>;
  setReadingHistory: Dispatch<SetStateAction<boolean>>;
  setUploading: Dispatch<SetStateAction<boolean>>;
  setUploadName: Dispatch<SetStateAction<string>>;
  setFailedUpload: Dispatch<SetStateAction<File | null>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setLiveAttachments: Dispatch<SetStateAction<RoomAttachment[]>>;
};
export function useChatUpload({
  supabase,
  open,
  noteMode,
  organizationId,
  conversationId,
  viewerId,
  followLatestRef,
  setReadingHistory,
  setUploading,
  setUploadName,
  setFailedUpload,
  setFeedback,
  setLiveAttachments,
}: UploadOptions) {
  const router = useRouter();
  const uploadInFlight = useRef(false);
  async function upload(file: File | undefined) {
    if (!file || !open || noteMode || uploadInFlight.current) return;
    if (!validChatAttachment(file)) {
      setFeedback(
        'Choose a nonempty photo, MP4, WebM, MOV, audio, PDF, text, Word, or Excel file up to 10 MB.',
      );
      return;
    }
    uploadInFlight.current = true;
    followLatestRef.current = true;
    setReadingHistory(false);
    setUploading(true);
    setUploadName(file.name);
    setFailedUpload(null);
    setFeedback(`Uploading ${file.name}…`);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
      const path = `${organizationId}/${conversationId}/${viewerId}/${crypto.randomUUID()}-${safeName}`;
      const bucket = supabase.storage.from('chat-attachments');
      let savedFile: RoomAttachment | undefined;
      const result = await uploadAndRegister({
        upload: () => bucket.upload(path, file, { contentType: file.type, upsert: false }),
        register: async () => {
          const result = await supabase
            .from('chat_attachments')
            .insert({
              organization_id: organizationId,
              conversation_id: conversationId,
              uploaded_by: viewerId,
              storage_path: path,
              file_name: file.name,
              content_type: file.type,
              size_bytes: file.size,
            })
            .select(
              'id, file_name, size_bytes, created_at, storage_path, content_type, uploaded_by',
            )
            .single();
          if (result.data) savedFile = result.data;
          return result;
        },
        remove: () => bucket.remove([path]),
      });
      if (result === 'saved') {
        if (savedFile) {
          let url: string | undefined;
          try {
            const { data: signed } = await bucket.createSignedUrl(path, 3600);
            url = signed?.signedUrl;
          } catch {
            /* The file is saved; leave renewal to the shared media retry control. */
          }
          const attachment = { ...savedFile, url };
          setLiveAttachments((current) =>
            [...current.filter((item) => item.id !== attachment.id), attachment].slice(
              -HISTORY_PAGE_SIZE,
            ),
          );
        }
        setFeedback('Attachment added.');
        router.refresh();
      } else if (result === 'unconfirmed')
        setFeedback('We could not confirm the attachment. Refresh the file list before retrying.');
      else {
        setFailedUpload(file);
        setFeedback('The attachment could not be saved. Retry the upload or choose another file.');
      }
    } catch {
      setFeedback('The upload could not be confirmed. Refresh the file list before trying again.');
    } finally {
      uploadInFlight.current = false;
      setUploading(false);
    }
  }

  return upload;
}
