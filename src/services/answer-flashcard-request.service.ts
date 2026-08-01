import type { DataSource } from 'typeorm';

import { UsersRepository } from '../repositories/users.repository';
import { FlashcardReviewService } from './flashcard-review.service';
import {
  StartFlashcardReviewSessionError,
  StartFlashcardReviewSessionErrorCode,
} from './start-flashcard-review-session.service';

import { resolveLocalDay, isValidTimeZone } from '../lib/timezone';

import type { User } from '../models/User';
import type { AnswerFlashcardRequestInput } from '../interfaces/answer-flashcard-request.interface';
import type {
  AnswerFlashcardInput,
  AnswerFlashcardResult,
} from '../interfaces/flashcard-review.interface';

const DEFAULT_TIMEZONE = 'UTC';

interface UsersRepositoryPort {
  findUserWithProfile(userId: string): Promise<User | null>;
}

interface FlashcardReviewServicePort {
  answerCard(input: AnswerFlashcardInput): Promise<AnswerFlashcardResult>;
}

interface AnswerFlashcardRequestServiceDeps {
  users: (dataSource: DataSource) => UsersRepositoryPort;
  flashcardReview: (dataSource: DataSource) => FlashcardReviewServicePort;
}

const DEFAULT_DEPS: AnswerFlashcardRequestServiceDeps = {
  users: (dataSource) => new UsersRepository(dataSource),
  flashcardReview: (dataSource) => new FlashcardReviewService(dataSource),
};

class AnswerFlashcardRequestService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: AnswerFlashcardRequestServiceDeps = DEFAULT_DEPS,
  ) {}

  async execute(input: AnswerFlashcardRequestInput): Promise<AnswerFlashcardResult> {
    const usersRepo = this.deps.users(this.dataSource);

    const user = await usersRepo.findUserWithProfile(input.userId);
    if (user === null) {
      throw new StartFlashcardReviewSessionError(
        'User not found',
        StartFlashcardReviewSessionErrorCode.USER_NOT_FOUND,
      );
    }
    const profile = user.profile as User['profile'] | null;
    if (profile === null || profile === undefined) {
      throw new StartFlashcardReviewSessionError(
        'User profile not found',
        StartFlashcardReviewSessionErrorCode.PROFILE_NOT_FOUND,
      );
    }

    let timezone = DEFAULT_TIMEZONE;
    if (profile.timezone !== null) {
      if (!isValidTimeZone(profile.timezone)) {
        throw new StartFlashcardReviewSessionError(
          `Invalid IANA timezone stored in user profile: ${profile.timezone}`,
          StartFlashcardReviewSessionErrorCode.INVALID_TIMEZONE,
        );
      }
      timezone = profile.timezone;
    }

    const localDay = resolveLocalDay(input.reviewedAt, timezone);

    const flashcardReviewService = this.deps.flashcardReview(this.dataSource);
    return flashcardReviewService.answerCard({
      userId: input.userId,
      studySessionId: input.studySessionId,
      flashcardId: input.flashcardId,
      idempotencyKey: input.idempotencyKey,
      rating: input.rating,
      reviewedAt: input.reviewedAt,
      localDate: localDay.localDate,
      dayStartedAt: localDay.dayStartedAt,
      dayEndedAt: localDay.dayEndedAt,
      responseTimeMs: input.responseTimeMs,
    });
  }
}

export { AnswerFlashcardRequestService };
export type { UsersRepositoryPort, FlashcardReviewServicePort, AnswerFlashcardRequestServiceDeps };
