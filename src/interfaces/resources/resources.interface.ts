import type { ResourceType } from '../../models/enums';

export interface CreateResourceRequestBody {
  title: string;
  url: string;
  description?: string;
  resourceType?: ResourceType;
  imageUrl?: string;
}

export interface UpdateResourceRequestBody {
  title?: string;
  url?: string;
  description?: string;
  imageUrl?: string;
}

export interface ResourceDto {
  id: string;
  title: string;
  description: string | null;
  url: string;
  resourceType: string;
  imageUrl: string | null;
  isGlobal: boolean;
  createdAt: Date;
}
