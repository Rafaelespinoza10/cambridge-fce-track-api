import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type {
  PracticeLocale,
  PracticeInsights,
  PracticeRecommendation as RecommendationDto,
} from '../interfaces/practice/practice-adaptive.interface';
export enum PracticeRecommendationStatus {
  PENDING = 'pending',
  READY = 'ready',
  FAILED = 'failed',
}
@Entity('practice_recommendations')
@Index(
  'uq_practice_recommendations_snapshot',
  ['user_id', 'snapshot_hash', 'locale', 'prompt_version'],
  { unique: true },
)
export class PracticeRecommendation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) user_id: string;
  @Column({ type: 'char', length: 64 }) snapshot_hash: string;
  @Column({ type: 'varchar', length: 2 }) locale: PracticeLocale;
  @Column({ type: 'varchar', length: 100 }) prompt_version: string;
  @Column({
    type: 'enum',
    enum: PracticeRecommendationStatus,
    enumName: 'practice_recommendation_status_enum',
  })
  status: PracticeRecommendationStatus;
  @Column({ type: 'jsonb' }) insights_snapshot: PracticeInsights;
  @Column({ type: 'jsonb', nullable: true }) recommendation: RecommendationDto | null;
  @CreateDateColumn({ type: 'timestamp with time zone' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamp with time zone' }) updated_at: Date;
}
