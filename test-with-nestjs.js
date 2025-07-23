// Y&L Consulting
// test-with-nestjs.js used to test the Chorus API with real data using NestJS application

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

class NestJSRealDataTester {
    constructor(baseUrl = 'http://localhost:3000') {
        this.baseUrl = baseUrl;
        this.testStartTime = Date.now();
        this.logFile = null;
        this.logBuffer = [];
        this.initializeLogFile();
    }

    // ===========================
    // LOG FILE MANAGEMENT
    // ===========================

    initializeLogFile() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFileName = `chorus-nestjs-test-logs-${timestamp}.txt`;
        this.logFile = path.join('./data', logFileName);
        
        // Ensure data directory exists
        const dataDir = path.dirname(this.logFile);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        console.log(`Log file initialized: ${this.logFile}`);
        this.writeToLogFile(`=== CHORUS NESTJS API TEST LOGS ===`);
        this.writeToLogFile(`Started: ${new Date().toISOString()}`);
        this.writeToLogFile(`Base URL: ${this.baseUrl}`);
        this.writeToLogFile(`Log File: ${this.logFile}`);
        this.writeToLogFile(`==========================================`);
        this.writeToLogFile(``);
    }

    writeToLogFile(message) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}`;
        
        // Add to buffer
        this.logBuffer.push(logEntry);
        
        // Write to file immediately
        try {
            fs.appendFileSync(this.logFile, logEntry + '\n');
        } catch (error) {
            console.error(`Error writing to log file: ${error.message}`);
        }
    }

    writeSectionToLogFile(sectionTitle, content) {
        this.writeToLogFile(``);
        this.writeToLogFile(`=== ${sectionTitle.toUpperCase()} ===`);
        this.writeToLogFile(content);
        this.writeToLogFile(`=== END ${sectionTitle.toUpperCase()} ===`);
        this.writeToLogFile(``);
    }

    writeSummaryToLogFile(summary) {
        this.writeToLogFile(``);
        this.writeToLogFile(`=== TEST SUMMARY ===`);
        this.writeToLogFile(`Total Test Time: ${Date.now() - this.testStartTime}ms`);
        this.writeToLogFile(`Log File: ${this.logFile}`);
        this.writeToLogFile(`Summary: ${JSON.stringify(summary, null, 2)}`);
        this.writeToLogFile(`=== END TEST SUMMARY ===`);
        this.writeToLogFile(``);
    }

    // ===========================
    // EXCEL DATA READING
    // ===========================

    readExcelData(filePath) {
        this.writeToLogFile(`Reading Excel file: ${filePath}`);
        console.log(`Reading Excel file: ${filePath}`);
        
        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                throw new Error(`Excel file not found: ${filePath}`);
            }

            // Read the Excel file
            const workbook = XLSX.readFile(filePath);
            
            // Get the first sheet
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            this.writeToLogFile(`Reading sheet: ${sheetName}`);
            console.log(`Reading sheet: ${sheetName}`);
            
            // Convert sheet to JSON
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            if (jsonData.length < 2) {
                throw new Error('Excel file must have at least a header row and one data row');
            }
            
            // Get headers (first row)
            const headers = jsonData[0];
            this.writeToLogFile(`Headers found: ${headers.join(', ')}`);
            console.log(`Headers found: ${headers.join(', ')}`);
            
            // Find column indices for "Tote Id" and "OLPN"
            const toteIdIndex = headers.findIndex(header => 
                header && header.toString().toLowerCase().includes('tote') && 
                header.toString().toLowerCase().includes('id')
            );
            const olpnIndex = headers.findIndex(header => 
                header && header.toString().toLowerCase().includes('olpn')
            );
            
            if (toteIdIndex === -1) {
                throw new Error('Column "Tote Id" not found in Excel file');
            }
            if (olpnIndex === -1) {
                throw new Error('Column "OLPN" not found in Excel file');
            }
            
            this.writeToLogFile(`Found "Tote Id" at column ${toteIdIndex + 1} (index ${toteIdIndex})`);
            this.writeToLogFile(`Found "OLPN" at column ${olpnIndex + 1} (index ${olpnIndex})`);
            console.log(`Found "Tote Id" at column ${toteIdIndex + 1} (index ${toteIdIndex})`);
            console.log(`Found "OLPN" at column ${olpnIndex + 1} (index ${olpnIndex})`);
            
            // Extract data rows (skip header)
            const dataRows = jsonData.slice(1);
            const toteIds = [];
            const olpns = [];
            
            // Process each data row
            dataRows.forEach((row, index) => {
                const toteId = row[toteIdIndex];
                const olpn = row[olpnIndex];
                
                // Skip empty rows
                if (!toteId || !olpn) {
                    this.writeToLogFile(`Skipping row ${index + 2}: empty toteId or olpn`);
                    console.log(`Skipping row ${index + 2}: empty toteId or olpn`);
                    return;
                }
                
                // Convert to string and trim
                const cleanToteId = toteId.toString().trim();
                const cleanOlpn = olpn.toString().trim();
                
                if (cleanToteId && cleanOlpn) {
                    toteIds.push(cleanToteId);
                    olpns.push(cleanOlpn);
                    this.writeToLogFile(`Row ${index + 2}: ${cleanToteId} / ${cleanOlpn}`);
                    console.log(`Row ${index + 2}: ${cleanToteId} / ${cleanOlpn}`);
                }
            });
            
            if (toteIds.length === 0) {
                throw new Error('No valid data rows found in Excel file');
            }
            
            this.writeToLogFile(`Successfully read ${toteIds.length} data pairs from Excel file`);
            console.log(`Successfully read ${toteIds.length} data pairs from Excel file`);
            
            return {
                toteIds: toteIds,
                olpns: olpns,
                totalPairs: toteIds.length,
                source: filePath
            };
            
        } catch (error) {
            this.writeToLogFile(`Error reading Excel file: ${error.message}`);
            console.error(`Error reading Excel file: ${error.message}`);
            throw error;
        }
    }

    /**
     * Create trip data array from Excel with timestamps in increasing order
     * @param {string} filePath - Path to the Excel file
     * @param {string} startTime - Optional start time (ISO string), defaults to current time
     * @param {number} timeInterval - Time interval between trips in milliseconds, defaults to 1000ms (1 second)
     * @returns {Array} Array of trip data objects with increasing timestamps
     */
    createTripDataArrayFromExcel(filePath, startTime = null, timeInterval = 1000) {
        try {
            console.log(`Reading Excel file: ${filePath}`);
            this.writeToLogFile(`Reading Excel file: ${filePath}`);
            
            // Read Excel data
            const excelData = this.readExcelData(filePath);
            
            if (!excelData || !excelData.toteIds || !excelData.olpns) {
                throw new Error('Invalid Excel data format');
            }
            
            console.log(`Found ${excelData.totalPairs} pairs in Excel file`);
            this.writeToLogFile(`Found ${excelData.totalPairs} pairs in Excel file`);
            
            // Generate base timestamp
            const baseTimestamp = startTime ? new Date(startTime) : new Date();
            
            // Create trip data array with increasing timestamps
            const tripDataArray = excelData.toteIds.map((toteId, index) => {
                const timestamp = new Date(baseTimestamp.getTime() + (index * timeInterval));
                
                return {
                    toteId: toteId,
                    olpn: excelData.olpns[index],
                    timestamp: timestamp.toISOString(),
                };
            });
            
            // Filter out invalid entries
            const validTripData = tripDataArray.filter(data => {
                if (!data.toteId || !data.olpn) {
                    console.log(`Skipping row ${data.rowIndex}: Missing toteId or olpn`);
                    this.writeToLogFile(`Skipping row ${data.rowIndex}: Missing toteId or olpn`);
                    return false;
                }
                return true;
            });
            
            console.log(`Created ${validTripData.length} valid trip data entries`);
            this.writeToLogFile(`Created ${validTripData.length} valid trip data entries`);
            
            // Log timestamp progression
            if (validTripData.length > 0) {
                const firstTimestamp = new Date(validTripData[0].timestamp);
                const lastTimestamp = new Date(validTripData[validTripData.length - 1].timestamp);
                const totalDuration = lastTimestamp.getTime() - firstTimestamp.getTime();
                
                console.log(`Timestamp progression: ${firstTimestamp.toISOString()} to ${lastTimestamp.toISOString()}`);
                console.log(`Total duration: ${totalDuration}ms (${(totalDuration / 1000).toFixed(2)}s)`);
                console.log(`Interval between trips: ${timeInterval}ms`);
                
                this.writeToLogFile(`Timestamp progression: ${firstTimestamp.toISOString()} to ${lastTimestamp.toISOString()}`);
                this.writeToLogFile(`Total duration: ${totalDuration}ms (${(totalDuration / 1000).toFixed(2)}s)`);
                this.writeToLogFile(`Interval between trips: ${timeInterval}ms`);
            }
            
            // Log the first few entries for verification
            const sampleEntries = validTripData.slice(0, 3);
            console.log('Sample entries:');
            this.writeToLogFile('Sample entries:');
            sampleEntries.forEach((entry, index) => {
                const logEntry = `${index + 1}. ${entry.toteId} / ${entry.olpn} / ${entry.timestamp}`;
                console.log(`  ${logEntry}`);
                this.writeToLogFile(`  ${logEntry}`);
            });
            
            if (validTripData.length > 3) {
                console.log(`  ... and ${validTripData.length - 3} more entries`);
                this.writeToLogFile(`  ... and ${validTripData.length - 3} more entries`);
            }
            
            return validTripData;
            
        } catch (error) {
            console.error(`Error creating trip data array from Excel: ${error.message}`);
            this.writeToLogFile(`Error creating trip data array from Excel: ${error.message}`);
            throw error;
        }
    }

    // ===========================
    // NESTJS API CALLS
    // ===========================

    async makeApiCall(endpoint, payload = null, method = 'POST') {
        const url = `${this.baseUrl}${endpoint}`;
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        };

        if (payload && method !== 'GET') {
            options.body = JSON.stringify(payload);
        }

        this.logApiCall(endpoint, payload, method);

        try {
            const response = await fetch(url, options);
            const responseText = await response.text();
            
            let responseData;
            try {
                responseData = JSON.parse(responseText);
            } catch (e) {
                responseData = responseText;
            }

            this.logApiResponse(responseData, endpoint);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${responseData.message || responseText}`);
            }

            return responseData;
        } catch (error) {
            this.log(`API call failed: ${error.message}`, 'error');
            throw error;
        }
    }

    // ===========================
    // LOGGING METHODS
    // ===========================

    log(message, type = 'info') {
        const timestamp = new Date().toISOString();
        const prefix = type === 'error' ? '[ERROR]' : type === 'success' ? '[SUCCESS]' : '[INFO]';
        const logMessage = `${prefix} ${message}`;
        console.log(`${prefix} [${timestamp}] ${message}`);
        this.writeToLogFile(logMessage);
    }

    logApiCall(endpoint, payload, method = 'POST') {
        const apiCallLog = `\nAPI CALL: ${method} ${endpoint}\nPayload: ${JSON.stringify(payload, null, 2)}`;
        console.log(`\nAPI CALL: ${method} ${endpoint}`);
        console.log(`Payload: ${JSON.stringify(payload, null, 2)}`);
        this.writeToLogFile(apiCallLog);
    }

    logApiResponse(response, endpoint) {
        let responseLog = `RESPONSE from ${endpoint}:\n`;
        console.log(`RESPONSE from ${endpoint}:`);
        if (typeof response === 'string') {
            console.log(`   Raw: ${response}`);
            responseLog += `   Raw: ${response}`;
        } else {
            console.log(`   JSON: ${JSON.stringify(response, null, 2)}`);
            responseLog += `   JSON: ${JSON.stringify(response, null, 2)}`;
        }
        this.writeToLogFile(responseLog);
    }

    logWorkflowStep(step, details = '') {
        const elapsed = Date.now() - this.testStartTime;
        const stepLog = `\nWORKFLOW STEP ${step} (${elapsed}ms elapsed):${details ? `\n   ${details}` : ''}`;
        console.log(`\nWORKFLOW STEP ${step} (${elapsed}ms elapsed):`);
        if (details) {
            console.log(`   ${details}`);
        }
        this.writeToLogFile(stepLog);
    }

    // ===========================
    // TRIP WORKFLOW TEST
    // ===========================

    async testTripWorkflow(tripDataArray = null) {
        console.log('Testing Trip Workflow with NestJS API');
        console.log('=====================================');
        
        try {
            // Use provided trip data or create sample data
            const testTripData = tripDataArray || [
                this.createTripData('SGLABSTESTTOTE', '22689222764918900000'),
                this.createTripData('SGL-TST-001', '58459503478030600000'),
                this.createTripData('SGL-TST-002', '74567554868359700000')
            ];
            
            this.log(`Testing Trip Workflow with ${testTripData.length} trip data entries`);
            console.log('Trip Data:');
            testTripData.forEach((data, index) => {
                console.log(`  ${index + 1}. ${data.toteId} / ${data.olpn} / ${data.timestamp}`);
            });
            
            this.logWorkflowStep('1', 'Executing Trip Workflow via NestJS API...');
            
            const workflowResult = await this.makeApiCall('/api/chorus/process-data', {
                tripData: testTripData
            });
            
            if (workflowResult.success) {
                this.log('Trip Workflow completed successfully', 'success');
                console.log(`Summary: ${JSON.stringify(workflowResult.summary, null, 2)}`);
                if (workflowResult.data) {
                    console.log(`Detailed Log: ${workflowResult.data}`);
                }
            } else {
                this.log('Trip Workflow failed', 'error');
                console.log(`Error: ${workflowResult.error}`);
                if (workflowResult.data) {
                    console.log(`Detailed Log: ${workflowResult.data}`);
                }
            }
            
            // Write detailed results to log file
            this.writeSectionToLogFile('TRIP WORKFLOW RESULTS', JSON.stringify(workflowResult, null, 2));
            
            return workflowResult;
            
        } catch (error) {
            this.log(`Trip Workflow test failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // INDIVIDUAL TRIP API TESTS
    // ===========================

    async testIndividualCreateTrip(olpn = null) {
        console.log('Testing Individual Create Trip via NestJS API');
        console.log('==============================================');
        
        const realData = this.getRealData();
        const testOlpn = olpn || realData.olpns[0];
        
        try {
            this.log(`Testing individual trip creation for OLPN: ${testOlpn}`);
            
            this.logWorkflowStep('1', 'Creating trip...');
            const timestamp = this.generateTimestamp();
            
            // Note: This would need a corresponding endpoint in your NestJS app
            // For now, we'll simulate the API call structure
            const result = await this.makeApiCall('/api/chorus/create-trip', {
                olpn: testOlpn,
                timestamp: timestamp
            });
            
            this.log('Individual trip creation successful', 'success');
            console.log(`Result: ${JSON.stringify(result, null, 2)}`);
            
            return { success: true, result };

        } catch (error) {
            this.log(`Individual trip creation failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    async testIndividualStartTracking(toteId = null, olpn = null) {
        console.log('Testing Individual Start Tracking via NestJS API');
        console.log('==================================================');
        
        const realData = this.getRealData();
        const testToteId = toteId || realData.toteIds[0];
        const testOlpn = olpn || realData.olpns[0];
        
        try {
            this.log(`Testing individual start tracking for pair: ${testToteId}/${testOlpn}`);
            
            this.logWorkflowStep('1', 'Starting tracking...');
            
            // Note: This would need a corresponding endpoint in your NestJS app
            const result = await this.makeApiCall('/api/chorus/start-tracking', {
                toteId: testToteId,
                olpn: testOlpn
            });
            
            this.log('Individual start tracking successful', 'success');
            console.log(`Result: ${JSON.stringify(result, null, 2)}`);
            
            return { success: true, result };

        } catch (error) {
            this.log(`Individual start tracking failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    async testIndividualUpdateTripToInTransit(olpn = null) {
        console.log('Testing Individual Update Trip to IN_TRANSIT via NestJS API');
        console.log('============================================================');
        
        const realData = this.getRealData();
        const testOlpn = olpn || realData.olpns[0];
        
        try {
            this.log(`Testing individual trip update to IN_TRANSIT for OLPN: ${testOlpn}`);
            const timestamp = this.generateTimestamp();
            this.logWorkflowStep('1', 'Updating trip to IN_TRANSIT...');
            
            // Note: This would need a corresponding endpoint in your NestJS app
            const result = await this.makeApiCall('/api/chorus/update-trip-in-transit', {
                olpn: testOlpn,
                timestamp: timestamp
            });
            
            this.log('Individual trip update successful', 'success');
            console.log(`Result: ${JSON.stringify(result, null, 2)}`);
            
            return { success: true, result };

        } catch (error) {
            this.log(`Individual trip update failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    async testIndividualEndTrip(olpn = null) {
        console.log('Testing Individual End Trip via NestJS API');
        console.log('============================================');
        
        const realData = this.getRealData();
        const testOlpn = olpn || realData.olpns[0];
        
        try {
            this.log(`Testing individual end trip for OLPN: ${testOlpn}`);
            
            this.logWorkflowStep('1', 'Ending trip...');
            const timestamp = this.generateTimestamp();
            
            // Note: This would need a corresponding endpoint in your NestJS app
            const result = await this.makeApiCall('/api/chorus/end-trip', {
                olpn: testOlpn,
                timestamp: timestamp
            });
            
            this.log('Individual end trip successful', 'success');
            console.log(`Result: ${JSON.stringify(result, null, 2)}`);
            
            return { success: true, result };

        } catch (error) {
            this.log(`Individual end trip failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    async testIndividualEndTracking(toteId = null, olpn = null) {
        console.log('Testing Individual End Tracking via NestJS API');
        console.log('================================================');
        
        const realData = this.getRealData();
        const testToteId = toteId || realData.toteIds[0];
        const testOlpn = olpn || realData.olpns[0];
        
        try {
            this.log(`Testing individual end tracking for pair: ${testToteId}/${testOlpn}`);
            
            this.logWorkflowStep('1', 'Ending tracking...');
            
            // Note: This would need a corresponding endpoint in your NestJS app
            const result = await this.makeApiCall('/api/chorus/end-tracking', {
                toteId: testToteId,
                olpn: testOlpn
            });
            
            this.log('Individual end tracking successful', 'success');
            console.log(`Result: ${JSON.stringify(result, null, 2)}`);
            
            return { success: true, result };

        } catch (error) {
            this.log(`Individual end tracking failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    async testIndividualListTripsInTransit(toteId = null) {
        console.log('Testing Individual List Trips In Transit via NestJS API');
        console.log('=========================================================');
        
        const realData = this.getRealData();
        const testToteId = toteId || realData.toteIds[0];
        
        try {
            this.log(`Testing individual list trips in transit for toteId: ${testToteId}`);
            
            this.logWorkflowStep('1', 'Listing trips in transit...');
            
            // Note: This would need a corresponding endpoint in your NestJS app
            const result = await this.makeApiCall(`/api/chorus/list-trips-in-transit?toteId=${testToteId}`, null, 'GET');
            
            this.log('Individual list trips successful', 'success');
            console.log(`Result: ${JSON.stringify(result, null, 2)}`);
            
            return { success: true, result };

        } catch (error) {
            this.log(`Individual list trips failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // ERROR LOGS TEST
    // ===========================

    async testErrorLogs() {
        console.log('Testing Error Logs API');
        console.log('=======================');
        
        try {
            // Test getting error logs
            this.logWorkflowStep('1', 'Getting error logs...');
            const errorLogs = await this.makeApiCall('/api/error-logs?limit=10', null, 'GET');
            
            this.log(`Retrieved ${errorLogs.total} error logs`, 'success');
            console.log(`Total error logs: ${errorLogs.total}`);
            
            if (errorLogs.logs && errorLogs.logs.length > 0) {
                console.log('Recent error logs:');
                errorLogs.logs.forEach((log, index) => {
                    console.log(`  ${index + 1}. ${log.errorType} - ${log.endpoint} - ${log.errorMessage.substring(0, 50)}...`);
                });
            }

            // Test getting error statistics
            this.logWorkflowStep('2', 'Getting error statistics...');
            const errorStats = await this.makeApiCall('/api/error-logs/stats', null, 'GET');
            
            this.log('Error statistics retrieved successfully', 'success');
            console.log('Error Statistics:');
            console.log(`  Total errors: ${errorStats.total}`);
            console.log('  By error type:');
            Object.entries(errorStats.byErrorType).forEach(([type, count]) => {
                console.log(`    ${type}: ${count}`);
            });
            console.log('  By endpoint:');
            Object.entries(errorStats.byEndpoint).forEach(([endpoint, count]) => {
                console.log(`    ${endpoint}: ${count}`);
            });

            return { errorLogs, errorStats };

        } catch (error) {
            this.log(`Error logs test failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // HELPER FUNCTIONS
    // ===========================

    /**
     * Generate a timestamp in ISO 8601 format for API calls
     * Format: 2025-06-11T08:51:27.706Z
     * @returns {string} ISO timestamp string
     */
    generateTimestamp() {
        return new Date().toISOString();
    }

    /**
     * Create trip data object with current timestamp
     * @param {string} toteId - The tote identifier
     * @param {string} olpn - The OLPN identifier
     * @returns {object} Trip data object with timestamp
     */
    createTripData(toteId, olpn) {
        return {
            toteId: toteId,
            olpn: olpn,
            timestamp: this.generateTimestamp()
        };
    }

    // ===========================
    // REAL DATA FROM USER
    // ===========================

    getRealData() {
        // Test data - Replace with your actual toteIds and olpns
        const toteIds = [
            "SGLABSTESTTOTE",
            "SGL-TST-001",
            "SGL-TST-002",
            "SGL-TST-003",
            "SGL-TST-004",
            "SGL-TST-005",
            "SGL-TST-006",
            "SGL-TST-007",
            "SGL-TST-008",
            "SGL-TST-009",
            "SGL-TST-010",
            "SGL-TST-011",
            "SGL-TST-012"
        ];

        const olpns = [
            "22689222764918900000",
            "58459503478030600000",
            "74567554868359700000",
            "26603835390618000000",
            "30406943617313500000",
            "22310400160640100000",
            "76752651950022400000",
            "49740586620580300000",
            "05083148263806590000",
            "73441533554165000000",
            "60240795421085400000",
            "84012421194206200000",
            "30907689907256900000"
        ];

        return {
            toteIds: toteIds,
            olpns: olpns
        };
    }

    // ===========================
    // CONNECTIVITY TEST
    // ===========================

    async testConnectivity() {
        console.log('Testing NestJS API Connectivity');
        console.log('=================================');
        
        try {
            // Test basic connectivity
            this.log('1. Testing API connectivity...');
            const healthCheck = await this.makeApiCall('/api/error-logs/stats', null, 'GET');
            
            this.log('API connectivity successful', 'success');
            console.log(`   API is responding`);
            console.log(`   Error stats: ${JSON.stringify(healthCheck, null, 2)}`);

            return { success: true, healthCheck };

        } catch (error) {
            this.log(`Connectivity test failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // EXCEL-BASED WORKFLOW TEST
    // ===========================

    async testTripWorkflowFromExcel(excelFilePath) {
        this.writeToLogFile('Testing Trip Workflow from Excel File with NestJS API');
        this.writeToLogFile('=====================================================');
        console.log('Testing Trip Workflow from Excel File with NestJS API');
        console.log('=====================================================');
        
        try {
            // Step 1: Read data from Excel file
            this.logWorkflowStep('1', 'Reading data from Excel file...');
            const tripDataArray = this.createTripDataArrayFromExcel(excelFilePath);
            
            this.log(`Successfully created ${tripDataArray.length} trip data entries from Excel file`, 'success');
            
            // Step 2: Execute the trip workflow with Excel data
            this.logWorkflowStep('2', 'Executing trip workflow with Excel data...');
            const workflowResult = await this.testTripWorkflow(tripDataArray);
            
            // Add Excel file information to the result
            const finalResult = {
                ...workflowResult,
                excelSource: {
                    filePath: excelFilePath,
                    totalPairs: tripDataArray.length,
                    tripData: tripDataArray
                }
            };
            
            this.log('Excel-based workflow completed successfully', 'success');
            this.writeToLogFile(`Excel Source: ${excelFilePath}`);
            this.writeToLogFile(`Total pairs processed: ${tripDataArray.length}`);
            console.log(`Excel Source: ${excelFilePath}`);
            console.log(`Total pairs processed: ${tripDataArray.length}`);
            
            // Write detailed results to log file
            this.writeSectionToLogFile('EXCEL WORKFLOW RESULTS', JSON.stringify(finalResult, null, 2));
            
            return finalResult;
            
        } catch (error) {
            this.log(`Excel-based workflow failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // MAIN TEST RUNNER
    // ===========================

    async runAllTests() {
        this.writeToLogFile('Starting Chorus NestJS API Tests with Real Data');
        this.writeToLogFile('================================================');
        this.writeToLogFile(' WARNING: This will make actual API calls to Chorus via NestJS!');
        this.writeToLogFile('');
        
        console.log('Starting Chorus NestJS API Tests with Real Data');
        console.log('================================================');
        console.log(' WARNING: This will make actual API calls to Chorus via NestJS!');
        console.log('');

        const results = {};

        try {
            // Test 1: Connectivity
            results.connectivity = await this.testConnectivity();

            // Test 2: Error Logs
            results.errorLogs = await this.testErrorLogs();

            // Test 3: Trip Workflow with sample data
            results.tripWorkflow = await this.testTripWorkflow();

            // Test 4: Individual API Tests
            results.individualTests = {
                createTrip: await this.testIndividualCreateTrip(),
                startTracking: await this.testIndividualStartTracking(),
                updateTripInTransit: await this.testIndividualUpdateTripToInTransit(),
                endTrip: await this.testIndividualEndTrip(),
                endTracking: await this.testIndividualEndTracking(),
                listTripsInTransit: await this.testIndividualListTripsInTransit()
            };

            // Test 5: Trip Workflow from Excel (uncomment and provide file path)
            // results.excelWorkflow = await this.testTripWorkflowFromExcel('./data/sample-data.xlsx');

            const totalTime = Date.now() - this.testStartTime;
            const summary = {
                totalTime: totalTime,
                logFile: this.logFile,
                results: results,
                timestamp: new Date().toISOString()
            };
            
            this.writeSummaryToLogFile(summary);
            this.writeToLogFile('All tests completed successfully!');
            this.writeToLogFile(`Total test time: ${totalTime}ms`);
            this.writeToLogFile(`Log file saved to: ${this.logFile}`);
            
            console.log('All tests completed successfully!');
            console.log(`Total test time: ${totalTime}ms`);
            console.log(`Log file saved to: ${this.logFile}`);
            console.log('Check the logs above for detailed results.');

        } catch (error) {
            this.writeToLogFile(`Test suite failed: ${error.message}`);
            this.writeToLogFile(`Stack trace: ${error.stack}`);
            console.error('Test suite failed:', error.message);
            console.error('Stack trace:', error.stack);
        }

        return results;
    }

    async runSpecificTest(testName, ...args) {
        console.log(`Running specific test: ${testName}`);
        console.log('=====================================');
        
        try {
            let result;
            
            switch (testName.toLowerCase()) {
                case 'connectivity':
                    result = await this.testConnectivity();
                    break;
                case 'errorlogs':
                case 'error-logs':
                    result = await this.testErrorLogs();
                    break;
                case 'tripworkflow':
                case 'trip-workflow':
                    result = await this.testTripWorkflow();
                    break;
                case 'createtrip':
                case 'create-trip':
                    result = await this.testIndividualCreateTrip(args[0]);
                    break;
                case 'starttracking':
                case 'start-tracking':
                    result = await this.testIndividualStartTracking(args[0], args[1]);
                    break;
                case 'updatetrip':
                case 'update-trip':
                    result = await this.testIndividualUpdateTripToInTransit(args[0]);
                    break;
                case 'endtrip':
                case 'end-trip':
                    result = await this.testIndividualEndTrip(args[0]);
                    break;
                case 'endtracking':
                case 'end-tracking':
                    result = await this.testIndividualEndTracking(args[0], args[1]);
                    break;
                case 'listtrips':
                case 'list-trips':
                    result = await this.testIndividualListTripsInTransit(args[0]);
                    break;
                case 'excel':
                case 'excel-workflow':
                    result = await this.testTripWorkflowFromExcel(args[0] || './data/sample-data.xlsx');
                    break;
                default:
                    throw new Error(`Unknown test: ${testName}`);
            }
            
            console.log(`Test ${testName} completed successfully!`);
            return result;
            
        } catch (error) {
            console.error(`Test ${testName} failed:`, error.message);
            throw error;
        }
    }
}

// ===========================
// USAGE
// ===========================

async function main() {
    const args = process.argv.slice(2);
    const tester = new NestJSRealDataTester('http://localhost:3000');
    
    if (args.length === 0) {
        // No arguments - run all tests
        console.log('No arguments provided. Running all tests...');
        await tester.runAllTests();
    } else {
        // Specific test requested
        const testName = args[0];
        const testArgs = args.slice(1);
        
        console.log(`Running test: ${testName}`);
        if (testArgs.length > 0) {
            console.log(`With arguments: ${testArgs.join(', ')}`);
        }
        
        await tester.runSpecificTest(testName, ...testArgs);
    }
    
    // Note: All logs are automatically saved to a timestamped file in the ./data directory
    // Example: chorus-nestjs-test-logs-2024-01-15T10-30-45-123Z.txt
}

// ===========================
// COMMAND LINE USAGE
// ===========================

function showUsage() {
    console.log(`
Chorus NestJS API Test Runner
=============================

Usage:
  node test-with-nestjs.js [test-name] [arguments...]

Available Tests:
  (no args)                    - Run all tests
  connectivity                 - Test API connectivity
  error-logs                   - Test error logging database
  trip-workflow               - Test main trip workflow
  create-trip [olpn]          - Test individual trip creation
  start-tracking [toteId] [olpn] - Test individual start tracking
  update-trip [olpn]          - Test individual trip update to IN_TRANSIT
  end-trip [olpn]             - Test individual trip ending
  end-tracking [toteId] [olpn] - Test individual end tracking
  list-trips [toteId]         - Test list trips in transit
  excel-workflow [file-path]  - Test workflow with Excel data

Examples:
  node test-with-nestjs.js
  node test-with-nestjs.js connectivity
  node test-with-nestjs.js create-trip 22689222764918900000
  node test-with-nestjs.js start-tracking SGLABSTESTTOTE 22689222764918900000
  node test-with-nestjs.js excel-workflow ./data/sample-data.xlsx
  node test-with-nestjs.js list-trips SGLABSTESTTOTE

Note: Make sure your NestJS application is running on http://localhost:3000
`);
}

// Check for help argument
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showUsage();
    process.exit(0);
}

// Export for use in other modules
module.exports = NestJSRealDataTester;

// Run tests if this file is executed directly
if (require.main === module) {
    main();
} 