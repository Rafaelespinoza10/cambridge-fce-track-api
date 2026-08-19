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
