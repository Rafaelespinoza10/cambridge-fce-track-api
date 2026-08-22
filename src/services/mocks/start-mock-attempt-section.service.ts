import type { DataSource } from 'typeorm';
import { MockAttemptsRepository } from '@repositories/mocks/mock-attempts.repository';
import { PracticeExercisesRepository } from '@repositories/practice/practice-exercises.repository';
import { WritingTasksRepository } from '@repositories/writing/writing-tasks.repository';
import { ListeningSourcesRepository } from '@repositories/mocks/listening-sources.repository';
import type { ListeningSourceSafeWithItems } from '@repositories/mocks/listening-sources.repository';
import { MockAttemptStatus, MockAttemptSectionStatus, MockAttemptSectionContentType } from '@models/enums';
import type { MockAttempt } from '@models/MockAttempt';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import type { PracticeExerciseSafeWithItems } from '../../interfaces/practice/practice-exercise.interface';
import type { WritingTaskSafeDto } from '../../interfaces/writing/writing-task.interface';
import {
  findMockAttemptSectionCatalogEntry,
  type MockAttemptSectionCatalogEntry,
} from '@lib/mocks/mock-attempt-catalog';
import { toMockAttemptSectionSafeDto } from '@lib/mocks/mock-attempt-dto';
import type {
  MockAttemptSectionContentDto,
  StartMockAttemptSectionResultDto,
} from '../../interfaces/mocks/mock-attempt.interface';

export enum StartMockAttemptSectionErrorCode {
  INVALID_INPUT = 'invalid_input',
  ATTEMPT_NOT_FOUND = 'attempt_not_found',
  ATTEMPT_NOT_ACTIVE = 'attempt_not_active',
  SECTION_NOT_FOUND = 'section_not_found',
  LISTENING_NOT_CURATED = 'listening_not_curated',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class StartMockAttemptSectionError extends Error {
  constructor(
    message: string,
    readonly code: StartMockAttemptSectionErrorCode,
  ) {
    super(message);
    this.name = 'StartMockAttemptSectionError';
  }
}

export interface GeneratePracticeExercisePort {
  execute(
    userId: string,
    request: {
      examCode: string;
      paperCode: string;
      partCode: string;
      taskType: string;
      idempotencyKey: string;
    },
  ): Promise<PracticeExerciseSafeWithItems>;
}

export interface GenerateWritingTaskPort {
  execute(
    userId: string,
    request: { taskType: string; idempotencyKey: string },
  ): Promise<WritingTaskSafeDto>;
}

export interface MockAttemptsRepositoryPort {
  findByIdForUser(attemptId: string, userId: string): Promise<MockAttempt | null>;
  findSectionByCodeForUser(
    attemptId: string,
    sectionCode: string,
    userId: string,
  ): Promise<MockAttemptSection | null>;
  startSectionContent(
    sectionId: string,
    data: {
      practiceExerciseId?: string | null;
      writingTaskId?: string | null;
      listeningSourceId?: string | null;
      startedAt: Date;
    },
  ): Promise<void>;
}

export interface PracticeExercisesRepositoryPort {
  findSafeExerciseWithItemsForUser(
    exerciseId: string,
    userId: string,
  ): Promise<PracticeExerciseSafeWithItems | null>;
}

export interface WritingTasksRepositoryPort {
  findSafeTaskForUser(taskId: string, userId: string): Promise<WritingTaskSafeDto | null>;
}

export interface ListeningSourcesRepositoryPort {
  findRandomActiveSourceWithItemsForPart(
    examCode: string,
    paperCode: string,
    partCode: string,
  ): Promise<ListeningSourceSafeWithItems | null>;
  findByIdWithItems(sourceId: string): Promise<ListeningSourceSafeWithItems | null>;
}

export interface StartMockAttemptSectionServiceDeps {
  generatePracticeExercise: GeneratePracticeExercisePort;
  generateWritingTask: GenerateWritingTaskPort;
  mockAttempts?: (dataSource: DataSource) => MockAttemptsRepositoryPort;
  practiceExercises?: (dataSource: DataSource) => PracticeExercisesRepositoryPort;
  writingTasks?: (dataSource: DataSource) => WritingTasksRepositoryPort;
  listeningSources?: (dataSource: DataSource) => ListeningSourcesRepositoryPort;
  /** Injectable seam for tests — defaults to Math.random(). */
  random?: () => number;
  now?: () => Date;
}

const DEFAULT_MOCK_ATTEMPTS_FACTORY = (dataSource: DataSource): MockAttemptsRepositoryPort =>
  new MockAttemptsRepository(dataSource);
const DEFAULT_PRACTICE_EXERCISES_FACTORY = (
  dataSource: DataSource,
): PracticeExercisesRepositoryPort => new PracticeExercisesRepository(dataSource);
const DEFAULT_WRITING_TASKS_FACTORY = (dataSource: DataSource): WritingTasksRepositoryPort =>
  new WritingTasksRepository(dataSource);
const DEFAULT_LISTENING_SOURCES_FACTORY = (
  dataSource: DataSource,
): ListeningSourcesRepositoryPort => new ListeningSourcesRepository(dataSource);

function invalidInput(message: string): never {
  throw new StartMockAttemptSectionError(message, StartMockAttemptSectionErrorCode.INVALID_INPUT);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function toListeningContentDto(
  result: ListeningSourceSafeWithItems,
): Extract<MockAttemptSectionContentDto, { contentType: 'listening' }> {
  return {
    contentType: 'listening',
    title: result.source.title,
    instructions: result.source.instructions,
    video: {
      provider: result.source.videoProvider,
      externalId: result.source.videoExternalId,
      startSeconds: result.source.videoStartSeconds,
      endSeconds: result.source.videoEndSeconds,
    },
    items: result.items,
  };
}

/**
 * Lazily provisions ONE section's real content the first time a student
 * enters it — never all 13 sections up front (see StartMockAttemptService's
 * doc comment on why: the httpApi ~29s hard timeout this codebase already
 * documents for bulk LLM work in one Lambda invocation, see
 * docs/cambridge-knowledge-base.md §10). Calling this again for a section
 * that's already past 'pending' is idempotent — it re-serves the same
 * already-generated content rather than regenerating (and re-billing) it.
 */
export class StartMockAttemptSectionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: StartMockAttemptSectionServiceDeps,
  ) {}

  async execute(
    userId: string,
    attemptId: string,
    sectionCode: string,
  ): Promise<StartMockAttemptSectionResultDto> {
    if (!isNonEmptyString(userId)) invalidInput('userId is required');
    if (!isNonEmptyString(attemptId)) invalidInput('attemptId is required');
    if (!isNonEmptyString(sectionCode)) invalidInput('sectionCode is required');

    const mockAttemptsFactory = this.deps.mockAttempts ?? DEFAULT_MOCK_ATTEMPTS_FACTORY;
    const mockAttemptsRepo = mockAttemptsFactory(this.dataSource);

    const attempt = await mockAttemptsRepo.findByIdForUser(attemptId, userId);
    if (attempt === null) {
      throw new StartMockAttemptSectionError(
        'Mock attempt not found',
        StartMockAttemptSectionErrorCode.ATTEMPT_NOT_FOUND,
      );
    }
    if (attempt.status !== MockAttemptStatus.IN_PROGRESS) {
      throw new StartMockAttemptSectionError(
        'This mock attempt is not in progress',
        StartMockAttemptSectionErrorCode.ATTEMPT_NOT_ACTIVE,
      );
    }

    const section = await mockAttemptsRepo.findSectionByCodeForUser(attemptId, sectionCode, userId);
    if (section === null) {
      throw new StartMockAttemptSectionError(
        'Mock attempt section not found',
        StartMockAttemptSectionErrorCode.SECTION_NOT_FOUND,
      );
    }

    const catalogEntry = findMockAttemptSectionCatalogEntry(sectionCode);
    if (catalogEntry === undefined) {
      // Unreachable given sections are always seeded from this exact catalog
      // at StartMockAttemptService time, but fail loudly rather than proceed
      // with an unknown section shape.
      throw new StartMockAttemptSectionError(
        'This section is not registered in the mock attempt catalog',
        StartMockAttemptSectionErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }

    let contentSection = section;
    if (section.status === MockAttemptSectionStatus.PENDING) {
      contentSection = await this.provisionContent(userId, attemptId, section, catalogEntry);
    }

    const content = await this.loadContent(userId, contentSection, catalogEntry);
    return { section: toMockAttemptSectionSafeDto(contentSection), content };
  }

  private async provisionContent(
    userId: string,
    attemptId: string,
    section: MockAttemptSection,
    catalogEntry: MockAttemptSectionCatalogEntry,
  ): Promise<MockAttemptSection> {
    const now = this.deps.now ?? (() => new Date());
    const mockAttemptsFactory = this.deps.mockAttempts ?? DEFAULT_MOCK_ATTEMPTS_FACTORY;
    const mockAttemptsRepo = mockAttemptsFactory(this.dataSource);
    const idempotencyKey = `${attemptId}:${section.section_code}`;

    if (catalogEntry.contentType === MockAttemptSectionContentType.PRACTICE_EXERCISE) {
      const exercise = await this.deps.generatePracticeExercise.execute(userId, {
        examCode: catalogEntry.examCode,
        paperCode: catalogEntry.paperCode,
        partCode: catalogEntry.partCode,
        taskType: catalogEntry.taskType ?? invalidInput('taskType is required for this section'),
        idempotencyKey,
      });
      await mockAttemptsRepo.startSectionContent(section.id, {
        practiceExerciseId: exercise.exercise.id,
        startedAt: now(),
      });
    } else if (catalogEntry.contentType === MockAttemptSectionContentType.WRITING_TASK) {
      const pool = catalogEntry.writingTaskTypes ?? [];
      if (pool.length === 0) invalidInput('writingTaskTypes is required for this section');
      const random = this.deps.random ?? Math.random;
      const taskType = pool[Math.floor(random() * pool.length)]!;
      const task = await this.deps.generateWritingTask.execute(userId, {
        taskType,
        idempotencyKey,
      });
      await mockAttemptsRepo.startSectionContent(section.id, {
        writingTaskId: task.id,
        startedAt: now(),
      });
    } else {
      const listeningFactory = this.deps.listeningSources ?? DEFAULT_LISTENING_SOURCES_FACTORY;
      const picked = await listeningFactory(this.dataSource).findRandomActiveSourceWithItemsForPart(
        catalogEntry.examCode,
        catalogEntry.paperCode,
        catalogEntry.partCode,
      );
      if (picked === null) {
        throw new StartMockAttemptSectionError(
          `No curated Listening content is available yet for ${catalogEntry.partCode}. An admin needs to register a YouTube source for this part first.`,
          StartMockAttemptSectionErrorCode.LISTENING_NOT_CURATED,
        );
      }
      await mockAttemptsRepo.startSectionContent(section.id, {
        listeningSourceId: picked.source.id,
        startedAt: now(),
      });
    }

    const updated = await mockAttemptsRepo.findSectionByCodeForUser(
      attemptId,
      section.section_code,
      userId,
    );
    if (updated === null) {
      throw new StartMockAttemptSectionError(
        'Failed to re-read the mock attempt section after provisioning its content',
        StartMockAttemptSectionErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }
    return updated;
  }

  private async loadContent(
    userId: string,
    section: MockAttemptSection,
    catalogEntry: MockAttemptSectionCatalogEntry,
  ): Promise<MockAttemptSectionContentDto> {
    if (catalogEntry.contentType === MockAttemptSectionContentType.PRACTICE_EXERCISE) {
      const factory = this.deps.practiceExercises ?? DEFAULT_PRACTICE_EXERCISES_FACTORY;
      const exercise = await factory(this.dataSource).findSafeExerciseWithItemsForUser(
        section.practice_exercise_id ?? '',
        userId,
      );
      if (exercise === null) {
        throw new StartMockAttemptSectionError(
          'Failed to load this section’s generated exercise',
          StartMockAttemptSectionErrorCode.PERSISTENCE_INCONSISTENCY,
        );
      }
      return { contentType: 'practice_exercise', exercise };
    }

    if (catalogEntry.contentType === MockAttemptSectionContentType.WRITING_TASK) {
      const factory = this.deps.writingTasks ?? DEFAULT_WRITING_TASKS_FACTORY;
      const task = await factory(this.dataSource).findSafeTaskForUser(
        section.writing_task_id ?? '',
        userId,
      );
      if (task === null) {
        throw new StartMockAttemptSectionError(
          'Failed to load this section’s generated writing task',
          StartMockAttemptSectionErrorCode.PERSISTENCE_INCONSISTENCY,
        );
      }
      return { contentType: 'writing_task', task };
    }

    const factory = this.deps.listeningSources ?? DEFAULT_LISTENING_SOURCES_FACTORY;
    const result = await factory(this.dataSource).findByIdWithItems(
      section.listening_source_id ?? '',
    );
    if (result === null) {
      throw new StartMockAttemptSectionError(
        'Failed to load this section’s curated Listening content',
        StartMockAttemptSectionErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }
    return toListeningContentDto(result);
  }
}
