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

@Entity('spotify_connections')
export class SpotifyConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  user_id: string;

  @Column({ type: 'varchar', length: 255 })
  spotify_user_id: string;

  @Column({ type: 'text' })
  access_token_encrypted: string;

  @Column({ type: 'text' })
  refresh_token_encrypted: string;

  @Column({ type: 'timestamp with time zone' })
  token_expires_at: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  scope: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @OneToOne('User')
  @JoinColumn({ name: 'user_id' })
  user: User;
}
