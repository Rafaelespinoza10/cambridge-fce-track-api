import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { EnglishLevel, TargetExam } from './enums';
import type { User } from './User';

@Entity('user_profiles')
export class UserProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  user_id: string;

  @Column({
    type: 'enum',
    enum: EnglishLevel,
    enumName: 'english_level_enum',
    nullable: true,
  })
  current_level: EnglishLevel | null;

  @Column({
    type: 'enum',
    enum: TargetExam,
    enumName: 'target_exam_enum',
    nullable: true,
  })
  target_exam: TargetExam | null;

  @Column({ type: 'integer', nullable: true })
  target_score: number | null;

  @Column({ type: 'date', nullable: true })
  target_date: string | null;

  @Column({ type: 'integer', nullable: true })
  study_days_per_week: number | null;

  @Column({ type: 'integer', nullable: true })
  daily_study_minutes: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  timezone: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @OneToOne('User', 'profile')
  @JoinColumn({ name: 'user_id' })
  user: User;
}
