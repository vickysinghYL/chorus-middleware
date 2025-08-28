import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ChorusApiService } from './chorus-api.service';
import { TripProcessingLogService } from './trip-processing-log.service';
import { CronJobEnum } from 'src/enums/cron.enum';

interface ApiResponse {
  summary: {
    dateRange: string;
    totalUniqueAssociations: number;
    generatedAt: string;
  };
  tripData: Array<{
    toteId: string;
    olpn: string;
    timestamp: string;
  }>;
}

interface TripData {
  toteId: string;
  olpn: string;
  timestamp: string;
}

@Injectable()
export class CronJobService {
  private readonly logger = new Logger(CronJobService.name);
  private readonly API_BASE_URL = 'http://3.91.8.133:3000';

  constructor(
    private readonly httpService: HttpService,
    private readonly chorusApiService: ChorusApiService,
    private readonly tripProcessingLogService: TripProcessingLogService,
  ) {}

  /**
   * Cron job that runs every hour
   * Fetches data from the last hour and processes it
   */
  @Cron(CronJobEnum.EVERY_HOUR)
  async handleCronJob() {
    this.logger.log('Starting scheduled cron job - fetching last hour of data (with overlap)');
    
    try {
      // Calculate date range for last hour in UTC with overlap buffer and safety lag
      // Start = now - 65 minutes (overlap), End = now - 5 minutes (lag)
      const now = new Date();
      const startWindow = new Date(now.getTime() - 65 * 60 * 1000);
      const endWindow = new Date(now.getTime() - 5 * 60 * 1000);
      
      const startDate = startWindow.toISOString().split('T')[0];
      const startTime = startWindow.toISOString().split('T')[1].substring(0, 5);
      const endDate = endWindow.toISOString().split('T')[0];
      const endTime = endWindow.toISOString().split('T')[1].substring(0, 5);
      
      this.logger.log(`Fetching data from ${startDate}T${startTime} to ${endDate}T${endTime} UTC`);
      
      // Fetch data from API
      const apiData = await this.fetchDataFromApi(startDate, startTime, endDate, endTime);
      
      if (!apiData || !apiData.tripData || apiData.tripData.length === 0) {
        this.logger.log('No trip data found in the specified time range');
        return;
      }
      
      this.logger.log(`Found ${apiData.tripData.length} trip data entries`);
      
      // Filter out existing records
      const newTripData = await this.filterNewTripData(apiData.tripData);
      
      if (newTripData.length === 0) {
        this.logger.log('All trip data entries already exist in database');
        return;
      }
      
      this.logger.log(`Found ${newTripData.length} new trip data entries to process`);
      
      // Process the new trip data
      const result = await this.chorusApiService.executeTripWorkflow(newTripData);
      
      this.logger.log(`Cron job completed successfully`);
      this.logger.log(`Processed: ${result.summary.processed}, Errors: ${result.summary.errors}`);
      
    } catch (error) {
      this.logger.error('Cron job failed:', error);
    }
  }

  /**
   * Fetch data from the API with the specified date range
   */
  private async fetchDataFromApi(
    startDate: string,
    startTime: string,
    endDate: string,
    endTime: string
  ): Promise<ApiResponse> {
    const startDatetime = `${startDate}T${startTime}:00.000Z`;
    const endDatetime = `${endDate}T${endTime}:59.999Z`;
    
    this.logger.log(`Fetching data from API: ${startDatetime} to ${endDatetime}`);
    
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.API_BASE_URL}/api/associations`, {
          params: {
            page: 1,
            limit: 150000,
            includeIncomplete: true
          }
        })
      );

      // Process the response using jq-like logic
      const processedData = this.processApiResponse(response.data, startDatetime, endDatetime);
      
      this.logger.log(`API response processed: ${processedData.tripData.length} valid entries`);
      
      return processedData;
      
    } catch (error) {
      this.logger.error('Failed to fetch data from API:', error);
      throw error;
    }
  }

  /**
   * Process API response similar to the jq logic in the shell script
   */
  private processApiResponse(data: any, startDatetime: string, endDatetime: string): ApiResponse {
    // Extract data array (handle both direct array and nested data property)
    const dataArray = data.data || data;
    
    if (!Array.isArray(dataArray)) {
      throw new Error('Invalid API response format');
    }
    
    // Filter and validate data
    const filteredData = dataArray.filter(item => {
      // Check tote_id pattern: 3 letters-3 letters-5 digits
      const toteIdPattern = /^[a-zA-Z]{3}-[a-zA-Z]{3}-[0-9]{5}$/;
      if (!toteIdPattern.test(item.tote_id || '')) {
        return false;
      }
      
      // Check olpn pattern: 8-20 digits
      const olpnPattern = /^[0-9]{20}$/;
      if (!olpnPattern.test(item.olpn || '')) {
        return false;
      }
      
      // Check timestamp is within range
      const timestamp = item.timestamp;
      if (!timestamp || timestamp < startDatetime || timestamp > endDatetime) {
        return false;
      }
      
      return true;
    });
    
    // Sort by timestamp and remove duplicates by tote_id
    const sortedData = filteredData.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    // Remove duplicates by tote_id (keep first occurrence)
    const uniqueData = sortedData.filter((item, index, self) => 
      index === self.findIndex(t => t.tote_id === item.tote_id)
    );
    
    // Transform to expected format
    const tripData = uniqueData.map(item => ({
      toteId: item.tote_id,
      olpn: item.olpn,
      timestamp: item.timestamp
    }));
    
    return {
      summary: {
        dateRange: `${startDatetime} to ${endDatetime}`,
        totalUniqueAssociations: tripData.length,
        generatedAt: new Date().toISOString().replace('T', ' ').replace('Z', ' UTC')
      },
      tripData
    };
  }

  /**
   * Filter out trip data that already exists in the database
   */
  private async filterNewTripData(tripData: TripData[]): Promise<TripData[]> {
    const newTripData: TripData[] = [];
    
    for (const trip of tripData) {
      try {
        const isDuplicate = await this.tripProcessingLogService.isTripDataDuplicate(
          trip.toteId, 
          trip.olpn, 
          trip.timestamp
        );
        
        if (!isDuplicate) {
          newTripData.push(trip);
        } else {
          this.logger.debug(`Skipping duplicate trip data: ${trip.toteId}/${trip.olpn}/${trip.timestamp}`);
        }
      } catch (error) {
        this.logger.error(`Error checking duplicate for trip data ${trip.toteId}/${trip.olpn}:`, error);
        // Continue with other records even if one fails
      }
    }
    
    return newTripData;
  }

  /**
   * Manual trigger for testing purposes
   */
  async triggerManualJob() {
    this.logger.log('Manual cron job triggered');
    await this.handleCronJob();
  }
}
