import type { EnglishLevel } from '../../models/enums';
import type { PracticeItemOption } from '../../models/practice-json-types';

export interface GeneratePracticeExerciseRequest {
  examCode: string;
  paperCode: string;
  partCode: string;
  taskType: string;
  targetLevel?: EnglishLevel;
}

/** Never carries answerKey, explanation, generationMetadata, userId or soft-delete fields. */
export interface PracticeExerciseSafeDto {
  id: string;
  examCode: string;
  paperCode: string;
  partCode: string;
  targetLevel: EnglishLevel | null;
  title: string;
  instructions: string;
  stimulus: string | null;
  timeLimitSeconds: number | null;
  itemCount: number;
  createdAt: Date;
}

/** Never carries answerKey or explanation — those stay server-side until submit/evaluation. */
export interface PracticeItemSafeDto {
  id: string;
  position: number;
  taskType: string;
  prompt: string;
  options: PracticeItemOption[] | null;
  skillTags: string[];
}

export interface PracticeExerciseSafeWithItems {
  exercise: PracticeExerciseSafeDto;
  items: PracticeItemSafeDto[];
}
