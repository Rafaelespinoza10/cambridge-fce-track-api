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
import type { Skill } from './Skill';
import type { ActivityTemplate } from './ActivityTemplate';

@Entity('exam_sections')
export class ExamSection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  skill_id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'integer', nullable: true })
  max_score: number | null;

  @Column({ type: 'integer', nullable: true })
  default_duration_minutes: number | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('Skill', 'exam_sections', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'skill_id' })
  skill: Skill;

  @OneToMany('ActivityTemplate', 'exam_section')
  activity_templates: ActivityTemplate[];
}
