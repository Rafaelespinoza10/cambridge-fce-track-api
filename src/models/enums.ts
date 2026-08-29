export enum UserRole {
  STUDENT = 'student',
  TEACHER = 'teacher',
  ADMIN = 'admin',
}

export enum EnglishLevel {
  A1 = 'A1',
  A2 = 'A2',
  B1 = 'B1',
  B1_PLUS = 'B1_PLUS',
  B2 = 'B2',
  C1 = 'C1',
  C2 = 'C2',
}

export enum TargetExam {
  B2_FIRST = 'B2_FIRST',
  C1_ADVANCED = 'C1_ADVANCED',
  IELTS = 'IELTS',
  TOEFL = 'TOEFL',
}

export enum GoalStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum ScoreType {
  CORRECT_ANSWERS = 'correct_answers',
  PERCENTAGE = 'percentage',
  RUBRIC = 'rubric',
  TIME_ONLY = 'time_only',
  CUSTOM = 'custom',
}

export enum WeekPlanStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
}

export enum DayOfWeek {
  MONDAY = 'monday',
  TUESDAY = 'tuesday',
  WEDNESDAY = 'wednesday',
  THURSDAY = 'thursday',
  FRIDAY = 'friday',
  SATURDAY = 'saturday',
  SUNDAY = 'sunday',
}

export enum ActivityPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum PlannedActivityStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  SKIPPED = 'skipped',
}

export enum PlannedActivitySource {
  MANUAL = 'manual',
  AI_GENERATED = 'ai_generated',
}

export enum DifficultyLevel {
  EASY = 'easy',
  MEDIUM = 'medium',
  HARD = 'hard',
}

export enum ScoreCriterion {
  CONTENT = 'content',
  COMMUNICATIVE_ACHIEVEMENT = 'communicative_achievement',
  ORGANIZATION = 'organization',
  LANGUAGE = 'language',
  FLUENCY = 'fluency',
  PRONUNCIATION = 'pronunciation',
  VOCABULARY = 'vocabulary',
  GRAMMAR = 'grammar',
  INTERACTION = 'interaction',
  OTHER = 'other',
}

export enum StorageProvider {
  S3 = 's3',
  LOCAL = 'local',
  EXTERNAL = 'external',
}

export enum ExamType {
  B2_FIRST = 'B2_FIRST',
  C1_ADVANCED = 'C1_ADVANCED',
  IELTS = 'IELTS',
  TOEFL = 'TOEFL',
}

export enum MockType {
  FULL = 'full',
  PARTIAL = 'partial',
}

export enum ResourceType {
  PDF = 'pdf',
  LINK = 'link',
  VIDEO = 'video',
  TEMPLATE = 'template',
  VOCABULARY = 'vocabulary',
  GRAMMAR = 'grammar',
  WRITING_SAMPLE = 'writing_sample',
  PODCAST = 'podcast',
  PLAYLIST = 'playlist',
  OTHER = 'other',
}

export enum RecommendationType {
  WEAKNESS = 'weakness',
  STUDY_PLAN = 'study_plan',
  REMINDER = 'reminder',
  IMPROVEMENT = 'improvement',
  GENERAL = 'general',
}

export enum RecommendationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum RecommendationStatus {
  PENDING = 'pending',
  APPLIED = 'applied',
  DISMISSED = 'dismissed',
}

export enum RecommendationSource {
  RULE_BASED = 'rule_based',
  AI = 'ai',
  MANUAL = 'manual',
}

export enum FlashcardType {
  PHRASAL_VERB = 'phrasal_verb',
  COLLOCATION = 'collocation',
  VOCABULARY = 'vocabulary',
  EXPRESSION = 'expression',
  GRAMMAR = 'grammar',
  WORD_FORMATION = 'word_formation',
  CUSTOM = 'custom',
}

export enum FlashcardStatus {
  NEW = 'new',
  LEARNING = 'learning',
  REVIEW = 'review',
  SUSPENDED = 'suspended',
}

export enum ReviewRating {
  AGAIN = 'again',
  HARD = 'hard',
  GOOD = 'good',
  EASY = 'easy',
}

export enum StudySessionType {
  ACTIVITY = 'activity',
  FLASHCARD_REVIEW = 'flashcard_review',
}

export enum StudySessionStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
}

export enum PracticeExerciseSource {
  AI = 'ai',
  SYSTEM = 'system',
}

export enum PracticeAttemptStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
}

export enum WritingTaskType {
  ESSAY = 'essay',
  ARTICLE = 'article',
  EMAIL = 'email',
  REPORT = 'report',
  REVIEW = 'review',
}

export enum WritingSubmissionStatus {
  IN_PROGRESS = 'in_progress',
  GRADED = 'graded',
  ABANDONED = 'abandoned',
}

export enum CambridgeSourceStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum ListeningSourceStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum MockAttemptStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
}

export enum MockAttemptSectionStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}

export enum MockAttemptSectionContentType {
  PRACTICE_EXERCISE = 'practice_exercise',
  WRITING_TASK = 'writing_task',
  LISTENING = 'listening',
}

export enum DailySessionSource {
  AI = 'ai',
  SYSTEM = 'system',
}

export enum DailySessionSubmissionStatus {
  IN_PROGRESS = 'in_progress',
  GRADED = 'graded',
  ABANDONED = 'abandoned',
}

/**
 * Where a Mistake Bank entry came from. Only `PRACTICE_ATTEMPT` is written
 * today (see RecordPracticeMistakesService); the other two exist so the mock
 * and daily-session grading paths can start writing without a new migration.
 */
export enum MistakeSource {
  PRACTICE_ATTEMPT = 'practice_attempt',
  MOCK_ATTEMPT = 'mock_attempt',
  DAILY_SESSION = 'daily_session',
  /** A correction the Writing grader made on a submitted text — see docs/mistake-bank.md §13. */
  WRITING_SUBMISSION = 'writing_submission',
}

/**
 * What kind of mistake a MistakeConcept represents. Nothing classifies
 * automatically yet — every concept is created as `UNKNOWN` and stays that
 * way until a later, explicit classification step (heuristic/AI/manual)
 * fills it in. `UNKNOWN` therefore means "not classified yet", never
 * "classified as unclassifiable".
 */
export enum MistakeErrorType {
  WORD_CLASS = 'word_class',
  SPELLING = 'spelling',
  VOCABULARY = 'vocabulary',
  PREFIX_SUFFIX = 'prefix_suffix',
  COLLOCATION = 'collocation',
  PHRASAL_VERB = 'phrasal_verb',
  GRAMMAR = 'grammar',
  MISUNDERSTANDING = 'misunderstanding',
  CARELESS = 'careless',
  /** Writing only — comes from WritingCorrection.category, which has no Practice equivalent. */
  PUNCTUATION = 'punctuation',
  /** Writing only — formality/tone mismatch, likewise Writing-specific. */
  REGISTER = 'register',
  UNKNOWN = 'unknown',
}

/**
 * Refines a MistakeErrorType into the specific weakness worth practising.
 *
 * Read the groups below as three different KINDS of refinement, because the
 * field deliberately means something slightly different per task type:
 *
 *  - Word Formation (UoE 3): the subtype IS the error — which transformation
 *    the student got wrong.
 *  - Key Word Transformation (UoE 4): the subtype is the STRUCTURE being
 *    tested (passive, conditional…), because that is what is deterministically
 *    knowable from the key word and what targeted practice needs to generate
 *    more of. The mechanical subtypes (`KEY_WORD_ALTERED`, `WORD_COUNT`) are
 *    the exception: those are certainties about the answer itself.
 *  - Open Cloze (UoE 2): the subtype is the WORD CLASS the gap required.
 */
export enum MistakeErrorSubtype {
  NOUN_TO_ADJECTIVE = 'noun_to_adjective',
  NOUN_TO_ADVERB = 'noun_to_adverb',
  ADJECTIVE_TO_NOUN = 'adjective_to_noun',
  ADJECTIVE_TO_ADVERB = 'adjective_to_adverb',
  VERB_TO_NOUN = 'verb_to_noun',
  VERB_TO_ADJECTIVE = 'verb_to_adjective',
  PREFIX_ERROR = 'prefix_error',
  SUFFIX_ERROR = 'suffix_error',
  SPELLING_CHANGE = 'spelling_change',

  // ── Key Word Transformation (UoE Part 4): the structure under test ──────
  PASSIVE = 'passive',
  CONDITIONAL = 'conditional',
  REPORTED_SPEECH = 'reported_speech',
  COMPARATIVE = 'comparative',
  CAUSATIVE = 'causative',
  WISH_REGRET = 'wish_regret',
  USED_TO = 'used_to',
  MODAL_DEDUCTION = 'modal_deduction',
  RELATIVE_CLAUSE = 'relative_clause',
  GERUND_INFINITIVE = 'gerund_infinitive',
  FIXED_EXPRESSION = 'fixed_expression',
  /** Mechanical, and certain: the key word was missing or altered (Cambridge forbids changing it). */
  KEY_WORD_ALTERED = 'key_word_altered',
  /** Mechanical, and certain: outside Cambridge's 2-5 word limit. */
  WORD_COUNT = 'word_count',

  // ── Open Cloze (UoE Part 2): the class of word the gap required ─────────
  PREPOSITION = 'preposition',
  ARTICLE = 'article',
  AUXILIARY = 'auxiliary',
  PRONOUN = 'pronoun',
  LINKER = 'linker',
  QUANTIFIER = 'quantifier',
}

/** Grammatical class of an expected/given answer. Always null until classification exists. */
export enum WordClass {
  NOUN = 'noun',
  VERB = 'verb',
  ADJECTIVE = 'adjective',
  ADVERB = 'adverb',
  OTHER = 'other',
}

/**
 * Who last decided a mistake's classification — the precedence rule the
 * whole classification pipeline is built around: a row whose source is
 * `USER` (a future manual correction) must never be silently overwritten by
 * a later deterministic reclassification or an AI pass. `UNKNOWN` means
 * "never classified" (the default for every row today), not "classified as
 * unclassifiable" — that distinction belongs to MistakeErrorType.UNKNOWN.
 */
export enum MistakeClassificationSource {
  DETERMINISTIC = 'deterministic',
  AI = 'ai',
  USER = 'user',
  UNKNOWN = 'unknown',
}

/**
 * A WeaknessReview row is an event, not a mutable schedule: it is
 * `scheduled` until its retest is graded, then `completed` forever.
 * `cancelled` is for a review whose pattern stopped being eligible before it
 * was ever taken (e.g. mastery collapsed and the pattern went back to plain
 * remediation) — it keeps the history without pretending the retest happened.
 *
 * `due` / `overdue` / `upcoming` are deliberately absent: those are derived
 * from `due_at` against the clock, never stored.
 */
export enum WeaknessReviewStatus {
  SCHEDULED = 'scheduled',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

/** Outcome of a graded retest — see gradeRetest in @lib/mistakes/retest-scheduler.ts. */
export enum WeaknessReviewResult {
  PASS = 'pass',
  PARTIAL = 'partial',
  FAIL = 'fail',
}
