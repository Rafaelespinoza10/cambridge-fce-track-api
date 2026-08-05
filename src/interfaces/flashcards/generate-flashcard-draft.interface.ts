import type { EnglishLevel, FlashcardType } from '../../models/enums';

export interface GenerateFlashcardDraftRequest {
  term: string;
  type: FlashcardType;
}

/**
 * Same editable shape the flashcard-create endpoint accepts. Deliberately
 * excludes id/userId/deckId/status/scheduling/timestamps — this is a draft,
 * never a persisted flashcard.
 */
export interface GeneratedFlashcardDraftDto {
  type: FlashcardType;
  front: string;
  back: string;
  translation: string | null;
  example: string | null;
  personalExample: string | null;
  notes: string | null;
  sourceName: null;
  sourceUrl: null;
  level: EnglishLevel | null;
  tags: string[];
}
