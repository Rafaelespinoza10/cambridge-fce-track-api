import type {
  EnglishLevel,
  MistakeSource,
  MistakeErrorType,
  MistakeErrorSubtype,
  WordClass,
} from '../../models/enums';

/**
 * One entry of the Mistake Bank as the client sees it: the *concept* the
 * student got wrong plus its aggregate counters — never `userId`, never the
 * raw occurrence rows, never an answer key of an exercise the student hasn't
 * submitted yet (everything here comes from an already-graded, already-
 * revealed answer).
 */
export interface MistakeDto {
  mistakeId: string;
  conceptKey: string;
  source: MistakeSource;

  /** Seeded skill slug (`use-of-english`, `reading`, …) or `unknown`. */
  skill: string;
  examCode: string;
  paperCode: string;
  partCode: string;
  taskType: string | null;

  /** Root word the item asked to transform, when the task type has one. */
  baseWord: string | null;
  prompt: string;
  /** What the student answered the last time they got this concept wrong. */
  userAnswer: string;
  correctAnswer: string;
  explanation: string | null;
  /** The exercise's target level — this module's notion of difficulty. */
  targetLevel: EnglishLevel | null;

  /**
   * `unknown`/null until a classification step exists — the field is here so
   * the client can already render (or hide) a diagnosis, not because one is
   * being computed today.
   */
  errorType: MistakeErrorType;
  errorSubtype: MistakeErrorSubtype | null;
  expectedWordClass: WordClass | null;
  userWordClass: WordClass | null;

  timesWrong: number;
  /** Times this same concept was answered correctly afterwards. */
  timesCorrect: number;
  firstSeenAt: Date;
  lastWrongAt: Date;
  lastCorrectAt: Date | null;
}

export interface MistakesPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ListMistakesResponseDto {
  items: MistakeDto[];
  pagination: MistakesPagination;
}
