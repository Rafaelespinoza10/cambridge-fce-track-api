import type { MistakeErrorType, MistakeErrorSubtype } from '../../models/enums';
import type { MasteryStatus } from '@lib/mistakes/mastery-score';

/**
 * One aggregated weakness pattern as the client sees it — never `userId`,
 * never the individual mistakes or practice answers it was computed from.
 *
 * `remediationAttempts === 0` is how the client knows a pattern has never
 * been practiced (score 0, status `weak`): that is deliberately not a fifth
 * status, since it is already visible in the numbers.
 */
export interface WeaknessDto {
  /** Seeded skill slug (`use-of-english`, `reading`, …) or `unknown`. */
  skill: string;
  examCode: string;
  paperCode: string;
  partCode: string;
  errorType: MistakeErrorType;
  errorSubtype: MistakeErrorSubtype | null;

  /** 0-100, see @lib/mistakes/mastery-score.ts — never `correct / total`. */
  masteryScore: number;
  status: MasteryStatus;

  /** Recorded failures of this pattern, all time, across every concept in it. */
  timesWrong: number;
  /** How many distinct MistakeConcepts (word families failed) roll up here. */
  conceptCount: number;

  remediationAttempts: number;
  remediationCorrect: number;
  /** Distinct lexical families answered correctly during remediation — the transfer signal. */
  distinctBaseWords: number;
  distinctPracticeDays: number;

  firstSeenAt: Date;
  lastWrongAt: Date;
  lastPracticedAt: Date | null;

  /** True when the score was capped below the mastered band because a gate (families/days/relapse) failed. */
  masteredBlocked: boolean;
}

export interface ListWeaknessesResponseDto {
  items: WeaknessDto[];
  /** Total patterns matching the filters, before the response cap. */
  totalItems: number;
}
