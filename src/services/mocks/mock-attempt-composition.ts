import OpenAI from 'openai';

import { getDatabaseConnection } from '@lib/shared/database';
import { LLMService } from '../llm/llm.service';
import { OpenAIProvider } from '../llm/openai.provider';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import { buildPracticeExerciseServices } from '../practice/generate-practice-exercise-composition';
import { buildWritingTaskServices } from '../writing/generate-writing-task-composition';
import { MockAttemptsRepository } from '@repositories/mocks/mock-attempts.repository';
import { StartMockAttemptService } from './start-mock-attempt.service';
import { StartMockAttemptSectionService } from './start-mock-attempt-section.service';
import { SaveMockAttemptSectionDraftService } from './save-mock-attempt-section-draft.service';
import { SubmitMockAttemptSectionService } from './submit-mock-attempt-section.service';
import { SubmitMockAttemptService } from './submit-mock-attempt.service';
import { AbandonMockAttemptService } from './abandon-mock-attempt.service';
import { GetActiveMockAttemptService } from './get-active-mock-attempt.service';
import { GetMockAttemptService } from './get-mock-attempt.service';
import { GetMockAttemptSectionResultService } from './get-mock-attempt-section-result.service';
import { GetMockAttemptResultService } from './get-mock-attempt-result.service';
import { GenerateMockAttemptItemFlashcardDraftService } from './generate-mock-attempt-item-flashcard-draft.service';
import { GenerateMockAttemptCorrectionFlashcardDraftService } from './generate-mock-attempt-correction-flashcard-draft.service';
import { FlashcardDraftGenerator } from '../flashcards/flashcard-draft-generator';

const DEFAULT_TEMPERATURE = 0.5;
const DEFAULT_MAX_OUTPUT_TOKENS = 2500;

let _openaiClient: OpenAI | null = null;

/** Reuses the OpenAI client across Lambda warm invocations — same pattern as every other composition.ts file. */
function getOpenAIClient(): OpenAI {
  if (_openaiClient !== null) {
    return _openaiClient;
  }
  const apiKey = process.env['OPEN_AI_API_KEY'];
  if (!apiKey) {
    throw new LLMServiceError('OPEN_AI_API_KEY is not configured', LLMErrorCode.NOT_CONFIGURED);
  }
  _openaiClient = new OpenAI({ apiKey });
  return _openaiClient;
}

interface MockAttemptServices {
  startAttempt: StartMockAttemptService;
  startSection: StartMockAttemptSectionService;
  saveSectionDraft: SaveMockAttemptSectionDraftService;
  submitSection: SubmitMockAttemptSectionService;
  submitAttempt: SubmitMockAttemptService;
  abandonAttempt: AbandonMockAttemptService;
  getActiveAttempt: GetActiveMockAttemptService;
  getAttempt: GetMockAttemptService;
  getSectionResult: GetMockAttemptSectionResultService;
  getResult: GetMockAttemptResultService;
  generateItemFlashcardDraft: GenerateMockAttemptItemFlashcardDraftService;
  generateCorrectionFlashcardDraft: GenerateMockAttemptCorrectionFlashcardDraftService;
}

async function buildMockAttemptServices(): Promise<MockAttemptServices> {
  const dataSource = await getDatabaseConnection();

  const provider = new OpenAIProvider(getOpenAIClient(), process.env['OPENAI_MODEL']);
  const llm = new LLMService({
    provider,
    defaultModel: provider.defaultModel,
    defaultTemperature: DEFAULT_TEMPERATURE,
    defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });

  // Reuses the exact same generation services Practice/Writing already
  // expose — the mock orchestrator never re-implements Use of English/
  // Reading/Writing generation, only sequences calls into them.
  const { generateExercise } = await buildPracticeExerciseServices();
  const { generateTask } = await buildWritingTaskServices();

  const mockAttemptsRepository = new MockAttemptsRepository(dataSource);

  const flashcardGenerator = new FlashcardDraftGenerator({ llm });

  return {
    startAttempt: new StartMockAttemptService(dataSource),
    startSection: new StartMockAttemptSectionService(dataSource, {
      generatePracticeExercise: generateExercise,
      generateWritingTask: generateTask,
    }),
    saveSectionDraft: new SaveMockAttemptSectionDraftService(dataSource),
    submitSection: new SubmitMockAttemptSectionService(dataSource, { llm }),
    submitAttempt: new SubmitMockAttemptService(dataSource),
    abandonAttempt: new AbandonMockAttemptService({ repository: mockAttemptsRepository }),
    getActiveAttempt: new GetActiveMockAttemptService({ repository: mockAttemptsRepository }),
    getAttempt: new GetMockAttemptService({ repository: mockAttemptsRepository }),
    getSectionResult: new GetMockAttemptSectionResultService({
      repository: mockAttemptsRepository,
    }),
    getResult: new GetMockAttemptResultService(dataSource),
    generateItemFlashcardDraft: new GenerateMockAttemptItemFlashcardDraftService(dataSource, {
      generator: flashcardGenerator,
    }),
    generateCorrectionFlashcardDraft: new GenerateMockAttemptCorrectionFlashcardDraftService(
      dataSource,
      { generator: flashcardGenerator },
    ),
  };
}

export { buildMockAttemptServices };
export type { MockAttemptServices };
