import { useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader } from '../ui';
import { issueService } from '../../services/issueService';
import type { IssueAttachmentApiResponse } from '../../api/types';
import { IconPlus, IconPaperclip } from './issue-detail-icons';

// Returns true when an attachment looks like a viewable image, by either the
// file name extension or (if available) a future content-type attribute.
function isImageAttachment(att: IssueAttachmentApiResponse): boolean {
  const name = (att.attributes?.name ?? '').toLowerCase();
  return /\.(jpe?g|png|webp|gif|bmp|svg)$/.test(name);
}

interface IssueAttachmentsPanelProps {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  attachments: IssueAttachmentApiResponse[];
  onAttachmentsChange: Dispatch<SetStateAction<IssueAttachmentApiResponse[]>>;
}

/** Right-rail "Attachments" card: upload via presigned URL, list, and delete. */
export function IssueAttachmentsPanel({
  workspaceSlug,
  projectId,
  issueId,
  attachments,
  onAttachmentsChange,
}: IssueAttachmentsPanelProps) {
  const { t } = useTranslation();
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between text-sm font-medium text-(--txt-secondary)">
        <span className="flex items-center gap-1.5">
          <IconPaperclip />
          {t('workItem.attachments.title', 'Attachments')}
        </span>
        <label
          className="cursor-pointer rounded p-0.5 text-(--txt-icon-tertiary) hover:bg-(--bg-layer-1-hover)"
          title={t('workItem.attachments.upload', 'Upload file')}
        >
          <IconPlus />
          <input
            type="file"
            className="sr-only"
            disabled={uploadingAttachment}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file || !workspaceSlug) return;
              setUploadingAttachment(true);
              try {
                const resp = await issueService.initiateAttachmentUpload(
                  workspaceSlug,
                  projectId,
                  issueId,
                  { name: file.name, size: file.size, type: file.type },
                );
                // Upload file to the presigned URL
                const formData = new FormData();
                Object.entries(resp.upload_data.fields ?? {}).forEach(([k, v]) =>
                  formData.append(k, v),
                );
                formData.append('file', file);
                const uploadResp = await fetch(resp.upload_data.url, {
                  method: 'POST',
                  body: formData,
                  credentials: 'omit',
                });
                if (!uploadResp.ok) throw new Error(`Upload failed: ${uploadResp.status}`);
                await issueService.confirmAttachmentUpload(
                  workspaceSlug,
                  projectId,
                  issueId,
                  resp.asset_id,
                );
                const refreshed = await issueService.listAttachments(
                  workspaceSlug,
                  projectId,
                  issueId,
                );
                onAttachmentsChange(refreshed);
              } catch {
                /* ignore — 503 if MinIO not configured */
              }
              setUploadingAttachment(false);
              e.target.value = '';
            }}
          />
        </label>
      </CardHeader>
      <CardContent className="space-y-1 pt-2">
        {uploadingAttachment && (
          <p className="text-xs text-(--txt-tertiary)">
            {t('workItem.attachments.uploading', 'Uploading…')}
          </p>
        )}
        {attachments.length === 0 && !uploadingAttachment ? (
          <p className="text-xs text-(--txt-tertiary)">
            {t('workItem.attachments.empty', 'No attachments yet.')}
          </p>
        ) : (
          attachments.map((att) => {
            const isImage = isImageAttachment(att);
            return (
              <div key={att.id} className="group">
                {isImage ? (
                  <a
                    href={att.asset_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded border border-(--border-subtle) hover:border-(--txt-accent-primary)"
                    title={att.attributes?.name}
                  >
                    <img
                      src={att.thumbnail_url || att.asset_url}
                      alt={att.attributes?.name ?? ''}
                      loading="lazy"
                      className="h-24 w-full bg-(--bg-layer-2) object-contain"
                    />
                    <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                      <span className="min-w-0 flex-1 truncate text-[10px] text-(--txt-secondary)">
                        {att.attributes?.name ??
                          t('workItem.attachments.fallbackName', 'Attachment')}
                      </span>
                      {att.attributes?.size != null && (
                        <span className="shrink-0 text-[10px] text-(--txt-tertiary)">
                          {(att.attributes.size / 1024).toFixed(0)}KB
                        </span>
                      )}
                    </div>
                  </a>
                ) : (
                  <div className="flex items-center gap-1">
                    <a
                      href={att.asset_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1 truncate text-xs text-(--txt-accent-primary) hover:underline"
                      title={att.attributes?.name}
                    >
                      {att.attributes?.name ?? t('workItem.attachments.fallbackName', 'Attachment')}
                    </a>
                    {att.attributes?.size != null && (
                      <span className="shrink-0 text-[10px] text-(--txt-tertiary)">
                        {(att.attributes.size / 1024).toFixed(0)}KB
                      </span>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    if (!workspaceSlug) return;
                    try {
                      await issueService.deleteAttachment(
                        workspaceSlug,
                        projectId,
                        issueId,
                        att.asset_id,
                      );
                      onAttachmentsChange((prev) => prev.filter((x) => x.id !== att.id));
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 text-[10px] text-(--txt-tertiary) hover:text-(--txt-danger-primary)"
                  title={t('common.delete', 'Delete')}
                >
                  {t('common.delete', 'Delete')}
                </button>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
