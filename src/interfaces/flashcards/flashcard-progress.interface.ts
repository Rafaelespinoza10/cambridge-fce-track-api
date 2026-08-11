export interface FlashcardPreferencesDto {
  dailyGoal: number;
}

export interface UpdateFlashcardPreferencesRequest {
  dailyGoal: number;
}

export interface FlashcardReviewSummaryDayDto {
  initialized: boolean;
  localDate: string;
  timezone: string;

  cardsDueNow: number;

  dailyGoal: number;
  cardsDueAtFirstSession: number | null;
  requiredReviews: number | null;

  cardsReviewed: number;
  uniqueCardsReviewed: number;
  goalCompleted: boolean;
}

export interface FlashcardStreakDto {
  current: number;
  best: number;
}

export interface FlashcardReviewWeekDayDto {
  date: string;
  completed: boolean;
}

export interface FlashcardReviewSummaryDto {
  preferences: FlashcardPreferencesDto;
  day: FlashcardReviewSummaryDayDto;
  streak: FlashcardStreakDto;
  week: FlashcardReviewWeekDayDto[];
}
