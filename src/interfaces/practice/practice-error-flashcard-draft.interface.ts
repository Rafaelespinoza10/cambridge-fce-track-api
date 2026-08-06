import type { GeneratedFlashcardDraftDto } from '../flashcards/generate-flashcard-draft.interface';

/**
 * Reuses `GeneratedFlashcardDraftDto` as-is — the exact same editable shape
 * the existing `POST /flashcards/ai/draft` endpoint returns, so the
 * frontend's flashcard CRUD can accept either draft source identically.
 * Never carries id/deckId/userId/status/scheduling/timestamps/attemptId/
 * itemId/answerKey or any AI provider metadata.
 */
export interface PracticeErrorFlashcardDraftResponse {
  draft: GeneratedFlashcardDraftDto;
}
