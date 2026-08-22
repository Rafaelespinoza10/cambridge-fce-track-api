import type { DataSource } from 'typeorm';
import { ListeningSourcesRepository } from '@repositories/mocks/listening-sources.repository';
import type {
  CreateListeningItemData,
  ListeningSourceSafeDto,
} from '@repositories/mocks/listening-sources.repository';
import { EnglishLevel, ListeningSourceStatus } from '@models/enums';
import type { PracticeItemOption, PracticeItemAnswerKey } from '@models/practice-json-types';
import {
  isPracticeItemAnswerKey,
  isPracticeItemOptionArray,
  normalizeSkillTags,
} from '@lib/practice/practice-jsonb-validators';
import { isPracticePartCode } from '@lib/practice/practice-exam-catalog';

export enum ImportListeningSourceErrorCode {
  INVALID_INPUT = 'invalid_input',
}

export class ImportListeningSourceError extends Error {
  constructor(
    message: string,
    readonly code: ImportListeningSourceErrorCode,
  ) {
    super(message);
    this.name = 'ImportListeningSourceError';
  }
}

export interface ImportListeningItemInput {
  position: number;
  prompt: string;
  options: PracticeItemOption[] | null;
  answerKey: PracticeItemAnswerKey;
  explanation: string | null;
  skillTags: string[];
}

export interface ImportListeningSourceInput {
  paperCode: string;
  partCode: string;
  title: string;
  instructions: string;
  targetLevel: EnglishLevel | null;
  videoExternalId: string;
  videoStartSeconds: number;
  videoEndSeconds: number;
  items: ImportListeningItemInput[];
}

export interface ListeningSourcesRepositoryPort {
  createSource(data: {
    examCode: string;
    paperCode: string;
    partCode: string;
    title: string;
    instructions: string;
    targetLevel: EnglishLevel | null;
    videoExternalId: string;
    videoStartSeconds: number;
    videoEndSeconds: number;
  }): Promise<{ id: string; created_at: Date }>;
  createItems(sourceId: string, items: CreateListeningItemData[]): Promise<unknown>;
}

export interface ImportListeningSourceServiceDeps {
  listeningSources?: (dataSource: DataSource) => ListeningSourcesRepositoryPort;
}

const DEFAULT_LISTENING_SOURCES_FACTORY = (
  dataSource: DataSource,
): ListeningSourcesRepositoryPort => new ListeningSourcesRepository(dataSource);

const EXAM_CODE = 'B2_FIRST';
const TITLE_MAX_LENGTH = 255;
const PROMPT_MAX_LENGTH = 2000;
const EXPLANATION_MAX_LENGTH = 2000;
const MIN_ITEMS = 1;
const MAX_ITEMS = 20;

function invalidInput(message: string): never {
  throw new ImportListeningSourceError(message, ImportListeningSourceErrorCode.INVALID_INPUT);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Persists one admin-curated, real B2 First Listening test: a real official
 * YouTube video plus that test's real published questions/answer key. This
 * is manual curation, never generation — see docs on ListeningSource for why
 * (real Listening audio has no reliable public transcript, and letting an
 * LLM invent questions from an auto-caption would violate the same "never
 * trust the model's memory" rule the Cambridge Knowledge Base already
 * enforces).
 */
export class ImportListeningSourceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: ImportListeningSourceServiceDeps = {},
  ) {}

  async execute(input: ImportListeningSourceInput): Promise<ListeningSourceSafeDto> {
    if (!isNonEmptyString(input.paperCode)) invalidInput('paperCode is required');
    if (!isNonEmptyString(input.partCode)) invalidInput('partCode is required');
    if (input.paperCode !== 'PAPER_3') {
      invalidInput('Only Listening parts (PAPER_3) can be imported as a ListeningSource');
    }
    if (!isPracticePartCode(EXAM_CODE, input.paperCode, input.partCode)) {
      invalidInput(`${input.paperCode}/${input.partCode} is not a real B2 First part`);
    }

    const title = isNonEmptyString(input.title)
      ? input.title.trim()
      : invalidInput('title is required');
    if (title.length > TITLE_MAX_LENGTH) invalidInput(`title exceeds ${TITLE_MAX_LENGTH} characters`);

    const instructions = isNonEmptyString(input.instructions)
      ? input.instructions.trim()
      : invalidInput('instructions is required');

    if (input.targetLevel !== null && !Object.values(EnglishLevel).includes(input.targetLevel)) {
      invalidInput('targetLevel must be a valid English level or null');
    }

    if (!isNonEmptyString(input.videoExternalId)) invalidInput('videoExternalId is required');
    if (!Number.isInteger(input.videoStartSeconds) || input.videoStartSeconds < 0) {
      invalidInput('videoStartSeconds must be a non-negative integer');
    }
    if (
      !Number.isInteger(input.videoEndSeconds) ||
      input.videoEndSeconds <= input.videoStartSeconds
    ) {
      invalidInput('videoEndSeconds must be an integer greater than videoStartSeconds');
    }

    if (
      !Array.isArray(input.items) ||
      input.items.length < MIN_ITEMS ||
      input.items.length > MAX_ITEMS
    ) {
      invalidInput(`items must contain between ${MIN_ITEMS} and ${MAX_ITEMS} entries`);
    }

    const items: CreateListeningItemData[] = input.items.map((item, index) => {
      if (typeof item.position !== 'number' || !Number.isInteger(item.position)) {
        invalidInput(`items[${index}].position must be an integer`);
      }
      if (!isNonEmptyString(item.prompt) || item.prompt.length > PROMPT_MAX_LENGTH) {
        invalidInput(
          `items[${index}].prompt is required and must be at most ${PROMPT_MAX_LENGTH} characters`,
        );
      }
      if (item.options !== null && !isPracticeItemOptionArray(item.options)) {
        invalidInput(`items[${index}].options is invalid`);
      }
      if (!isPracticeItemAnswerKey(item.answerKey)) {
        invalidInput(`items[${index}].answerKey is invalid`);
      }
      if (
        item.explanation !== null &&
        (typeof item.explanation !== 'string' || item.explanation.length > EXPLANATION_MAX_LENGTH)
      ) {
        invalidInput(`items[${index}].explanation is invalid`);
      }
      return {
        position: item.position,
        prompt: item.prompt.trim(),
        options: item.options,
        answerKey: item.answerKey,
        explanation: item.explanation,
        skillTags: normalizeSkillTags(item.skillTags),
      };
    });

    const positions = items.map((i) => i.position).sort((a, b) => a - b);
    const expectedPositions = Array.from({ length: items.length }, (_, i) => i + 1);
    if (JSON.stringify(positions) !== JSON.stringify(expectedPositions)) {
      invalidInput('item positions must be exactly 1..N with no gaps or duplicates');
    }

    const factory = this.deps.listeningSources ?? DEFAULT_LISTENING_SOURCES_FACTORY;
    const repo = factory(this.dataSource);

    const source = await repo.createSource({
      examCode: EXAM_CODE,
      paperCode: input.paperCode,
      partCode: input.partCode,
      title,
      instructions,
      targetLevel: input.targetLevel,
      videoExternalId: input.videoExternalId.trim(),
      videoStartSeconds: input.videoStartSeconds,
      videoEndSeconds: input.videoEndSeconds,
    });
    await repo.createItems(source.id, items);

    return {
      id: source.id,
      examCode: EXAM_CODE,
      paperCode: input.paperCode,
      partCode: input.partCode,
      title,
      instructions,
      targetLevel: input.targetLevel,
      videoProvider: 'youtube',
      videoExternalId: input.videoExternalId.trim(),
      videoStartSeconds: input.videoStartSeconds,
      videoEndSeconds: input.videoEndSeconds,
      status: ListeningSourceStatus.ACTIVE,
      itemCount: items.length,
      createdAt: source.created_at,
    };
  }
}
