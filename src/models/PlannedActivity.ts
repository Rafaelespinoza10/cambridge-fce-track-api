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
import { ActivityPriority, PlannedActivityStatus } from './enums';
import type { PlanDay } from './PlanDay';
import type { ActivityTemplate } from './ActivityTemplate';
import type { CustomActivity } from './CustomActivity';
import type { Skill } from './Skill';
import type { ExamSection } from './ExamSection';
import type { ActivityScore } from './ActivityScore';
import type { StudySession } from './StudySession';
import type { EvidenceFile } from './EvidenceFile';

@Entity('planned_activities')
export class PlannedActivity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  plan_day_id: string;

  @Column({ type: 'uuid', nullable: true })
  activity_template_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  custom_activity_id: string | null;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'uuid', nullable: true })
  skill_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  exam_section_id: string | null;

  @Column({ type: 'integer', default: 0 })
  scheduled_order: number;

  @Column({ type: 'integer', nullable: true })
  estimated_duration_minutes: number | null;

  @Column({
    type: 'enum',
    enum: ActivityPriority,
    enumName: 'activity_priority_enum',
    default: ActivityPriority.MEDIUM,
  })
  priority: ActivityPriority;

  @Column({
    type: 'enum',
    enum: PlannedActivityStatus,
    enumName: 'planned_activity_status_enum',
    default: PlannedActivityStatus.PENDING,
  })
  status: PlannedActivityStatus;

  @Column({ type: 'timestamp with time zone', nullable: true })
  scheduled_at: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  completed_at: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deleted_at: Date | null;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('PlanDay', 'planned_activities', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_day_id' })
  plan_day: PlanDay;

  @ManyToOne('ActivityTemplate', 'planned_activities', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'activity_template_id' })
  activity_template: ActivityTemplate | null;

  @ManyToOne('CustomActivity', 'planned_activities', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'custom_activity_id' })
  custom_activity: CustomActivity | null;

  @ManyToOne('Skill', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'skill_id' })
  skill: Skill | null;

  @ManyToOne('ExamSection', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'exam_section_id' })
  exam_section: ExamSection | null;

  @OneToMany('ActivityScore', 'planned_activity')
  activity_scores: ActivityScore[];

  @OneToMany('StudySession', 'planned_activity')
  study_sessions: StudySession[];

  @OneToMany('EvidenceFile', 'planned_activity')
  evidence_files: EvidenceFile[];
}
