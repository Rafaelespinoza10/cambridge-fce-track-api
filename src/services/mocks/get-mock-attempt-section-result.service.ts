import { MockAttemptSectionStatus } from '@models/enums';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import type { MockAttemptSectionGradingFeedback } from '@models/mock-attempt-json-types';
import { toMockAttemptSectionSafeDto } from '@lib/mocks/mock-attempt-dto';
import { roundToTwoDecimals } from '@lib/practice/practice-attempt-grading';
import type { MockAttemptSectionSafeDto } from '../../interfaces/mocks/mock-attempt.interface';

export enum GetMockAttemptSectionResultErrorCode {
  SECTION_NOT_FOUND = 'section_not_found',
}

export class GetMockAttemptSectionResultError extends Error {
  constructor(
    message: string,
    readonly code: GetMockAttemptSectionResultErrorCode,
  ) {
    super(message);
    this.name = 'GetMockAttemptSectionResultError';
  }
}

export interface MockAttemptSectionResultViewDto {
  section: MockAttemptSectionSafeDto;
  percentage: number | null;
  feedback: MockAttemptSectionGradingFeedback | null;
}

export interface MockAttemptsRepositoryPort {
  findSectionByCodeForUser(
    attemptId: string,
    sectionCode: string,
    userId: string,
  ): Promise<MockAttemptSection | null>;
}

export interface GetMockAttemptSectionResultServiceDeps {
  repository: MockAttemptsRepositoryPort;
}

/**
 * Re-serves one already-submitted section's grading result. Submitting a
 * section (SubmitMockAttemptSectionService) returns its percentage/feedback
 * once, transiently — this endpoint exists so a client that reloads between
 * submitting a section and acknowledging its result screen can still show
 * it, instead of silently skipping ahead to the next section.
 *
 * `percentage`/`feedback` are only ever populated for a 'completed' section
 * — same "branch on status, never infer from which field is present" shape
 * as GetDailySessionSubmissionService. percentage is recomputed here with
 * the exact formula SubmitMockAttemptSectionService uses rather than being
 * stored: mock_attempt_sections persists raw_score/max_score, never a
 * percentage column.
 */
export class GetMockAttemptSectionResultService {
  constructor(private readonly deps: GetMockAttemptSectionResultServiceDeps) {}

  async execute(
    userId: string,
    attemptId: string,
    sectionCode: string,
  ): Promise<MockAttemptSectionResultViewDto> {
    const section = await this.deps.repository.findSectionByCodeForUser(
      attemptId,
      sectionCode,
      userId,
    );
    if (section === null) {
      throw new GetMockAttemptSectionResultError(
        'Mock attempt section not found',
        GetMockAttemptSectionResultErrorCode.SECTION_NOT_FOUND,
      );
    }

    const safeSection = toMockAttemptSectionSafeDto(section);
    if (section.status !== MockAttemptSectionStatus.COMPLETED) {
      return { section: safeSection, percentage: null, feedback: null };
    }

    const rawScore = safeSection.rawScore ?? 0;
    const maxScore = safeSection.maxScore ?? 0;
    const percentage = maxScore > 0 ? roundToTwoDecimals((rawScore / maxScore) * 100) : 0;

    return { section: safeSection, percentage, feedback: section.grading_feedback };
  }
}
