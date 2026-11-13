import type { KnowledgeAsset } from '@/types/database';

export const articleAssetTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
type ArticleAssetsOptions = {
  library: boolean;
  isNew: boolean;
  busy: boolean;
  uploading: boolean;
  uploadMessage: string;
  assets: KnowledgeAsset[];
  upload: (file?: File) => Promise<void>;
};
export function renderArticleAssets({
  library,
  isNew,
  busy,
  uploading,
  uploadMessage,
  assets,
  upload,
}: ArticleAssetsOptions) {
  return (
    !library && (
      <section className="settings-card">
        <h2>Images and attachments</h2>
        {isNew ? (
          <p>
            Save your article to add images and attachments. You’ll return to this editor after
            saving.
          </p>
        ) : (
          <>
            <p>Files added here are available to anyone who can read this article.</p>
            <label className="knowledge-file">
              Upload a file (up to 6 MB)
              <input
                type="file"
                accept={articleAssetTypes.join(',')}
                disabled={uploading || busy}
                onChange={(e) => {
                  void upload(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            {uploadMessage && <p role="status">{uploadMessage}</p>}
            <ul>
              {assets.map((a) => (
                <li key={a.id}>
                  <a href={`/app/help/assets/${a.id}?download=1`}>{a.file_name}</a>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    )
  );
}
