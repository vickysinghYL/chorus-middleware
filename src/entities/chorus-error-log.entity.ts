import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('chorus_error_logs')
@Index(['timestamp', 'errorType'])
@Index(['endpoint', 'timestamp'])
export class ChorusErrorLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  endpoint: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  errorType: string;

  @Column({ type: 'int', nullable: true })
  statusCode: number;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @Column({ type: 'text', nullable: true })
  requestPayload: string;


  @Column({ type: 'varchar', length: 255, nullable: true })
  toteId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  olpn: string;

  @CreateDateColumn()
  timestamp: Date;

  @UpdateDateColumn()
  updatedAt: Date;
} 