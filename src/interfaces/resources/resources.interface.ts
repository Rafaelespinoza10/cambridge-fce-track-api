export interface CreateResourceRequestBody {
  title: string;
  url: string;
  description?: string;
}

export interface ResourceDto {
  id: string;
  title: string;
  description: string | null;
  url: string;
  resourceType: string;
  isGlobal: boolean;
  createdAt: Date;
}
