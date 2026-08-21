import { StorageProvider } from '@models/enums';
import { EvidenceFile } from '@models/EvidenceFile';
import type {
  EvidenceContext,
  FileCategory,
  LinkedTo,
  SafeEvidence,
} from '../../interfaces/evidence/evidence.interface';

export function createError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

export const VALID_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export const VALID_PDF_TYPES = new Set(['application/pdf']);

export const VALID_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/aac',
]);

export const ALL_VALID_MIME_TYPES = new Set<string>([
  ...VALID_IMAGE_TYPES,
  ...VALID_PDF_TYPES,
  ...VALID_AUDIO_TYPES,
]);

export function getCategoryFromMimeType(mimeType: string): FileCategory | null {
  if (VALID_IMAGE_TYPES.has(mimeType)) return 'image';
  if (VALID_PDF_TYPES.has(mimeType)) return 'pdf';
  if (VALID_AUDIO_TYPES.has(mimeType)) return 'audio';
  return null;
}

/**
 * Only resolvable when findMany's joins were used (planned_activity /
 * activity_score / mock_test relations loaded) — a plain repo.create()/save()
 * result (e.g. right after createEvidence) won't have these populated, and
 * that's fine: this just returns null rather than throwing.
 */
function resolveContext(e: EvidenceFile): EvidenceContext | null {
  if (e.mock_test) return { label: e.mock_test.name, skillName: null };
  if (e.activity_score?.planned_activity) {
    return {
      label: e.activity_score.planned_activity.title,
      skillName: e.activity_score.skill?.name ?? null,
    };
  }
  if (e.planned_activity) {
    return { label: e.planned_activity.title, skillName: e.planned_activity.skill?.name ?? null };
  }
  return null;
}

export function toSafeEvidence(e: EvidenceFile): SafeEvidence {
  let linkedTo: LinkedTo | null = null;
  let linkedId: string | null = null;

  if (e.planned_activity_id !== null) {
    linkedTo = 'activity';
    linkedId = e.planned_activity_id;
  } else if (e.activity_score_id !== null) {
    linkedTo = 'score';
    linkedId = e.activity_score_id;
  } else if (e.mock_test_id !== null) {
    linkedTo = 'mock';
    linkedId = e.mock_test_id;
  }

  const category: FileCategory | null =
    e.storage_provider === StorageProvider.EXTERNAL
      ? 'external'
      : getCategoryFromMimeType(e.mime_type ?? '');

  return {
    id: e.id,
    fileName: e.file_name,
    originalFileName: e.original_file_name,
    mimeType: e.mime_type,
    fileSize: e.file_size,
    storageProvider: e.storage_provider,
    storageKey: e.storage_key,
    publicUrl: e.public_url,
    category,
    linkedTo,
    linkedId,
    context: resolveContext(e),
    uploadedAt: e.uploaded_at,
    createdAt: e.created_at,
  };
}
