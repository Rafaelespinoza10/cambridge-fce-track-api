import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getDatabaseConnection } from '../lib/database';
import { EvidenceRepository } from '../repositories/evidence.repository';
import { StorageProvider } from '../models/enums';
import type {
  CreateEvidenceBody,
  EvidenceListFilters,
  GenerateUploadUrlBody,
  SafeEvidence,
} from '../interfaces/evidence.interface';
import { ALL_VALID_MIME_TYPES, createError, toSafeEvidence } from '@lib/evidence-library';

const S3_BUCKET = process.env['S3_EVIDENCE_BUCKET'] ?? '';
const S3_REGION = process.env['S3_REGION'] ?? 'us-east-1';
const UPLOAD_URL_EXPIRES_IN = 300; // 5 minutes
const MAX_FILE_SIZE = 52_428_800; // 50 MB

const s3 = new S3Client({ region: S3_REGION });

const VALID_LINKED_TO = new Set(['activity', 'score', 'mock']);

class EvidenceService {
  async generateUploadUrl(
    userId: string,
    body: GenerateUploadUrlBody,
  ): Promise<{ uploadUrl: string; key: string; expiresIn: number }> {
    if (!body.fileName || typeof body.fileName !== 'string' || body.fileName.trim() === '') {
      throw createError('fileName is required', 400);
    }
    if (!body.mimeType || !ALL_VALID_MIME_TYPES.has(body.mimeType)) {
      throw createError(
        `mimeType must be one of: ${[...ALL_VALID_MIME_TYPES].join(', ')}`,
        400,
      );
    }
    if (body.fileSize !== undefined && (body.fileSize <= 0 || body.fileSize > MAX_FILE_SIZE)) {
      throw createError('fileSize must be between 1 and 52428800 bytes (50 MB)', 400);
    }

    const sanitized = body.fileName.trim().replace(/\s+/g, '_');
    const key = `evidence/${userId}/${randomUUID()}_${sanitized}`;

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: body.mimeType,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: UPLOAD_URL_EXPIRES_IN });
    return { uploadUrl, key, expiresIn: UPLOAD_URL_EXPIRES_IN };
  }

  async createEvidence(userId: string, body: CreateEvidenceBody): Promise<SafeEvidence> {
    const isExternal = typeof body.externalUrl === 'string' && body.externalUrl.trim() !== '';

    if (isExternal) {
      // externalUrl path — no S3 involved
    } else {
      if (!body.fileName || typeof body.fileName !== 'string' || body.fileName.trim() === '') {
        throw createError('fileName is required for file evidence', 400);
      }
      if (!body.storageKey || typeof body.storageKey !== 'string') {
        throw createError('storageKey is required for file evidence', 400);
      }
      if (!body.mimeType || !ALL_VALID_MIME_TYPES.has(body.mimeType)) {
        throw createError(
          `mimeType must be one of: ${[...ALL_VALID_MIME_TYPES].join(', ')}`,
          400,
        );
      }
    }

    if (body.linkedTo !== undefined && !VALID_LINKED_TO.has(body.linkedTo)) {
      throw createError('linkedTo must be one of: activity, score, mock', 400);
    }
    if (body.linkedTo !== undefined && !body.linkedId) {
      throw createError('linkedId is required when linkedTo is provided', 400);
    }
    if (body.linkedId !== undefined && body.linkedTo === undefined) {
      throw createError('linkedTo is required when linkedId is provided', 400);
    }

    const ds = await getDatabaseConnection();
    const repo = new EvidenceRepository(ds);
    const now = new Date();

    if (isExternal) {
      const url = body.externalUrl!.trim();
      const record = await repo.create({
        userId,
        fileName: url.length <= 255 ? url : `${url.slice(0, 252)}...`,
        originalFileName: body.description ?? null,
        mimeType: null,
        fileSize: null,
        storageProvider: StorageProvider.EXTERNAL,
        storageKey: url,
        publicUrl: url,
        uploadedAt: now,
        plannedActivityId: body.linkedTo === 'activity' ? (body.linkedId ?? null) : null,
        activityScoreId: body.linkedTo === 'score' ? (body.linkedId ?? null) : null,
        mockTestId: body.linkedTo === 'mock' ? (body.linkedId ?? null) : null,
      });
      return toSafeEvidence(record);
    }

    const record = await repo.create({
      userId,
      fileName: body.fileName!.trim(),
      originalFileName: body.originalFileName ?? null,
      mimeType: body.mimeType ?? null,
      fileSize: body.fileSize ?? null,
      storageProvider: StorageProvider.S3,
      storageKey: body.storageKey!,
      publicUrl: body.publicUrl ?? null,
      uploadedAt: now,
      plannedActivityId: body.linkedTo === 'activity' ? (body.linkedId ?? null) : null,
      activityScoreId: body.linkedTo === 'score' ? (body.linkedId ?? null) : null,
      mockTestId: body.linkedTo === 'mock' ? (body.linkedId ?? null) : null,
    });
    return toSafeEvidence(record);
  }

  async getEvidence(userId: string, evidenceId: string): Promise<SafeEvidence> {
    const ds = await getDatabaseConnection();
    const repo = new EvidenceRepository(ds);
    const record = await repo.findByIdAndOwner(evidenceId, userId);
    if (record === null) throw createError('Evidence not found', 404);
    return toSafeEvidence(record);
  }

  async listEvidence(
    userId: string,
    filters: EvidenceListFilters,
  ): Promise<{ data: SafeEvidence[]; total: number; limit: number; offset: number }> {
    const limit = Math.min(filters.limit ?? 20, 100);
    const offset = filters.offset ?? 0;

    if (filters.linkedTo !== undefined && !VALID_LINKED_TO.has(filters.linkedTo)) {
      throw createError('linkedTo must be one of: activity, score, mock', 400);
    }

    const ds = await getDatabaseConnection();
    const repo = new EvidenceRepository(ds);

    const [records, total] = await repo.findMany({
      userId,
      limit,
      offset,
      ...(filters.linkedTo === 'activity' ? { plannedActivityId: filters.linkedId } : {}),
      ...(filters.linkedTo === 'score' ? { activityScoreId: filters.linkedId } : {}),
      ...(filters.linkedTo === 'mock' ? { mockTestId: filters.linkedId } : {}),
    });

    return { data: records.map(toSafeEvidence), total, limit, offset };
  }

  async deleteEvidence(userId: string, evidenceId: string): Promise<void> {
    const ds = await getDatabaseConnection();
    const repo = new EvidenceRepository(ds);

    const record = await repo.findByIdAndOwner(evidenceId, userId);
    if (record === null) throw createError('Evidence not found', 404);

    if (record.storage_provider === StorageProvider.S3) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: record.storage_key }));
      } catch {
        // S3 deletion failure does not block soft-delete
      }
    }

    await repo.softDelete(evidenceId);
  }
}

export { EvidenceService };
