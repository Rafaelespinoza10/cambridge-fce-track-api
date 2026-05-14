import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { ScoreType } from './enums';
import type { Skill } from './Skill';
import type { ExamSection } from './ExamSection';
import type { PlannedActivity } from './PlannedActivity';

@Entity('activity_templates')
export class ActivityTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  skill_id: string;

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
  })
  score_type: ScoreType;

  @Column({ type: 'integer', nullable: true })
  default_duration_minutes: number | null;

  @Column({ type: 'integer', nullable: true })
  max_score: number | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('Skill', 'activity_templates', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'skill_id' })
  skill: Skill;

  @ManyToOne('ExamSection', 'activity_templates', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'exam_section_id' })
  exam_section: ExamSection | null;

  @OneToMany('PlannedActivity', 'activity_template')
  planned_activities: PlannedActivity[];
}
