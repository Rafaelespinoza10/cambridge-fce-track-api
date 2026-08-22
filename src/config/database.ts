import 'reflect-metadata';
import { DataSource } from 'typeorm';

import { User } from '../models/User';
import { UserProfile } from '../models/UserProfile';
import { UserGoal } from '../models/UserGoal';
import { Skill } from '../models/Skill';
import { ExamSection } from '../models/ExamSection';
import { ActivityTemplate } from '../models/ActivityTemplate';
import { CustomActivity } from '../models/CustomActivity';
import { WeeklyPlan } from '../models/WeeklyPlan';
import { PlanDay } from '../models/PlanDay';
import { PlannedActivity } from '../models/PlannedActivity';
import { StudySession } from '../models/StudySession';
import { ActivityScore } from '../models/ActivityScore';
import { ActivityScoreDetail } from '../models/ActivityScoreDetail';
import { EvidenceFile } from '../models/EvidenceFile';
import { MockTest } from '../models/MockTest';
import { MockSectionScore } from '../models/MockSectionScore';
import { Resource } from '../models/Resource';
import { Recommendation } from '../models/Recommendation';
import { NotificationPreference } from '../models/NotificationPreference';
import { Deck } from '../models/Deck';
import { Flashcard } from '../models/Flashcard';
import { FlashcardReview } from '../models/FlashcardReview';
import { DailyReviewStat } from '../models/DailyReviewStat';
import { FlashcardPreference } from '../models/FlashcardPreference';
import { PracticeExercise } from '../models/PracticeExercise';
import { PracticeItem } from '../models/PracticeItem';
import { PracticeAttempt } from '../models/PracticeAttempt';
import { PracticeAnswer } from '../models/PracticeAnswer';
import { PracticeRecommendation } from '../models/PracticeRecommendation';
import { WritingTask } from '../models/WritingTask';
import { WritingSubmission } from '../models/WritingSubmission';
import { CambridgeSource } from '../models/CambridgeSource';
import { CambridgeKnowledgeItem } from '../models/CambridgeKnowledgeItem';
import { ListeningSource } from '../models/ListeningSource';
import { ListeningItem } from '../models/ListeningItem';
import { MockAttempt } from '../models/MockAttempt';
import { MockAttemptSection } from '../models/MockAttemptSection';
import { DailySession } from '../models/DailySession';
import { DailySessionItem } from '../models/DailySessionItem';
import { DailySessionSubmission } from '../models/DailySessionSubmission';
import { SpotifyConnection } from '../models/SpotifyConnection';

function getSslConfig(): boolean | { rejectUnauthorized: boolean } {
  const databaseUrl: string = process.env.DATABASE_URL ?? '';
  if (databaseUrl.includes('sslmode=require') || databaseUrl.includes('ssl=true')) {
    return { rejectUnauthorized: false };
  }
  return false;
}

function isLoggingEnabled(): boolean {
  return process.env.DB_LOGGING === 'true' || process.env.NODE_ENV === 'development';
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: getSslConfig(),
  synchronize: false,
  logging: isLoggingEnabled(),
  entities: [
    User,
    UserProfile,
    UserGoal,
    Skill,
    ExamSection,
    ActivityTemplate,
    CustomActivity,
    WeeklyPlan,
    PlanDay,
    PlannedActivity,
    StudySession,
    ActivityScore,
    ActivityScoreDetail,
    EvidenceFile,
    MockTest,
    MockSectionScore,
    Resource,
    Recommendation,
    NotificationPreference,
    Deck,
    Flashcard,
    FlashcardReview,
    DailyReviewStat,
    FlashcardPreference,
    PracticeExercise,
    PracticeItem,
    PracticeAttempt,
    PracticeAnswer,
    PracticeRecommendation,
    WritingTask,
    WritingSubmission,
    CambridgeSource,
    CambridgeKnowledgeItem,
    ListeningSource,
    ListeningItem,
    MockAttempt,
    MockAttemptSection,
    DailySession,
    DailySessionItem,
    DailySessionSubmission,
    SpotifyConnection,
  ],
  migrations: ['src/migrations/*.ts'],
  migrationsTableName: 'typeorm_migrations',
});
