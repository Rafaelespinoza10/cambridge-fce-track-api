import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToMany,
} from 'typeorm';
import type { ExamSection } from './ExamSection';
import type { ActivityTemplate } from './ActivityTemplate';
import type { Resource } from './Resource';

@Entity('skills')
export class Skill {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @OneToMany('ExamSection', 'skill')
  exam_sections: ExamSection[];

  @OneToMany('ActivityTemplate', 'skill')
  activity_templates: ActivityTemplate[];

  @ManyToMany('Resource', 'skills')
  resources: Resource[];
}
