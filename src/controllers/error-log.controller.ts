import { Controller, Get, Delete, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ErrorLogService } from '../services/error-log.service';
import { ChorusErrorLog } from '../entities/chorus-error-log.entity';

@Controller('error-logs')
export class ErrorLogController {
  constructor(private readonly errorLogService: ErrorLogService) {}

  @Get()
  async getErrorLogs(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
    @Query('errorType') errorType?: string,
    @Query('endpoint') endpoint?: string,
    @Query('toteId') toteId?: string,
    @Query('olpn') olpn?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    const filters: any = {};
    if (errorType) filters.errorType = errorType;
    if (endpoint) filters.endpoint = endpoint;
    if (toteId) filters.toteId = toteId;
    if (olpn) filters.olpn = olpn;
    if (startDate) filters.startDate = new Date(startDate);
    if (endDate) filters.endDate = new Date(endDate);

    return this.errorLogService.findAll(pageNum, limitNum, filters);
  }

  @Get('stats')
  async getErrorStats() {
    return this.errorLogService.getErrorStats();
  }

  @Get(':id')
  async getErrorLogById(@Param('id', ParseIntPipe) id: number) {
    const errorLog = await this.errorLogService.findById(id);
    if (!errorLog) {
      return { message: 'Error log not found' };
    }
    return errorLog;
  }

  @Get('tote/:toteId')
  async getErrorLogsByToteId(@Param('toteId') toteId: string) {
    return this.errorLogService.findByToteId(toteId);
  }

  @Get('olpn/:olpn')
  async getErrorLogsByOlpn(@Param('olpn') olpn: string) {
    return this.errorLogService.findByOlpn(olpn);
  }

  @Get('workflow/:workflowName')
  async getErrorLogsByWorkflow(@Param('workflowName') workflowName: string) {
    return this.errorLogService.findByWorkflow(workflowName);
  }

  @Delete('cleanup')
  async deleteOldLogs(@Query('daysOld') daysOld: string = '30') {
    const daysOldNum = parseInt(daysOld, 10);
    const deletedCount = await this.errorLogService.deleteOldLogs(daysOldNum);
    return { 
      message: `Deleted ${deletedCount} old error logs`,
      deletedCount 
    };
  }
} 