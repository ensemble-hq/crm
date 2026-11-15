import { Paperclip, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../api';
import { type FileInfo, MAX_FILE_BYTES } from '../contracts/files';
import { ICON, small } from './styles';

/** A file's bytes as base64, which is how files travel to the server. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`"${file.name}" could not be read.`));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });
}

export function fileSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Fetches a file and hands it to the browser to save. */
async function save(file: FileInfo): Promise<void> {
  const { content, contentType } = await api.downloadFile(file.id);
  const bytes = Uint8Array.from(atob(content), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The files on a message or about to be sent. Clicking one saves it; `onRemove` adds a way to take one off. */
export function FileChips({ files, onRemove }: { files: FileInfo[]; onRemove?: (id: string) => void }) {
  const [problem, setProblem] = useState<string>();
  if (files.length === 0) return null;
  return (
    <div className="m-cluster" data-gap="1">
      {files.map((file) => (
        <span key={file.id} className="m-badge" style={{ gap: 'var(--m-space-1)', maxInlineSize: 280 }}>
          <button type="button" title={`Save ${file.name}`} onClick={() => void save(file).catch((cause: unknown) => setProblem(cause instanceof Error ? cause.message : 'That file could not be fetched.'))} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--m-space-1)', padding: 0, border: 0, background: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer', minInlineSize: 0 }}>
            <Paperclip size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
            <span style={{ opacity: 0.7, flexShrink: 0 }}>{fileSize(file.size)}</span>
          </button>
          {onRemove ? (
            <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(file.id)} style={{ display: 'inline-flex', padding: 0, border: 0, background: 'none', color: 'inherit', cursor: 'pointer' }}>
              <X size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden />
            </button>
          ) : null}
        </span>
      ))}
      {problem ? <span className="m-field-error" role="alert">{problem}</span> : null}
    </div>
  );
}

/** A button that uploads the files chosen and hands back what the server calls them. */
export function AttachButton({ onAdded, onProblem, room, label = 'Attach', iconOnly = false }: { onAdded: (files: FileInfo[]) => void; onProblem: (problem: string | undefined) => void; room: number; label?: string; iconOnly?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function chosen(list: FileList | null) {
    const picked = [...(list ?? [])];
    if (picked.length === 0) return;
    onProblem(undefined);
    if (picked.length > room) return onProblem(room <= 0 ? 'That is as many files as fit.' : `There is room for ${room} more ${room === 1 ? 'file' : 'files'}.`);
    const big = picked.find((file) => file.size > MAX_FILE_BYTES);
    if (big) return onProblem(`"${big.name}" is larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`);
    setBusy(true);
    try {
      const added: FileInfo[] = [];
      for (const file of picked) added.push(await api.uploadFile({ name: file.name, contentType: file.type || 'application/octet-stream', content: await toBase64(file) }));
      onAdded(added);
    } catch (cause) {
      onProblem(cause instanceof Error ? cause.message : 'The file could not be added.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <>
      <input ref={input} type="file" multiple hidden onChange={(event) => void chosen(event.target.files)} />
      <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only={iconOnly || undefined} aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <span className="m-spinner" data-size="sm" role="status" aria-label="Adding the file" /> : <Paperclip size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />}
        {iconOnly ? null : <span style={busy ? small : undefined}>{busy ? 'Adding…' : label}</span>}
      </button>
    </>
  );
}
