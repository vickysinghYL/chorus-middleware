import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Like } from 'typeorm';
import { ChorusErrorLog } from '../entities/chorus-error-log.entity';

export interface ErrorLogData {
  endpoint: string;
  errorType: string;
  statusCode: number;
  errorMessage: string;
  requestPayload?: any;
  toteId?: string;
  olpn?: string;
}

@Injectable()
export class ErrorLogService {
  private readonly logger = new Logger(ErrorLogService.name);

  constructor(
    @InjectRepository(ChorusErrorLog)
    private errorLogRepository: Repository<ChorusErrorLog>,
  ) {}

  async createErrorLog(errorData: ErrorLogData): Promise<ChorusErrorLog> {
    try {
      const errorLog = this.errorLogRepository.create({
        ...errorData,
        requestPayload: errorData.requestPayload ? JSON.stringify(errorData.requestPayload) : null,
      });

      const savedLog = await this.errorLogRepository.save(errorLog);
      this.logger.log(`Error log created with ID: ${savedLog.id}`);
      return savedLog;
    } catch (error) {
      this.logger.error('Failed to create error log:', error);
      throw error;
    }
  }

  async findAll(
    page: number = 1,
    limit: number = 50,
    filters?: {
      errorType?: string;
      endpoint?: string;
      toteId?: string;
      olpn?: string;
      startDate?: Date;
      endDate?: Date;
    }
  ): Promise<{ logs: ChorusErrorLog[]; total: number }> {
    const queryBuilder = this.errorLogRepository.createQueryBuilder('log');

    // Apply filters
    if (filters?.errorType) {
      queryBuilder.andWhere('log.errorType = :errorType', { errorType: filters.errorType });
    }

    if (filters?.endpoint) {
      queryBuilder.andWhere('log.endpoint LIKE :endpoint', { endpoint: `%${filters.endpoint}%` });
    }

    if (filters?.toteId) {
      queryBuilder.andWhere('log.toteId = :toteId', { toteId: filters.toteId });
    }

    if (filters?.olpn) {
      queryBuilder.andWhere('log.olpn = :olpn', { olpn: filters.olpn });
    }

    if (filters?.startDate && filters?.endDate) {
      queryBuilder.andWhere('log.timestamp BETWEEN :startDate AND :endDate', {
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
    }

    // Order by timestamp descending (newest first)
    queryBuilder.orderBy('log.timestamp', 'DESC');

    // Apply pagination
    const offset = (page - 1) * limit;
    queryBuilder.skip(offset).take(limit);

    const [logs, total] = await queryBuilder.getManyAndCount();

    return { logs, total };
  }

  async findById(id: number): Promise<ChorusErrorLog | null> {
    return this.errorLogRepository.findOne({ where: { id } });
  }

  async findByToteId(toteId: string): Promise<ChorusErrorLog[]> {
    return this.errorLogRepository.find({
      where: { toteId },
      order: { timestamp: 'DESC' },
    });
  }

  async findByOlpn(olpn: string): Promise<ChorusErrorLog[]> {
    return this.errorLogRepository.find({
      where: { olpn },
      order: { timestamp: 'DESC' },
    });
  }

  async findByWorkflow(workflowName: string): Promise<ChorusErrorLog[]> {
    return this.errorLogRepository.find({
      where: { errorType: 'WORKFLOW_ERROR' },
      order: { timestamp: 'DESC' },
    });
  }

  async getErrorStats(): Promise<{
    total: number;
    byErrorType: { [key: string]: number };
    byEndpoint: { [key: string]: number };
  }> {
    const total = await this.errorLogRepository.count();

    // Get error type distribution
    const errorTypeStats = await this.errorLogRepository
      .createQueryBuilder('log')
      .select('log.errorType', 'errorType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('log.errorType')
      .getRawMany();

    const byErrorType = errorTypeStats.reduce((acc, stat) => {
      acc[stat.errorType] = parseInt(stat.count);
      return acc;
    }, {});

    // Get endpoint distribution
    const endpointStats = await this.errorLogRepository
      .createQueryBuilder('log')
      .select('log.endpoint', 'endpoint')
      .addSelect('COUNT(*)', 'count')
      .groupBy('log.endpoint')
      .getRawMany();

    const byEndpoint = endpointStats.reduce((acc, stat) => {
      acc[stat.endpoint] = parseInt(stat.count);
      return acc;
    }, {});

    return {
      total,
      byErrorType,
      byEndpoint,
    };
  }

  async deleteOldLogs(daysOld: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.errorLogRepository
      .createQueryBuilder()
      .delete()
      .where('timestamp < :cutoffDate', { cutoffDate })
      .execute();

    return result.affected || 0;
  }
} 