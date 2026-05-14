import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import type { User } from './User';

@Entity('notification_preferences')
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  user_id: string;

  @Column({ type: 'boolean', default: false })
  study_reminders_enabled: boolean;

  @Column({ type: 'boolean', default: false })
  weekly_summary_enabled: boolean;

  @Column({ type: 'varchar', length: 10, nullable: true })
  reminder_time: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  timezone: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @OneToOne('User', 'notification_preference')
  @JoinColumn({ name: 'user_id' })
  user: User;
}
