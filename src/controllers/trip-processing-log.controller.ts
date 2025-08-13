import { Controller, Get, Post, Query, Param, Body, HttpStatus, HttpException, Res } from '@nestjs/common';
import { TripProcessingLogService } from '../services/trip-processing-log.service';
import { TripProcessingStatus } from '../entities/trip-processing-log.entity';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';

interface TripDataDto {
  toteId: string;
  olpn: string;
  timestamp: string;
}

interface BulkInsertRequestDto {
  tripData: TripDataDto[];
}

interface ApiResponseDto<T = any> {
  success: boolean;
  result?: T;
  error?: string;
}

enum FilterType {
  ALL = 'all',
  OLPN = 'olpn',
  TOTE_ID = 'toteId',
  DATE = 'date',
  DATE_RANGE = 'dateRange'
}

@Controller('trip-processing-logs')
export class TripProcessingLogController {
  constructor(private readonly tripProcessingLogService: TripProcessingLogService) {}

  @Post('/bulk-insert-success')
  async bulkInsertSuccess(@Body() request: BulkInsertRequestDto): Promise<ApiResponseDto> {
    try {
      // Validate input
      if (!request.tripData || !Array.isArray(request.tripData) || request.tripData.length === 0) {
        throw new HttpException(
          'Invalid request: tripData must be a non-empty array',
          HttpStatus.BAD_REQUEST
        );
      }

      // Validate each trip data entry
      for (let i = 0; i < request.tripData.length; i++) {
        const tripData = request.tripData[i];
        if (!tripData.toteId || !tripData.olpn || !tripData.timestamp) {
          throw new HttpException(
            `Invalid trip data at index ${i}: toteId, olpn, and timestamp are required`,
            HttpStatus.BAD_REQUEST
          );
        }

        // Validate timestamp format
        if (isNaN(Date.parse(tripData.timestamp))) {
          throw new HttpException(
            `Invalid timestamp format at index ${i}: ${tripData.timestamp}`,
            HttpStatus.BAD_REQUEST
          );
        }
      }

      const workflowType = 'MANUAL_INSERT';
      
      console.log(`Bulk inserting ${request.tripData.length} trip processing logs with SUCCESS status`);
      console.log('Workflow type:', workflowType);

      // Determine optimal number of workers based on CPU cores
      const cpuCores = require('os').cpus().length;
      const maxWorkers = Math.min(cpuCores, 10); // Use 2 workers for 2 CPU server
      const chunkSize = Math.ceil(request.tripData.length / maxWorkers);
      
      console.log(`Using ${maxWorkers} workers for parallel processing`);
      console.log(`Chunk size per worker: ${chunkSize}`);
      
      // Create chunks for parallel processing
      const chunks = [];
      for (let i = 0; i < request.tripData.length; i += chunkSize) {
        chunks.push(request.tripData.slice(i, i + chunkSize));
      }
      
      console.log(`Created ${chunks.length} chunks for parallel processing`);
      
      // Process chunks in parallel
      const chunkResults = await Promise.all(
        chunks.map(async (chunk, chunkIndex) => {
          console.log(`Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length} entries`);
          
          const chunkResults = await Promise.all(
            chunk.map(async (tripData, index) => {
              const globalIndex = chunkIndex * chunkSize + index;
              
              try {
                const processingTimeMs = 0; // Manual insert, no actual processing time
                
                const log = await this.tripProcessingLogService.createTripProcessingLog(
                  tripData,
                  workflowType,
                  processingTimeMs,
                  TripProcessingStatus.SUCCESS
                );

                return {
                  index: globalIndex + 1,
                  toteId: tripData.toteId,
                  olpn: tripData.olpn,
                  status: 'SUCCESS',
                  logId: log.id,
                  worker: chunkIndex + 1
                };
              } catch (error) {
                return {
                  index: globalIndex + 1,
                  toteId: tripData.toteId,
                  olpn: tripData.olpn,
                  status: 'FAILED',
                  error: error.message,
                  worker: chunkIndex + 1
                };
              }
            })
          );
          
          console.log(`Completed chunk ${chunkIndex + 1}/${chunks.length} - Processed: ${chunkResults.filter(r => r.status === 'SUCCESS').length}, Failed: ${chunkResults.filter(r => r.status === 'FAILED').length}`);
          
          return chunkResults;
        })
      );
      
      // Flatten results from all chunks
      const results = chunkResults.flat();

      // Calculate summary
      const successful = results.filter(r => r.status === 'SUCCESS').length;
      const failed = results.filter(r => r.status === 'FAILED').length;

      return {
        success: failed === 0,
        result: {
          totalRequested: request.tripData.length,
          successful,
          failed,
          results
        }
      };

    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        `Failed to bulk insert trip processing logs: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('/statistics')
  async getProcessingStatistics(): Promise<ApiResponseDto> {
    try {
      const statistics = await this.tripProcessingLogService.getProcessingStatistics();
      
      return { 
        success: true, 
        result: statistics 
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get processing statistics: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('/dashboard-stats')
  async getDashboardStats(): Promise<ApiResponseDto> {
    try {
      const stats = await this.tripProcessingLogService.getDashboardStats();
      
      return {
        success: true,
        result: stats
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get dashboard statistics: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('/logs')
  async getProcessingLogs(
    @Query('skip') skip: number = 0,
    @Query('limit') limit: number = 50,
    @Query('filterType') filterType: FilterType = FilterType.ALL,
    @Query('value') value?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<ApiResponseDto> {
    try {
      if (skip < 0) {
        throw new HttpException('Skip must be a non-negative number', HttpStatus.BAD_REQUEST);
      }

      if (limit < 1 || limit > 1000) {
        throw new HttpException('Limit must be between 1 and 1000', HttpStatus.BAD_REQUEST);
      }

      const filters: any = {};

      switch (filterType) {
        case FilterType.ALL:
          // No additional filters needed
          break;
        case FilterType.OLPN:
          if (!value) {
            throw new HttpException('OLPN value is required for OLPN filter', HttpStatus.BAD_REQUEST);
          }
          filters.olpn = value;
          break;
        case FilterType.TOTE_ID:
          if (!value) {
            throw new HttpException('Tote ID value is required for Tote ID filter', HttpStatus.BAD_REQUEST);
          }
          filters.toteId = value;
          break;
        case FilterType.DATE:
          if (!value) {
            throw new HttpException('Date value is required for date filter', HttpStatus.BAD_REQUEST);
          }
          const date = new Date(value);
          if (isNaN(date.getTime())) {
            throw new HttpException('Invalid date format', HttpStatus.BAD_REQUEST);
          }
          filters.startDate = date;
          filters.endDate = new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1); // End of day
          break;
        case FilterType.DATE_RANGE:
          if (!startDate || !endDate) {
            throw new HttpException('Start date and end date are required for date range filter', HttpStatus.BAD_REQUEST);
          }
          const start = new Date(startDate);
          const end = new Date(endDate);
          if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            throw new HttpException('Invalid date format', HttpStatus.BAD_REQUEST);
          }
          if (start > end) {
            throw new HttpException('Start date cannot be after end date', HttpStatus.BAD_REQUEST);
          }
          filters.startDate = start;
          filters.endDate = end;
          break;
        default:
          throw new HttpException('Invalid filter type', HttpStatus.BAD_REQUEST);
      }

      // Calculate page number for serial number calculation
      const pageNum = Math.floor(skip / limit) + 1;
      const result = await this.tripProcessingLogService.getFilteredLogs(pageNum, limit, filters);
      
      return {
        success: true,
        result: {
          logs: result.logs.map((log, index) => ({
            sno: skip + index + 1,
            toteId: log.toteId,
            olpn: log.olpn,
            timestamp: log.timestamp,
            status: log.status,
            errorMessage: log.errorMessage || 'N/A',
            errorDet: log.errors && log.errors.length > 0 ? log.errors[0].errorType : 'N/A',
            workflowType: log.workflowType,
            processingTimeMs: log.processingTimeMs,
            createdAt: log.createdAt,
            updatedAt: log.updatedAt,
            errors: log.errors?.map(error => ({
              id: error.id,
              errorType: error.errorType,
              errorMessage: error.errorMessage,
              errorDetails: error.errorDetails,
              step: error.step,
              createdAt: error.createdAt
            })) || []
          })),
          total: result.total,
          skip: skip,
          limit: limit,
          totalPages: Math.ceil(result.total / limit)
        }
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        `Failed to get processing logs: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('/export')
  async exportLogsToExcel(
    @Query('filterType') filterType: FilterType = FilterType.ALL,
    @Query('value') value?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<ApiResponseDto> {
    try {
      const filters: any = {};

      switch (filterType) {
        case FilterType.ALL:
          // No additional filters needed
          break;
        case FilterType.OLPN:
          if (!value) {
            throw new HttpException('OLPN value is required for OLPN filter', HttpStatus.BAD_REQUEST);
          }
          filters.olpn = value;
          break;
        case FilterType.TOTE_ID:
          if (!value) {
            throw new HttpException('Tote ID value is required for Tote ID filter', HttpStatus.BAD_REQUEST);
          }
          filters.toteId = value;
          break;
        case FilterType.DATE:
          if (!value) {
            throw new HttpException('Date value is required for date filter', HttpStatus.BAD_REQUEST);
          }
          const date = new Date(value);
          if (isNaN(date.getTime())) {
            throw new HttpException('Invalid date format', HttpStatus.BAD_REQUEST);
          }
          filters.startDate = date;
          filters.endDate = new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1); // End of day
          break;
        case FilterType.DATE_RANGE:
          if (!startDate || !endDate) {
            throw new HttpException('Start date and end date are required for date range filter', HttpStatus.BAD_REQUEST);
          }
          const start = new Date(startDate);
          const end = new Date(endDate);
          if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            throw new HttpException('Invalid date format', HttpStatus.BAD_REQUEST);
          }
          if (start > end) {
            throw new HttpException('Start date cannot be after end date', HttpStatus.BAD_REQUEST);
          }
          filters.startDate = start;
          filters.endDate = end;
          break;
        default:
          throw new HttpException('Invalid filter type', HttpStatus.BAD_REQUEST);
      }

      // Get all logs for export (no pagination)
      const result = await this.tripProcessingLogService.getFilteredLogs(1, 10000, filters);

      if (result.logs.length === 0) {
        throw new HttpException('No logs found for the specified filters', HttpStatus.NOT_FOUND);
      }

      // Prepare data for Excel export matching UI columns
      const excelData = result.logs.map((log, index) => ({
        'S.NO': index + 1,
        'TOTE ID': log.toteId || 'N/A',
        'OLPN': log.olpn || 'N/A',
        'TIMESTAMP': log.timestamp,
        'STATUS': log.status,
        'ERROR MESSAGE': log.errorMessage || 'N/A',
        'ERROR DETAILS': log.errors && log.errors.length > 0 ? log.errors[0].errorType : 'N/A',
        'PROCESSING TIME (MS)': log.processingTimeMs || 0,
        'CREATED AT': log.createdAt,
        'UPDATED AT': log.updatedAt
      }));

      // Create workbook and worksheet
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(excelData);

      // Set column widths
      const columnWidths = [
        { wch: 8 },   // S.NO
        { wch: 20 },  // TOTE ID
        { wch: 20 },  // OLPN
        { wch: 25 },  // TIMESTAMP
        { wch: 12 },  // STATUS
        { wch: 50 },  // ERROR MESSAGE
        { wch: 15 },  // ERROR DETAILS
        { wch: 20 },  // PROCESSING TIME
        { wch: 20 },  // CREATED AT
        { wch: 20 }   // UPDATED AT
      ];
      worksheet['!cols'] = columnWidths;

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Processing Logs');

      // Generate filename and path
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      const filename = `processing_logs_${filterType}_${timestamp}.xlsx`;
      const exportsDir = path.join(process.cwd(), 'exports');
      const filePath = path.join(exportsDir, filename);

      // Create exports directory if it doesn't exist
      if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
      }

      // Write file to disk
      XLSX.writeFile(workbook, filePath);

      return {
        success: true,
        result: {
          message: `Processing logs exported successfully`,
          filename: filename,
          downloadUrl: `${process.env.SERVER_URL}/trip-processing-logs/download/${filename}`,
          totalRecords: result.logs.length,
          fileSize: fs.statSync(filePath).size,
          exportDate: new Date().toISOString(),
          filterType: filterType,
          filterValue: value || 'N/A'
        }
      };

    } catch (error) {
      console.error('Error exporting logs:', error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        `Failed to export logs: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('/download/:filename')
  async downloadFile(@Param('filename') filename: string, @Res() res: Response) {
    try {
      const exportsDir = path.join(process.cwd(), 'exports');
      const filePath = path.join(exportsDir, filename);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new HttpException('File not found', HttpStatus.NOT_FOUND);
      }

      // Set headers for file download
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', fs.statSync(filePath).size);

      // Stream the file to response
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);

    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        `Failed to download file: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('/recent')
  async getRecentLogs(@Query('limit') limit: string): Promise<ApiResponseDto> {
    try {
      const limitNumber = limit ? parseInt(limit, 10) : 50;
      
      if (isNaN(limitNumber) || limitNumber < 1 || limitNumber > 1000) {
        throw new HttpException('Limit must be a number between 1 and 1000', HttpStatus.BAD_REQUEST);
      }
      
      const logs = await this.tripProcessingLogService.getRecentLogs(limitNumber);
      
      return { 
        success: true, 
        result: logs 
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        `Failed to get recent logs: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('/by-olpn/:olpn')
  async getLogsByOlpn(@Param('olpn') olpn: string): Promise<ApiResponseDto> {
    try {
      if (!olpn) {
        throw new HttpException('OLPN is required', HttpStatus.BAD_REQUEST);
      }
      
      // Validate OLPN format (basic validation)
      if (olpn.trim().length === 0) {
        throw new HttpException('OLPN cannot be empty', HttpStatus.BAD_REQUEST);
      }
      
      console.log(`Fetching logs for OLPN: ${olpn}`);
      
      const logs = await this.tripProcessingLogService.getLogsByOlpn(olpn);
      
      console.log(`Found ${logs.length} logs for OLPN: ${olpn}`);
      
      return { 
        success: true, 
        result: {
          olpn,
          totalLogs: logs.length,
          logs: logs.map(log => ({
            id: log.id,
            toteId: log.toteId,
            olpn: log.olpn,
            timestamp: log.timestamp,
            status: log.status,
            errorMessage: log.errorMessage,
            workflowType: log.workflowType,
            processingTimeMs: log.processingTimeMs,
            createdAt: log.createdAt,
            updatedAt: log.updatedAt,
            errors: log.errors?.map(error => ({
              id: error.id,
              errorType: error.errorType,
              errorMessage: error.errorMessage,
              errorDetails: error.errorDetails,
              step: error.step,
              createdAt: error.createdAt
            })) || []
          }))
        }
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      
      console.error(`Error fetching logs for OLPN ${olpn}:`, error);
      
      throw new HttpException(
        `Failed to get logs by OLPN: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('/export-failed-logs')
  async exportFailedLogsToExcel(@Query('date') date: string): Promise<ApiResponseDto> {
    try {
      // Validate date parameter
      if (!date) {
        throw new HttpException('Date parameter is required (YYYY-MM-DD format)', HttpStatus.BAD_REQUEST);
      }

      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        throw new HttpException('Invalid date format. Use YYYY-MM-DD format', HttpStatus.BAD_REQUEST);
      }

      // Validate date is valid
      const parsedDate = new Date(date);
      if (isNaN(parsedDate.getTime())) {
        throw new HttpException('Invalid date provided', HttpStatus.BAD_REQUEST);
      }

      console.log(`Exporting failed logs for date: ${date}`);

      // Get failed logs for the specified date
      const failedLogs = await this.tripProcessingLogService.getFailedLogsByDate(date);

      if (failedLogs.length === 0) {
        throw new HttpException(`No failed logs found for date: ${date}`, HttpStatus.NOT_FOUND);
      }

      console.log(`Found ${failedLogs.length} failed logs for date: ${date}`);

      // Prepare data for Excel export
      const excelData = failedLogs.map((log, index) => {
        const row = {
          'S.No': index + 1,
          'Tote ID': log.toteId,
          'OLPN': log.olpn,
          'Timestamp': log.timestamp,
          'Status': log.status,
          'Error Message': log.errorMessage || 'N/A'
        };

        // Add error details if available
        if (log.errors && log.errors.length > 0) {
          const errorDetails = log.errors.map(error => 
            `${error.errorType}: ${error.errorDetails}`
          ).join('; ');
          row['Error Details'] = errorDetails;
        } else {
          row['Error Details'] = 'N/A';
        }

        return row;
      });

      // Create workbook and worksheet
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(excelData);

      // Set column widths
      const columnWidths = [
        { wch: 8 },   // S.No
        { wch: 15 },  // Tote ID
        { wch: 15 },  // OLPN
        { wch: 20 },  // Timestamp
        { wch: 12 },  // Status
        { wch: 30 },  // Error Message
        { wch: 50 }   // Error Details
      ];
      worksheet['!cols'] = columnWidths;

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Failed Logs');

      // Generate filename and path
      const filename = `${date}_error_details.xlsx`;
      const exportsDir = path.join(process.cwd(), 'exports');
      const filePath = path.join(exportsDir, filename);

      // Create exports directory if it doesn't exist
      if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
        console.log(`Created exports directory: ${exportsDir}`);
      }

      // Write file to disk
      XLSX.writeFile(workbook, filePath);

      console.log(`Excel file saved successfully: ${filePath}`);
      console.log(`File size: ${fs.statSync(filePath).size} bytes`);

      return {
        success: true,
        result: {
          message: `Failed logs exported successfully for date: ${date}`,
          filename: filename,
          filePath: filePath,
          totalRecords: failedLogs.length,
          fileSize: fs.statSync(filePath).size,
          exportDate: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('Error exporting failed logs:', error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        `Failed to export failed logs: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
} 