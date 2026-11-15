import { type Context, NotFoundError, ValidationError } from '@mariachi/core';
import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import type { StorageClient } from '@mariachi/storage';
import { randomUUID } from 'node:crypto';
import { type FileContent, type FileInfo, MAX_FILE_BYTES, type UploadFile } from '../../../../src/contracts/files';
import { type FileRow, filesTable } from '../../schema';

/**
 * The files people give the CRM. The bytes live in whatever store this instance is set up with (a
 * folder on disk by default; any S3-compatible store by configuration) and a row here says what
 * each one is. Nothing else in the CRM knows where the bytes are.
 */

/** Kinds of file that run when opened. They are refused, whatever they are called. */
const RUNNABLE = /\.(exe|bat|cmd|com|scr|msi|ps1|vbs|js|jar|app|dmg|sh)$/i;

export class FilesRepository extends DrizzleRepository<FileRow> {
  constructor(db: DrizzleDb) {
    super(filesTable, db);
  }
}

export const toFileInfo = (row: FileRow): FileInfo => ({ id: row.id, name: row.name, contentType: row.contentType, size: row.size });

export class FilesService {
  constructor(
    private readonly files: FilesRepository,
    private readonly storage: StorageClient,
  ) {}

  /** Keeps a file. Used by uploads, and by email arriving with attachments. */
  async store(ctx: Context, input: { name: string; contentType: string; data: Buffer; uploadedBy: string | null }): Promise<FileInfo> {
    const name = input.name.replace(/[\\/\u0000-\u001f]/g, '_').trim().slice(0, 200) || 'file';
    if (RUNNABLE.test(name)) throw new ValidationError(`"${name}" is a kind of file that runs when opened, so it cannot be attached.`);
    if (input.data.length === 0) throw new ValidationError(`"${name}" is empty.`);
    if (input.data.length > MAX_FILE_BYTES) throw new ValidationError(`"${name}" is larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`);
    const id = `file_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const key = `${ctx.tenantId ?? 'crm'}/${id}`;
    const contentType = input.contentType.trim() || 'application/octet-stream';
    await this.storage.put(key, input.data, { access: 'private', contentType });
    return toFileInfo(await this.files.create(ctx, { id, name, contentType, size: input.data.length, key, uploadedBy: input.uploadedBy }));
  }

  async upload(ctx: Context, input: UploadFile): Promise<FileInfo> {
    if (!ctx.userId) throw new ValidationError('Sign in to add a file.');
    // Not base64 at all is caught here: what decodes to nothing is refused as empty.
    return this.store(ctx, { name: input.name, contentType: input.contentType, data: Buffer.from(input.content, 'base64'), uploadedBy: ctx.userId });
  }

  /** What these files are. One that does not exist is left out. */
  async info(ctx: Context, ids: string[]): Promise<FileInfo[]> {
    if (ids.length === 0) return [];
    const rows = await this.files.findMany(ctx, [{ field: 'id', op: 'in', value: ids }], { limit: ids.length });
    return ids.flatMap((id) => rows.filter((row) => row.id === id).map(toFileInfo));
  }

  /** A file's bytes. */
  async read(ctx: Context, id: string): Promise<{ file: FileInfo; data: Buffer }> {
    const row = await this.files.findById(ctx, id);
    const data = row ? await this.storage.get(row.key) : null;
    if (!row || !data) throw new NotFoundError('file', id);
    return { file: toFileInfo(row), data };
  }

  async download(ctx: Context, id: string): Promise<FileContent> {
    const { file, data } = await this.read(ctx, id);
    return { ...file, content: data.toString('base64') };
  }
}
