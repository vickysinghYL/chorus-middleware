import { Controller, Post, Get, Body, Query, Param, HttpStatus, HttpException } from '@nestjs/common';
import { ChorusApiService } from '../services/chorus-api.service';

interface TripDataDto {
  toteId: string;
  olpn: string;
  timestamp: string;
}

interface TripWorkflowRequestDto {
  tripData: TripDataDto[];
}

interface TripWorkflowResponseDto {
  success: boolean;
  data: string;
  summary: {
    totalTripData: number;
    processed: number;
    errors: number;
  };
  error?: string;
}

@Controller('chorus')
export class ChorusController {
  constructor(private readonly chorusApiService: ChorusApiService) {}

  @Post('/process-data')
  async executeTripWorkflow(@Body() request: TripWorkflowRequestDto): Promise<any> {
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

    // Sort trip data by timestamp in ascending order
    const sortedTripData = [...request.tripData].sort((a, b) => {
      const timestampA = new Date(a.timestamp).getTime();
      const timestampB = new Date(b.timestamp).getTime();
      return timestampA - timestampB;
    });

    console.log(`Sorted ${sortedTripData.length} trip data entries by timestamp (ascending)`);
    console.log('First entry:', sortedTripData[0]);
    console.log('Last entry:', sortedTripData[sortedTripData.length - 1]);

    // Execute the workflow with sorted data
    this.chorusApiService.executeTripWorkflow(sortedTripData);
      
    return { success: true, data: 'Trip workflow executed successfully' };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        `Internal server error: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // ===========================
  // INDIVIDUAL API ENDPOINTS
  // ===========================

  @Post('/create-trip')
  async createTrip(@Body() body: { olpn: string; timestamp?: string }) {
    try {
      if (!body.olpn) {
        throw new HttpException('OLPN is required', HttpStatus.BAD_REQUEST);
      }
      
      const timestamp = body.timestamp || new Date().toISOString();
      const result = await this.chorusApiService.createTrip(body.olpn, timestamp);
      
      return { success: true, result };
    } catch (error) {
      throw new HttpException(
        `Failed to create trip: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('/start-tracking')
  async startTracking(@Body() body: { toteId: string; olpn: string }) {
    try {
      if (!body.toteId || !body.olpn) {
        throw new HttpException('ToteId and OLPN are required', HttpStatus.BAD_REQUEST);
      }
      
      const result = await this.chorusApiService.startTracking(body.toteId, body.olpn);
      
      return { success: true, result };
    } catch (error) {
      throw new HttpException(
        `Failed to start tracking: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('/update-trip-in-transit')
  async updateTripToInTransit(@Body() body: { olpn: string; timestamp?: string }) {
    try {
      if (!body.olpn) {
        throw new HttpException('OLPN is required', HttpStatus.BAD_REQUEST);
      }
      
      const timestamp = body.timestamp || new Date().toISOString();
      const result = await this.chorusApiService.updateTripToInTransit(body.olpn, timestamp);
      
      return { success: true, result };
    } catch (error) {
      throw new HttpException(
        `Failed to update trip to IN_TRANSIT: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('/end-trip')
  async endTrip(@Body() body: { olpn: string; timestamp?: string }) {
    try {
      if (!body.olpn) {
        throw new HttpException('OLPN is required', HttpStatus.BAD_REQUEST);
      }
      
      const timestamp = body.timestamp || new Date().toISOString();
      const result = await this.chorusApiService.endTrip(body.olpn, timestamp);
      
      return { success: true, result };
    } catch (error) {
      throw new HttpException(
        `Failed to end trip: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('/end-tracking')
  async endTracking(@Body() body: { toteId: string; olpn: string }) {
    try {
      if (!body.toteId || !body.olpn) {
        throw new HttpException('ToteId and OLPN are required', HttpStatus.BAD_REQUEST);
      }
      
      const result = await this.chorusApiService.endTracking(body.toteId, body.olpn);
      
      return { success: true, result };
    } catch (error) {
      throw new HttpException(
        `Failed to end tracking: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('/list-trips-in-transit')
  async listTripsInTransit(@Query('toteId') toteId: string) {
    try {
      if (!toteId) {
        throw new HttpException('ToteId is required', HttpStatus.BAD_REQUEST);
      }
      
      const result = await this.chorusApiService.listAllTripsInTransit(toteId);
      
      return { success: true, result };
    } catch (error) {
      throw new HttpException(
        `Failed to list trips in transit: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
} 