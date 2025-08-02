import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TripProcessingLog, TripProcessingStatus } from '../entities/trip-processing-log.entity';
import { TripProcessingError } from '../entities/trip-processing-error.entity';

interface TripData {
  toteId: string;
  olpn: string;
  timestamp: string;
}

interface ProcessingResult {
  success: boolean;
  errorMessage?: string;
  processingTimeMs: number;
  errors?: any[];
}

@Injectable()
export class TripProcessingLogService {
  private readonly logger = new Logger(TripProcessingLogService.name);

  constructor(
    @InjectRepository(TripProcessingLog)
    private tripProcessingLogRepository: Repository<TripProcessingLog>,
    @InjectRepository(TripProcessingError)
    private tripProcessingErrorRepository: Repository<TripProcessingError>
  ) {}

  /**
   * Check if OLPN already exists in the database
   */
  async isOlpnDuplicate(olpn: string): Promise<boolean> {
    const existingLog = await this.tripProcessingLogRepository.findOne({
      where: { olpn }
    });
    return !!existingLog;
  }

  /**
   * Create a new trip processing log entry
   */
  async createTripProcessingLog(
    tripData: TripData,
    workflowType: string,
    processingTimeMs: number,
    status: TripProcessingStatus,
    errorMessage?: string
  ): Promise<TripProcessingLog> {
    const log = this.tripProcessingLogRepository.create({
      toteId: tripData.toteId,
      olpn: tripData.olpn,
      timestamp: new Date(tripData.timestamp),
      status,
      errorMessage,
      workflowType,
      processingTimeMs
    });

    return await this.tripProcessingLogRepository.save(log);
  }

  /**
   * Create error entries for a trip processing log
   */
  async createTripProcessingErrors(
    tripProcessingLogId: number,
    errors: Array<{
      errorType: string;
      errorMessage: string;
      errorDetails?: string;
      step?: string;
      requestPayload?: any;
    }>
  ): Promise<TripProcessingError[]> {
    const errorEntities = errors.map(error => 
      this.tripProcessingErrorRepository.create({
        tripProcessingLogId,
        errorType: error.errorType,
        errorMessage: error.errorMessage,
        errorDetails: error.errorDetails,
        step: error.step,
        requestPayload: error.requestPayload
      })
    );

    return await this.tripProcessingErrorRepository.save(errorEntities);
  }

  /**
   * Process a single trip data with duplicate checking and logging
   */
  async processTripData(
    tripData: TripData,
    workflowType: string,
    processingFunction: (tripData: TripData) => Promise<ProcessingResult>
  ): Promise<ProcessingResult> {
    const startTime = Date.now();
    
    try {
      // Check for duplicate OLPN
      const isDuplicate = await this.isOlpnDuplicate(tripData.olpn);
      
      if (isDuplicate) {
        const processingTimeMs = Date.now() - startTime;
        
        // Create log entry for duplicate OLPN with FAILED status
        const log = await this.createTripProcessingLog(
          tripData,
          workflowType,
          processingTimeMs,
          TripProcessingStatus.FAILED,
          'Duplicate OLPN found in database'
        );

        // Create error entry
        await this.createTripProcessingErrors(log.id, [{
          errorType: 'DUPLICATE_OLPN',
          errorMessage: 'Duplicate OLPN found in database',
          errorDetails: `OLPN ${tripData.olpn} already exists in the processing logs`,
          step: 'Duplicate Check',
          requestPayload: tripData
        }]);

        this.logger.warn(`Duplicate OLPN detected: ${tripData.olpn}`);
        
        return {
          success: false,
          errorMessage: 'Duplicate OLPN found in database',
          processingTimeMs
        };
      }

      // Process the trip data
      const result = await processingFunction(tripData);
      const processingTimeMs = Date.now() - startTime;

      // Create log entry
      const status = result.success ? TripProcessingStatus.SUCCESS : TripProcessingStatus.FAILED;
      const log = await this.createTripProcessingLog(
        tripData,
        workflowType,
        processingTimeMs,
        status,
        result.errorMessage
      );

      // Create error entries if any
      if (result.errors && result.errors.length > 0) {
        await this.createTripProcessingErrors(log.id, result.errors);
      }

      return {
        ...result,
        processingTimeMs
      };

    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      
      this.logger.error(`Error processing trip data ${tripData.toteId}/${tripData.olpn}:`, error);

      // Create log entry for unexpected error
      const log = await this.createTripProcessingLog(
        tripData,
        workflowType,
        processingTimeMs,
        TripProcessingStatus.FAILED,
        error.message
      );

      // Create error entry
      await this.createTripProcessingErrors(log.id, [{
        errorType: 'UNEXPECTED_ERROR',
        errorMessage: error.message,
        errorDetails: error.stack,
        step: 'Trip Processing',
        requestPayload: tripData
      }]);

      return {
        success: false,
        errorMessage: error.message,
        processingTimeMs
      };
    }
  }

  /**
   * Get processing statistics
   */
  async getProcessingStatistics(): Promise<{
    totalProcessed: number;
    successful: number;
    failed: number;
    duplicateOlpn: number;
  }> {
    const [totalProcessed, successful, failed, duplicateOlpn] = await Promise.all([
      this.tripProcessingLogRepository.count(),
      this.tripProcessingLogRepository.count({ where: { status: TripProcessingStatus.SUCCESS } }),
      this.tripProcessingLogRepository.count({ where: { status: TripProcessingStatus.FAILED } }),
      this.tripProcessingErrorRepository.count({ where: { errorType: 'DUPLICATE_OLPN' } })
    ]);

    return {
      totalProcessed,
      successful,
      failed,
      duplicateOlpn
    };
  }

  /**
   * Get recent processing logs
   */
  async getRecentLogs(limit: number = 50): Promise<TripProcessingLog[]> {
    return await this.tripProcessingLogRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
      relations: ['errors']
    });
  }
} 