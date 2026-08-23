import type { DataSource } from 'typeorm';
import { MockAttemptsRepository } from '@repositories/mocks/mock-attempts.repository';
import { MocksRepository } from '@repositories/mocks/mocks.repository';
import { MockAttemptStatus, MockAttemptSectionStatus, MockType, ExamType } from '@models/enums';
import type { MockAttempt } from '@models/MockAttempt';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import { getMockExamCatalog } from '@lib/mocks/mock-exam-catalog';
import { roundToTwoDecimals } from '@lib/practice/practice-attempt-grading';
import { toMockAttemptSafeDto } from '@lib/mocks/mock-attempt-dto';
import { computeMockAttemptPaperScores, PAPER_GROUPS } from '@lib/mocks/mock-attempt-paper-scores';
import type { MockAttemptPaperGroup } from '@lib/mocks/mock-attempt-paper-scores';
import { estimateB2FirstResult } from '@lib/mocks/estimate-mock-level';
import type { MockAttemptFinalResultDto } from '../../interfaces/mocks/mock-attempt.interface';

export enum SubmitMockAttemptErrorCode {
  INVALID_INPUT = 'invalid_input',
  ATTEMPT_NOT_FOUND = 'attempt_not_found',
  ATTEMPT_ABANDONED = 'attempt_abandoned',
  SECTIONS_NOT_COMPLETE = 'sections_not_complete',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class SubmitMockAttemptError extends Error {
  constructor(
    message: string,
    readonly code: SubmitMockAttemptErrorCode,
    readonly incompleteSectionCodes: string[] = [],
  ) {
    super(message);
    this.name = 'SubmitMockAttemptError';
  }
}

export interface MockAttemptsRepositoryPort {
  findByIdForUser(attemptId: string, userId: string): Promise<MockAttempt | null>;
  findSectionsByAttempt(attemptId: string): Promise<MockAttemptSection[]>;
  completeAttempt(
    attemptId: string,
    data: { submittedAt: Date; resultMockTestId: string },
  ): Promise<void>;
}

export interface MocksRepositoryPort {
  createMock(
    data: Parameters<MocksRepository['createMock']>[0],
  ): ReturnType<MocksRepository['createMock']>;
  createSections(
    data: Parameters<MocksRepository['createSections']>[0],
  ): ReturnType<MocksRepository['createSections']>;
  resolveExamSectionIds(
    ...args: Parameters<MocksRepository['resolveExamSectionIds']>
  ): ReturnType<MocksRepository['resolveExamSectionIds']>;
}

export interface SubmitMockAttemptServiceDeps {
  mockAttempts?: (dataSource: DataSource) => MockAttemptsRepositoryPort;
  mocks?: (dataSource: DataSource) => MocksRepositoryPort;
}

const DEFAULT_MOCK_ATTEMPTS_FACTORY = (dataSource: DataSource): MockAttemptsRepositoryPort =>
  new MockAttemptsRepository(dataSource);
const DEFAULT_MOCKS_FACTORY = (dataSource: DataSource): MocksRepositoryPort =>
  new MocksRepository(dataSource);

function invalidInput(message: string): never {
  throw new SubmitMockAttemptError(message, SubmitMockAttemptErrorCode.INVALID_INPUT);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

const PAPER_GROUP_LABELS: Record<MockAttemptPaperGroup, string> = {
  reading: 'Reading',
  useOfEnglish: 'Use of English',
  writing: 'Writing',
  listening: 'Listening',
};

/**
 * Names the MockTest after what was actually sat, so a scoped attempt is
 * recognisable in the mock history instead of every row reading "Full Timed
 * Mock". Multiple groups are joined because nothing stops a future scope from
 * spanning two (Reading and Use of English are one Cambridge paper).
 */
function buildMockName(
  isFullMock: boolean,
  coveredGroups: MockAttemptPaperGroup[],
  submittedAt: Date,
): string {
  const date = submittedAt.toISOString().slice(0, 10);
  if (isFullMock) return `Full Timed Mock — ${date}`;
  const label = coveredGroups.map((group) => PAPER_GROUP_LABELS[group]).join(' + ');
  return `${label} Timed Mock — ${date}`;
}

/**
 * Finalizes a mock attempt once every section has been submitted (see
 * SubmitMockAttemptSectionService — including a client force-submitting a
 * timed-out section). Aggregates each section's already-graded rawScore/
 * maxScore into a real MockTest + MockSectionScore rows via the EXISTING
 * MocksRepository — the same createMock/createSections calls
 * MocksService.createMock already makes — so the finished attempt shows up
 * in the ordinary Mocks history/charts/CSV export with zero changes to that
 * module. section_code is deliberately kept identical between
 * MOCK_ATTEMPT_SECTION_CATALOG and MOCK_EXAM_CATALOG, so no code translation
 * is needed here.
 *
 * estimatedStandardizedScore/estimatedLevel are filled in with
 * estimateB2FirstResult's approximation (see lib/mocks/estimate-mock-level.ts
 * for why it can only ever be an estimate, never the real Cambridge Scale
 * Score) — same as today's manual mock registration, still editable
 * afterwards via PATCH /mocks/{id} if the student later sits the real exam.
 */
export class SubmitMockAttemptService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: SubmitMockAttemptServiceDeps = {},
  ) {}

  async execute(
    userId: string,
    attemptId: string,
    submittedAt: Date,
  ): Promise<MockAttemptFinalResultDto> {
    if (!isNonEmptyString(userId)) invalidInput('userId is required');
    if (!isNonEmptyString(attemptId)) invalidInput('attemptId is required');
    if (!(submittedAt instanceof Date) || Number.isNaN(submittedAt.getTime())) {
      invalidInput('submittedAt must be a valid Date');
    }

    const mockAttemptsFactory = this.deps.mockAttempts ?? DEFAULT_MOCK_ATTEMPTS_FACTORY;

    const attempt = await mockAttemptsFactory(this.dataSource).findByIdForUser(attemptId, userId);
    if (attempt === null) {
      throw new SubmitMockAttemptError(
        'Mock attempt not found',
        SubmitMockAttemptErrorCode.ATTEMPT_NOT_FOUND,
      );
    }
    if (attempt.status === MockAttemptStatus.COMPLETED) {
      // Idempotent replay: nothing is recomputed.
      const sections = await mockAttemptsFactory(this.dataSource).findSectionsByAttempt(attemptId);
      return {
        attempt: toMockAttemptSafeDto(attempt, sections),
        mockTestId: attempt.result_mock_test_id ?? '',
      };
    }
    if (attempt.status === MockAttemptStatus.ABANDONED) {
      throw new SubmitMockAttemptError(
        'This mock attempt was abandoned and cannot be submitted',
        SubmitMockAttemptErrorCode.ATTEMPT_ABANDONED,
      );
    }

    const sections = await mockAttemptsFactory(this.dataSource).findSectionsByAttempt(attemptId);
    const incomplete = sections.filter((s) => s.status !== MockAttemptSectionStatus.COMPLETED);
    if (incomplete.length > 0) {
      throw new SubmitMockAttemptError(
        'Every section must be submitted before the mock attempt can be finalized',
        SubmitMockAttemptErrorCode.SECTIONS_NOT_COMPLETE,
        incomplete.map((s) => s.section_code),
      );
    }

    // Not wrapped in a single DB transaction across the Mocks repository and
    // the MockAttempts repository — same atomicity level MocksService.createMock
    // already has today (its own createMock/createSections calls are two
    // sequential saves, not one transaction). A failure between creating the
    // MockTest and marking the attempt completed would leave an orphaned
    // MockTest but never a lost attempt result — retrying this endpoint is
    // safe (see the idempotent-replay branch above once result_mock_test_id
    // is set).
    const mocksFactory = this.deps.mocks ?? DEFAULT_MOCKS_FACTORY;
    const mocksRepo = mocksFactory(this.dataSource);
    const mockAttemptsRepo = mockAttemptsFactory(this.dataSource);

    // Only B2 First has a published-boundary approximation to interpolate
    // (see estimateB2FirstResult) — every other exam type stays null, same
    // as before. All 4 groups are guaranteed non-null percentages here since
    // every section is already confirmed 'completed' above.
    const paperScores = computeMockAttemptPaperScores(sections);
    const coveredGroups = PAPER_GROUPS.filter((group) => paperScores[group].percentage !== null);
    const isFullMock = coveredGroups.length === PAPER_GROUPS.length;

    // A scoped attempt (Writing only, Listening only, ...) gets NO estimated
    // score or level, and this is the whole reason that check exists.
    //
    // The average below reads a missing group as `?? 0`, which is correct when
    // every group is present but catastrophic when one isn't: a Writing-only
    // attempt scoring 80% would average (0 + 0 + 80 + 0) / 4 = 20% and be
    // filed as a B2 First result near the bottom of the scale. It would then
    // become "your last mock" on Home and Progress. A partial sitting simply
    // is not a B2 First estimate, so it reports none — the per-section scores
    // still roll up and still feed the exam-part metrics.
    let estimatedStandardizedScore: number | null = null;
    let estimatedLevel: ReturnType<typeof estimateB2FirstResult>['estimatedLevel'] | null = null;
    if (attempt.exam_type === ExamType.B2_FIRST && isFullMock) {
      const percentages = PAPER_GROUPS.map((group) => paperScores[group].percentage ?? 0);
      const overallPercentage = percentages.reduce((sum, p) => sum + p, 0) / percentages.length;
      const estimate = estimateB2FirstResult(overallPercentage);
      estimatedStandardizedScore = estimate.estimatedScore;
      estimatedLevel = estimate.estimatedLevel;
    }

    const mockTest = await mocksRepo.createMock({
      userId,
      name: buildMockName(isFullMock, coveredGroups, submittedAt),
      examType: attempt.exam_type,
      mockType: isFullMock ? MockType.FULL : MockType.PARTIAL,
      takenAt: submittedAt,
      estimatedStandardizedScore,
      scoreScale: getMockExamCatalog(attempt.exam_type).scoreScale,
      estimatedLevel,
      notes: isFullMock
        ? 'Generated automatically from a live timed mock attempt. Score and level are an approximation, not an official Cambridge result.'
        : 'Generated automatically from a scoped timed mock attempt. Covers only part of the exam, so it carries no overall score or level estimate.',
    });

    const sectionCodes = sections.map((s) => s.section_code);
    const examSectionIds = await mocksRepo.resolveExamSectionIds(attempt.exam_type, sectionCodes);

    await mocksRepo.createSections(
      sections.map((s) => {
        const rawScore = s.raw_score !== null ? Number(s.raw_score) : null;
        const maxScore = s.max_score !== null ? Number(s.max_score) : null;
        const percentage =
          rawScore !== null && maxScore !== null && maxScore > 0
            ? roundToTwoDecimals((rawScore / maxScore) * 100)
            : null;
        return {
          mockTestId: mockTest.id,
          sectionCode: s.section_code,
          examSectionId: examSectionIds.get(s.section_code) ?? null,
          rawScore,
          maxScore,
          percentage,
          standardizedScore: null,
          notes: null,
        };
      }),
    );

    await mockAttemptsRepo.completeAttempt(attemptId, {
      submittedAt,
      resultMockTestId: mockTest.id,
    });

    const completedAttempt: MockAttempt = {
      ...attempt,
      status: MockAttemptStatus.COMPLETED,
      submitted_at: submittedAt,
      result_mock_test_id: mockTest.id,
    };
    return { attempt: toMockAttemptSafeDto(completedAttempt, sections), mockTestId: mockTest.id };
  }
}
