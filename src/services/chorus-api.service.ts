import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorLogService, ErrorLogData } from './error-log.service';
import * as crypto from 'crypto';
import fetch from 'node-fetch';

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
  public readonly isLogged: boolean;
  public readonly endpoint: string;
  public readonly statusCode: number;
  public readonly requestPayload?: any;

  constructor(message: string, endpoint: string, statusCode: number, requestPayload?: any, isLogged: boolean = false) {
    super(message);
    this.name = 'ChorusApiError';
    this.isLogged = isLogged;
    this.endpoint = endpoint;
    this.statusCode = statusCode;
    this.requestPayload = requestPayload;
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
    private errorLogService: ErrorLogService
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
      this.logger.error(`${this.TAG}: API request failed: ${response.status} ${response.statusText}`, errorText);
      
      // Log error to database
      try {
        await this.errorLogService.createErrorLog({
          endpoint,
          errorType: 'API_ERROR',
          statusCode: response.status,
          errorMessage: `Chorus API Error (${response.status}): ${errorText}`,
          requestPayload: payload,
        });
      } catch (dbError) {
        this.logger.error(`${this.TAG}: Failed to log error to database:`, dbError);
      }
      
      throw new ChorusApiError(
        `Chorus API Error (${response.status}): ${errorText}`,
        endpoint,
        response.status,
        payload,
        true // Mark as already logged
      );
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
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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

    try {
      await this.errorLogService.createErrorLog({
        endpoint: 'workflow',
        errorType: 'WORKFLOW_ERROR',
        statusCode: 0,
        errorMessage: error.message || 'Unknown workflow error',
        requestPayload: context.requestPayload,
        toteId: context.toteId,
        olpn: context.olpn,
      });
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

  async executeTripWorkflow(tripDataArray: TripData[]): Promise<WorkflowResult> {
    // Sort trip data by timestamp in ascending order
    const sortedTripData = [...tripDataArray].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    this.logger.log(`${this.TAG}: Starting 'Trip Workflow' for ${sortedTripData.length} trip data entries (sorted by timestamp).`);
    let log: string[] = [];
    let totalProcessed = 0;
    let totalErrors = 0;

    try {
      // Process each trip data entry sequentially
      const processTripData = async (tripData: TripData, index: number) => {
        const { toteId, olpn, timestamp } = tripData;
        const tripLog: string[] = [];
        let tripErrors = 0;
        
        try {
          this.logger.log(`${this.TAG}: Processing trip data ${index + 1}/${sortedTripData.length}: ${toteId}/${olpn}`);
          tripLog.push(`Processing trip data ${index + 1}/${sortedTripData.length}: ${toteId}/${olpn}`);
          
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
              const [currentToteId, currentOlpn] = toteOlpnPairs[i];
              
                this.logger.log(`Processing existing trip ${i + 1}/${customerIds.length}: ${oldOlpn}`);
                tripLog.push(`Processing existing trip ${i + 1}/${customerIds.length}: ${oldOlpn}`);
                
                // Update Trip Status to "COMPLETED" With old_oLPN
                this.logger.log(`Updating trip status to COMPLETED for ${oldOlpn}`);
                tripLog.push(`Updating trip status to COMPLETED for ${oldOlpn}`);
                try{
                await this.endTrip(oldOlpn, timestamp);
                this.logger.log(`    Trip status updated to COMPLETED for ${oldOlpn}`);
                tripLog.push(`    Trip status updated to COMPLETED for ${oldOlpn}`);
                
                // Small delay to ensure status update is processed
                await this.delay(100);
                
                }catch(error){
                  this.logger.error(`    ERROR: Failed to update trip status to COMPLETED for ${oldOlpn}: ${error.message}`);
                  tripLog.push(`    ERROR: Failed to update trip status to COMPLETED for ${oldOlpn}: ${error.message}`);
                  tripErrors++;
                  existingTripsFailed = true; // Mark that existing trip processing failed

                  await this.logWorkflowError(error, {
                    workflowName: 'Trip Workflow',
                    toteId: currentToteId,
                    olpn: currentOlpn,
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
                try{
                await this.endTracking(currentToteId, currentOlpn);
                this.logger.log(`    Trip ended successfully for ${currentToteId}/${currentOlpn}`);
                tripLog.push(`    Trip ended successfully for ${currentToteId}/${currentOlpn}`);
                
                // Small delay between operations
                await this.delay(100);
                
                }catch(error){
                  this.logger.error(`    ERROR: Failed to end trip for ${currentToteId}/${currentOlpn}: ${error.message}`);
                  tripLog.push(`    ERROR: Failed to end trip for ${currentToteId}/${currentOlpn}: ${error.message}`);
                  tripErrors++;
                  existingTripsFailed = true; // Mark that existing trip processing failed

                  await this.logWorkflowError(error, {
                    workflowName: 'Trip Workflow',
                    toteId: currentToteId,
                    olpn: currentOlpn,
                    step: 'Process Existing Trip',
                    requestPayload: { oldOlpn, currentToteId, currentOlpn, timestamp }
                  });
                  // If status update fails, skip remaining steps for this pair but continue with next pair
                  this.logger.log(`  Skipping remaining steps for ${toteId}/${olpn} due to trip ending failure`);
                  tripLog.push(`  Skipping remaining steps for ${toteId}/${olpn} due to trip ending failure`);
                }
              }
            // Wait for all existing trips to be processed
            await this.delay(100);
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
            return { success: false, log: tripLog, errors: tripErrors };
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
            
            // Log error to database
            await this.logWorkflowError(error, {
              workflowName: 'Trip Workflow',
              toteId,
              olpn,
              step: 'Create New Trip',
              requestPayload: { olpn, timestamp }
            });
            
            // If trip creation fails, skip remaining steps for this pair but continue with next pair
            this.logger.log(`  Skipping remaining steps for ${toteId}/${olpn} due to trip creation failure`);
            tripLog.push(`  Skipping remaining steps for ${toteId}/${olpn} due to trip creation failure`);
            return { success: false, log: tripLog, errors: tripErrors };
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
            
            // Log error to database
            await this.logWorkflowError(error, {
              workflowName: 'Trip Workflow',
              toteId,
              olpn,
              step: 'Start Tracking',
              requestPayload: { toteId, olpn }
            });
            
            // If tracking fails, skip to next trip data entry
            this.logger.log(`  Skipping remaining steps for ${toteId}/${olpn} due to tracking failure`);
            tripLog.push(`  Skipping remaining steps for ${toteId}/${olpn} due to tracking failure`);
            return { success: false, log: tripLog, errors: tripErrors };
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
            
            // Log error to database
            await this.logWorkflowError(error, {
              workflowName: 'Trip Workflow',
              toteId,
              olpn,
              step: 'Update Trip Status',
              requestPayload: { olpn, timestamp }
            });
            
            // If status update fails, skip remaining steps for this pair but continue with next pair
            this.logger.log(`  Skipping remaining steps for ${toteId}/${olpn} due to status update failure`);
            tripLog.push(`  Skipping remaining steps for ${toteId}/${olpn} due to status update failure`);
            return { success: false, log: tripLog, errors: tripErrors };
          }
          
          this.logger.log(`Completed processing for ${toteId}/${olpn} (${tripErrors} errors)`);
          tripLog.push(`Completed processing for ${toteId}/${olpn} (${tripErrors} errors)`);
          return { success: tripErrors === 0, log: tripLog, errors: tripErrors };
          
        } catch (error) {
          this.logger.log(`ERROR: Failed to process trip data ${toteId}/${olpn}: ${error.message}`);
          tripLog.push(`ERROR: Failed to process trip data ${toteId}/${olpn}: ${error.message}`);
          
          // Log error to database
          await this.logWorkflowError(error, {
            workflowName: 'Trip Workflow',
            toteId,
            olpn,
            step: 'Process Trip Data',
            requestPayload: tripData
          });
          
          return { success: false, log: tripLog, errors: 1 };
        }
      };

      // Process all trip data entries sequentially
      for (let i = 0; i < sortedTripData.length; i++) {
        const tripData = sortedTripData[i];
        const result = await processTripData(tripData, i);
        
        const { success, log: tripLog, errors } = result;
        log.push(...tripLog);
        totalProcessed += success ? 1 : 0;
        totalErrors += errors;
        
        // Small delay between processing different trip data entries
        if (i < sortedTripData.length - 1) {
          await this.delay(200);
        }
      }
      
      this.logger.log(`${this.TAG}: 'Trip Workflow' completed. Processed: ${totalProcessed}, Errors: ${totalErrors}`);
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
      this.logger.error(`${this.TAG}: 'Trip Workflow' failed:`, error);
      log.push(`CRITICAL ERROR: ${error.message}`);
      
      // Log critical workflow error to database
      await this.logWorkflowError(error, {
        workflowName: 'Trip Workflow',
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
} 