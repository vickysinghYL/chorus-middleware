import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
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

  async getFailedLogsByDate(date: string): Promise<TripProcessingLog[]> {
    // Parse the date string and create date range for the entire day
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);
    
    return await this.tripProcessingLogRepository.find({
      where: {
        status: TripProcessingStatus.FAILED,
        createdAt: Between(startDate, endDate)
      },
      order: { createdAt: 'ASC' },
      relations: ['errors']
    });
  }

  /**
   * Get all processing logs by OLPN
   */
  async getLogsByOlpn(olpn: string): Promise<TripProcessingLog[]> {
    return await this.tripProcessingLogRepository.find({
      where: { olpn },
      order: { createdAt: 'DESC' },
      relations: ['errors']
    });
  }

  /**
   * Get dashboard statistics
   */
  async getDashboardStats(): Promise<{
    totalErrors: number;
    duplicateOlpn: number;
    assetNotFound: number;
    totalProcessed: number;
    successful: number;
    failed: number;
  }> {
    // Get total processed logs
    const totalProcessed = await this.tripProcessingLogRepository.count();
    
    // Get successful and failed counts
    const [successful, failed] = await Promise.all([
      this.tripProcessingLogRepository.count({ where: { status: TripProcessingStatus.SUCCESS } }),
      this.tripProcessingLogRepository.count({ where: { status: TripProcessingStatus.FAILED } })
    ]);

    // Get duplicate OLPN count (OLPNs that appear more than once)
    const duplicateOlpnResult = await this.tripProcessingLogRepository
      .createQueryBuilder('log')
      .select('log.olpn', 'olpn')
      .addSelect('COUNT(*)', 'count')
      .where('log.olpn IS NOT NULL')
      .groupBy('log.olpn')
      .having('COUNT(*) > 1')
      .getRawMany();

    const duplicateOlpn = duplicateOlpnResult.reduce((total, item) => total + parseInt(item.count), 0);

    // Get asset not found errors from error details
    const assetNotFound = await this.tripProcessingErrorRepository.count({
      where: [
        { errorType: 'ASSET_NOT_FOUND' },
        { errorMessage: 'Asset not found' },
        { errorMessage: 'asset not found' },
        { errorMessage: 'Failed to start tracking' }
      ]
    });

    // Total errors includes failed logs plus specific error types
    const totalErrors = failed;

    return {
      totalErrors,
      duplicateOlpn,
      assetNotFound,
      totalProcessed,
      successful,
      failed
    };
  }

  /**
   * Get filtered logs with pagination
   */
  async getFilteredLogs(
    page: number = 1,
    limit: number = 50,
    filters?: {
      olpn?: string;
      toteId?: string;
      startDate?: Date;
      endDate?: Date;
    }
  ): Promise<{ logs: TripProcessingLog[]; total: number }> {
    const queryBuilder = this.tripProcessingLogRepository.createQueryBuilder('log');

    // Apply filters
    if (filters?.olpn) {
      queryBuilder.andWhere('log.olpn = :olpn', { olpn: filters.olpn });
    }

    if (filters?.toteId) {
      queryBuilder.andWhere('log.toteId = :toteId', { toteId: filters.toteId });
    }

    if (filters?.startDate && filters?.endDate) {
      queryBuilder.andWhere('log.createdAt BETWEEN :startDate AND :endDate', {
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
    }

    // Order by created date descending (newest first)
    queryBuilder.orderBy('log.createdAt', 'DESC');

    // Apply pagination
    const offset = (page - 1) * limit;
    queryBuilder.skip(offset).take(limit);

    // Include errors relation
    queryBuilder.leftJoinAndSelect('log.errors', 'errors');

    const [logs, total] = await queryBuilder.getManyAndCount();

    return { logs, total };
  }
} 