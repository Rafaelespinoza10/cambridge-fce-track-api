import { MistakeErrorType, MistakeErrorSubtype } from '../../models/enums';
import {
  isPracticeExamCode,
  isPracticePaperCode,
  isPracticePartCode,
} from '@lib/practice/practice-exam-catalog';
import { isCambridgeSkillSlug } from '@lib/cambridge-knowledge/cambridge-knowledge-catalog';
import { UNKNOWN_SKILL_SLUG } from '@lib/mistakes/mistake-concept-key';
import { MasteryStatus } from '@lib/mistakes/mastery-score';
import { computeWeaknessProfiles } from './compute-weakness-profiles';
import type {
  MistakeMasteryRepositoryPort,
  WeaknessProfileDeps,
} from './compute-weakness-profiles';
import type { WeaknessQueryFilters } from '@repositories/mistakes/mistake-mastery.repository';
import type { ListWeaknessesResponseDto } from '../../interfaces/mistakes/weaknesses.interface';

export enum ListWeaknessesErrorCode {
  INVALID_INPUT = 'invalid_input',
  UNSUPPORTED_SKILL = 'unsupported_skill',
  UNSUPPORTED_EXAM = 'unsupported_exam',
  UNSUPPORTED_PAPER = 'unsupported_paper',
  UNSUPPORTED_PART = 'unsupported_part',
}

export class ListWeaknessesError extends Error {
  constructor(
    message: string,
    readonly code: ListWeaknessesErrorCode,
  ) {
    super(message);
    this.name = 'ListWeaknessesError';
  }
}

/** Raw query-string values — everything API Gateway hands the controller is a string or undefined. */
export interface ListWeaknessesRawQuery {
  skill?: string;
  examCode?: string;
  paperCode?: string;
  partCode?: string;
  errorType?: string;
  errorSubtype?: string;
  status?: string;
}

export type ListWeaknessesServiceDeps = WeaknessProfileDeps;
export type { MistakeMasteryRepositoryPort };

/**
 * Hard cap on the response. Patterns are inherently few (a handful of parts ×
 * a handful of error types), so this is a runaway guard, not pagination —
 * the client always gets the weakest ones, which is what the screen shows.
 */
const MAX_ITEMS = 100;
const ERROR_TYPES = new Set<string>(Object.values(MistakeErrorType));
const ERROR_SUBTYPES = new Set<string>(Object.values(MistakeErrorSubtype));
const STATUSES = new Set<string>(Object.values(MasteryStatus));

function invalidInput(message: string): never {
  throw new ListWeaknessesError(message, ListWeaknessesErrorCode.INVALID_INPUT);
}

/** Accepts both the stored slug (`use-of-english`) and the shoutier `USE_OF_ENGLISH`. */
function normalizeSkill(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-');
}

/**
 * Aggregates the user's recorded mistakes into weakness *patterns*, scores
 * each one from its remediation evidence (see @lib/mistakes/mastery-score.ts)
 * and returns them weakest-first.
 *
 * `userId` is a parameter, never a filter the caller can drop: both
 * repository reads are scoped by it, so there is no code path that can
 * surface another user's weaknesses.
 */
export class ListWeaknessesService {
  constructor(private readonly deps: ListWeaknessesServiceDeps) {}

  async execute(
    userId: string,
    rawQuery: ListWeaknessesRawQuery,
  ): Promise<ListWeaknessesResponseDto> {
    if (typeof userId !== 'string' || userId.trim() === '') invalidInput('userId is required');

    const filters = this.resolveFilters(rawQuery);
    const statusFilter = this.resolveStatusFilter(rawQuery.status);

    // Scored patterns come back weakest-first already; status is not stored
    // anywhere, so it can only be filtered after scoring.
    const profiles = await computeWeaknessProfiles(this.deps, userId, filters);
    const items = profiles.filter(
      (item) => statusFilter === undefined || item.status === statusFilter,
    );

    return { items: items.slice(0, MAX_ITEMS), totalItems: items.length };
  }

  private resolveFilters(rawQuery: ListWeaknessesRawQuery): WeaknessQueryFilters {
    const filters: WeaknessQueryFilters = {};

    if (rawQuery.skill !== undefined) {
      const skill = normalizeSkill(rawQuery.skill);
      // `unknown` is accepted too — it is where a mistake from an
      // unrecognized part code is filed, and hiding it from every filter
      // would make those weaknesses unreachable.
      if (!isCambridgeSkillSlug(skill) && skill !== UNKNOWN_SKILL_SLUG) {
        throw new ListWeaknessesError(
          `Unknown skill "${rawQuery.skill}"`,
          ListWeaknessesErrorCode.UNSUPPORTED_SKILL,
        );
      }
      filters.skill = skill;
    }

    if (rawQuery.errorType !== undefined) {
      const errorType = rawQuery.errorType.trim().toLowerCase();
      if (!ERROR_TYPES.has(errorType)) {
        invalidInput(`errorType must be one of: ${[...ERROR_TYPES].join(', ')}`);
      }
      filters.errorType = errorType as MistakeErrorType;
    }

    if (rawQuery.errorSubtype !== undefined) {
      const errorSubtype = rawQuery.errorSubtype.trim().toLowerCase();
      if (!ERROR_SUBTYPES.has(errorSubtype)) {
        invalidInput(`errorSubtype must be one of: ${[...ERROR_SUBTYPES].join(', ')}`);
      }
      filters.errorSubtype = errorSubtype as MistakeErrorSubtype;
    }

    // Same cascade the practice history and mistakes endpoints enforce: a
    // paper only means something inside an exam, a part inside a paper.
    const { examCode, paperCode, partCode } = rawQuery;
    if (examCode !== undefined) {
      if (!isPracticeExamCode(examCode)) {
        throw new ListWeaknessesError(
          `Unknown examCode "${examCode}"`,
          ListWeaknessesErrorCode.UNSUPPORTED_EXAM,
        );
      }
      filters.examCode = examCode;
    }
    if (paperCode !== undefined) {
      if (examCode === undefined) invalidInput('paperCode requires examCode');
      if (!isPracticePaperCode(examCode, paperCode)) {
        throw new ListWeaknessesError(
          `Unknown paperCode "${paperCode}" for exam "${examCode}"`,
          ListWeaknessesErrorCode.UNSUPPORTED_PAPER,
        );
      }
      filters.paperCode = paperCode;
    }
    if (partCode !== undefined) {
      if (examCode === undefined || paperCode === undefined) {
        invalidInput('partCode requires examCode and paperCode');
      }
      if (!isPracticePartCode(examCode, paperCode, partCode)) {
        throw new ListWeaknessesError(
          `Unknown partCode "${partCode}" for paper "${paperCode}"`,
          ListWeaknessesErrorCode.UNSUPPORTED_PART,
        );
      }
      filters.partCode = partCode;
    }

    return filters;
  }

  private resolveStatusFilter(raw: string | undefined): MasteryStatus | undefined {
    if (raw === undefined) return undefined;
    const status = raw.trim().toLowerCase();
    if (!STATUSES.has(status)) {
      invalidInput(`status must be one of: ${[...STATUSES].join(', ')}`);
    }
    return status as MasteryStatus;
  }
}
