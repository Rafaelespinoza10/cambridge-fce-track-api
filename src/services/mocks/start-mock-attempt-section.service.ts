import type { DataSource } from 'typeorm';
import { MockAttemptsRepository } from '@repositories/mocks/mock-attempts.repository';
import { PracticeExercisesRepository } from '@repositories/practice/practice-exercises.repository';
import { WritingTasksRepository } from '@repositories/writing/writing-tasks.repository';
import { ListeningSourcesRepository } from '@repositories/mocks/listening-sources.repository';
import type { ListeningSourceSafeWithItems } from '@repositories/mocks/listening-sources.repository';
import {
  MockAttemptStatus,
  MockAttemptSectionStatus,
  MockAttemptSectionContentType,
} from '@models/enums';
import type { MockAttempt } from '@models/MockAttempt';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import type { PracticeExerciseSafeWithItems } from '../../interfaces/practice/practice-exercise.interface';
import type { WritingTaskSafeDto } from '../../interfaces/writing/writing-task.interface';
import {
  findMockAttemptSectionCatalogEntry,
  type MockAttemptSectionCatalogEntry,
} from '@lib/mocks/mock-attempt-catalog';
import { toMockAttemptSectionSafeDto } from '@lib/mocks/mock-attempt-dto';
import { deterministicUuidFrom } from '@lib/shared/deterministic-uuid';
import type { MockAttemptSectionAnswers } from '@models/mock-attempt-json-types';
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
  findSectionsByAttempt(attemptId: string): Promise<MockAttemptSection[]>;
  startSectionContent(
    sectionId: string,
    data: {
      practiceExerciseId?: string | null;
      writingTaskId?: string | null;
      listeningSourceId?: string | null;
      startedAt: Date;
      timeLimitSecondsOverride?: number;
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
  findActiveSourceWithItemsForPartAndVideo(
    examCode: string,
    paperCode: string,
    partCode: string,
    videoExternalId: string,
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

/**
 * Only ever returns a value for a section still 'in_progress' — a
 * 'completed' section's grading result belongs to
 * GetMockAttemptSectionResultService, not here, and a 'pending' section has
 * never had anything saved. `answers` defaults to `[]` (an empty array) at
 * seed time (see MockAttemptsRepository.createAttemptWithSections), never a
 * real MockAttemptSectionAnswers object, so that default is never mistaken
 * for a saved draft.
 */
function toDraftAnswersDto(section: MockAttemptSection): MockAttemptSectionAnswers | null {
  if (section.status !== MockAttemptSectionStatus.IN_PROGRESS) return null;
  if (Array.isArray(section.answers)) return null;
  return section.answers;
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
    return {
      section: toMockAttemptSectionSafeDto(contentSection),
      content,
      draftAnswers: toDraftAnswersDto(contentSection),
    };
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
    // practice_exercises.idempotency_key / writing_tasks.idempotency_key are
    // both typed `uuid` — a compound string like `${attemptId}:${sectionCode}`
    // is never valid Postgres uuid input on its own, so it's hashed into a
    // deterministic one first (same attemptId+sectionCode always maps to the
    // same UUID, so idempotent re-entry into this section still replays the
    // already-generated content instead of erroring or regenerating).
    const idempotencyKey = deterministicUuidFrom(`${attemptId}:${section.section_code}`);

    if (catalogEntry.contentType === MockAttemptSectionContentType.PRACTICE_EXERCISE) {
      const exercise = await this.deps.generatePracticeExercise.execute(userId, {
        examCode: catalogEntry.examCode,
        paperCode: catalogEntry.paperCode,
        partCode: catalogEntry.partCode,
        taskType: catalogEntry.taskType ?? invalidInput('taskType is required for this section'),
        idempotencyKey,
      });
      const timeLimitSecondsOverride =
        catalogEntry.scoreGroup === 'useOfEnglish'
          ? await this.computeUseOfEnglishTimeLimitSeconds(mockAttemptsRepo, attemptId, catalogEntry)
          : undefined;
      await mockAttemptsRepo.startSectionContent(section.id, {
        practiceExerciseId: exercise.exercise.id,
        startedAt: now(),
        timeLimitSecondsOverride,
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
      const listeningRepo = listeningFactory(this.dataSource);
      const picked = await this.pickListeningSource(
        mockAttemptsRepo,
        listeningRepo,
        attemptId,
        catalogEntry,
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

  /**
   * The 4 Listening parts of one real Cambridge test all come from the SAME
   * source video (a single ~40-minute recording split into part-specific
   * start/end windows — see scripts/fixtures/listening-tests/*.json, every
   * part in one file shares one videoExternalId). Once this attempt has
   * already provisioned one Listening part, every subsequent part must reuse
   * that same video rather than independently randomizing — otherwise a
   * student's "mock" could stitch together parts from 4 unrelated tests.
   * Falls back to the old random pick if no matching part exists for that
   * video (defensive only; the curated fixtures always provide all 4).
   */
  private async pickListeningSource(
    mockAttemptsRepo: MockAttemptsRepositoryPort,
    listeningRepo: ListeningSourcesRepositoryPort,
    attemptId: string,
    catalogEntry: MockAttemptSectionCatalogEntry,
  ): Promise<ListeningSourceSafeWithItems | null> {
    const sections = await mockAttemptsRepo.findSectionsByAttempt(attemptId);
    const alreadyProvisioned = sections.find(
      (s) =>
        s.content_type === MockAttemptSectionContentType.LISTENING &&
        s.listening_source_id !== null,
    );

    if (alreadyProvisioned?.listening_source_id) {
      const existingSource = await listeningRepo.findByIdWithItems(
        alreadyProvisioned.listening_source_id,
      );
      if (existingSource !== null) {
        const matched = await listeningRepo.findActiveSourceWithItemsForPartAndVideo(
          catalogEntry.examCode,
          catalogEntry.paperCode,
          catalogEntry.partCode,
          existingSource.source.videoExternalId,
        );
        if (matched !== null) return matched;
      }
    }

    return listeningRepo.findRandomActiveSourceWithItemsForPart(
      catalogEntry.examCode,
      catalogEntry.paperCode,
      catalogEntry.partCode,
    );
  }

  /**
   * Pools unused time across the 4 Use of English parts only (scoreGroup ===
   * 'useOfEnglish') — Reading and Writing keep their own fixed timers. A part
   * finished early carries its leftover seconds forward into the next
   * not-yet-started UoE part's limit, cascading across all 4: leftover is the
   * sum, across every already-completed UoE section in this attempt, of
   * (that section's own time_limit_seconds — the time it actually took), so
   * a boost inherited by part 2 that goes unused there keeps compounding
   * into part 3, etc.
   */
  private async computeUseOfEnglishTimeLimitSeconds(
    mockAttemptsRepo: MockAttemptsRepositoryPort,
    attemptId: string,
    catalogEntry: MockAttemptSectionCatalogEntry,
  ): Promise<number> {
    const baseSeconds = catalogEntry.defaultDurationMinutes * 60;
    const sections = await mockAttemptsRepo.findSectionsByAttempt(attemptId);

    const bankedSeconds = sections.reduce((sum, s) => {
      if (s.section_code === catalogEntry.sectionCode) return sum;
      if (s.status !== MockAttemptSectionStatus.COMPLETED) return sum;
      if (s.started_at === null || s.completed_at === null) return sum;
      const otherEntry = findMockAttemptSectionCatalogEntry(s.section_code);
      if (otherEntry?.scoreGroup !== 'useOfEnglish') return sum;

      const elapsedSeconds = Math.floor(
        (s.completed_at.getTime() - s.started_at.getTime()) / 1000,
      );
      return sum + Math.max(0, s.time_limit_seconds - elapsedSeconds);
    }, 0);

    return baseSeconds + bankedSeconds;
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
