import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { TripProcessingError } from './trip-processing-error.entity';

export enum TripProcessingStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED'
}

@Entity('trip_processing_logs')
export class TripProcessingLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  toteId: string;

  @Column({ type: 'varchar', length: 255 })
  olpn: string;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @Column({
    type: 'enum',
    enum: TripProcessingStatus,
    default: TripProcessingStatus.FAILED
  })
  status: TripProcessingStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  workflowType: string; // 'SINGLE_THREADED' or 'MULTIPROCESS'

  @Column({ type: 'int', default: 0 })
  processingTimeMs: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => TripProcessingError, error => error.tripProcessingLog)
  errors: TripProcessingError[];
} 