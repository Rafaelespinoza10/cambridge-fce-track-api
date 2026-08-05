import { getDatabaseConnection } from '../../lib/database';
import { StartFlashcardReviewSessionService } from './start-flashcard-review-session.service';
import { AnswerFlashcardRequestService } from './answer-flashcard-request.service';
import { CompleteFlashcardReviewSessionService } from './complete-flashcard-review-session.service';

interface FlashcardReviewServices {
  startSession: StartFlashcardReviewSessionService;
  answerFlashcard: AnswerFlashcardRequestService;
  completeSession: CompleteFlashcardReviewSessionService;
}

async function buildFlashcardReviewServices(): Promise<FlashcardReviewServices> {
  const dataSource = await getDatabaseConnection();
  return {
    startSession: new StartFlashcardReviewSessionService(dataSource),
    answerFlashcard: new AnswerFlashcardRequestService(dataSource),
    completeSession: new CompleteFlashcardReviewSessionService(dataSource),
  };
}

export { buildFlashcardReviewServices };
export type { FlashcardReviewServices };
