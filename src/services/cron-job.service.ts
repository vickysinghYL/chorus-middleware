import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ChorusApiService } from './chorus-api.service';
import { TripProcessingLogService } from './trip-processing-log.service';
import { CronJobEnum } from 'src/enums/cron.enum';

interface FilteredApiResponse {
  success: boolean;
  data: Array<{
    sequence: number;
    tote_id: string;
    olpn: string;
    first_timestamp: string;
    status: string;
  }>;
  metadata: {
    total_raw_records: number;
    datetime_filtered_records: number;
    final_filtered_records: number;
    deduplication_stats?: {
      total_raw_records: number;
      valid_pattern_records: number;
      duplicates_removed: number;
      tote_cross_contaminations: number;
      olpn_cross_contaminations: number;
      first_occurrences_kept: number;
      final_data_quality_percent: number;
    };
    data_quality_percent: number;
  };
  query_info: {
    start_datetime_utc: string;
    end_datetime_utc: string;
    processing_timestamp: string;
  };
}

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
  private readonly API_BASE_URL = 'http://3.91.8.133:4300';

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
      
      this.logger.log(`Found ${apiData.tripData.length} trip data entries from filtered API`);
      
      // Filter out existing records (API already handles deduplication, but check our database)
      const newTripData = await this.filterNewTripData(apiData.tripData);
      
      if (newTripData.length === 0) {
        this.logger.log('All trip data entries already exist in database');
        return;
      }
      
      this.logger.log(`Found ${newTripData.length} new trip data entries to process`);
      
      // Process the new trip data
      // const result = await this.chorusApiService.executeTripWorkflow(newTripData);
      
      this.logger.log(`Cron job completed successfully`);
      // this.logger.log(`Processed: ${result.summary.processed}, Errors: ${result.summary.errors}`);
      
    } catch (error) {
      this.logger.error('Cron job failed:', error);
    }
  }

  /**
   * Fetch data from the filtered API with the specified date range
   */
  private async fetchDataFromApi(
    startDate: string,
    startTime: string,
    endDate: string,
    endTime: string
  ): Promise<ApiResponse> {
    this.logger.log(`Fetching filtered data from API: ${startDate} ${startTime} to ${endDate} ${endTime}`);
    
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.API_BASE_URL}/api/filtered-associations`, {
          params: {
            start_date: startDate,
            start_time: startTime,
            end_date: endDate,
            end_time: endTime
          }
        })
      );

      // Process the filtered response
      const processedData = this.processFilteredApiResponse(response.data);
      
      this.logger.log(`Filtered API response processed: ${processedData.tripData.length} valid entries`);
      this.logger.log(`Data quality: ${response.data.metadata.data_quality_percent}%`);
      
      // Log deduplication stats if available
      if (response.data.metadata.deduplication_stats) {
        this.logger.log(`Deduplication stats: ${response.data.metadata.deduplication_stats.duplicates_removed} duplicates removed`);
      } else {
        this.logger.log(`No deduplication stats available (likely no data found)`);
      }
      
      return processedData;
      
    } catch (error) {
      this.logger.error('Failed to fetch data from filtered API:', error);
      throw error;
    }
  }

  /**
   * Process filtered API response - data is already clean and validated
   */
  private processFilteredApiResponse(data: FilteredApiResponse): ApiResponse {
    if (!data.success || !Array.isArray(data.data)) {
      throw new Error('Invalid filtered API response format');
    }
    
    // Transform filtered data to expected format
    // Data is already validated, deduplicated, and sorted by the API
    const tripData = data.data.map(item => ({
      toteId: item.tote_id,
      olpn: item.olpn,
      timestamp: item.first_timestamp
    }));
    
    return {
      summary: {
        dateRange: `${data.query_info.start_datetime_utc} to ${data.query_info.end_datetime_utc}`,
        totalUniqueAssociations: tripData.length,
        generatedAt: data.query_info.processing_timestamp
      },
      tripData
    };
  }

  /**
   * Process API response similar to the jq logic in the shell script (legacy method)
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
   * Note: The filtered API already handles deduplication, but we still check our database
   */
  private async filterNewTripData(tripData: TripData[]): Promise<TripData[]> {
    const newTripData: TripData[] = [];
    
    this.logger.log(`Checking ${tripData.length} trip data entries against database for duplicates`);
    
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
    
    this.logger.log(`Found ${newTripData.length} new trip data entries (${tripData.length - newTripData.length} already processed)`);
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
