import { IsNull } from 'typeorm';
import type { DataSource, EntityManager, Repository, UpdateResult } from 'typeorm';
import { PracticeExercise } from '../models/PracticeExercise';
import { PracticeItem } from '../models/PracticeItem';
import type { PracticeExerciseSource, EnglishLevel } from '../models/enums';
import type {
  PracticeItemOption,
  PracticeItemAnswerKey,
  PracticeItemMetadata,
  PracticeExerciseGenerationMetadata,
} from '../models/practice-json-types';
import {
  isPracticeItemAnswerKey,
  isPracticeItemOptionArray,
  isSafeGenerationMetadata,
} from '../lib/practice-jsonb-validators';
import type {
  PracticeExerciseSafeDto,
  PracticeItemSafeDto,
  PracticeExerciseSafeWithItems,
} from '../interfaces/practice/practice-exercise.interface';

interface CreateExerciseData {
  userId: string;
  examCode: string;
  paperCode: string;
  partCode: string;
  targetLevel: EnglishLevel | null;
  title: string;
  instructions: string;
  stimulus: string | null;
  timeLimitSeconds: number | null;
  itemCount: number;
  source: PracticeExerciseSource;
  model: string | null;
  promptVersion: string | null;
  generationMetadata: PracticeExerciseGenerationMetadata | null;
}

interface CreateItemData {
  position: number;
  taskType: string;
  prompt: string;
  options: PracticeItemOption[] | null;
  answerKey: PracticeItemAnswerKey;
  explanation: string | null;
  skillTags: string[];
  metadata: PracticeItemMetadata | null;
}

/** Internal-only: includes answerKey/explanation, fetched via an explicit addSelect(). */
interface PracticeExerciseWithAnswerKeysForEvaluation {
  exercise: PracticeExercise;
  items: PracticeItem[];
}

function toSafeExerciseDto(exercise: PracticeExercise): PracticeExerciseSafeDto {
  return {
    id: exercise.id,
    examCode: exercise.exam_code,
    paperCode: exercise.paper_code,
    partCode: exercise.part_code,
    targetLevel: exercise.target_level,
    title: exercise.title,
    instructions: exercise.instructions,
    stimulus: exercise.stimulus,
    timeLimitSeconds: exercise.time_limit_seconds,
    itemCount: exercise.item_count,
    createdAt: exercise.created_at,
  };
}

function toSafeItemDto(item: PracticeItem): PracticeItemSafeDto {
  return {
    id: item.id,
    position: item.position,
    taskType: item.task_type,
    prompt: item.prompt,
    options: item.options,
    skillTags: item.skill_tags,
  };
}

class PracticeExercisesRepository {
  private readonly exerciseRepo: Repository<PracticeExercise>;
  private readonly itemRepo: Repository<PracticeItem>;

  constructor(dataSource: DataSource | EntityManager) {
    this.exerciseRepo = dataSource.getRepository(PracticeExercise);
    this.itemRepo = dataSource.getRepository(PracticeItem);
  }

  async createExercise(data: CreateExerciseData): Promise<PracticeExercise> {
    if (!isSafeGenerationMetadata(data.generationMetadata)) {
      throw new Error('generationMetadata contains a forbidden key (secret, prompt or headers)');
    }

    const exercise = this.exerciseRepo.create({
      user_id: data.userId,
      exam_code: data.examCode,
      paper_code: data.paperCode,
      part_code: data.partCode,
      target_level: data.targetLevel,
      title: data.title,
      instructions: data.instructions,
      stimulus: data.stimulus,
      time_limit_seconds: data.timeLimitSeconds,
      item_count: data.itemCount,
      source: data.source,
      model: data.model,
      prompt_version: data.promptVersion,
      generation_metadata: data.generationMetadata,
    });
    return this.exerciseRepo.save(exercise);
  }

  async createItems(exerciseId: string, items: CreateItemData[]): Promise<PracticeItem[]> {
    for (const item of items) {
      if (!isPracticeItemAnswerKey(item.answerKey)) {
        throw new Error(`invalid answerKey for item at position ${item.position}`);
      }
      if (item.options !== null && !isPracticeItemOptionArray(item.options)) {
        throw new Error(`invalid options for item at position ${item.position}`);
      }
    }

    const entities = items.map((item) =>
      this.itemRepo.create({
        exercise_id: exerciseId,
        position: item.position,
        task_type: item.taskType,
        prompt: item.prompt,
        options: item.options,
        answer_key: item.answerKey,
        explanation: item.explanation,
        skill_tags: item.skillTags,
        metadata: item.metadata,
      }),
    );
    return this.itemRepo.save(entities);
  }

  async findByIdForUser(exerciseId: string, userId: string): Promise<PracticeExercise | null> {
    return this.exerciseRepo
      .createQueryBuilder('exercise')
      .where('exercise.id = :exerciseId', { exerciseId })
      .andWhere('exercise.user_id = :userId', { userId })
      .andWhere('exercise.deleted_at IS NULL')
      .getOne();
  }

  /**
   * Client-facing projection: never selects answer_key/explanation (they
   * carry `select: false` at the column level, so a plain `find()` already
   * excludes them — this method never needs to override that), and the
   * hand-built DTO mapping is a second, independent layer that also can't
   * leak them, generationMetadata, user_id or deleted_at.
   */
  async findSafeExerciseWithItemsForUser(
    exerciseId: string,
    userId: string,
  ): Promise<PracticeExerciseSafeWithItems | null> {
    const exercise = await this.findByIdForUser(exerciseId, userId);
    if (exercise === null) return null;

    const items = await this.itemRepo.find({
      where: { exercise_id: exerciseId },
      order: { position: 'ASC' },
    });

    return {
      exercise: toSafeExerciseDto(exercise),
      items: items.map(toSafeItemDto),
    };
  }

  /**
   * Internal-only: explicitly opts back into answer_key/explanation via
   * addSelect(). Only for the grading path (PR 3) — never expose this
   * result to a client response.
   */
  async findExerciseWithAnswerKeysForEvaluation(
    exerciseId: string,
    userId: string,
  ): Promise<PracticeExerciseWithAnswerKeysForEvaluation | null> {
    const exercise = await this.findByIdForUser(exerciseId, userId);
    if (exercise === null) return null;

    const items = await this.itemRepo
      .createQueryBuilder('item')
      .addSelect('item.answer_key')
      .addSelect('item.explanation')
      .where('item.exercise_id = :exerciseId', { exerciseId })
      .orderBy('item.position', 'ASC')
      .getMany();

    return { exercise, items };
  }

  async softDeleteExercise(exerciseId: string, userId: string): Promise<UpdateResult> {
    return this.exerciseRepo.softDelete({
      id: exerciseId,
      user_id: userId,
      deleted_at: IsNull(),
    });
  }
}

export { PracticeExercisesRepository };
export type { CreateExerciseData, CreateItemData, PracticeExerciseWithAnswerKeysForEvaluation };
export type {
  PracticeExerciseSafeDto,
  PracticeItemSafeDto,
  PracticeExerciseSafeWithItems,
} from '../interfaces/practice/practice-exercise.interface';
