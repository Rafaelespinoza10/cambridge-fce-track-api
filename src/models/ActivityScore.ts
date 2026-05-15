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
import { ScoreType, DifficultyLevel } from './enums';
import type { User } from './User';
import type { PlannedActivity } from './PlannedActivity';
import type { Skill } from './Skill';
import type { ExamSection } from './ExamSection';
import type { ActivityScoreDetail } from './ActivityScoreDetail';
import type { EvidenceFile } from './EvidenceFile';

@Entity('activity_scores')
export class ActivityScore {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid', nullable: true })
  planned_activity_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  skill_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  exam_section_id: string | null;

  @Column({
    type: 'enum',
    enum: ScoreType,
    enumName: 'score_type_enum',
  })
  score_type: ScoreType;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  raw_score: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  max_score: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  percentage: string | null;

  @Column({ type: 'integer', nullable: true })
  correct_answers: number | null;

  @Column({ type: 'integer', nullable: true })
  total_questions: number | null;

  @Column({ type: 'integer', nullable: true })
  time_spent_minutes: number | null;

  @Column({
    type: 'enum',
    enum: DifficultyLevel,
    enumName: 'difficulty_level_enum',
    nullable: true,
  })
  difficulty: DifficultyLevel | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'timestamp with time zone' })
  attempted_at: Date;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deleted_at: Date | null;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('User', 'activity_scores', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('PlannedActivity', 'activity_scores', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'planned_activity_id' })
  planned_activity: PlannedActivity | null;

  @ManyToOne('Skill', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'skill_id' })
  skill: Skill | null;

  @ManyToOne('ExamSection', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'exam_section_id' })
  exam_section: ExamSection | null;

  @OneToMany('ActivityScoreDetail', 'activity_score')
  score_details: ActivityScoreDetail[];

  @OneToMany('EvidenceFile', 'activity_score')
  evidence_files: EvidenceFile[];
}
