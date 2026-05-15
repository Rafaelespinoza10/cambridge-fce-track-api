import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import {
  RecommendationType,
  RecommendationPriority,
  RecommendationStatus,
  RecommendationSource,
} from './enums';
import type { User } from './User';
import type { Skill } from './Skill';
import type { ExamSection } from './ExamSection';

@Entity('recommendations')
export class Recommendation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid', nullable: true })
  skill_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  exam_section_id: string | null;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: RecommendationType,
    enumName: 'recommendation_type_enum',
  })
  recommendation_type: RecommendationType;

  @Column({
    type: 'enum',
    enum: RecommendationPriority,
    enumName: 'recommendation_priority_enum',
    default: RecommendationPriority.MEDIUM,
  })
  priority: RecommendationPriority;

  @Column({
    type: 'enum',
    enum: RecommendationStatus,
    enumName: 'recommendation_status_enum',
    default: RecommendationStatus.PENDING,
  })
  status: RecommendationStatus;

  @Column({
    type: 'enum',
    enum: RecommendationSource,
    enumName: 'recommendation_source_enum',
    default: RecommendationSource.RULE_BASED,
  })
  source: RecommendationSource;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deleted_at: Date | null;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('User', 'recommendations', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('Skill', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'skill_id' })
  skill: Skill | null;

  @ManyToOne('ExamSection', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'exam_section_id' })
  exam_section: ExamSection | null;
}
