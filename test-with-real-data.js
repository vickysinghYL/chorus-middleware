// Y&L Consulting
// test-with-real-data.js used to test the Chorus API with real data

const NewChorusApiService = require('./services/chorusApiServiceNode');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

class RealDataTester {
    constructor() {
        this.chorusService = new NewChorusApiService();
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
        const logFileName = `chorus-test-logs-${timestamp}.txt`;
        this.logFile = path.join('./data', logFileName);
        
        // Ensure data directory exists
        const dataDir = path.dirname(this.logFile);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        console.log(`Log file initialized: ${this.logFile}`);
        this.writeToLogFile(`=== CHORUS API TEST LOGS ===`);
        this.writeToLogFile(`Started: ${new Date().toISOString()}`);
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

    /**
     * Create trip data array with custom timestamp progression
     * @param {Array} dataArray - Array of objects with toteId and olpn
     * @param {string} startTime - Optional start time (ISO string), defaults to current time
     * @param {number} timeInterval - Time interval between trips in milliseconds, defaults to 1000ms (1 second)
     * @returns {Array} Array of trip data objects with increasing timestamps
     */
    createTripDataArrayWithProgression(dataArray, startTime = null, timeInterval = 1000) {
        try {
            if (!Array.isArray(dataArray) || dataArray.length === 0) {
                throw new Error('Invalid or empty data array');
            }
            
            console.log(`Creating trip data array with progression for ${dataArray.length} items`);
            this.writeToLogFile(`Creating trip data array with progression for ${dataArray.length} items`);
            
            // Generate base timestamp
            const baseTimestamp = startTime ? new Date(startTime) : new Date();
            
            // Create trip data array with increasing timestamps
            const tripDataArray = dataArray.map((item, index) => {
                const timestamp = new Date(baseTimestamp.getTime() + (index * timeInterval));
                
                return {
                    toteId: item.toteId || item['Tote Id'] || item['ToteId'] || item['tote_id'] || item['Tote ID'],
                    olpn: item.olpn || item['OLPN'] || item['olpn'],
                    timestamp: timestamp.toISOString(),
                    index: index + 1 // For reference
                };
            });
            
            // Filter out invalid entries
            const validTripData = tripDataArray.filter(data => {
                if (!data.toteId || !data.olpn) {
                    console.log(`Skipping item ${data.index}: Missing toteId or olpn`);
                    this.writeToLogFile(`Skipping item ${data.index}: Missing toteId or olpn`);
                    return false;
                }
                return true;
            });
            
            console.log(`Created ${validTripData.length} valid trip data entries with progression`);
            this.writeToLogFile(`Created ${validTripData.length} valid trip data entries with progression`);
            
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
            
            return validTripData;
            
        } catch (error) {
            console.error(`Error creating trip data array with progression: ${error.message}`);
            this.writeToLogFile(`Error creating trip data array with progression: ${error.message}`);
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
    // EXCEL-BASED WORKFLOW TEST
    // ===========================

    async testEndCreateEndWorkflowFromExcel(excelFilePath) {
        this.writeToLogFile('Testing End-Create-End Workflow from Excel File');
        this.writeToLogFile('================================================');
        console.log('Testing End-Create-End Workflow from Excel File');
        console.log('================================================');
        
        try {
            // Step 1: Read data from Excel file
            this.logWorkflowStep('1', 'Reading data from Excel file...');
            const excelData = this.readExcelData(excelFilePath);
            
            this.log(`Successfully read ${excelData.totalPairs} pairs from Excel file`, 'success');
            this.writeToLogFile(`ToteIds: ${excelData.toteIds.join(', ')}`);
            this.writeToLogFile(`OLPNs: ${excelData.olpns.join(', ')}`);
            console.log(`ToteIds: ${excelData.toteIds.join(', ')}`);
            console.log(`OLPNs: ${excelData.olpns.join(', ')}`);
            
            // Step 2: Execute the end-create-end workflow with Excel data
            this.logWorkflowStep('2', 'Executing end-create-end workflow with Excel data...');
            const workflowResult = await this.testEndCreateEndWorkflow(excelData.toteIds, excelData.olpns);
            
            // Add Excel file information to the result
            const finalResult = {
                ...workflowResult,
                excelSource: {
                    filePath: excelFilePath,
                    totalPairs: excelData.totalPairs,
                    toteIds: excelData.toteIds,
                    olpns: excelData.olpns
                }
            };
            
            this.log('Excel-based workflow completed successfully', 'success');
            this.writeToLogFile(`Excel Source: ${excelFilePath}`);
            this.writeToLogFile(`Total pairs processed: ${excelData.totalPairs}`);
            console.log(`Excel Source: ${excelFilePath}`);
            console.log(`Total pairs processed: ${excelData.totalPairs}`);
            
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
    // TRIP WORKFLOW TEST (Following Flowchart)
    // ===========================

    async testTripWorkflow(tripDataArray = null) {
        console.log('Testing Trip Workflow (Following Flowchart)');
        console.log('============================================');
        
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
            
            this.logWorkflowStep('1', 'Executing Trip Workflow following flowchart...');
            const workflowResult = await this.chorusService.executeTripWorkflow(testTripData);
            
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
            // Sample of real toteIds and olpns from the user's data
            toteIds: toteIds,
            olpns: olpns
        };
    }

    // ===========================
    // BASIC CONNECTIVITY TEST
    // ===========================

    async testConnectivity() {
        console.log('Testing Chorus API Connectivity with Real Data');
        console.log('==================================================');
        
        try {
            // Test authentication
            this.log('1. Testing authentication...');
            const authHeader = await this.chorusService.getAuthHeader();
            this.log('Authentication successful', 'success');
            console.log(`   Auth header: ${authHeader.substring(0, 50)}...`);

            // Test basic API call with real toteId
            this.log('2. Testing API connection with real toteId...');
            const realData = this.getRealData();
            const testToteId = realData.toteIds[0];
            
            this.logApiCall('v1alpha1/trips:list', {
                tripStages: ["IN_TRANSIT"],
                assetIdentifier: { customerId: testToteId }
            });
            
            const listResult = await this.chorusService.listAllTripsInTransit(testToteId);
            
            this.logApiResponse(listResult.raw, 'v1alpha1/trips:list');
            this.log(`API connection successful`, 'success');
            this.log(`   Found ${listResult.customerIds.length} trips for ${testToteId}`, 'success');
            
            if (listResult.customerIds.length > 0) {
                console.log(`   Customer IDs found: ${listResult.customerIds.join(', ')}`);
            }

            return { success: true, listResult };

        } catch (error) {
            this.log(`Connectivity test failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // SINGLE ITEM TEST
    // ===========================

    async testSingleItem() {
        console.log('\nTesting Single Item Workflow');
        console.log('===============================');
        
        const realData = this.getRealData();
        const testToteId = realData.toteIds[0];
        const testOlpn = realData.olpns[0];
        
        try {
            this.log(`Testing with: ${testToteId} / ${testOlpn}`);

            // Test Create-Track-Update workflow
            this.logWorkflowStep('1', 'Creating trip and starting tracking...');
            const createResult = await this.chorusService.executeCreateTrackUpdateWorkflow([
                this.createTripData(testToteId, testOlpn)
            ]);
            
            if (createResult.success) {
                this.log('Create-Track-Update workflow successful', 'success');
                console.log(`   Summary: ${JSON.stringify(createResult.summary, null, 2)}`);
                if (createResult.data) {
                    console.log(`   Detailed Log: ${createResult.data}`);
                }
            } else {
                this.log('Create-Track-Update workflow failed', 'error');
                console.log(`   Error: ${createResult.error}`);
                if (createResult.data) {
                    console.log(`   Detailed Log: ${createResult.data}`);
                }
                return;
            }

            // Wait for state to settle
            this.logWorkflowStep('2', 'Waiting for state to settle...');
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Test End All Trips workflow
            this.logWorkflowStep('3', 'Ending trip...');
            const endResult = await this.chorusService.executeEndAllTripsWorkflow([this.createTripData(testToteId, testOlpn)]);
            
            if (endResult.success) {
                this.log('End All Trips workflow successful', 'success');
                console.log(`   Summary: ${JSON.stringify(endResult.summary, null, 2)}`);
                if (endResult.data) {
                    console.log(`   Detailed Log: ${endResult.data}`);
                }
            } else {
                this.log('End All Trips workflow failed', 'error');
                console.log(`   Error: ${endResult.error}`);
                if (endResult.data) {
                    console.log(`   Detailed Log: ${endResult.data}`);
                }
            }

            return { createResult, endResult };

        } catch (error) {
            this.log(`Single item test failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // SMALL BATCH TEST
    // ===========================

    async testSmallBatch() {
        console.log('Testing Small Batch (3 items)');
        console.log('=================================');
        
        const realData = this.getRealData();
        const batchToteIds = realData.toteIds.slice(0, 3);
        const batchOlpns = realData.olpns.slice(0, 3);
        
        try {
            this.log(`Testing batch: ${batchToteIds.length} items`);
            console.log(`ToteIds: ${batchToteIds.join(', ')}`);
            console.log(`OLPNs: ${batchOlpns.join(', ')}`);

            // Test Create-Track-Update workflow
            this.logWorkflowStep('1', 'Creating trips and starting tracking...');
            const createResult = await this.chorusService.executeCreateTrackUpdateWorkflow(
                batchToteIds.map((toteId, index) => this.createTripData(toteId, batchOlpns[index]))
            );
            
            if (createResult.success) {
                this.log('Batch create workflow successful', 'success');
                console.log(`Summary: ${JSON.stringify(createResult.summary, null, 2)}`);
                if (createResult.data) {
                    console.log(`   Detailed Log: ${createResult.data}`);
                }
            } else {
                this.log('Batch create workflow failed', 'error');
                console.log(`Error: ${createResult.error}`);
                if (createResult.data) {
                    console.log(`Detailed Log: ${createResult.data}`);
                }
                return;
            }

            // Wait for state to settle
            this.logWorkflowStep('2', 'Waiting for state to settle...');
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Test End All Trips workflow
            this.logWorkflowStep('3', 'Ending trips...');
            const endResult = await this.chorusService.executeEndAllTripsWorkflow(
                batchToteIds.map((toteId, index) => this.createTripData(toteId, batchOlpns[index]))
            );
            
            if (endResult.success) {
                this.log('Batch end workflow successful', 'success');
                console.log(`Summary: ${JSON.stringify(endResult.summary, null, 2)}`);
                if (endResult.data) {
                    console.log(`Detailed Log: ${endResult.data}`);
                }
            } else {
                this.log('Batch end workflow failed', 'error');
                console.log(`Error: ${endResult.error}`);
                if (endResult.data) {
                    console.log(`Detailed Log: ${endResult.data}`);
                }
            }

            return { createResult, endResult };

        } catch (error) {
            this.log(`Small batch test failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // INDIVIDUAL API OPERATION TESTS
    // ===========================

    async testIndividualCreateTrip(olpn = null) {
        console.log('Testing Individual Create Trip');
        console.log('==================================');
        
        const realData = this.getRealData();
        const testOlpn = olpn || realData.olpns[0];
        
        try {
            this.log(`Testing individual trip creation for OLPN: ${testOlpn}`);
            
            this.logWorkflowStep('1', 'Creating trip...');
            const timestamp = this.generateTimestamp();
            const result = await this.chorusService.createTrip(testOlpn, timestamp);
            
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
        console.log('Testing Individual Start Tracking');
        console.log('=====================================');
        
        const realData = this.getRealData();
        const testToteId = toteId || realData.toteIds[0];
        const testOlpn = olpn || realData.olpns[0];
        
        try {
            this.log(`Testing individual start tracking for pair: ${testToteId}/${testOlpn}`);
            
            this.logWorkflowStep('1', 'Starting tracking...');
            const result = await this.chorusService.startTracking(testToteId, testOlpn);
            
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
        console.log('Testing Individual Update Trip to IN_TRANSIT');
        console.log('================================================');
        
        const realData = this.getRealData();
        const testOlpn = olpn || realData.olpns[0];
        
        try {
            this.log(`Testing individual trip update to IN_TRANSIT for OLPN: ${testOlpn}`);
            const timestamp = this.generateTimestamp();
            this.logWorkflowStep('1', 'Updating trip to IN_TRANSIT...');
            const result = await this.chorusService.updateTripToInTransit(testOlpn, timestamp);
            
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
        console.log('Testing Individual End Trip');
        console.log('===============================');
        
        const realData = this.getRealData();
        const testOlpn = olpn || realData.olpns[0];
        
        try {
            this.log(`Testing individual end trip for OLPN: ${testOlpn}`);
            
            this.logWorkflowStep('1', 'Ending trip...');
            const timestamp = this.generateTimestamp();
            const result = await this.chorusService.endTrip(testOlpn, timestamp);
            
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
        console.log('Testing Individual End Tracking');
        console.log('===================================');
        
        const realData = this.getRealData();
        const testToteId = toteId || realData.toteIds[0];
        const testOlpn = olpn || realData.olpns[0];
        
        try {
            this.log(`Testing individual end tracking for pair: ${testToteId}/${testOlpn}`);
            
            this.logWorkflowStep('1', 'Ending tracking...');
            const result = await this.chorusService.endTracking(testToteId, testOlpn);
            
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
        console.log('Testing Individual List Trips In Transit');
        console.log('============================================');
        
        const realData = this.getRealData();
        const testToteId = toteId || realData.toteIds[0];
        
        try {
            this.log(`Testing individual list trips in transit for toteId: ${testToteId}`);
            
            this.logWorkflowStep('1', 'Listing trips in transit...');
            const result = await this.chorusService.listAllTripsInTransit(testToteId);
            
            this.log('Individual list trips successful', 'success');
            console.log(`Found ${result.customerIds.length} trips`);
            console.log(`Customer IDs: ${result.customerIds.join(', ')}`);
            console.log(`Tote/OLPN Pairs: ${JSON.stringify(result.toteOlpnPairs)}`);
            console.log(`Raw Response: ${JSON.stringify(result.raw, null, 2)}`);
            
            return { success: true, result };

        } catch (error) {
            this.log(`Individual list trips failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // CREATE TRIPS ONLY TEST (without tracking)
    // ===========================

    async testCreateTripsOnly(olpns = null) {
        console.log('Testing Create Trips Only (No Tracking)');
        console.log('===========================================');
        
        const realData = this.getRealData();
        const testOlpns = olpns || realData.olpns;
        
        try {
            this.log(`Testing Create Trips Only with ${testOlpns.length} OLPNs`);
            console.log(`OLPNs: ${testOlpns.join(', ')}`);

            this.logWorkflowStep('1', 'Creating trips for all OLPNs...');
            
            const results = [];
            let successCount = 0;
            let errorCount = 0;
            
            for (let i = 0; i < testOlpns.length; i++) {
                const olpn = testOlpns[i];
                try {
                    console.log(`Creating trip for OLPN: ${olpn}`);
                    const result = await this.chorusService.createTrip(olpn);
                    console.log(`Trip created successfully for ${olpn}`);
                    results.push({ olpn, success: true, result });
                    successCount++;
                    
                    // Small delay between creations
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                } catch (error) {
                    console.log(`Failed to create trip for ${olpn}: ${error.message}`);
                    results.push({ olpn, success: false, error: error.message });
                    errorCount++;
                }
            }
            
            const summary = {
                totalOlpns: testOlpns.length,
                successful: successCount,
                failed: errorCount,
                successRate: `${((successCount / testOlpns.length) * 100).toFixed(1)}%`
            };
            
            if (errorCount === 0) {
                this.log('Create Trips Only workflow successful', 'success');
            } else {
                this.log(`Create Trips Only workflow completed with ${errorCount} errors`, 'info');
            }
            
            console.log(`Summary: ${JSON.stringify(summary, null, 2)}`);
            console.log(`Results: ${JSON.stringify(results, null, 2)}`);

            return { success: errorCount === 0, results, summary };

        } catch (error) {
            this.log(`Create Trips Only test failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // CREATE ALL TRIPS TEST
    // ===========================

    async testCreateAllTrips(toteIds = null, olpns = null) {
        console.log('Testing Create All Trips Workflow');
        console.log('=====================================');
        
        const realData = this.getRealData();
        const testToteIds = toteIds || realData.toteIds;
        const testOlpns = olpns || realData.olpns;
        
        try {
            this.log(`Testing Create All Trips with ${testToteIds.length} pairs`);
            console.log(`ToteIds: ${testToteIds.join(', ')}`);
            console.log(`OLPNs: ${testOlpns.join(', ')}`);

            this.logWorkflowStep('1', 'Creating trips and starting tracking for all pairs...');
            const createResult = await this.chorusService.executeCreateTrackUpdateWorkflow(
                testToteIds.map((toteId, index) => this.createTripData(toteId, testOlpns[index]))
            );
            
            if (createResult.success) {
                this.log('Create All Trips workflow successful', 'success');
                console.log(`Summary: ${JSON.stringify(createResult.summary, null, 2)}`);
                if (createResult.data) {
                    console.log(`Detailed Log: ${createResult.data}`);
                }
            } else {
                this.log('Create All Trips workflow failed', 'error');
                console.log(`Error: ${createResult.error}`);
                if (createResult.data) {
                    console.log(`Detailed Log: ${createResult.data}`);
                }
            }

            return createResult;

        } catch (error) {
            this.log(`Create All Trips test failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // END ALL TRIPS TEST
    // ===========================

    async testEndAllTrips(toteIds = null) {
        console.log('Testing End All Trips Workflow');
        console.log('==================================');
        
        const realData = this.getRealData();
        const toteIdsToEnd = toteIds || realData.toteIds;
        
        try {
            this.log(`Testing End All Trips with ${toteIdsToEnd.length} toteIds`);
            console.log(`ToteIds: ${toteIdsToEnd.join(', ')}`);

            this.logWorkflowStep('1', 'Finding and ending all trips in transit...');
            const endResult = await this.chorusService.executeEndAllTripsWorkflow(
                toteIdsToEnd.map(toteId => this.createTripData(toteId, 'default-olpn'))
            );
            
            if (endResult.success) {
                this.log('End All Trips workflow successful', 'success');
                console.log(`Summary: ${JSON.stringify(endResult.summary, null, 2)}`);
                if (endResult.data) {
                    console.log(`Detailed Log: ${endResult.data}`);
                }
            } else {
                this.log('End All Trips workflow failed', 'error');
                console.log(`Error: ${endResult.error}`);
                if (endResult.data) {
                    console.log(`Detailed Log: ${endResult.data}`);
                }
            }

            return endResult;

        } catch (error) {
            this.log(`End All Trips test failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // END-CREATE-END WORKFLOW TEST
    // ===========================

    async testEndCreateEndWorkflow(tripDataArray = null) {
        console.log('Testing End-Create-End Workflow with All Totes');
        console.log('===============================================');
        
        // Use provided trip data or create from real data
        let testTripData;
        if (tripDataArray) {
            testTripData = tripDataArray;
        } else {
            const realData = this.getRealData();
            testTripData = realData.toteIds.map((toteId, index) => 
                this.createTripData(toteId, realData.olpns[index])
            );
        }
        
        try {
            this.log(`Testing End-Create-End workflow for ${testTripData.length} pairs`);
            console.log('Trip Data:');
            testTripData.forEach((data, index) => {
                console.log(`  ${index + 1}. ${data.toteId} / ${data.olpn} / ${data.timestamp}`);
            });

            // Step 1: End all existing trips for all toteIds
            this.logWorkflowStep('1', 'Ending all existing trips for all toteIds...');
            const toteIdsToEnd = testTripData.map(data => data.toteId);
            const endAllResult = await this.chorusService.executeEndAllTripsWorkflow(
                toteIdsToEnd.map(toteId => this.createTripData(toteId, 'default-olpn'))
            );
            
            if (endAllResult.success) {
                this.log('End all trips workflow successful', 'success');
                console.log(`   Summary: ${JSON.stringify(endAllResult.summary, null, 2)}`);
                if (endAllResult.data) {
                    console.log(`   Detailed Log: ${endAllResult.data}`);
                }
            } else {
                this.log('End all trips workflow failed', 'error');
                console.log(`   Error: ${endAllResult.error}`);
                if (endAllResult.data) {
                    console.log(`   Detailed Log: ${endAllResult.data}`);
                }
                return { success: false, step: 'end_all', result: endAllResult };
            }

            // Wait for state to settle after ending trips
            this.logWorkflowStep('2', 'Waiting for state to settle after ending trips...');

                        // Step 3: End existing trips and create new trips for each pair
            this.logWorkflowStep('3', 'Ending existing trips and creating new trips for each pair...');
            const createResults = [];
            let createSuccessCount = 0;
            let createErrorCount = 0;
            
            for (let i = 0; i < testTripData.length; i++) {
                const { toteId, olpn, timestamp } = testTripData[i];
                
                try {
                    this.writeToLogFile(`Processing pair ${i + 1}/${testTripData.length}: ${toteId}/${olpn}`);
                    console.log(`Processing pair ${i + 1}/${testTripData.length}: ${toteId}/${olpn}`);
                    
                    // Step 3a: End existing trips for this specific pair
                    this.writeToLogFile(`  Ending existing trips for pair: ${toteId}/${olpn}`);
                    console.log(`  Ending existing trips for pair: ${toteId}/${olpn}`);
                    try {
                        // List trips in transit for this specific toteId
                        const { customerIds, toteOlpnPairs } = await this.chorusService.listAllTripsInTransit(toteId);
                        
                        if (customerIds.length > 0) {
                            this.writeToLogFile(`  Found ${customerIds.length} existing trips for ${toteId}`);
                            console.log(`  Found ${customerIds.length} existing trips for ${toteId}`);
                            
                            // End all trips for this toteId
                            for (const customerId of customerIds) {
                                try {
                                    this.writeToLogFile(`    Ending trip for OLPN: ${customerId}`);
                                    console.log(`    Ending trip for OLPN: ${customerId}`);
                                    await this.chorusService.endTrip(customerId, timestamp);
                                    this.writeToLogFile(`    Trip ended successfully for ${customerId}`);
                                    console.log(`    Trip ended successfully for ${customerId}`);
                                    await new Promise(resolve => setTimeout(resolve, 100));
                                } catch (error) {
                                    this.writeToLogFile(`    Failed to end trip for ${customerId}: ${error.message}`);
                                    console.log(`    Failed to end trip for ${customerId}: ${error.message}`);
                                }
                            }
                            
                            // Wait for trip ending to settle
                            await new Promise(resolve => setTimeout(resolve, 300));
                            
                            // End tracking for all pairs of this toteId
                            for (const [currentToteId, currentOlpn] of toteOlpnPairs) {
                                try {
                                    this.writeToLogFile(`    Ending tracking for pair: ${currentToteId}/${currentOlpn}`);
                                    console.log(`    Ending tracking for pair: ${currentToteId}/${currentOlpn}`);
                                    await this.chorusService.endTracking(currentToteId, currentOlpn);
                                    this.writeToLogFile(`    Tracking ended successfully for ${currentToteId}/${currentOlpn}`);
                                    console.log(`    Tracking ended successfully for ${currentToteId}/${currentOlpn}`);
                                    await new Promise(resolve => setTimeout(resolve, 100));
                                } catch (error) {
                                    this.writeToLogFile(`    Failed to end tracking for ${currentToteId}/${currentOlpn}: ${error.message}`);
                                    console.log(`    Failed to end tracking for ${currentToteId}/${currentOlpn}: ${error.message}`);
                                }
                            }
                            
                            // Wait for tracking ending to settle
                            await new Promise(resolve => setTimeout(resolve, 300));
                        } else {
                            this.writeToLogFile(`  No existing trips found for ${toteId}`);
                            console.log(`  No existing trips found for ${toteId}`);
                        }
                    } catch (error) {
                        this.writeToLogFile(`  Error ending existing trips for ${toteId}: ${error.message}`);
                        console.log(`  Error ending existing trips for ${toteId}: ${error.message}`);
                    }
                    
                    // Step 3b: Create new trip for this OLPN
                    this.writeToLogFile(`  Creating new trip for OLPN: ${olpn}`);
                    console.log(`  Creating new trip for OLPN: ${olpn}`);
                    const result = await this.chorusService.createTrip(olpn, timestamp);
                    this.writeToLogFile(`  Trip created successfully for ${olpn}`);
                    console.log(`  Trip created successfully for ${olpn}`);
                    createResults.push({ toteId, olpn, success: true, result });
                    createSuccessCount++;
                    
                    // Small delay between pairs
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                } catch (error) {
                    this.writeToLogFile(`Failed to process pair ${toteId}/${olpn}: ${error.message}`);
                    console.log(`Failed to process pair ${toteId}/${olpn}: ${error.message}`);
                    createResults.push({ toteId, olpn, success: false, error: error.message });
                    createErrorCount++;
                }
            }
            
            if (createErrorCount === 0) {
                this.log('All pairs processed successfully (ended existing trips and created new trips)', 'success');
            } else {
                this.log(`Pair processing completed with ${createErrorCount} errors`, 'info');
            }
            console.log(`Create Summary: ${createSuccessCount} successful, ${createErrorCount} failed`);

            // Wait for trip creation to settle
            this.logWorkflowStep('4', 'Waiting for trip creation to settle...');
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Step 5: Start tracking for all pairs
            this.logWorkflowStep('5', 'Starting tracking for all pairs...');
            const startTrackingResults = [];
            let startTrackingSuccessCount = 0;
            let startTrackingErrorCount = 0;
            
            for (let i = 0; i < testTripData.length; i++) {
                const { toteId, olpn } = testTripData[i];
                try {
                    console.log(`Starting tracking for pair: ${toteId}/${olpn}`);
                    const result = await this.chorusService.startTracking(toteId, olpn);
                    console.log(`Tracking started successfully for ${toteId}/${olpn}`);
                    startTrackingResults.push({ toteId, olpn, success: true, result });
                    startTrackingSuccessCount++;
                    
                    // Small delay between operations
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                } catch (error) {
                    console.log(`Failed to start tracking for ${toteId}/${olpn}: ${error.message}`);
                    startTrackingResults.push({ toteId, olpn, success: false, error: error.message });
                    startTrackingErrorCount++;
                }
            }
            
            if (startTrackingErrorCount === 0) {
                this.log('All tracking started successfully', 'success');
            } else {
                this.log(`Tracking start completed with ${startTrackingErrorCount} errors`, 'info');
            }
            console.log(`Start Tracking Summary: ${startTrackingSuccessCount} successful, ${startTrackingErrorCount} failed`);

            // Wait for tracking to settle
            this.logWorkflowStep('6', 'Waiting for tracking to settle...');
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Step 7: Update all trips to IN_TRANSIT
            this.logWorkflowStep('7', 'Updating all trips to IN_TRANSIT...');
            const updateResults = [];
            let updateSuccessCount = 0;
            let updateErrorCount = 0;
            
            for (let i = 0; i < testTripData.length; i++) {
                const { olpn, timestamp } = testTripData[i];
                try {
                    console.log(`Updating trip to IN_TRANSIT for OLPN: ${olpn}`);
                    const result = await this.chorusService.updateTripToInTransit(olpn, timestamp);
                    console.log(`Trip updated successfully for ${olpn}`);
                    updateResults.push({ olpn, success: true, result });
                    updateSuccessCount++;
                    
                    // Small delay between operations
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                } catch (error) {
                    console.log(`Failed to update trip for ${olpn}: ${error.message}`);
                    updateResults.push({ olpn, success: false, error: error.message });
                    updateErrorCount++;
                }
            }
            
            if (updateErrorCount === 0) {
                this.log('All trips updated to IN_TRANSIT successfully', 'success');
            } else {
                this.log(`Trip updates completed with ${updateErrorCount} errors`, 'info');
            }
            console.log(`Update Summary: ${updateSuccessCount} successful, ${updateErrorCount} failed`);

            // Wait for trip state to settle
            this.logWorkflowStep('8', 'Waiting for trip state to settle...');
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Step 9: End all trips
            this.logWorkflowStep('9', 'Ending all trips...');
            const endTripResults = [];
            let endTripSuccessCount = 0;
            let endTripErrorCount = 0;
            
            for (let i = 0; i < testTripData.length; i++) {
                const { olpn, timestamp } = testTripData[i];
                try {
                    console.log(`Ending trip for OLPN: ${olpn}`);
                    const result = await this.chorusService.endTrip(olpn, timestamp);
                    console.log(`Trip ended successfully for ${olpn}`);
                    endTripResults.push({ olpn, success: true, result });
                    endTripSuccessCount++;
                    
                    // Small delay between operations
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                } catch (error) {
                    console.log(`Failed to end trip for ${olpn}: ${error.message}`);
                    endTripResults.push({ olpn, success: false, error: error.message });
                    endTripErrorCount++;
                }
            }
            
            if (endTripErrorCount === 0) {
                this.log('All trips ended successfully', 'success');
            } else {
                this.log(`Trip ending completed with ${endTripErrorCount} errors`, 'info');
            }
            console.log(`End Trip Summary: ${endTripSuccessCount} successful, ${endTripErrorCount} failed`);

            // Wait for trip ending to settle
            this.logWorkflowStep('10', 'Waiting for trip ending to settle...');
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Step 11: End tracking for all pairs
            this.logWorkflowStep('11', 'Ending tracking for all pairs...');
            const endTrackingResults = [];
            let endTrackingSuccessCount = 0;
            let endTrackingErrorCount = 0;
            
            for (let i = 0; i < testTripData.length; i++) {
                const { toteId, olpn, timestamp } = testTripData[i];
                try {
                    console.log(`Ending tracking for pair: ${toteId}/${olpn}`);
                    const result = await this.chorusService.endTracking(toteId, olpn);
                    console.log(`Tracking ended successfully for ${toteId}/${olpn}`);
                    endTrackingResults.push({ toteId, olpn, success: true, result });
                    endTrackingSuccessCount++;
                    
                    // Small delay between operations
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                } catch (error) {
                    console.log(`Failed to end tracking for ${toteId}/${olpn}: ${error.message}`);
                    endTrackingResults.push({ toteId, olpn, success: false, error: error.message });
                    endTrackingErrorCount++;
                }
            }
            
            if (endTrackingErrorCount === 0) {
                this.log('All tracking ended successfully', 'success');
            } else {
                this.log(`Tracking ending completed with ${endTrackingErrorCount} errors`, 'info');
            }
            console.log(`End Tracking Summary: ${endTrackingSuccessCount} successful, ${endTrackingErrorCount} failed`);

            this.log('End-Create-End workflow completed successfully', 'success');
            
            const summary = {
                totalPairs: testTripData.length,
                steps: {
                    endAllTrips: endAllResult.summary,
                    endExistingAndCreateTrips: {
                        total: testTripData.length,
                        successful: createSuccessCount,
                        failed: createErrorCount,
                        successRate: `${((createSuccessCount / testTripData.length) * 100).toFixed(1)}%`
                    },
                    startTracking: {
                        total: testTripData.length,
                        successful: startTrackingSuccessCount,
                        failed: startTrackingErrorCount,
                        successRate: `${((startTrackingSuccessCount / testTripData.length) * 100).toFixed(1)}%`
                    },
                    updateTrips: {
                        total: testTripData.length,
                        successful: updateSuccessCount,
                        failed: updateErrorCount,
                        successRate: `${((updateSuccessCount / testTripData.length) * 100).toFixed(1)}%`
                    },
                    endTrips: {
                        total: testTripData.length,
                        successful: endTripSuccessCount,
                        failed: endTripErrorCount,
                        successRate: `${((endTripSuccessCount / testTripData.length) * 100).toFixed(1)}%`
                    },
                    endTracking: {
                        total: testTripData.length,
                        successful: endTrackingSuccessCount,
                        failed: endTrackingErrorCount,
                        successRate: `${((endTrackingSuccessCount / testTripData.length) * 100).toFixed(1)}%`
                    }
                },
                totalSteps: 6
            };

            console.log(`Workflow Summary: ${JSON.stringify(summary, null, 2)}`);

            return { 
                success: true, 
                summary,
                results: {
                    endAllTrips: endAllResult,
                    createTrips: createResults,
                    startTracking: startTrackingResults,
                    updateTrips: updateResults,
                    endTrips: endTripResults,
                    endTracking: endTrackingResults
                }
            };

        } catch (error) {
            this.log(`End-Create-End workflow failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // PERFORMANCE TEST
    // ===========================

    async testPerformance() {
        console.log('Testing Performance with Larger Dataset');
        console.log('==========================================');
        
        const realData = this.getRealData();
        const allToteIds = realData.toteIds;
        const allOlpns = realData.olpns;
        
        try {
            this.log(`Testing performance with ${allToteIds.length} items`);
            console.log(`ToteIds: ${allToteIds.join(', ')}`);
            console.log(`OLPNs: ${allOlpns.join(', ')}`);

            const startTime = Date.now();

            // Test Create-Track-Update workflow
            this.logWorkflowStep('1', 'Creating trips and starting tracking...');
            const createResult = await this.chorusService.executeCreateTrackUpdateWorkflow(
                allToteIds.map((toteId, index) => this.createTripData(toteId, allOlpns[index]))
            );
            
            const createTime = Date.now() - startTime;
            
            if (createResult.success) {
                this.log('Performance test create workflow successful', 'success');
                console.log(`Create time: ${createTime}ms`);
                console.log(`Average time per item: ${(createTime / allToteIds.length).toFixed(2)}ms`);
                console.log(`Summary: ${JSON.stringify(createResult.summary, null, 2)}`);
                if (createResult.data) {
                    console.log(`Detailed Log: ${createResult.data}`);
                }
            } else {
                this.log('Performance test create workflow failed', 'error');
                console.log(`Error: ${createResult.error}`);
                if (createResult.data) {
                    console.log(`Detailed Log: ${createResult.data}`);
                }
                return;
            }

            // Wait for state to settle
            this.logWorkflowStep('2', 'Waiting for state to settle...');
            await new Promise(resolve => setTimeout(resolve, 8000));

            // Test End All Trips workflow
            this.logWorkflowStep('3', 'Ending trips...');
            const endStartTime = Date.now();
            const endResult = await this.chorusService.executeEndAllTripsWorkflow(
                allToteIds.map(toteId => this.createTripData(toteId, 'default-olpn'))
            );
            const endTime = Date.now() - endStartTime;
            
            if (endResult.success) {
                this.log('Performance test end workflow successful', 'success');
                console.log(`End time: ${endTime}ms`);
                console.log(`Average time per item: ${(endTime / allToteIds.length).toFixed(2)}ms`);
                console.log(`Summary: ${JSON.stringify(endResult.summary, null, 2)}`);
                if (endResult.data) {
                    console.log(`Detailed Log: ${endResult.data}`);
                }
            } else {
                this.log('Performance test end workflow failed', 'error');
                console.log(`Error: ${endResult.error}`);
                if (endResult.data) {
                    console.log(`Detailed Log: ${endResult.data}`);
                }
            }

            const totalTime = Date.now() - startTime;
            console.log(`Performance Summary:`);
            console.log(`Total time: ${totalTime}ms`);
            console.log(`Items processed: ${allToteIds.length}`);
            console.log(`Average total time per item: ${(totalTime / allToteIds.length).toFixed(2)}ms`);

            return { createResult, endResult, performance: { totalTime, createTime, endTime } };

        } catch (error) {
            this.log(`Performance test failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // MAIN TEST RUNNER
    // ===========================

    async runAllTests() {
        // this.writeToLogFile('Starting Chorus API Tests with Real Data');
        // this.writeToLogFile('============================================');
        // this.writeToLogFile(' WARNING: This will make actual API calls to Chorus!');
        // this.writeToLogFile('Test Data:');
        // const realData = this.getRealData();
        // const realTripExcelData = this.createTripDataArrayFromExcel('C:\\Users\\rog\\Documents\\SGLap_Real_data.xlsx');
        // this.writeToLogFile(`Tote IDs: ${realData.toteIds.join(', ')}`);
        // this.writeToLogFile(`OLPNs: ${realData.olpns.join(', ')}`);
        // this.writeToLogFile('');
        
        // console.log('Starting Chorus API Tests with Real Data');
        // console.log('============================================');
        // console.log(' WARNING: This will make actual API calls to Chorus!');
        // console.log('Test Data:');
        // console.log(`Tote IDs: ${realData.toteIds.join(', ')}`);
        // console.log(`OLPNs: ${realData.olpns.join(', ')}`);
        // console.log('');

        const results = {};

        try {
            // Test 1: Connectivity
            // results.connectivity = await this.testConnectivity();

            // Test 2: Single Item
            // results.singleItem = await this.testSingleItem();

            // Test 3: Small Batch
            // results.smallBatch = await this.testSmallBatch();

            // Test 4: Individual Create Trip
            // results.individualCreateTrip = await this.testIndividualCreateTrip('21139930391139300000');

            // Test 5: Individual Start Tracking
            // results.individualStartTracking = await this.testIndividualStartTracking('SGLABSTESTTOTE', '21139930391139300000');

            // Test 6: Individual Update Trip to IN_TRANSIT
            // results.individualUpdateTripToInTransit = await this.testIndividualUpdateTripToInTransit('21139930391139300000');

            // Test 7: Individual End Trip
            // results.individualEndTrip = await this.testIndividualEndTrip('75327521744879600000');

            // Test 8: Individual End Tracking
            // results.individualEndTracking = await this.testIndividualEndTracking('SGL-TST-012', '75327521744879600000');

            // Test 9: Individual List Trips In Transit
            results.individualListTripsInTransit = await this.testIndividualListTripsInTransit('cah-hdc-test-1');

            // Test 11: Create All Trips (full workflow)
            // results.createAllTrips = await this.testCreateAllTrips();

            // Test 12: End All Trips
            // results.endAllTrips = await this.testEndAllTrips();

            // Test 13: End-Create-End Workflow (All Totes)
            // results.endCreateEndWorkflow = await this.testEndCreateEndWorkflow();

            // Test 14: End-Create-End Workflow from Excel File
            // results.excelWorkflow = await this.testEndCreateEndWorkflowFromExcel('C:\\Users\\rog\\Documents\\SGLap_Real_data.xlsx');

            // Test 15: Trip Workflow (Following Flowchart)
            // results.tripWorkflow = await this.testTripWorkflow(realTripExcelData);

            // Test 16: Performance
            //results.performance = await this.testPerformance();

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
}

// ===========================
// USAGE
// ===========================

async function main() {
    const tester = new RealDataTester();
    
    // Run all tests
    await tester.runAllTests();
    
    // Or run individual tests:
    // await tester.testConnectivity();
    // await tester.testSingleItem();
    // await tester.testSmallBatch();
    
    // Individual API operation tests (with custom parameters):
    // await tester.testIndividualCreateTrip('6919702610159660000');
    // await tester.testIndividualStartTracking('15aeb344b522', '6919702610159660000');
    // await tester.testIndividualUpdateTripToInTransit('6919702610159660000');
    // await tester.testIndividualEndTrip('6919702610159660000');
    // await tester.testIndividualEndTracking('15aeb344b522', '6919702610159660000');
    // await tester.testIndividualListTripsInTransit('15aeb344b522');
    // await tester.testIndividualListAllTrips('15aeb344b522');
    
    // Workflow tests (with custom parameters):
    // await tester.testCreateTripsOnly(['6919702610159660000', '1397009787425300000']);
    // await tester.testCreateAllTrips(['15aeb344b522', 'SGLABSTESTTOTE'], ['6919702610159660000', '1397009787425300000']);
    // await tester.testEndAllTrips(['15aeb344b522', 'SGLABSTESTTOTE']);
    // await tester.testEndCreateEndWorkflow(); // Test with all toteIds (auto-generated from real data)
    // await tester.testEndCreateEndWorkflow([
    //     tester.createTripData('SGLABSTESTTOTE', '52481468326731500000'),
    //     tester.createTripData('SGL-TST-001', '58459503478030600000')
    // ]); // Test with custom trip data
    
    // Excel-based workflow tests:
    // await tester.createSampleExcelFile(); // Create a sample Excel file first
    // await tester.testEndCreateEndWorkflowFromExcel('./data/sample-data.xlsx'); // Test with sample Excel file
    // await tester.testEndCreateEndWorkflowFromExcel("C:\\Users\\rog\\Documents\\SGLap_Real_data.xlsx"); // Test with your Excel file
    
    // Trip Workflow tests (following flowchart):
    // await tester.testTripWorkflow(); // Test with default sample data
    // await tester.testTripWorkflow([
    //     tester.createTripData('SGLABSTESTTOTE', '22689222764918900000'),
    //     tester.createTripData('SGL-TST-001', '58459503478030600000')
    // ]); // Test with custom data
    
    // await tester.testPerformance();
    
    // Note: All logs are automatically saved to a timestamped file in the ./data directory
    // Example: chorus-test-logs-2024-01-15T10-30-45-123Z.txt
}

// Export for use in other modules
module.exports = RealDataTester;

// Run tests if this file is executed directly
if (require.main === module) {
    main();
} 