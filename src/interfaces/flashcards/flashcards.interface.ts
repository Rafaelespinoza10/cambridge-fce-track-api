import type { FlashcardType, FlashcardStatus, EnglishLevel } from '../../models/enums';

export interface CreateFlashcardRequestBody {
  type: FlashcardType;
  front: string;
  back: string;
  translation?: string;
  example?: string;
  personalExample?: string;
  notes?: string;
  sourceName?: string;
  sourceUrl?: string;
  level?: EnglishLevel;
  tags?: string[];
}

export interface UpdateFlashcardRequestBody {
  type?: FlashcardType;
  front?: string;
  back?: string;
  translation?: string | null;
  example?: string | null;
  personalExample?: string | null;
  notes?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  level?: EnglishLevel | null;
  tags?: string[];
}

export type FlashcardListStatus = 'active' | 'suspended' | 'all';

export interface CreateWordFamilyDerivativeInput {
  form: string;
  partOfSpeech: string;
}

export interface CreateWordFamilyRequestBody {
  baseWord: string;
  derivatives: CreateWordFamilyDerivativeInput[];
}

export interface WordFamilyDto {
  familyTag: string;
  baseWord: string;
  derivatives: FlashcardDto[];
}

export interface PhrasalVerbGroupDto {
  verbTag: string;
  baseVerb: string;
  cards: FlashcardDto[];
}

export interface OrganizePhrasalVerbsResultDto {
  updatedCount: number;
  groups: PhrasalVerbGroupDto[];
}

export interface FlashcardDto {
  id: string;
  deckId: string;
  type: FlashcardType;

  front: string;
  back: string;

  translation: string | null;
  example: string | null;
  personalExample: string | null;
  notes: string | null;

  sourceName: string | null;
  sourceUrl: string | null;

  level: EnglishLevel | null;
  tags: string[];

  status: FlashcardStatus;
  nextReviewAt: Date;
  intervalMinutes: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;

  createdAt: Date;
  updatedAt: Date;
}
