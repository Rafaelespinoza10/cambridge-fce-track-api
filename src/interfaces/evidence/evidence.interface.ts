export type FileCategory = 'image' | 'pdf' | 'audio' | 'external';
export type LinkedTo = 'activity' | 'score' | 'mock';

export interface GenerateUploadUrlBody {
  fileName: string;
  mimeType: string;
  fileSize?: number;
}

export interface CreateEvidenceBody {
  fileName?: string;
  originalFileName?: string;
  mimeType?: string;
  fileSize?: number;
  storageKey?: string;
  publicUrl?: string;
  externalUrl?: string;
  description?: string;
  linkedTo?: LinkedTo;
  linkedId?: string;
}

export interface EvidenceListFilters {
  linkedTo?: LinkedTo;
  linkedId?: string;
  limit?: number;
  offset?: number;
}

export interface EvidenceContext {
  label: string;
  skillName: string | null;
}

export interface SafeEvidence {
  id: string;
  fileName: string;
  originalFileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  storageProvider: string;
  storageKey: string;
  publicUrl: string | null;
  category: FileCategory | null;
  linkedTo: LinkedTo | null;
  linkedId: string | null;
  context: EvidenceContext | null;
  uploadedAt: Date;
  createdAt: Date;
}
