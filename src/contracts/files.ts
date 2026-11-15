import { z } from 'zod';

/**
 * Files people give the CRM: something attached to an email, or handed to the assistant. A file is
 * uploaded first and then referred to by its id. The bytes travel as base64 inside the same
 * operations everything else uses, so an agent over MCP can attach a file exactly as a person can.
 */

/** The largest single file, in bytes. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** The most an email can carry. */
export const MAX_ATTACHMENTS = 5;

export const fileInfoSchema = z.object({ id: z.string(), name: z.string(), contentType: z.string(), size: z.number().int() });
export type FileInfo = z.infer<typeof fileInfoSchema>;

export const uploadFileSchema = z.object({
  name: z.string().min(1).max(200),
  contentType: z.string().max(200),
  /** The file's bytes, base64 encoded. */
  content: z.string(),
});
export type UploadFile = z.infer<typeof uploadFileSchema>;

export const fileContentSchema = fileInfoSchema.extend({ content: z.string() });
export type FileContent = z.infer<typeof fileContentSchema>;

export interface FilesApi {
  /** Stores a file and returns its id, to attach to an email or hand to the assistant. */
  uploadFile(input: UploadFile): Promise<FileInfo>;
  /** A stored file with its bytes, base64 encoded. */
  downloadFile(id: string): Promise<FileContent>;
}
