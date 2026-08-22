import type { EnglishLevel, DailySessionSubmissionStatus } from '../../models/enums';
import type {
  DailySessionItemOption,
  DailySessionSentenceTarget,
  DailySessionComprehensionAnswerRecord,
  DailySessionSentenceSubmission,
  DailySessionSentenceFeedback,
} from '../../models/daily-session-json-types';

export interface GenerateDailySessionRequest {
  targetLevel?: EnglishLevel;
}

/** Never carries generationMetadata, userId, timezone or soft-delete fields. */
export interface DailySessionSafeDto {
  id: string;
  sessionDate: string;
  targetLevel: EnglishLevel | null;
  topic: string;
  readingTitle: string;
  readingInstructions: string;
  readingPassage: string;
  itemCount: number;
  sentenceTaskInstructions: string;
  sentenceTargets: DailySessionSentenceTarget[];
  createdAt: Date;
}

/** Never carries answerKey or explanation — those stay server-side until submit/evaluation. */
export interface DailySessionItemSafeDto {
  id: string;
  position: number;
  prompt: string;
  options: DailySessionItemOption[] | null;
  skillTags: string[];
}

export interface DailySessionSafeWithItems {
  session: DailySessionSafeDto;
  items: DailySessionItemSafeDto[];
}

/** One submitted sentence for one target, from the client. */
export interface SentenceSubmissionRequest {
  targetId: string;
  submittedSentence: string;
}

export interface SubmitDailySessionSubmissionRequest {
  comprehensionAnswers: unknown;
  sentenceSubmissions: SentenceSubmissionRequest[];
}

/** Never carries userId or soft-delete fields. */
export interface DailySessionSubmissionSafeDto {
  id: string;
  dailySessionId: string;
  status: DailySessionSubmissionStatus;
  startedAt: Date;
}

export interface DailySessionSubmissionResultDto {
  submissionId: string;
  dailySessionId: string;
  submittedAt: Date;
  durationSeconds: number;
  comprehensionAnswers: DailySessionComprehensionAnswerRecord[];
  comprehensionCorrectCount: number;
  comprehensionTotalCount: number;
  comprehensionPercentage: number;
  sentenceSubmissions: DailySessionSentenceSubmission[];
  sentenceFeedback: DailySessionSentenceFeedback;
}

export interface DailySessionSubmissionStartResultDto {
  submission: DailySessionSubmissionSafeDto;
  resumed: boolean;
}

export interface DailySessionSubmissionSubmitResultDto {
  result: DailySessionSubmissionResultDto;
  idempotentReplay: boolean;
}
