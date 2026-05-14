import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { ScoreType } from './enums';
import type { User } from './User';
import type { Skill } from './Skill';
import type { ExamSection } from './ExamSection';
import type { PlannedActivity } from './PlannedActivity';

@Entity('custom_activities')
export class CustomActivity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid', nullable: true })
  skill_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  exam_section_id: string | null;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: ScoreType,
    enumName: 'score_type_enum',
    nullable: true,
  })
  score_type: ScoreType | null;

  @Column({ type: 'integer', nullable: true })
  default_duration_minutes: number | null;

  @Column({ type: 'integer', nullable: true })
  max_score: number | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deleted_at: Date | null;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('User', 'custom_activities', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('Skill', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'skill_id' })
  skill: Skill | null;

  @ManyToOne('ExamSection', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'exam_section_id' })
  exam_section: ExamSection | null;

  @OneToMany('PlannedActivity', 'custom_activity')
  planned_activities: PlannedActivity[];
}
