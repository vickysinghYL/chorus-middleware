const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

// ===========================
// NESTJS SERVICE TESTER
// ===========================

class NestJSServiceTester {
    constructor() {
        this.testStartTime = Date.now();
        this.logFile = this.generateLogFileName();
        this.ensureDataDirectory();
        
        // Real data for testing
        this.realData = {
            toteIds: [
                'SGLABSTESTTOTE',
                'SGL-TST-001',
                'SGL-TST-002',
                'SGL-TST-003',
                'SGL-TST-004'
            ],
            olpns: [
                '22689222764918900000',
                '58459503478030600000',
                '74567554868359700000',
                '12345678901234567890',
                '98765432109876543210'
            ]
        };
    }

    // ===========================
    // UTILITY METHODS
    // ===========================

    generateLogFileName() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `./data/chorus-service-test-logs-${timestamp}.txt`;
    }

    ensureDataDirectory() {
        const dataDir = './data';
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    generateTimestamp() {
        return new Date().toISOString();
    }

    createTripData(toteId, olpn, timestamp = null) {
        return {
            toteId: toteId,
            olpn: olpn,
            timestamp: timestamp || this.generateTimestamp()
        };
    }

    getRealData() {
        return this.realData;
    }

    // ===========================
    // LOGGING METHODS
    // ===========================

    log(message, level = 'info') {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        
        console.log(logMessage);
        this.writeToLogFile(logMessage);
    }

    logWorkflowStep(step, message) {
        this.log(`[STEP ${step}] ${message}`);
    }

    writeToLogFile(content) {
        try {
            fs.appendFileSync(this.logFile, content + '\n');
        } catch (error) {
            console.error('Failed to write to log file:', error.message);
        }
    }

    writeSectionToLogFile(sectionName, content) {
        const separator = '='.repeat(50);
        const section = `\n${separator}\n${sectionName}\n${separator}\n${content}\n${separator}\n`;
        this.writeToLogFile(section);
    }

    writeSummaryToLogFile(summary) {
        this.writeSectionToLogFile('TEST SUMMARY', JSON.stringify(summary, null, 2));
    }

    // ===========================
    // EXCEL DATA PROCESSING
    // ===========================

    readExcelFile(filePath) {
        try {
            this.log(`Reading Excel file: ${filePath}`);
            
            if (!fs.existsSync(filePath)) {
                throw new Error(`Excel file not found: ${filePath}`);
            }

            const workbook = xlsx.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            const data = xlsx.utils.sheet_to_json(worksheet);
            
            this.log(`Successfully read ${data.length} rows from Excel file`);
            return data;
            
        } catch (error) {
            this.log(`Failed to read Excel file: ${error.message}`, 'error');
            throw error;
        }
    }

    processExcelData(excelData) {
        try {
            this.log('Processing Excel data...');
            
            const tripDataArray = [];
            
            for (let i = 0; i < excelData.length; i++) {
                const row = excelData[i];
                
                // Extract data based on Excel column structure
                // Adjust these field names based on your Excel structure
                const toteId = row['ToteId'] || row['toteId'] || row['TOTE_ID'] || `TOTE_${i + 1}`;
                const olpn = row['OLPN'] || row['olpn'] || row['Olpn'] || `OLPN_${i + 1}`;
                const timestamp = row['Timestamp'] || row['timestamp'] || row['TIME'] || this.generateTimestamp();
                
                if (toteId && olpn) {
                    tripDataArray.push(this.createTripData(toteId, olpn, timestamp));
                }
            }
            
            this.log(`Processed ${tripDataArray.length} valid trip data entries from Excel`);
            return tripDataArray;
            
        } catch (error) {
            this.log(`Failed to process Excel data: ${error.message}`, 'error');
            throw error;
        }
    }

    // ===========================
    // SERVICE INTEGRATION
    // ===========================

    async initializeService() {
        try {
            this.log('Initializing ChorusApiService...');
            
            // Load environment variables
            require('dotenv').config();
            
            // Import NestJS modules
            const { NestFactory } = require('@nestjs/core');
            const { AppModule } = require('./src/app.module');
            
            // Create NestJS application context
            this.app = await NestFactory.createApplicationContext(AppModule);
            
            // Get the service instance
            this.chorusApiService = this.app.get('ChorusApiService');
            this.errorLogService = this.app.get('ErrorLogService');
            
            this.log('ChorusApiService initialized successfully');
            
        } catch (error) {
            this.log(`Failed to initialize service: ${error.message}`, 'error');
            throw error;
        }
    }

    async cleanup() {
        if (this.app) {
            await this.app.close();
        }
    }

    // ===========================
    // CONNECTIVITY TEST
    // ===========================

    async testConnectivity() {
        console.log('Testing Service Connectivity');
        console.log('============================');
        
        try {
            this.log('Testing service initialization...');
            
            await this.initializeService();
            
            this.log('Service connectivity test passed', 'success');
            return { success: true, message: 'Service initialized successfully' };
            
        } catch (error) {
            this.log(`Service connectivity test failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // ERROR LOGS TEST
    // ===========================

    async testErrorLogs() {
        console.log('Testing Error Logs Database');
        console.log('============================');
        
        try {
            this.log('Testing error log service...');
            
            // Test creating an error log
            const testErrorData = {
                endpoint: '/test/endpoint',
                errorType: 'TEST_ERROR',
                statusCode: 500,
                errorMessage: 'Test error message from service tester',
                requestPayload: { test: 'data' },
                toteId: 'TEST_TOTE',
                olpn: 'TEST_OLPN'
            };
            
            const createdLog = await this.errorLogService.createErrorLog(testErrorData);
            this.log(`Created test error log with ID: ${createdLog.id}`);
            
            // Test querying error logs
            const logs = await this.errorLogService.getErrorLogs({ limit: 10 });
            this.log(`Retrieved ${logs.length} error logs`);
            
            // Test error statistics
            const stats = await this.errorLogService.getErrorStatistics();
            this.log(`Error statistics: ${JSON.stringify(stats)}`);
            
            this.log('Error logs test completed successfully', 'success');
            return { success: true, logsCount: logs.length, stats };
            
        } catch (error) {
            this.log(`Error logs test failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // TRIP WORKFLOW TEST
    // ===========================

    async testTripWorkflow(tripDataArray = null) {
        console.log('Testing Trip Workflow with Service');
        console.log('==================================');
        
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
            
            this.logWorkflowStep('1', 'Executing Trip Workflow via Service...');
            
            const workflowResult = await this.chorusApiService.executeTripWorkflow(testTripData);
            
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
    // INDIVIDUAL SERVICE TESTS
    // ===========================

    async testIndividualCreateTrip(olpn = null) {
        console.log('Testing Individual Create Trip via Service');
        console.log('==========================================');
        
        const realData = this.getRealData();
        const testOlpn = olpn || realData.olpns[0];
        
        try {
            this.log(`Testing individual trip creation for OLPN: ${testOlpn}`);
            
            this.logWorkflowStep('1', 'Creating trip...');
            const timestamp = this.generateTimestamp();
            
            const result = await this.chorusApiService.createTrip(testOlpn, timestamp);
            
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
        console.log('Testing Individual Start Tracking via Service');
        console.log('==============================================');
        
        const realData = this.getRealData();
        const testToteId = toteId || realData.toteIds[0];
        const testOlpn = olpn || realData.olpns[0];
        
        try {
            this.log(`Testing individual start tracking for pair: ${testToteId}/${testOlpn}`);
            
            this.logWorkflowStep('1', 'Starting tracking...');
            
            const result = await this.chorusApiService.startTracking(testToteId, testOlpn);
            
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
        console.log('Testing Individual Update Trip to IN_TRANSIT via Service');
        console.log('==========================================================');
        
        const realData = this.getRealData();
        const testOlpn = olpn || realData.olpns[0];
        
        try {
            this.log(`Testing individual trip update to IN_TRANSIT for OLPN: ${testOlpn}`);
            const timestamp = this.generateTimestamp();
            this.logWorkflowStep('1', 'Updating trip to IN_TRANSIT...');
            
            const result = await this.chorusApiService.updateTripToInTransit(testOlpn, timestamp);
            
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
        console.log('Testing Individual End Trip via Service');
        console.log('========================================');
        
        const realData = this.getRealData();
        const testOlpn = olpn || realData.olpns[0];
        
        try {
            this.log(`Testing individual end trip for OLPN: ${testOlpn}`);
            
            this.logWorkflowStep('1', 'Ending trip...');
            const timestamp = this.generateTimestamp();
            
            const result = await this.chorusApiService.endTrip(testOlpn, timestamp);
            
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
        console.log('Testing Individual End Tracking via Service');
        console.log('============================================');
        
        const realData = this.getRealData();
        const testToteId = toteId || realData.toteIds[0];
        const testOlpn = olpn || realData.olpns[0];
        
        try {
            this.log(`Testing individual end tracking for pair: ${testToteId}/${testOlpn}`);
            
            this.logWorkflowStep('1', 'Ending tracking...');
            
            const result = await this.chorusApiService.endTracking(testToteId, testOlpn);
            
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
        console.log('Testing Individual List Trips In Transit via Service');
        console.log('======================================================');
        
        const realData = this.getRealData();
        const testToteId = toteId || realData.toteIds[0];
        
        try {
            this.log(`Testing individual list trips in transit for toteId: ${testToteId}`);
            
            this.logWorkflowStep('1', 'Listing trips in transit...');
            
            const result = await this.chorusApiService.listAllTripsInTransit(testToteId);
            
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
    // EXCEL WORKFLOW TEST
    // ===========================

    async testTripWorkflowFromExcel(filePath) {
        console.log('Testing Trip Workflow from Excel via Service');
        console.log('=============================================');
        
        try {
            this.log(`Testing workflow with Excel file: ${filePath}`);
            
            // Read and process Excel data
            const excelData = this.readExcelFile(filePath);
            const tripDataArray = this.processExcelData(excelData);
            
            if (tripDataArray.length === 0) {
                throw new Error('No valid trip data found in Excel file');
            }
            
            // Execute workflow with Excel data
            const workflowResult = await this.testTripWorkflow(tripDataArray);
            
            this.log('Excel workflow test completed successfully', 'success');
            return workflowResult;
            
        } catch (error) {
            this.log(`Excel workflow test failed: ${error.message}`, 'error');
            console.error('Full error:', error);
            throw error;
        }
    }

    // ===========================
    // MAIN TEST RUNNER
    // ===========================

    async runAllTests() {
        this.writeToLogFile('Starting Chorus Service Tests with Real Data');
        this.writeToLogFile('=============================================');
        this.writeToLogFile(' WARNING: This will make actual API calls to Chorus!');
        this.writeToLogFile('');
        
        console.log('Starting Chorus Service Tests with Real Data');
        console.log('=============================================');
        console.log(' WARNING: This will make actual API calls to Chorus!');
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
        } finally {
            await this.cleanup();
        }

        return results;
    }

    async runSpecificTest(testName, ...args) {
        console.log(`Running specific test: ${testName}`);
        console.log('=====================================');
        
        try {
            // Initialize service first
            await this.initializeService();
            
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
        } finally {
            await this.cleanup();
        }
    }
}

// ===========================
// USAGE
// ===========================

async function main() {
    const args = process.argv.slice(2);
    const tester = new NestJSServiceTester();
    
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
    // Example: chorus-service-test-logs-2024-01-15T10-30-45-123Z.txt
}

// ===========================
// COMMAND LINE USAGE
// ===========================

function showUsage() {
    console.log(`
Chorus Service Test Runner
==========================

Usage:
  node test-with-service.js [test-name] [arguments...]

Available Tests:
  (no args)                    - Run all tests
  connectivity                 - Test service initialization
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
  node test-with-service.js
  node test-with-service.js connectivity
  node test-with-service.js create-trip 22689222764918900000
  node test-with-service.js start-tracking SGLABSTESTTOTE 22689222764918900000
  node test-with-service.js excel-workflow ./data/sample-data.xlsx
  node test-with-service.js list-trips SGLABSTESTTOTE

Note: This script directly calls the ChorusApiService methods
`);
}

// Check for help argument
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showUsage();
    process.exit(0);
}

// Export for use in other modules
module.exports = { NestJSServiceTester };

// Run if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
} 