import type { MockAttempt } from '@models/MockAttempt';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import type {
  MockAttemptSafeDto,
  MockAttemptSectionSafeDto,
} from '../../interfaces/mocks/mock-attempt.interface';

/** Never carries any content id (practice_exercise_id/writing_task_id/listening_source_id) or answers/grading_feedback. */
export function toMockAttemptSectionSafeDto(
  section: MockAttemptSection,
): MockAttemptSectionSafeDto {
  return {
    sectionCode: section.section_code,
    contentType: section.content_type,
    status: section.status,
    timeLimitSeconds: section.time_limit_seconds,
    startedAt: section.started_at,
    completedAt: section.completed_at,
    rawScore: section.raw_score !== null ? Number(section.raw_score) : null,
    maxScore: section.max_score !== null ? Number(section.max_score) : null,
  };
}

/** Never carries userId. Shared by every mock-attempt service. */
export function toMockAttemptSafeDto(
  attempt: MockAttempt,
  sections: MockAttemptSection[],
): MockAttemptSafeDto {
  return {
    id: attempt.id,
    examType: attempt.exam_type,
    status: attempt.status,
    startedAt: attempt.started_at,
    submittedAt: attempt.submitted_at,
    resultMockTestId: attempt.result_mock_test_id,
    sections: sections.map(toMockAttemptSectionSafeDto),
  };
}
