import { MistakeErrorType } from '../../models/enums';
import {
  isPracticeExamCode,
  isPracticePaperCode,
  isPracticePartCode,
} from '@lib/practice/practice-exam-catalog';
import { isCambridgeSkillSlug } from '@lib/cambridge-knowledge/cambridge-knowledge-catalog';
import { UNKNOWN_SKILL_SLUG } from '@lib/mistakes/mistake-concept-key';
import type { MistakeConcept } from '../../models/MistakeConcept';
import type {
  ListMistakesFilters,
  ListMistakesResult,
} from '@repositories/mistakes/mistakes.repository';
import type {
  MistakeDto,
  ListMistakesResponseDto,
} from '../../interfaces/mistakes/mistakes.interface';

export enum ListMistakesErrorCode {
  INVALID_INPUT = 'invalid_input',
  UNSUPPORTED_SKILL = 'unsupported_skill',
  UNSUPPORTED_EXAM = 'unsupported_exam',
  UNSUPPORTED_PAPER = 'unsupported_paper',
  UNSUPPORTED_PART = 'unsupported_part',
}

export class ListMistakesError extends Error {
  constructor(
    message: string,
    readonly code: ListMistakesErrorCode,
  ) {
    super(message);
    this.name = 'ListMistakesError';
  }
}

/** Raw query-string values — everything API Gateway hands the controller is a string or undefined. */
export interface ListMistakesRawQuery {
  skill?: string;
  examCode?: string;
  paperCode?: string;
  partCode?: string;
  errorType?: string;
  baseWord?: string;
  page?: string;
  pageSize?: string;
}

export interface MistakesRepositoryPort {
  listByUser(filters: ListMistakesFilters): Promise<ListMistakesResult>;
}

export interface ListMistakesServiceDeps {
  repository: MistakesRepositoryPort;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_BASE_WORD_LENGTH = 120;
const POSITIVE_INTEGER = /^\d+$/;
const ERROR_TYPES = new Set<string>(Object.values(MistakeErrorType));

function invalidInput(message: string): never {
  throw new ListMistakesError(message, ListMistakesErrorCode.INVALID_INPUT);
}

/** `page`/`pageSize` share the "positive integer" shape; the pageSize upper bound is checked by the caller. */
function parsePositiveInt(value: string | undefined, fieldName: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!POSITIVE_INTEGER.test(value)) invalidInput(`${fieldName} must be a positive integer`);
  const parsed = Number(value);
  if (parsed < 1) invalidInput(`${fieldName} must be a positive integer`);
  return parsed;
}

/**
 * Accepts both the stored slug (`use-of-english`) and the shoutier form a
 * client might send (`USE_OF_ENGLISH`) — same skill either way.
 */
function normalizeSkill(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-');
}

function toDto(concept: MistakeConcept): MistakeDto {
  return {
    mistakeId: concept.id,
    conceptKey: concept.concept_key,
    source: concept.source,
    skill: concept.skill_slug,
    examCode: concept.exam_code,
    paperCode: concept.paper_code,
    partCode: concept.part_code,
    taskType: concept.task_type,
    baseWord: concept.base_word,
    prompt: concept.prompt,
    userAnswer: concept.last_user_answer,
    correctAnswer: concept.correct_answer,
    explanation: concept.explanation,
    targetLevel: concept.target_level,
    errorType: concept.error_type,
    errorSubtype: concept.error_subtype,
    expectedWordClass: concept.expected_word_class,
    userWordClass: concept.user_word_class,
    timesWrong: concept.times_wrong,
    timesCorrect: concept.times_correct,
    firstSeenAt: concept.first_seen_at,
    lastWrongAt: concept.last_wrong_at,
    lastCorrectAt: concept.last_correct_at,
  };
}

/**
 * Reads the authenticated user's Mistake Bank. `userId` is a parameter, not
 * a filter the caller can choose to omit — the repository always scopes by
 * it, so there is no code path that returns another user's mistakes.
 */
export class ListMistakesService {
  constructor(private readonly deps: ListMistakesServiceDeps) {}

  async execute(userId: string, rawQuery: ListMistakesRawQuery): Promise<ListMistakesResponseDto> {
    if (typeof userId !== 'string' || userId.trim() === '') invalidInput('userId is required');

    const page = parsePositiveInt(rawQuery.page, 'page', DEFAULT_PAGE);
    const pageSize = parsePositiveInt(rawQuery.pageSize, 'pageSize', DEFAULT_PAGE_SIZE);
    if (pageSize > MAX_PAGE_SIZE) invalidInput(`pageSize must be at most ${MAX_PAGE_SIZE}`);

    const skill = this.resolveSkillFilter(rawQuery.skill);
    const errorType = this.resolveErrorTypeFilter(rawQuery.errorType);
    const baseWord = this.resolveBaseWordFilter(rawQuery.baseWord);
    const { examCode, paperCode, partCode } = rawQuery;
    this.validateCatalogFilters(examCode, paperCode, partCode);

    const { rows, totalItems } = await this.deps.repository.listByUser({
      userId,
      skill,
      examCode,
      paperCode,
      partCode,
      errorType,
      baseWord,
      page,
      pageSize,
    });

    return {
      items: rows.map(toDto),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
      },
    };
  }

  private resolveSkillFilter(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    const skill = normalizeSkill(raw);
    // `unknown` is accepted too: it's what a mistake from an unrecognized
    // part code is filed under, and hiding those from every filter would
    // make them unreachable.
    if (!isCambridgeSkillSlug(skill) && skill !== UNKNOWN_SKILL_SLUG) {
      throw new ListMistakesError(
        `Unknown skill "${raw}"`,
        ListMistakesErrorCode.UNSUPPORTED_SKILL,
      );
    }
    return skill;
  }

  private resolveErrorTypeFilter(raw: string | undefined): MistakeErrorType | undefined {
    if (raw === undefined) return undefined;
    const candidate = raw.trim().toLowerCase();
    if (!ERROR_TYPES.has(candidate)) {
      invalidInput(`errorType must be one of: ${[...ERROR_TYPES].join(', ')}`);
    }
    return candidate as MistakeErrorType;
  }

  private resolveBaseWordFilter(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    const baseWord = raw.trim();
    if (baseWord === '') invalidInput('baseWord must not be empty');
    if (baseWord.length > MAX_BASE_WORD_LENGTH) {
      invalidInput(`baseWord must be at most ${MAX_BASE_WORD_LENGTH} characters`);
    }
    return baseWord;
  }

  /**
   * Same rule as the practice history endpoint: a paper only makes sense
   * inside an exam and a part only inside a paper, so the narrower filters
   * require the broader ones.
   */
  private validateCatalogFilters(
    examCode: string | undefined,
    paperCode: string | undefined,
    partCode: string | undefined,
  ): void {
    if (examCode !== undefined && !isPracticeExamCode(examCode)) {
      throw new ListMistakesError(
        `Unknown examCode "${examCode}"`,
        ListMistakesErrorCode.UNSUPPORTED_EXAM,
      );
    }
    if (paperCode !== undefined) {
      if (examCode === undefined) invalidInput('paperCode requires examCode');
      if (!isPracticePaperCode(examCode, paperCode)) {
        throw new ListMistakesError(
          `Unknown paperCode "${paperCode}" for exam "${examCode}"`,
          ListMistakesErrorCode.UNSUPPORTED_PAPER,
        );
      }
    }
    if (partCode !== undefined) {
      if (examCode === undefined || paperCode === undefined) {
        invalidInput('partCode requires examCode and paperCode');
      }
      if (!isPracticePartCode(examCode, paperCode, partCode)) {
        throw new ListMistakesError(
          `Unknown partCode "${partCode}" for paper "${paperCode}"`,
          ListMistakesErrorCode.UNSUPPORTED_PART,
        );
      }
    }
  }
}
