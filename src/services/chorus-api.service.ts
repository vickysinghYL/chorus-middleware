import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorLogService, ErrorLogData } from './error-log.service';
import { TripProcessingLogService } from './trip-processing-log.service';
import * as crypto from 'crypto';
import * as fetch from 'node-fetch';
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';

interface TripData {
  toteId: string;
  olpn: string;
  timestamp: string;
}

interface WorkflowResult {
  success: boolean;
  data: string;
  summary: {
    totalTripData: number;
    processed: number;
    errors: number;
  };
  error?: string;
}

class ChorusApiError extends Error {
  public isLogged: boolean;
  public readonly endpoint: string;
  public readonly statusCode: number;
  public readonly requestPayload?: any;
  public readonly toteId?: string;
  public readonly olpn?: string;

  constructor(message: string, endpoint: string, statusCode: number, requestPayload?: any, isLogged: boolean = false, toteId?: string, olpn?: string) {
    super(message);
    this.name = 'ChorusApiError';
    this.isLogged = isLogged;
    this.endpoint = endpoint;
    this.statusCode = statusCode;
    this.requestPayload = requestPayload;
    this.toteId = toteId;
    this.olpn = olpn;
  }
}

@Injectable()
export class ChorusApiService {
  private readonly logger = new Logger(ChorusApiService.name);
  private readonly TAG = "ChorusApiService (Backend)";

  private readonly API_DOMAIN = "api.chorussystems.net";
  private readonly BASE_URL = `https://${this.API_DOMAIN}/`;

  // Google Cloud credentials
  private readonly PROJECT_ID: string;
  private readonly CLIENT_EMAIL: string;
  private readonly PRIVATE_KEY_ID: string;
  private readonly PRIVATE_KEY_PEM: string;

  // Token configuration
  private readonly TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
  private readonly SCOPE = "https://www.googleapis.com/auth/cloud-platform";
  private readonly TOKEN_VALIDITY_SECONDS = 3600; // 1 hour
  private readonly REFRESH_BUFFER_SECONDS = 300; // 5 minutes





  // Token management
  private currentToken: string | null = null;
  private tokenExpirationTime = 0;

  constructor(
    private configService: ConfigService,
    private errorLogService: ErrorLogService,
    private tripProcessingLogService: TripProcessingLogService
  ) {
    // Load credentials securely from environment variables
    this.PROJECT_ID = this.configService.get<string>('GOOGLE_PROJECT_ID');
    this.CLIENT_EMAIL = this.configService.get<string>('GOOGLE_CLIENT_EMAIL');
    this.PRIVATE_KEY_ID = this.configService.get<string>('GOOGLE_PRIVATE_KEY_ID');
    // The key from .env might have escaped newlines, so we replace them.
    this.PRIVATE_KEY_PEM = this.configService.get<string>('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

    if (!this.CLIENT_EMAIL || !this.PRIVATE_KEY_PEM || !this.PROJECT_ID) {
      const errorMsg = `${this.TAG}: Missing Google Cloud credentials in environment variables (GOOGLE_PROJECT_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY).`;
      this.logger.error(errorMsg);
      throw new Error("Service account credentials are not configured for Chorus API.");
    }
  }

  // ===========================
  // AUTHENTICATION & JWT
  // ===========================

  private base64UrlEncode(buffer: Buffer): string {
    return buffer.toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  private async createJwtToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    
    const header = { alg: "RS256", typ: "JWT", kid: this.PRIVATE_KEY_ID };
    const payload = {
      iss: this.CLIENT_EMAIL,
      sub: this.CLIENT_EMAIL,
      aud: this.BASE_URL,
      iat: now,
      exp: now + this.TOKEN_VALIDITY_SECONDS,
    };

    const encodedHeader = this.base64UrlEncode(Buffer.from(JSON.stringify(header)));
    const encodedPayload = this.base64UrlEncode(Buffer.from(JSON.stringify(payload)));
    
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(unsignedToken);
    const signature = sign.sign(this.PRIVATE_KEY_PEM, 'base64');
    
    const encodedSignature = signature.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    this.logger.log(`${this.TAG}: JWT token generated successfully.`);
    return `${unsignedToken}.${encodedSignature}`;
  }

  private async getAuthHeader(): Promise<string> {
    if (!this.currentToken || Date.now() >= this.tokenExpirationTime - (this.REFRESH_BUFFER_SECONDS * 1000)) {
      this.logger.log(`${this.TAG}: Token expired or missing, refreshing...`);
      this.currentToken = await this.createJwtToken();
      this.tokenExpirationTime = Date.now() + (this.TOKEN_VALIDITY_SECONDS * 1000);
      this.logger.log(`${this.TAG}: Token refreshed. New expiration: ${new Date(this.tokenExpirationTime).toLocaleString()}`);
    }
    return `Bearer ${this.currentToken}`;
  }

  // ===========================
  // CORE API COMMUNICATION
  // ===========================

  private async makeApiRequest(endpoint: string, payload?: any, method: string = 'POST'): Promise<any> {
    const authHeader = await this.getAuthHeader();
    const url = `${this.BASE_URL}${endpoint}`;

    this.logger.log(`${this.TAG}: Making ${method} request to ${url}`);

    try {
      const response = await fetch(url, {
        method: method,
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: payload ? JSON.stringify(payload) : undefined
      });

      if (!response.ok) {
        const errorText = await response.text();
        const isTimeout = this.isTimeoutError(response.status, errorText);
        
        this.logger.error(`${this.TAG}: API request failed: ${response.status} ${response.statusText}`, errorText);
        
        // Extract toteId and olpn from payload for better error logging
        let toteId: string | undefined;
        let olpn: string | undefined;
        
        if (payload) {
          // Extract toteId from assetIdentifier
          if (payload.assetIdentifier?.customerId) {
            toteId = payload.assetIdentifier.customerId;
          }
          
          // Extract olpn from tripIdentifier or trip.customerId
          if (payload.tripIdentifier?.customerId) {
            olpn = payload.tripIdentifier.customerId;
          } else if (payload.trip?.customerId) {
            olpn = payload.trip.customerId;
          }
        }
        
        const lastError = new ChorusApiError(
          `Chorus API Error (${response.status}): ${errorText}`,
          endpoint,
          response.status,
          payload,
          false, // Mark as not logged yet
          toteId,
          olpn
        );

        // Log error to database
        try {
          await this.errorLogService.createErrorLog({
            endpoint,
            errorType: isTimeout ? 'TIMEOUT_ERROR' : 'API_ERROR',
            statusCode: response.status,
            errorMessage: `Chorus API Error (${response.status}): ${errorText}`,
            requestPayload: payload,
            toteId,
            olpn,
          });
          lastError.isLogged = true; // Mark as logged
        } catch (dbError) {
          this.logger.error(`${this.TAG}: Failed to log error to database:`, dbError);
        }
        throw lastError;
      }

      // Handle cases where the response might be empty (e.g., a 204 No Content)
      const contentType = response.headers.get("content-type");
      let responseData;
      
      if (contentType && contentType.indexOf("application/json") !== -1) {
        responseData = await response.json();
        this.logger.log(`${this.TAG}: JSON response received`);
        this.logger.log(`Response data: ${JSON.stringify(responseData, null, 2)}`);
      } else {
        responseData = await response.text();
        this.logger.log(`${this.TAG}: Text response received`);
        this.logger.log(`Response data: ${responseData}`);
      }
      
      return responseData;

    } catch (error) {
      // If this is already a ChorusApiError that was thrown from the if (!response.ok) block,
      // just re-throw it without logging again
      if (error instanceof ChorusApiError) {
        this.logger.log(`${this.TAG}: Re-throwing ChorusApiError without duplicate logging`);
        throw error;
      }
      
      // Handle network errors (server unreachable, DNS failures, etc.)
      const isNetworkError = error.code === 'ENOTFOUND' || 
                            error.code === 'ECONNREFUSED' || 
                            error.code === 'ECONNRESET' ||
                            error.message?.includes('fetch') ||
                            error.message?.includes('network');
      
      let lastError: ChorusApiError;
      
      if (isNetworkError) {
        lastError = new ChorusApiError(
          `Network error: ${error.message}`,
          endpoint,
          0, // Status code 0 for network errors
          payload,
          false,
          payload?.assetIdentifier?.customerId,
          payload?.tripIdentifier?.customerId || payload?.trip?.customerId
        );
        
        this.logger.error(`${this.TAG}: Network error: ${lastError.message}`);
      } else {
        // Handle other errors (non-retryable)
        lastError = new ChorusApiError(
          `Request failed: ${error.message}`,
          endpoint,
          0,
          payload,
          false,
          payload?.assetIdentifier?.customerId,
          payload?.tripIdentifier?.customerId || payload?.trip?.customerId
        );
        
        this.logger.error(`${this.TAG}: Request failed: ${lastError.message}`);
      }

      // Log error to database
      try {
        await this.errorLogService.createErrorLog({
          endpoint,
          errorType: lastError.statusCode === 0 ? 'NETWORK_ERROR' : 'REQUEST_ERROR',
          statusCode: lastError.statusCode,
          errorMessage: lastError.message,
          requestPayload: payload,
          toteId: payload?.assetIdentifier?.customerId,
          olpn: payload?.tripIdentifier?.customerId || payload?.trip?.customerId,
        });
        lastError.isLogged = true; // Mark as logged
      } catch (dbError) {
        this.logger.error(`${this.TAG}: Failed to log error to database:`, dbError);
      }
      throw lastError;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ===========================
  // ERROR HANDLING
  // ===========================

  private isTimeoutError(statusCode: number, errorMessage: string): boolean {
    return statusCode === 504 || 
           statusCode === 408 || 
           errorMessage.toLowerCase().includes('timeout') ||
           errorMessage.toLowerCase().includes('gateway timeout');
  }



  private async logWorkflowError(
    error: any,
    context: {
      workflowName: string;
      toteId?: string;
      olpn?: string;
      step?: string;
      requestPayload?: any;
    }
  ): Promise<void> {
    // Check if this is a ChorusApiError that has already been logged
    if (error instanceof ChorusApiError && error.isLogged) {
      this.logger.log(`${this.TAG}: Skipping duplicate error log for ${error.endpoint} (already logged)`);
      return;
    }

    // Debug logging to ensure parameters are being passed correctly
    this.logger.log(`${this.TAG}: Logging workflow error - toteId: "${context.toteId}", olpn: "${context.olpn}", step: "${context.step}"`);

    try {
      await this.errorLogService.createErrorLog({
        endpoint: error instanceof ChorusApiError ? error.endpoint : 'workflow',
        errorType: 'WORKFLOW_ERROR',
        statusCode: error instanceof ChorusApiError ? error.statusCode : 0,
        errorMessage: error.message || 'Unknown workflow error',
        requestPayload: error instanceof ChorusApiError ? error.requestPayload : context.requestPayload,
        toteId: error instanceof ChorusApiError ? error.toteId : context.toteId,
        olpn: error instanceof ChorusApiError ? error.olpn : context.olpn,
      });
      this.logger.log(`${this.TAG}: Successfully logged workflow error to database`);
    } catch (dbError) {
      this.logger.error(`${this.TAG}: Failed to log workflow error to database:`, dbError);
    }
  }

  private async logWorkflowBusinessError(
    error: any,
    context: {
      workflowName: string;
      toteId?: string;
      olpn?: string;
      step?: string;
      requestPayload?: any;
    }
  ): Promise<void> {
    try {
      await this.errorLogService.createErrorLog({
        endpoint: 'workflow',
        errorType: 'BUSINESS_ERROR',
        statusCode: 0,
        errorMessage: error.message || 'Unknown business logic error',
        requestPayload: context.requestPayload,
        toteId: context.toteId,
        olpn: context.olpn,
      });
    } catch (dbError) {
      this.logger.error(`${this.TAG}: Failed to log business error to database:`, dbError);
    }
  }

  // ===========================
  // SIX CORE API METHODS
  // ===========================

  async listAllTripsInTransit(toteId: string): Promise<{ customerIds: string[], toteOlpnPairs: [string, string][], raw: any }> {
    const payload = {
      tripStages: ["IN_TRANSIT"],
      assetIdentifier: { customerId: toteId }
    };
    const data = await this.makeApiRequest('v1alpha1/trips:list', payload);

    const customerIds: string[] = [];
    const toteOlpnPairs: [string, string][] = [];
    if (data.trips) {
      data.trips.forEach((trip: any) => {
        if (trip.customerId?.trim()) {
          customerIds.push(trip.customerId);
          toteOlpnPairs.push([toteId, trip.customerId]);
        }
      });
    }
    
    // Debug logging
    this.logger.log(`${this.TAG}: listAllTripsInTransit for ${toteId} - Found ${customerIds.length} trips`);
    this.logger.log(`${this.TAG}: customerIds: ${JSON.stringify(customerIds)}`);
    this.logger.log(`${this.TAG}: toteOlpnPairs: ${JSON.stringify(toteOlpnPairs)}`);
    
    return { customerIds, toteOlpnPairs, raw: data };
  }

  async endTrip(customerId: string, timestamp: string | null = null): Promise<any> {
    const payload: any = {
      tripIdentifier: { customerId: customerId },
      newStage: "COMPLETED"
    };
    
    if (timestamp) {
      payload.timestamp = timestamp;
    }
    
    return this.makeApiRequest('v1alpha1/trips:updateStage', payload);
  }

  async endTracking(toteId: string, olpn: string): Promise<any> {
    this.logger.log(`${this.TAG}: Ending tracking for toteId: ${toteId}, olpn: ${olpn}`);
    
    const payload = {
      assetIdentifier: { customerId: toteId },
      tripIdentifier: { customerId: olpn }
    };
    
    this.logger.log(`${this.TAG}: End tracking payload: ${JSON.stringify(payload)}`);
    
    try {
      const result = await this.makeApiRequest('v1alpha1/trackings:end', payload);
      this.logger.log(`${this.TAG}: Successfully ended tracking for ${toteId}/${olpn}`);
      this.logger.log(`${this.TAG}: End tracking response: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      this.logger.error(`${this.TAG}: Failed to end tracking for ${toteId}/${olpn}: ${error.message}`);
      throw error;
    }
  }

  async createTrip(olpn: string, timestamp: string | null = null): Promise<any> {
    this.logger.log(`${this.TAG}: Creating trip for olpn: ${olpn}, timestamp: ${timestamp || 'current time'}`);
    
    const payload: any = { trip: { customerId: olpn } };
    
    if (timestamp) {
      payload.trip.actualStartTime = timestamp;
    }
    
    this.logger.log(`${this.TAG}: Create trip payload: ${JSON.stringify(payload)}`);
    
    try {
      const result = await this.makeApiRequest('v1alpha1/trips', payload);
      this.logger.log(`${this.TAG}: Successfully created trip for ${olpn}`);
      this.logger.log(`${this.TAG}: Create trip response: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      this.logger.error(`${this.TAG}: Failed to create trip for ${olpn}: ${error.message}`);
      throw error;
    }
  }

  async startTracking(toteId: string, olpn: string): Promise<any> {
    this.logger.log(`${this.TAG}: Starting tracking for toteId: ${toteId}, olpn: ${olpn}`);
    
    const payload = {
      assetIdentifier: { customerId: toteId },
      tripIdentifier: { customerId: olpn }
    };
    
    this.logger.log(`${this.TAG}: Start tracking payload: ${JSON.stringify(payload)}`);
    
    try {
      const result = await this.makeApiRequest('v1alpha1/trackings:addTrip', payload);
      this.logger.log(`${this.TAG}: Successfully started tracking for ${toteId}/${olpn}`);
      this.logger.log(`${this.TAG}: Start tracking response: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      this.logger.error(`${this.TAG}: Failed to start tracking for ${toteId}/${olpn}: ${error.message}`);
      throw error;
    }
  }

  async updateTripToInTransit(olpn: string, timestamp: string | null = null): Promise<any> {
    this.logger.log(`${this.TAG}: Updating trip to IN_TRANSIT for olpn: ${olpn}, timestamp: ${timestamp || 'current time'}`);
    
    const payload: any = {
      tripIdentifier: { customerId: olpn },
      newStage: "IN_TRANSIT"
    };
    
    if (timestamp) {
      payload.timestamp = timestamp;
    }
    
    this.logger.log(`${this.TAG}: Update trip to IN_TRANSIT payload: ${JSON.stringify(payload)}`);
    
    try {
      const result = await this.makeApiRequest('v1alpha1/trips:updateStage', payload);
      this.logger.log(`${this.TAG}: Successfully updated trip to IN_TRANSIT for ${olpn}`);
      this.logger.log(`${this.TAG}: Update trip response: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      this.logger.error(`${this.TAG}: Failed to update trip to IN_TRANSIT for ${olpn}: ${error.message}`);
      throw error;
    }
  }

  // ===========================
  // TRIP WORKFLOW EXECUTION (Following Flowchart)
  // ===========================

  async executeTripWorkflow(sortedTripData: TripData[]) {
    

    const workflowStartTime = Date.now();
    this.logger.log(`${this.TAG}: Starting 'Trip Workflow' for ${sortedTripData.length} trip data entries (sorted by timestamp).`);
    this.logger.log(`${this.TAG}: Workflow start time: ${new Date(workflowStartTime).toISOString()}`);
    
    let log: string[] = [];
    let totalProcessed = 0;
    let totalErrors = 0;

    try {
      // Process each trip data entry sequentially with logging
      for (let i = 0; i < sortedTripData.length; i++) {
        const tripData = sortedTripData[i];
        this.logger.log(`${this.TAG}: [PROGRESS] Processing data entry ${i + 1}/${sortedTripData.length} from array`);
        log.push(`[PROGRESS] Processing data entry ${i + 1}/${sortedTripData.length} from array`);
        
        // Use the trip processing log service to handle duplicate checking and logging
        const result = await this.tripProcessingLogService.processTripData(
          tripData,
          'SINGLE_THREADED',
          async (tripData) => {
            return await this.processSingleTripData(tripData, i, sortedTripData.length);
          }
        );
        
        if (result.success) {
          totalProcessed++;
        } else {
          totalErrors++;
        }
        
        this.logger.log(`${this.TAG}: [PROGRESS] Completed data entry ${i + 1}/${sortedTripData.length} - Success: ${result.success}, Processing Time: ${result.processingTimeMs}ms`);
        log.push(`[PROGRESS] Completed data entry ${i + 1}/${sortedTripData.length} - Success: ${result.success}, Processing Time: ${result.processingTimeMs}ms`);
      }
      
      const workflowEndTime = Date.now();
      const workflowDuration = workflowEndTime - workflowStartTime;
      const averageTimePerPair = sortedTripData.length > 0 ? workflowDuration / sortedTripData.length : 0;
      
      this.logger.log(`${this.TAG}: [TIMING] 'Trip Workflow' completed in ${workflowDuration}ms`);
      this.logger.log(`${this.TAG}: [TIMING] Average time per pair: ${averageTimePerPair.toFixed(2)}ms`);
      this.logger.log(`${this.TAG}: [TIMING] Workflow end time: ${new Date(workflowEndTime).toISOString()}`);
      this.logger.log(`${this.TAG}: 'Trip Workflow' completed. Processed: ${totalProcessed}, Errors: ${totalErrors}`);
      
      log.push(`[TIMING] 'Trip Workflow' completed in ${workflowDuration}ms`);
      log.push(`[TIMING] Average time per pair: ${averageTimePerPair.toFixed(2)}ms`);
      log.push(`[TIMING] Workflow end time: ${new Date(workflowEndTime).toISOString()}`);
      
      return {
        success: totalErrors === 0,
        data: log.join('\n'),
        summary: {
          totalTripData: sortedTripData.length,
          processed: totalProcessed,
          errors: totalErrors
        }
      };

    } catch (error) {
      const workflowEndTime = Date.now();
      const workflowDuration = workflowEndTime - workflowStartTime;
      
      this.logger.error(`${this.TAG}: [TIMING] 'Trip Workflow' failed after ${workflowDuration}ms`);
      this.logger.error(`${this.TAG}: 'Trip Workflow' failed:`, error);
      log.push(`[TIMING] 'Trip Workflow' failed after ${workflowDuration}ms`);
      log.push(`CRITICAL ERROR: ${error.message}`);
      
      // Log critical workflow error to database
      const firstTripData = sortedTripData.length > 0 ? sortedTripData[0] : null;
      await this.logWorkflowError(error, {
        workflowName: 'Trip Workflow',
        toteId: firstTripData?.toteId,
        olpn: firstTripData?.olpn,
        step: 'Workflow Execution',
        requestPayload: { tripDataArray: sortedTripData }
      });
      
      return {
        success: false,
        error: error.message,
        data: log.join('\n'),
        summary: {
          totalTripData: sortedTripData.length,
          processed: totalProcessed,
          errors: totalErrors + 1
        }
      };
    }
  }

  private async processSingleTripData(tripData: TripData, index: number, totalCount: number): Promise<{
    success: boolean;
    errorMessage?: string;
    processingTimeMs: number;
    errors?: any[];
  }> {
    const { toteId, olpn, timestamp } = tripData;
    const startTime = Date.now();
    const tripLog: string[] = [];
    let tripErrors = 0;
    const errors: any[] = [];
    
    try {
      this.logger.log(`${this.TAG}: Processing trip data ${index + 1}/${totalCount}: ${toteId}/${olpn}`);
      tripLog.push(`Processing trip data ${index + 1}/${totalCount}: ${toteId}/${olpn}`);
      
      // Step 1: List Trips (IN_TRANSIT) using ToteID
      this.logger.log(`${this.TAG}: Step 1 - Listing trips in transit for ${toteId}...`);
      tripLog.push(`Step 1 - Listing trips in transit for ${toteId}...`);
      
      const { customerIds, toteOlpnPairs } = await this.listAllTripsInTransit(toteId);
      tripLog.push(`Found ${customerIds.length} existing trips in transit for ${toteId}`);
      this.logger.log(`Found ${customerIds.length} existing trips: ${customerIds.join(', ')}`);
      
      // Track if any existing trip processing fails
      let existingTripsFailed = false;
      
      // Step 2: Read through each record of the List
      if (customerIds.length > 0) {
        this.logger.log(`${this.TAG}: Step 2 - Processing ${customerIds.length} existing trips...`);
        tripLog.push(`Step 2 - Processing ${customerIds.length} existing trips...`);
        
        // Step 3: For Each Record - Update Trip Status to "COMPLETED" and End Trip
        for (let i = 0; i < customerIds.length; i++) {
          const oldOlpn = customerIds[i];
          
          // Safety check to ensure toteOlpnPairs[i] exists
          if (!toteOlpnPairs[i]) {
            this.logger.error(`${this.TAG}: Missing toteOlpnPairs entry for index ${i}`);
            continue;
          }
          
          const [currentToteId, currentOlpn] = toteOlpnPairs[i];
          
          // Additional safety check for the destructured values
          if (!currentToteId || !currentOlpn) {
            this.logger.error(`${this.TAG}: Invalid toteOlpnPairs entry at index ${i}: [${currentToteId}, ${currentOlpn}]`);
            continue;
          }
          
          this.logger.log(`Processing existing trip ${i + 1}/${customerIds.length}: ${oldOlpn}`);
          tripLog.push(`Processing existing trip ${i + 1}/${customerIds.length}: ${oldOlpn}`);
          
          // Update Trip Status to "COMPLETED" With old_oLPN
          this.logger.log(`Updating trip status to COMPLETED for ${oldOlpn}`);
          tripLog.push(`Updating trip status to COMPLETED for ${oldOlpn}`);
          
          try {
            await this.endTrip(oldOlpn, timestamp);
            this.logger.log(`    Trip status updated to COMPLETED for ${oldOlpn}`);
            tripLog.push(`    Trip status updated to COMPLETED for ${oldOlpn}`);
            
            // Small delay to ensure status update is processed
            await this.delay(100);
            
          } catch (error) {
            this.logger.error(`    ERROR: Failed to update trip status to COMPLETED for ${oldOlpn}: ${error.message}`);
            tripLog.push(`    ERROR: Failed to update trip status to COMPLETED for ${oldOlpn}: ${error.message}`);
            tripErrors++;
            existingTripsFailed = true;

            errors.push({
              errorType: 'API_ERROR',
              errorMessage: `Failed to update trip status to COMPLETED for ${oldOlpn}`,
              errorDetails: error.message,
              step: 'Process Existing Trip',
              requestPayload: { oldOlpn, currentToteId, currentOlpn, timestamp }
            });

            // If status update fails, skip remaining steps for this pair but continue with next pair
            this.logger.log(`  Skipping remaining steps for ${toteId}/${olpn} due to status update failure`);
            tripLog.push(`  Skipping remaining steps for ${toteId}/${olpn} due to status update failure`);
            continue;
          }
          
          // End Trip using (AssetID+old_oLPN)
          this.logger.log(`    Ending trip for pair: ${currentToteId}/${currentOlpn}`);
          tripLog.push(`    Ending trip for pair: ${currentToteId}/${currentOlpn}`);
          
          try {
            await this.endTracking(currentToteId, currentOlpn);
            this.logger.log(`    Trip ended successfully for ${currentToteId}/${currentOlpn}`);
            tripLog.push(`    Trip ended successfully for ${currentToteId}/${currentOlpn}`);
            
          } catch (error) {
            this.logger.error(`    ERROR: Failed to end trip for ${currentToteId}/${currentOlpn}: ${error.message}`);
            tripLog.push(`    ERROR: Failed to end trip for ${currentToteId}/${currentOlpn}: ${error.message}`);
            tripErrors++;
            existingTripsFailed = true;

            errors.push({
              errorType: 'API_ERROR',
              errorMessage: `Failed to end trip for ${currentToteId}/${currentOlpn}`,
              errorDetails: error.message,
              step: 'Process Existing Trip',
              requestPayload: { oldOlpn, currentToteId, currentOlpn, timestamp }
            });
            
            // If status update fails, skip remaining steps for this pair but continue with next pair
            this.logger.log(`  Skipping remaining steps for ${toteId}/${olpn} due to trip ending failure`);
            tripLog.push(`  Skipping remaining steps for ${toteId}/${olpn} due to trip ending failure`);
          }
        }
        
        this.logger.log(`  Completed processing ${customerIds.length} existing trips for ${toteId}`);
        tripLog.push(`  Completed processing ${customerIds.length} existing trips for ${toteId}`);
      } else {
        this.logger.log(`  No existing trips found for ${toteId}`);
        tripLog.push(`  No existing trips found for ${toteId}`);
      }
      
      // Step 4: Create Trip with New_oLPN (only if no existing trips failed)
      if (customerIds.length === 0 || !existingTripsFailed) {
        this.logger.log(`${this.TAG}: Step 4 - Creating new trip with ${olpn}`);
        tripLog.push(`Step 4 - Creating new trip with ${olpn}`);
      } else {
        this.logger.log(`${this.TAG}: Step 4 - Skipping new trip creation for ${olpn} due to existing trip processing failures`);
        tripLog.push(`Step 4 - Skipping new trip creation for ${olpn} due to existing trip processing failures`);
        
        const processingTimeMs = Date.now() - startTime;
        return { 
          success: false, 
          errorMessage: 'Skipped due to existing trip processing failures',
          processingTimeMs,
          errors 
        };
      }
      
      try {
        await this.createTrip(olpn, timestamp);
        this.logger.log(`  New trip created successfully for ${olpn}`);
        tripLog.push(`  New trip created successfully for ${olpn}`);
        
        // Small delay to ensure trip creation is processed
        await this.delay(100);
        
      } catch (error) {
        this.logger.log(`  ERROR: Failed to create new trip for ${olpn}: ${error.message}`);
        tripLog.push(`  ERROR: Failed to create new trip for ${olpn}: ${error.message}`);
        tripErrors++;
        
        errors.push({
          errorType: 'API_ERROR',
          errorMessage: `Failed to create new trip for ${olpn}`,
          errorDetails: error.message,
          step: 'Create New Trip',
          requestPayload: { olpn, timestamp }
        });
        
        const processingTimeMs = Date.now() - startTime;
        return { 
          success: false, 
          errorMessage: `Failed to create new trip for ${olpn}`,
          processingTimeMs,
          errors 
        };
      }
      
      // Step 5: Start Tracking (AddTrip) ToteID+new_oLPN
      this.logger.log(`${this.TAG}: Step 5 - Starting tracking for ${toteId}/${olpn}`);
      tripLog.push(`Step 5 - Starting tracking for ${toteId}/${olpn}`);
      
      try {
        await this.startTracking(toteId, olpn);
        this.logger.log(`  Tracking started successfully for ${toteId}/${olpn}`);
        tripLog.push(`  Tracking started successfully for ${toteId}/${olpn}`);
        
        // Small delay to ensure tracking is established
        await this.delay(100);
        
      } catch (error) {
        this.logger.log(`  ERROR: Failed to start tracking for ${toteId}/${olpn}: ${error.message}`);
        tripLog.push(`  ERROR: Failed to start tracking for ${toteId}/${olpn}: ${error.message}`);
        tripErrors++;
        
        errors.push({
          errorType: 'API_ERROR',
          errorMessage: `Failed to start tracking for ${toteId}/${olpn}`,
          errorDetails: error.message,
          step: 'Start Tracking',
          requestPayload: { toteId, olpn }
        });
        
        const processingTimeMs = Date.now() - startTime;
        return { 
          success: false, 
          errorMessage: `Failed to start tracking for ${toteId}/${olpn}`,
          processingTimeMs,
          errors 
        };
      }
      
      // Step 6: Update Trip status to IN_TRANSIT (new_oLPN)
      this.logger.log(`${this.TAG}: Step 6 - Updating trip status to IN_TRANSIT for ${olpn}`);
      tripLog.push(`Step 6 - Updating trip status to IN_TRANSIT for ${olpn}`);
      
      try {
        await this.updateTripToInTransit(olpn, timestamp);
        this.logger.log(`Trip status updated to IN_TRANSIT for ${olpn}`);
        tripLog.push(`Trip status updated to IN_TRANSIT for ${olpn}`);
        
      } catch (error) {
        this.logger.log(`  ERROR: Failed to update trip status to IN_TRANSIT for ${olpn}: ${error.message}`);
        tripLog.push(`  ERROR: Failed to update trip status to IN_TRANSIT for ${olpn}: ${error.message}`);
        tripErrors++;
        
        errors.push({
          errorType: 'API_ERROR',
          errorMessage: `Failed to update trip status to IN_TRANSIT for ${olpn}`,
          errorDetails: error.message,
          step: 'Update Trip Status',
          requestPayload: { olpn, timestamp }
        });
        
        const processingTimeMs = Date.now() - startTime;
        return { 
          success: false, 
          errorMessage: `Failed to update trip status to IN_TRANSIT for ${olpn}`,
          processingTimeMs,
          errors 
        };
      }
      
      this.logger.log(`Completed processing for ${toteId}/${olpn} (${tripErrors} errors)`);
      tripLog.push(`Completed processing for ${toteId}/${olpn} (${tripErrors} errors)`);
      
      const processingTimeMs = Date.now() - startTime;
      return { 
        success: tripErrors === 0, 
        errorMessage: tripErrors > 0 ? `Completed with ${tripErrors} errors` : undefined,
        processingTimeMs,
        errors 
      };
      
    } catch (error) {
      this.logger.error(`ERROR: Failed to process trip data ${toteId}/${olpn}: ${error.message}`);
      tripLog.push(`ERROR: Failed to process trip data ${toteId}/${olpn}: ${error.message}`);
      
      errors.push({
        errorType: 'UNEXPECTED_ERROR',
        errorMessage: `Failed to process trip data ${toteId}/${olpn}`,
        errorDetails: error.message,
        step: 'Process Trip Data',
        requestPayload: tripData
      });
      
      const processingTimeMs = Date.now() - startTime;
      return { 
        success: false, 
        errorMessage: error.message,
        processingTimeMs,
        errors 
      };
    }
  }

  // ===========================
  // MULTIPROCESSING WORKFLOW
  // ===========================

  async executeTripWorkflowMultiProcess(tripData: TripData[]): Promise<WorkflowResult> {
    const sortedTripData = [...tripData].sort((a, b) => {
      const timestampA = new Date(a.timestamp).getTime();
      const timestampB = new Date(b.timestamp).getTime();
      return timestampA - timestampB;
    });

    console.log(`Sorted ${sortedTripData.length} trip data entries by timestamp (ascending)`);
    console.log('First entry:', sortedTripData[0]);
    console.log('Last entry:', sortedTripData[sortedTripData.length - 1]);

    const workflowStartTime = Date.now();
    this.logger.log(`${this.TAG}: Starting 'Multi-Process Trip Workflow' for ${sortedTripData.length} trip data entries.`);
    this.logger.log(`${this.TAG}: Workflow start time: ${new Date(workflowStartTime).toISOString()}`);
    
    let log: string[] = [];
    let totalProcessed = 0;
    let totalErrors = 0;

    try {
      // Determine optimal number of workers based on CPU cores
      const cpuCores = os.cpus().length;
      const maxWorkers = Math.min(cpuCores,10); // Use 2 workers max for 2 CPU server
      const chunkSize = Math.ceil(sortedTripData.length / maxWorkers);
      
      this.logger.log(`${this.TAG}: Using ${maxWorkers} workers for parallel processing`);
      this.logger.log(`${this.TAG}: Chunk size per worker: ${chunkSize}`);
      
      // Create worker chunks
      const chunks: TripData[][] = [];
      for (let i = 0; i < sortedTripData.length; i += chunkSize) {
        chunks.push(sortedTripData.slice(i, i + chunkSize));
      }
      
      this.logger.log(`${this.TAG}: Created ${chunks.length} chunks for parallel processing`);
      
      // Process chunks in parallel using Promise.all
      const workerPromises = chunks.map(async (chunk, chunkIndex) => {
        return this.processChunkWithLogging(chunk, chunkIndex, chunks.length);
      });
      
      // Wait for all workers to complete
      const results = await Promise.all(workerPromises);
      
      // Aggregate results
      for (const result of results) {
        log.push(...result.log);
        totalProcessed += result.processed;
        totalErrors += result.errors;
      }
      
      const workflowEndTime = Date.now();
      const workflowDuration = workflowEndTime - workflowStartTime;
      const averageTimePerPair = sortedTripData.length > 0 ? workflowDuration / sortedTripData.length : 0;
      
      this.logger.log(`${this.TAG}: [TIMING] 'Multi-Process Trip Workflow' completed in ${workflowDuration}ms`);
      this.logger.log(`${this.TAG}: [TIMING] Average time per pair: ${averageTimePerPair.toFixed(2)}ms`);
      this.logger.log(`${this.TAG}: [TIMING] Workflow end time: ${new Date(workflowEndTime).toISOString()}`);
      this.logger.log(`${this.TAG}: 'Multi-Process Trip Workflow' completed. Processed: ${totalProcessed}, Errors: ${totalErrors}`);
      
      log.push(`[TIMING] 'Multi-Process Trip Workflow' completed in ${workflowDuration}ms`);
      log.push(`[TIMING] Average time per pair: ${averageTimePerPair.toFixed(2)}ms`);
      log.push(`[TIMING] Workflow end time: ${new Date(workflowEndTime).toISOString()}`);
      
      return {
        success: totalErrors === 0,
        data: log.join('\n'),
        summary: {
          totalTripData: sortedTripData.length,
          processed: totalProcessed,
          errors: totalErrors
        }
      };

    } catch (error) {
      const workflowEndTime = Date.now();
      const workflowDuration = workflowEndTime - workflowStartTime;
      
      this.logger.error(`${this.TAG}: [TIMING] 'Multi-Process Trip Workflow' failed after ${workflowDuration}ms`);
      this.logger.error(`${this.TAG}: 'Multi-Process Trip Workflow' failed:`, error);
      log.push(`[TIMING] 'Multi-Process Trip Workflow' failed after ${workflowDuration}ms`);
      log.push(`CRITICAL ERROR: ${error.message}`);
      
      // Log critical workflow error to database
      const firstTripData = sortedTripData.length > 0 ? sortedTripData[0] : null;
      await this.logWorkflowError(error, {
        workflowName: 'Multi-Process Trip Workflow',
        toteId: firstTripData?.toteId,
        olpn: firstTripData?.olpn,
        step: 'Multi-Process Workflow Execution',
        requestPayload: { tripDataArray: sortedTripData }
      });
      
      return {
        success: false,
        error: error.message,
        data: log.join('\n'),
        summary: {
          totalTripData: sortedTripData.length,
          processed: totalProcessed,
          errors: totalErrors + 1
        }
      };
    }
  }

  private async processChunkWithLogging(chunk: TripData[], chunkIndex: number, totalChunks: number): Promise<{
    log: string[];
    processed: number;
    errors: number;
  }> {
    const chunkStartTime = Date.now();
    const chunkLog: string[] = [];
    let chunkProcessed = 0;
    let chunkErrors = 0;
    
    this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] Starting chunk processing for ${chunk.length} trip data entries`);
    chunkLog.push(`[WORKER ${chunkIndex + 1}] Starting chunk processing for ${chunk.length} trip data entries`);
    
    // Process each trip data in the chunk sequentially with logging
    for (let i = 0; i < chunk.length; i++) {
      const tripData = chunk[i];
      
      this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] Processing trip data ${i + 1}/${chunk.length}: ${tripData.toteId}/${tripData.olpn}`);
      chunkLog.push(`[WORKER ${chunkIndex + 1}] Processing trip data ${i + 1}/${chunk.length}: ${tripData.toteId}/${tripData.olpn}`);
      
      // Use the trip processing log service to handle duplicate checking and logging
      const result = await this.tripProcessingLogService.processTripData(
        tripData,
        'MULTIPROCESS',
        async (tripData) => {
          return await this.processSingleTripData(tripData, i, chunk.length);
        }
      );
      
      if (result.success) {
        chunkProcessed++;
      } else {
        chunkErrors++;
      }
      
      this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] Completed trip data ${i + 1}/${chunk.length} - Success: ${result.success}, Processing Time: ${result.processingTimeMs}ms`);
      chunkLog.push(`[WORKER ${chunkIndex + 1}] Completed trip data ${i + 1}/${chunk.length} - Success: ${result.success}, Processing Time: ${result.processingTimeMs}ms`);
    }
    
    const chunkEndTime = Date.now();
    const chunkDuration = chunkEndTime - chunkStartTime;
    this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] [TIMING] Completed chunk processing in ${chunkDuration}ms - Processed: ${chunkProcessed}, Errors: ${chunkErrors}`);
    chunkLog.push(`[WORKER ${chunkIndex + 1}] [TIMING] Completed chunk processing in ${chunkDuration}ms - Processed: ${chunkProcessed}, Errors: ${chunkErrors}`);
    
    return {
      log: chunkLog,
      processed: chunkProcessed,
      errors: chunkErrors
    };
  }

  private async processChunkSequentially(chunk: TripData[], chunkIndex: number, totalChunks: number): Promise<{
    log: string[];
    processed: number;
    errors: number;
  }> {
    const chunkStartTime = Date.now();
    const chunkLog: string[] = [];
    let chunkProcessed = 0;
    let chunkErrors = 0;
    
    this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] Starting chunk processing for ${chunk.length} trip data entries`);
    chunkLog.push(`[WORKER ${chunkIndex + 1}] Starting chunk processing for ${chunk.length} trip data entries`);
    
    // Process each trip data in the chunk sequentially (to maintain order within chunk)
    for (let i = 0; i < chunk.length; i++) {
      const tripData = chunk[i];
      const { toteId, olpn, timestamp } = tripData;
      const pairStartTime = Date.now();
      const tripLog: string[] = [];
      let tripErrors = 0;
      
      this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] Processing trip data ${i + 1}/${chunk.length}: ${toteId}/${olpn}`);
      tripLog.push(`[WORKER ${chunkIndex + 1}] Processing trip data ${i + 1}/${chunk.length}: ${toteId}/${olpn}`);
      
      try {
        // Step 1: List Trips (IN_TRANSIT) using ToteID
        this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] Step 1 - Listing trips in transit for ${toteId}...`);
        tripLog.push(`[WORKER ${chunkIndex + 1}] Step 1 - Listing trips in transit for ${toteId}...`);
        
        const { customerIds, toteOlpnPairs } = await this.listAllTripsInTransit(toteId);
        tripLog.push(`Found ${customerIds.length} existing trips in transit for ${toteId}`);
        
        // Track if any existing trip processing fails
        let existingTripsFailed = false;
        
        // Step 2: Read through each record of the List
        if (customerIds.length > 0) {
          this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] Step 2 - Processing ${customerIds.length} existing trips...`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] Step 2 - Processing ${customerIds.length} existing trips...`);
          
          // Step 3: For Each Record - Update Trip Status to "COMPLETED" and End Trip
          for (let j = 0; j < customerIds.length; j++) {
            const oldOlpn = customerIds[j];
            
            if (!toteOlpnPairs[j]) {
              this.logger.error(`${this.TAG}: [WORKER ${chunkIndex + 1}] Missing toteOlpnPairs entry for index ${j}`);
              continue;
            }
            
            const [currentToteId, currentOlpn] = toteOlpnPairs[j];
            
            if (!currentToteId || !currentOlpn) {
              this.logger.error(`${this.TAG}: [WORKER ${chunkIndex + 1}] Invalid toteOlpnPairs entry at index ${j}: [${currentToteId}, ${currentOlpn}]`);
              continue;
            }
            
            this.logger.log(`[WORKER ${chunkIndex + 1}] Processing existing trip ${j + 1}/${customerIds.length}: ${oldOlpn}`);
            tripLog.push(`[WORKER ${chunkIndex + 1}] Processing existing trip ${j + 1}/${customerIds.length}: ${oldOlpn}`);
            
            // Update Trip Status to "COMPLETED" With old_oLPN
            try {
              await this.endTrip(oldOlpn, timestamp);
              this.logger.log(`[WORKER ${chunkIndex + 1}] Trip status updated to COMPLETED for ${oldOlpn}`);
              tripLog.push(`[WORKER ${chunkIndex + 1}] Trip status updated to COMPLETED for ${oldOlpn}`);
              
              await this.delay(100);
              
            } catch (error) {
              this.logger.error(`[WORKER ${chunkIndex + 1}] ERROR: Failed to update trip status to COMPLETED for ${oldOlpn}: ${error.message}`);
              tripLog.push(`[WORKER ${chunkIndex + 1}] ERROR: Failed to update trip status to COMPLETED for ${oldOlpn}: ${error.message}`);
              tripErrors++;
              existingTripsFailed = true;

              await this.logWorkflowError(error, {
                workflowName: 'Multi-Process Trip Workflow',
                toteId: currentToteId,
                olpn: currentOlpn,
                step: 'Process Existing Trip',
                requestPayload: { oldOlpn, currentToteId, currentOlpn, timestamp }
              });

              this.logger.log(`[WORKER ${chunkIndex + 1}] Skipping remaining steps for ${toteId}/${olpn} due to status update failure`);
              tripLog.push(`[WORKER ${chunkIndex + 1}] Skipping remaining steps for ${toteId}/${olpn} due to status update failure`);
              continue;
            }
            
            // End Trip using (AssetID+old_oLPN)
            try {
              await this.endTracking(currentToteId, currentOlpn);
              this.logger.log(`[WORKER ${chunkIndex + 1}] Trip ended successfully for ${currentToteId}/${currentOlpn}`);
              tripLog.push(`[WORKER ${chunkIndex + 1}] Trip ended successfully for ${currentToteId}/${currentOlpn}`);
              
            } catch (error) {
              this.logger.error(`[WORKER ${chunkIndex + 1}] ERROR: Failed to end trip for ${currentToteId}/${currentOlpn}: ${error.message}`);
              tripLog.push(`[WORKER ${chunkIndex + 1}] ERROR: Failed to end trip for ${currentToteId}/${currentOlpn}: ${error.message}`);
              tripErrors++;
              existingTripsFailed = true;

              await this.logWorkflowError(error, {
                workflowName: 'Multi-Process Trip Workflow',
                toteId: currentToteId,
                olpn: currentOlpn,
                step: 'Process Existing Trip',
                requestPayload: { oldOlpn, currentToteId, currentOlpn, timestamp }
              });
              
              this.logger.log(`[WORKER ${chunkIndex + 1}] Skipping remaining steps for ${toteId}/${olpn} due to trip ending failure`);
              tripLog.push(`[WORKER ${chunkIndex + 1}] Skipping remaining steps for ${toteId}/${olpn} due to trip ending failure`);
            }
          }
          
          this.logger.log(`[WORKER ${chunkIndex + 1}] Completed processing ${customerIds.length} existing trips for ${toteId}`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] Completed processing ${customerIds.length} existing trips for ${toteId}`);
        } else {
          this.logger.log(`[WORKER ${chunkIndex + 1}] No existing trips found for ${toteId}`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] No existing trips found for ${toteId}`);
        }
        
        // Step 4: Create Trip with New_oLPN (only if no existing trips failed)
        if (customerIds.length === 0 || !existingTripsFailed) {
          this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] Step 4 - Creating new trip with ${olpn}`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] Step 4 - Creating new trip with ${olpn}`);
        } else {
          this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] Step 4 - Skipping new trip creation for ${olpn} due to existing trip processing failures`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] Step 4 - Skipping new trip creation for ${olpn} due to existing trip processing failures`);
          
          const pairEndTime = Date.now();
          const pairDuration = pairEndTime - pairStartTime;
          this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] [TIMING] Completed processing for ${toteId}/${olpn} in ${pairDuration}ms (${tripErrors} errors) - Skipped due to existing trip failures`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] [TIMING] Completed processing for ${toteId}/${olpn} in ${pairDuration}ms (${tripErrors} errors) - Skipped due to existing trip failures`);
          
          chunkErrors += tripErrors;
          chunkLog.push(...tripLog);
          continue;
        }
        
        try {
          await this.createTrip(olpn, timestamp);
          this.logger.log(`[WORKER ${chunkIndex + 1}] New trip created successfully for ${olpn}`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] New trip created successfully for ${olpn}`);
          
          await this.delay(100);
          
        } catch (error) {
          this.logger.log(`[WORKER ${chunkIndex + 1}] ERROR: Failed to create new trip for ${olpn}: ${error.message}`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] ERROR: Failed to create new trip for ${olpn}: ${error.message}`);
          tripErrors++;
          
          await this.logWorkflowError(error, {
            workflowName: 'Multi-Process Trip Workflow',
            toteId,
            olpn,
            step: 'Create New Trip',
            requestPayload: { olpn, timestamp }
          });
          
          this.logger.log(`[WORKER ${chunkIndex + 1}] Skipping remaining steps for ${toteId}/${olpn} due to trip creation failure`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] Skipping remaining steps for ${toteId}/${olpn} due to trip creation failure`);
          
          const pairEndTime = Date.now();
          const pairDuration = pairEndTime - pairStartTime;
          this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] [TIMING] Completed processing for ${toteId}/${olpn} in ${pairDuration}ms (${tripErrors} errors) - Failed at trip creation`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] [TIMING] Completed processing for ${toteId}/${olpn} in ${pairDuration}ms (${tripErrors} errors) - Failed at trip creation`);
          
          chunkErrors += tripErrors;
          chunkLog.push(...tripLog);
          continue;
        }
        
        // Step 5: Start Tracking (AddTrip) ToteID+new_oLPN
        this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] Step 5 - Starting tracking for ${toteId}/${olpn}`);
        tripLog.push(`[WORKER ${chunkIndex + 1}] Step 5 - Starting tracking for ${toteId}/${olpn}`);
        
        try {
          await this.startTracking(toteId, olpn);
          this.logger.log(`[WORKER ${chunkIndex + 1}] Tracking started successfully for ${toteId}/${olpn}`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] Tracking started successfully for ${toteId}/${olpn}`);
          
          await this.delay(100);
          
        } catch (error) {
          this.logger.log(`[WORKER ${chunkIndex + 1}] ERROR: Failed to start tracking for ${toteId}/${olpn}: ${error.message}`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] ERROR: Failed to start tracking for ${toteId}/${olpn}: ${error.message}`);
          tripErrors++;
          
          await this.logWorkflowError(error, {
            workflowName: 'Multi-Process Trip Workflow',
            toteId,
            olpn,
            step: 'Start Tracking',
            requestPayload: { toteId, olpn }
          });
          
          this.logger.log(`[WORKER ${chunkIndex + 1}] Skipping remaining steps for ${toteId}/${olpn} due to tracking failure`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] Skipping remaining steps for ${toteId}/${olpn} due to tracking failure`);
          
          const pairEndTime = Date.now();
          const pairDuration = pairEndTime - pairStartTime;
          this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] [TIMING] Completed processing for ${toteId}/${olpn} in ${pairDuration}ms (${tripErrors} errors) - Failed at tracking`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] [TIMING] Completed processing for ${toteId}/${olpn} in ${pairDuration}ms (${tripErrors} errors) - Failed at tracking`);
          
          chunkErrors += tripErrors;
          chunkLog.push(...tripLog);
          continue;
        }
        
        // Step 6: Update Trip status to IN_TRANSIT (new_oLPN)
        this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] Step 6 - Updating trip status to IN_TRANSIT for ${olpn}`);
        tripLog.push(`[WORKER ${chunkIndex + 1}] Step 6 - Updating trip status to IN_TRANSIT for ${olpn}`);
        
        try {
          await this.updateTripToInTransit(olpn, timestamp);
          this.logger.log(`[WORKER ${chunkIndex + 1}] Trip status updated to IN_TRANSIT for ${olpn}`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] Trip status updated to IN_TRANSIT for ${olpn}`);
          
        } catch (error) {
          this.logger.log(`[WORKER ${chunkIndex + 1}] ERROR: Failed to update trip status to IN_TRANSIT for ${olpn}: ${error.message}`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] ERROR: Failed to update trip status to IN_TRANSIT for ${olpn}: ${error.message}`);
          tripErrors++;
          
          await this.logWorkflowError(error, {
            workflowName: 'Multi-Process Trip Workflow',
            toteId,
            olpn,
            step: 'Update Trip Status',
            requestPayload: { olpn, timestamp }
          });
          
          this.logger.log(`[WORKER ${chunkIndex + 1}] Skipping remaining steps for ${toteId}/${olpn} due to status update failure`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] Skipping remaining steps for ${toteId}/${olpn} due to status update failure`);
          
          const pairEndTime = Date.now();
          const pairDuration = pairEndTime - pairStartTime;
          this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] [TIMING] Completed processing for ${toteId}/${olpn} in ${pairDuration}ms (${tripErrors} errors) - Failed at status update`);
          tripLog.push(`[WORKER ${chunkIndex + 1}] [TIMING] Completed processing for ${toteId}/${olpn} in ${pairDuration}ms (${tripErrors} errors) - Failed at status update`);
          
          chunkErrors += tripErrors;
          chunkLog.push(...tripLog);
          continue;
        }
        
        const pairEndTime = Date.now();
        const pairDuration = pairEndTime - pairStartTime;
        this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] [TIMING] Completed processing for ${toteId}/${olpn} in ${pairDuration}ms (${tripErrors} errors)`);
        tripLog.push(`[WORKER ${chunkIndex + 1}] [TIMING] Completed processing for ${toteId}/${olpn} in ${pairDuration}ms (${tripErrors} errors)`);
        this.logger.log(`[WORKER ${chunkIndex + 1}] Completed processing for ${toteId}/${olpn} (${tripErrors} errors)`);
        tripLog.push(`[WORKER ${chunkIndex + 1}] Completed processing for ${toteId}/${olpn} (${tripErrors} errors)`);
        
        chunkProcessed += tripErrors === 0 ? 1 : 0;
        chunkErrors += tripErrors;
        chunkLog.push(...tripLog);
        
      } catch (error) {
        const pairEndTime = Date.now();
        const pairDuration = pairEndTime - pairStartTime;
        this.logger.error(`${this.TAG}: [WORKER ${chunkIndex + 1}] [TIMING] Failed processing for ${toteId}/${olpn} after ${pairDuration}ms`);
        tripLog.push(`[WORKER ${chunkIndex + 1}] [TIMING] Failed processing for ${toteId}/${olpn} after ${pairDuration}ms`);
        this.logger.log(`[WORKER ${chunkIndex + 1}] ERROR: Failed to process trip data ${toteId}/${olpn}: ${error.message}`);
        tripLog.push(`[WORKER ${chunkIndex + 1}] ERROR: Failed to process trip data ${toteId}/${olpn}: ${error.message}`);
        
        await this.logWorkflowError(error, {
          workflowName: 'Multi-Process Trip Workflow',
          toteId,
          olpn,
          step: 'Process Trip Data',
          requestPayload: tripData
        });
        
        chunkErrors += 1;
        chunkLog.push(...tripLog);
      }
    }
    
    const chunkEndTime = Date.now();
    const chunkDuration = chunkEndTime - chunkStartTime;
    this.logger.log(`${this.TAG}: [WORKER ${chunkIndex + 1}] [TIMING] Completed chunk processing in ${chunkDuration}ms - Processed: ${chunkProcessed}, Errors: ${chunkErrors}`);
    chunkLog.push(`[WORKER ${chunkIndex + 1}] [TIMING] Completed chunk processing in ${chunkDuration}ms - Processed: ${chunkProcessed}, Errors: ${chunkErrors}`);
    
    return {
      log: chunkLog,
      processed: chunkProcessed,
      errors: chunkErrors
    };
  }
} 