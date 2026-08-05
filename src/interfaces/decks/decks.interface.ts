export interface CreateDeckRequestBody {
  name: string;
  description?: string;
  color?: string;
}

export interface UpdateDeckRequestBody {
  name?: string;
  description?: string | null;
  color?: string | null;
}

export type DeckListStatus = 'available' | 'archived';

export interface DeckDto {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}
