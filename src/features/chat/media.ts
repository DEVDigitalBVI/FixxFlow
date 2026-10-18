import { attachmentTypes } from '@/lib/uploads';

export const chatAttachmentLimit = 10 * 1024 * 1024;
export const chatAttachmentTypes = [...attachmentTypes,
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg',
] as const;
export function validChatAttachment(file: { type: string; size: number }) {
  return chatAttachmentTypes.some(type => type === file.type) && file.size > 0 && file.size <= chatAttachmentLimit;
}
export function chatMediaKind(type?: string): 'image' | 'video' | 'audio' | 'file' {
  if (!chatAttachmentTypes.some(allowed => allowed === type)) return 'file';
  return type?.startsWith('image/') ? 'image' : type?.startsWith('video/') ? 'video' : type?.startsWith('audio/') ? 'audio' : 'file';
}
