import type { DataSource, Repository } from 'typeorm';
import { ListeningSource } from '@models/ListeningSource';
import { ListeningItem } from '@models/ListeningItem';
import { ListeningSourceStatus, EnglishLevel } from '@models/enums';
import type { PracticeItemOption, PracticeItemAnswerKey } from '@models/practice-json-types';

export interface CreateListeningSourceData {
  examCode: string;
  paperCode: string;
  partCode: string;
  title: string;
  instructions: string;
  targetLevel: EnglishLevel | null;
  videoExternalId: string;
  videoStartSeconds: number;
  videoEndSeconds: number;
}

export interface CreateListeningItemData {
  position: number;
  prompt: string;
  options: PracticeItemOption[] | null;
  answerKey: PracticeItemAnswerKey;
  explanation: string | null;
  skillTags: string[];
}

export interface ListeningSourceSafeDto {
  id: string;
  examCode: string;
  paperCode: string;
  partCode: string;
  title: string;
  instructions: string;
  targetLevel: EnglishLevel | null;
  videoProvider: string;
  videoExternalId: string;
  videoStartSeconds: number;
  videoEndSeconds: number;
  status: ListeningSourceStatus;
  itemCount: number;
  createdAt: Date;
}

export interface ListeningItemSafeDto {
  id: string;
  position: number;
  prompt: string;
  options: PracticeItemOption[] | null;
  skillTags: string[];
}

export interface ListeningSourceSafeWithItems {
  source: ListeningSourceSafeDto & { videoStartSeconds: number; videoEndSeconds: number };
  items: ListeningItemSafeDto[];
}

function toSafeSourceDto(source: ListeningSource, itemCount: number): ListeningSourceSafeDto {
  return {
    id: source.id,
    examCode: source.exam_code,
    paperCode: source.paper_code,
    partCode: source.part_code,
    title: source.title,
    instructions: source.instructions,
    targetLevel: source.target_level,
    videoProvider: source.video_provider,
    videoExternalId: source.video_external_id,
    videoStartSeconds: source.video_start_seconds,
    videoEndSeconds: source.video_end_seconds,
    status: source.status,
    itemCount,
    createdAt: source.created_at,
  };
}

function toSafeItemDto(item: ListeningItem): ListeningItemSafeDto {
  return {
    id: item.id,
    position: item.position,
    prompt: item.prompt,
    options: item.options,
    skillTags: item.skill_tags,
  };
}

class ListeningSourcesRepository {
  private readonly sourceRepo: Repository<ListeningSource>;
  private readonly itemRepo: Repository<ListeningItem>;

  constructor(dataSource: DataSource) {
    this.sourceRepo = dataSource.getRepository(ListeningSource);
    this.itemRepo = dataSource.getRepository(ListeningItem);
  }

  async createSource(data: CreateListeningSourceData): Promise<ListeningSource> {
    const entity = this.sourceRepo.create({
      exam_code: data.examCode,
      paper_code: data.paperCode,
      part_code: data.partCode,
      title: data.title,
      instructions: data.instructions,
      target_level: data.targetLevel,
      video_external_id: data.videoExternalId,
      video_start_seconds: data.videoStartSeconds,
      video_end_seconds: data.videoEndSeconds,
    });
    return this.sourceRepo.save(entity);
  }

  async createItems(sourceId: string, items: CreateListeningItemData[]): Promise<ListeningItem[]> {
    const entities = items.map((item) =>
      this.itemRepo.create({
        source_id: sourceId,
        position: item.position,
        prompt: item.prompt,
        options: item.options,
        answer_key: item.answerKey,
        explanation: item.explanation,
        skill_tags: item.skillTags,
      }),
    );
    return this.itemRepo.save(entities);
  }

  async listSources(): Promise<ListeningSourceSafeDto[]> {
    const sources = await this.sourceRepo
      .createQueryBuilder('source')
      .orderBy('source.created_at', 'DESC')
      .getMany();

    const counts = await this.itemRepo
      .createQueryBuilder('item')
      .select('item.source_id', 'sourceId')
      .addSelect('COUNT(*)', 'count')
      .where('item.source_id IN (:...ids)', { ids: sources.map((s) => s.id).concat('') })
      .groupBy('item.source_id')
      .getRawMany<{ sourceId: string; count: string }>();
    const countsBySource = new Map(counts.map((c) => [c.sourceId, Number(c.count)]));

    return sources.map((source) => toSafeSourceDto(source, countsBySource.get(source.id) ?? 0));
  }

  /**
   * Picks one active, curated source for this part at random — a simple
   * variety mechanism (no extra "last used" bookkeeping table) so repeated
   * mock attempts against the same part don't always draw the same test.
   */
  async findRandomActiveSourceWithItemsForPart(
    examCode: string,
    paperCode: string,
    partCode: string,
  ): Promise<ListeningSourceSafeWithItems | null> {
    const source = await this.sourceRepo
      .createQueryBuilder('source')
      .where('source.exam_code = :examCode', { examCode })
      .andWhere('source.paper_code = :paperCode', { paperCode })
      .andWhere('source.part_code = :partCode', { partCode })
      .andWhere('source.status = :status', { status: ListeningSourceStatus.ACTIVE })
      .orderBy('RANDOM()')
      .getOne();
    if (source === null) return null;

    const items = await this.itemRepo.find({
      where: { source_id: source.id },
      order: { position: 'ASC' },
    });

    return {
      source: toSafeSourceDto(source, items.length),
      items: items.map(toSafeItemDto),
    };
  }

  /**
   * Same part, same curated video — used to keep all 4 Listening parts of one
   * mock attempt drawn from the same real test rather than 4 independently
   * randomized ones (see StartMockAttemptSectionService.pickListeningSource).
   */
  async findActiveSourceWithItemsForPartAndVideo(
    examCode: string,
    paperCode: string,
    partCode: string,
    videoExternalId: string,
  ): Promise<ListeningSourceSafeWithItems | null> {
    const source = await this.sourceRepo
      .createQueryBuilder('source')
      .where('source.exam_code = :examCode', { examCode })
      .andWhere('source.paper_code = :paperCode', { paperCode })
      .andWhere('source.part_code = :partCode', { partCode })
      .andWhere('source.status = :status', { status: ListeningSourceStatus.ACTIVE })
      .andWhere('source.video_external_id = :videoExternalId', { videoExternalId })
      .getOne();
    if (source === null) return null;

    const items = await this.itemRepo.find({
      where: { source_id: source.id },
      order: { position: 'ASC' },
    });

    return {
      source: toSafeSourceDto(source, items.length),
      items: items.map(toSafeItemDto),
    };
  }

  async findByIdWithItems(sourceId: string): Promise<ListeningSourceSafeWithItems | null> {
    const source = await this.sourceRepo.findOne({ where: { id: sourceId } });
    if (source === null) return null;

    const items = await this.itemRepo.find({
      where: { source_id: source.id },
      order: { position: 'ASC' },
    });

    return {
      source: toSafeSourceDto(source, items.length),
      items: items.map(toSafeItemDto),
    };
  }

  /** Internal-only: explicitly opts back into answer_key/explanation for grading. Never expose this to a client response. */
  async findItemsWithAnswerKeysBySourceId(sourceId: string): Promise<ListeningItem[]> {
    return this.itemRepo
      .createQueryBuilder('item')
      .addSelect('item.answer_key')
      .addSelect('item.explanation')
      .where('item.source_id = :sourceId', { sourceId })
      .orderBy('item.position', 'ASC')
      .getMany();
  }
}

export { ListeningSourcesRepository };
