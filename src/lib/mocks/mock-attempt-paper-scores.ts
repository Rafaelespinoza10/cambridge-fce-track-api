import { MockAttemptSectionStatus } from '@models/enums';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import { roundToTwoDecimals } from '@lib/practice/practice-attempt-grading';
import { findMockAttemptSectionCatalogEntry } from './mock-attempt-catalog';

/**
 * Shared by SubmitMockAttemptService (to persist the finished MockTest's
 * paper-level rollup) and GetMockAttemptResultService (to display it) — the
 * one place MOCK_ATTEMPT_SECTION_CATALOG's `scoreGroup` field actually gets
 * consumed, so the two callers can never compute it differently.
 */

export type MockAttemptPaperGroup = 'reading' | 'useOfEnglish' | 'writing' | 'listening';

export interface MockAttemptPaperScoreDto {
  rawScore: number;
  maxScore: number;
  /** null when no section in this group has been completed yet (e.g. an abandoned attempt). */
  percentage: number | null;
}

const PAPER_GROUPS: MockAttemptPaperGroup[] = ['reading', 'useOfEnglish', 'writing', 'listening'];

function emptyPaperScore(): MockAttemptPaperScoreDto {
  return { rawScore: 0, maxScore: 0, percentage: null };
}

export function computeMockAttemptPaperScores(
  sections: MockAttemptSection[],
): Record<MockAttemptPaperGroup, MockAttemptPaperScoreDto> {
  const scores: Record<MockAttemptPaperGroup, MockAttemptPaperScoreDto> = {
    reading: emptyPaperScore(),
    useOfEnglish: emptyPaperScore(),
    writing: emptyPaperScore(),
    listening: emptyPaperScore(),
  };

  for (const section of sections) {
    if (section.status !== MockAttemptSectionStatus.COMPLETED) continue;
    if (section.raw_score === null || section.max_score === null) continue;

    const catalogEntry = findMockAttemptSectionCatalogEntry(section.section_code);
    if (catalogEntry === undefined) continue;

    const group = scores[catalogEntry.scoreGroup];
    group.rawScore += Number(section.raw_score);
    group.maxScore += Number(section.max_score);
  }

  for (const group of PAPER_GROUPS) {
    const score = scores[group];
    score.percentage =
      score.maxScore > 0 ? roundToTwoDecimals((score.rawScore / score.maxScore) * 100) : null;
  }

  return scores;
}

export { PAPER_GROUPS };
