import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { TripProcessingLog } from './trip-processing-log.entity';

@Entity('trip_processing_errors')
export class TripProcessingError {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  tripProcessingLogId: number;

  @Column({ type: 'varchar', length: 100 })
  errorType: string; // 'API_ERROR', 'BUSINESS_ERROR', 'DUPLICATE_OLPN', etc.

  @Column({ type: 'text' })
  errorMessage: string;

  @Column({ type: 'text', nullable: true })
  errorDetails: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  step: string; // Which step in the workflow failed

  @Column({ type: 'json', nullable: true })
  requestPayload: any;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => TripProcessingLog, tripLog => tripLog.errors)
  @JoinColumn({ name: 'tripProcessingLogId' })
  tripProcessingLog: TripProcessingLog;
} 