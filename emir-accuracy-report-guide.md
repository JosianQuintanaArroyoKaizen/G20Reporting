# EMIR Accuracy Testing Report - Implementation Guide

## Project Overview
Create a comprehensive data quality and accuracy report for ETD ESMA EOD Trade Activity data, analyzing EMIR regulatory reporting compliance and identifying issues across all reportable fields.

---

## AWS Architecture Overview

### Technology Stack
- **Infrastructure**: AWS CDK (TypeScript) - extending existing microservices pattern
- **Storage**: S3 (raw CSV files, partitioned by date)
- **Analytics**: AWS Athena (SQL queries on S3 data)
- **Orchestration**: AWS Step Functions (8-phase pipeline coordination)
- **Compute**: AWS Lambda (validation logic, report generation)
- **Messaging**: EventBridge + SQS (existing pattern for decoupling)
- **Metadata Store**: DynamoDB (report runs, summary stats, error counts)
- **Schema Management**: AWS Glue Data Catalog (define CSV schema for Athena)

### High-Level Pipeline Flow
```
1. CSV Upload to S3 → S3 Event Notification
2. Step Function Triggered → Orchestrates all phases
3. Phase 1 Lambda: Data Profiling (Athena queries)
4. Phase 2 Lambda: Completeness Analysis (Athena queries)
5. Phase 3 Lambda: Format Validation (Athena + custom logic)
6. Phase 4 Lambda: Logical Validation (Athena + custom logic)
7. Phase 5 Lambda: Scoring Calculation (aggregate results)
8. Phase 6-8 Lambda: Report Generation (PDF/Excel output to S3)
9. EventBridge Event: Report Complete → Notification
```

### New CDK Constructs to Create
Extending the existing pattern from `lib/` directory:

1. **lib/storage.ts** - `EmirStorage` construct
   - S3 buckets for raw data and reports (with partitioning and lifecycle policies)
   - Athena workgroup configuration
   - S3 event notifications

2. **lib/glue-catalog.ts** - `EmirDataCatalog` construct
   - Glue database and table definitions
   - Schema for 203 EMIR REFIT fields
   - Partitioning strategy (year/month/day)

3. **lib/step-functions.ts** - `EmirPipeline` construct
   - Step Functions state machine
   - Error handling and retry logic
   - Parallel execution for independent validation phases

4. **lib/emir-microservices.ts** - `EmirMicroservices` construct (similar to existing `SwnMicroservices`)
   - Lambda functions for each phase
   - Environment variables (S3 buckets, Athena workgroup, table names)
   - IAM permissions (S3, Athena, Glue access)

5. **lib/emir-api.ts** - `EmirApi` construct (optional - for retrieving reports)
   - API Gateway endpoints to query report status
   - Lambda to fetch results from DynamoDB
   - S3 pre-signed URLs for report downloads

### Existing Constructs to Reuse
- **lib/database.ts** - Add new DynamoDB tables for EMIR metadata
- **lib/eventbus.ts** - Use existing EventBridge pattern for pipeline events
- **lib/queue.ts** - Use existing SQS pattern for async processing (if needed)

---

## Phase 1: Data Loading and Initial Assessment

### 1.1 Load the Data
- Read the CSV file containing the ETD ESMA EOD Trade Activity Report
- Verify the data structure matches expected headers (203 fields for EMIR REFIT)
- Check total number of records/trades
- Identify the reporting period (Report Date: 2025-09-25)

### 1.2 Initial Data Profiling
- Get row count
- Identify columns with data vs empty columns
- Check for completely empty records
- Generate basic statistics (how many fields populated per record on average)

### Implementation Steps (Phase 1)

**Triggers:**
- Manual CSV upload to S3 bucket: `s3://emir-raw-data/year=2025/month=09/day=25/etd_esma_eod.csv`
- S3 PUT event triggers Lambda: `data-loader` function
- Lambda starts Step Functions execution

**Lambda Function: `src/emir/data-loader/index.js`**
- Triggered by S3 event notification
- Extracts metadata from S3 object (file size, record count, report date from path)
- Initiates Glue Crawler (or validates against existing schema)
- Verifies 203 expected columns exist in CSV header
- Creates DynamoDB record: report run metadata
- Starts Step Functions state machine with payload:
  ```json
  {
    "reportDate": "2025-09-25",
    "s3Bucket": "emir-raw-data",
    "s3Key": "year=2025/month=09/day=25/etd_esma_eod.csv",
    "executionId": "uuid",
    "timestamp": "2025-09-25T10:30:00Z"
  }
  ```

**Athena Queries (executed by Lambda):**
```sql
-- 1.1: Basic data verification
SELECT COUNT(*) as total_records,
       COUNT(DISTINCT uti) as unique_utis
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25';

-- 1.2: Column population analysis
SELECT 
  SUM(CASE WHEN uti IS NOT NULL THEN 1 ELSE 0 END) as uti_populated,
  SUM(CASE WHEN counterparty_1 IS NOT NULL THEN 1 ELSE 0 END) as cp1_populated,
  -- ... for all 203 fields
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25';

-- 1.2: Empty records check
SELECT COUNT(*) as completely_empty_records
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25'
  AND uti IS NULL 
  AND counterparty_1 IS NULL
  -- ... check key fields
```

**DynamoDB Table: `emir_report_runs`**
```
PK: reportDate (2025-09-25)
SK: executionId (uuid)
Attributes:
  - status (INITIATED, IN_PROGRESS, COMPLETED, FAILED)
  - totalRecords
  - s3Location
  - startTime
  - phase1CompleteTime
  - currentPhase
```

**Step Functions State Machine:**
- Receives payload from data-loader Lambda
- Passes context to Phase 2
- Handles retries if Athena queries fail

---

## Phase 2: Completeness Analysis

### 2.1 Mandatory Fields Check
Identify which **mandatory fields** have missing values:

**Critical Identifiers:**
- UTI (Unique Transaction Identifier)
- Report tracking number
- Counterparty 1 (Reporting counterparty)
- Counterparty 2
- Report submitting entity ID
- Entity responsible for reporting

**Critical Trade Information:**
- Action type
- Event type
- Event date
- Execution timestamp
- Direction

**Product Information:**
- ISIN or UPI (at least one required)
- Asset class
- Product classification

### 2.2 Completeness Metrics
- Calculate % of mandatory fields populated across all records
- Identify records with critical missing data
- Create completeness score per record
- Flag high-priority gaps

### Implementation Steps (Phase 2)

**Lambda Function: `src/emir/completeness-validator/index.js`**
- Invoked by Step Functions with context from Phase 1
- Executes multiple Athena queries for mandatory field validation
- Writes results to DynamoDB table: `emir_validation_results`
- Returns summary statistics to Step Functions

**Athena Queries:**
```sql
-- 2.1: Critical identifiers missing count
SELECT 
  'UTI' as field_name,
  COUNT(*) as missing_count,
  ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM emir_trades WHERE year='2025' AND month='09' AND day='25'), 2) as missing_percentage
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25'
  AND (uti IS NULL OR uti = '');

-- Repeat for all mandatory fields (counterparty_1, counterparty_2, etc.)

-- 2.2: Records with multiple critical gaps
SELECT uti, counterparty_1, action_type, event_type,
       -- Count how many mandatory fields are missing
       (CASE WHEN uti IS NULL THEN 1 ELSE 0 END +
        CASE WHEN counterparty_1 IS NULL THEN 1 ELSE 0 END +
        CASE WHEN action_type IS NULL THEN 1 ELSE 0 END +
        -- ... all mandatory fields
       ) as missing_mandatory_count
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25'
HAVING missing_mandatory_count > 0
ORDER BY missing_mandatory_count DESC
LIMIT 1000; -- Store worst offenders for detailed reporting

-- 2.2: Overall completeness score by record
CREATE TABLE emir_completeness_scores AS
SELECT 
  uti,
  ROUND(100.0 * (203 - missing_field_count) / 203, 2) as completeness_score
FROM (
  SELECT uti,
    (CASE WHEN field1 IS NULL THEN 1 ELSE 0 END +
     CASE WHEN field2 IS NULL THEN 1 ELSE 0 END +
     -- ... for all 203 fields
    ) as missing_field_count
  FROM emir_trades
  WHERE year='2025' AND month='09' AND day='25'
);
```

**DynamoDB Table: `emir_validation_results`**
```
PK: reportDate#executionId (2025-09-25#uuid)
SK: validationType#fieldName (COMPLETENESS#UTI)
Attributes:
  - totalRecords
  - missingCount
  - missingPercentage
  - errorSeverity (CRITICAL, MAJOR, MINOR)
  - sampleErrors (list of 5-10 example UTIs with this issue)
```

**Output to Step Functions:**
```json
{
  "phase": "completeness",
  "status": "completed",
  "criticalErrors": 15,
  "majorErrors": 42,
  "minorErrors": 103,
  "overallCompletenessRate": 94.5
}
```

---

## Phase 3: Format Validation

### 3.1 Identifier Format Checks

**LEI Validation (20 characters, alphanumeric):**
- Counterparty 1
- Counterparty 2
- Report submitting entity ID
- Entity responsible for reporting
- Execution Agent ID
- Broker ID
- Clearing member

**UTI Validation:**
- Check format compliance
- Verify uniqueness
- Check for Prior UTI references

**ISIN Validation (12 characters):**
- Format check
- Valid structure (country code + identifier + check digit)

**UPI Validation:**
- Format compliance with approved taxonomy

### 3.2 Date/Timestamp Validation
- Verify all dates are in ISO 8601 format
- Check logical date sequences (effective date ≤ expiration date)
- Validate timestamps are reasonable
- Check for future dates where not applicable

### 3.3 Currency Code Validation
- Verify ISO 4217 currency codes (3 letters)
- Check across all currency fields

### Implementation Steps (Phase 3)

**Lambda Function: `src/emir/format-validator/index.js`**
- Invoked by Step Functions after Phase 2 completes
- Uses Athena with regex patterns for format validation
- For complex validations (ISIN check digit), uses Lambda logic on sampled data
- Stores results in `emir_validation_results` DynamoDB table

**Athena Queries with Regex:**
```sql
-- 3.1: LEI format validation (20 alphanumeric characters)
SELECT 
  'counterparty_1_lei' as field_name,
  'FORMAT_ERROR' as error_type,
  COUNT(*) as error_count,
  ARRAY_AGG(uti LIMIT 10) as sample_utis
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25'
  AND counterparty_1 IS NOT NULL
  AND (LENGTH(counterparty_1) != 20 
       OR NOT REGEXP_LIKE(counterparty_1, '^[A-Z0-9]{20}$'))
GROUP BY field_name, error_type;

-- Repeat for all LEI fields (counterparty_2, execution_agent_id, broker_id, etc.)

-- 3.1: UTI uniqueness check
SELECT uti, COUNT(*) as duplicate_count
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25'
  AND uti IS NOT NULL
GROUP BY uti
HAVING COUNT(*) > 1;

-- 3.1: ISIN format validation (12 characters, starts with 2-letter country code)
SELECT 
  COUNT(*) as invalid_isin_count,
  ARRAY_AGG(DISTINCT isin LIMIT 20) as sample_invalid_isins
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25'
  AND isin IS NOT NULL
  AND (LENGTH(isin) != 12 
       OR NOT REGEXP_LIKE(SUBSTR(isin, 1, 2), '^[A-Z]{2}$')
       OR NOT REGEXP_LIKE(SUBSTR(isin, 3, 9), '^[A-Z0-9]{9}$'));

-- 3.2: Date format validation (ISO 8601: YYYY-MM-DD)
SELECT 
  COUNT(*) as invalid_date_count
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25'
  AND (
    NOT REGEXP_LIKE(execution_timestamp, '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}')
    OR NOT REGEXP_LIKE(effective_date, '^\d{4}-\d{2}-\d{2}$')
  );

-- 3.3: Currency code validation (3 uppercase letters, must be valid ISO 4217)
-- First, create reference table of valid currency codes
SELECT 
  notional_currency_1 as currency,
  COUNT(*) as usage_count
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25'
  AND notional_currency_1 IS NOT NULL
  AND (LENGTH(notional_currency_1) != 3 
       OR NOT REGEXP_LIKE(notional_currency_1, '^[A-Z]{3}$')
       OR notional_currency_1 NOT IN ('USD', 'EUR', 'GBP', 'JPY', /* ...all ISO 4217 codes... */))
GROUP BY currency;
```

**Lambda-side Validation (for complex logic):**
- ISIN check digit calculation (Luhn algorithm variant)
- UPI format validation against DTCC/ANNA taxonomy
- Advanced date parsing and timezone handling

**Reference Data Management:**
- Store valid ISO 4217 currency codes in DynamoDB or S3 JSON file
- Store valid LEI prefix ranges (if available from GLEIF)
- Update reference data periodically via separate Lambda

**DynamoDB Storage Pattern:**
```
PK: reportDate#executionId
SK: FORMAT#LEI_COUNTERPARTY_1
Attributes:
  - errorCount: 23
  - errorPercentage: 0.12
  - severity: CRITICAL
  - sampleErrors: ["uti1", "uti2", ...]
  - sampleInvalidValues: ["12345", "ABC", ...]
```

---

## Phase 4: Logical Validation ("Valid but Wrong" Errors)

### 4.1 Cross-Field Consistency Checks

**Counterparty Logic:**
- If Direction = "BUY", counterparty 1 is buyer
- Direction consistency with leg directions
- Counterparty nature vs corporate sector alignment

**Date Logic:**
- Execution timestamp ≤ Effective date ≤ Expiration date
- Clearing timestamp (if cleared) ≤ Execution timestamp + reasonable period
- Confirmation timestamp logic
- Early termination date < Expiration date (if present)

**Clearing Logic:**
- If Cleared = "true", Central counterparty must be populated
- If Clearing obligation = "true", Cleared should typically be "true"
- Clearing timestamp should be present if Cleared = "true"

**Notional/Valuation Logic:**
- Notional amounts should match notional currencies
- Check for unrealistic values (too high/low)
- Valuation currency matches valuation amount

### 4.2 Derivative-Specific Validations

**For Options:**
- Option type, style, and strike price should all be populated together
- Maturity date validation

**For Swaps:**
- Leg 1 and Leg 2 data consistency
- Fixed rate vs Floating rate completeness per leg
- Payment frequency validation

**For Futures/Forwards:**
- Delivery type and delivery dates
- Price validation

### Implementation Steps (Phase 4)

**Lambda Function: `src/emir/logical-validator/index.js`**
- Most complex validation phase - combines multiple field checks
- Can run in parallel with Phase 3 (format validation) using Step Functions parallel state
- Executes Athena queries for cross-field consistency
- May use Lambda logic for complex business rules

**Athena Queries for Logical Validation:**
```sql
-- 4.1: Counterparty direction consistency
SELECT 
  uti, direction, counterparty_1, counterparty_2
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25'
  AND direction IS NOT NULL
  AND (
    (direction = 'BUY' AND /* buyer should be CP1 logic */)
    OR (direction = 'SELL' AND /* seller should be CP1 logic */)
  );

-- 4.1: Date sequence validation (most common logical error)
SELECT 
  'DATE_SEQUENCE_ERROR' as error_type,
  COUNT(*) as error_count,
  ARRAY_AGG(uti LIMIT 20) as sample_utis
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25'
  AND (
    -- Execution must be before or equal to effective date
    CAST(execution_timestamp AS TIMESTAMP) > CAST(effective_date AS DATE)
    -- Effective date must be before expiration
    OR CAST(effective_date AS DATE) > CAST(expiration_date AS DATE)
    -- Early termination must be before expiration
    OR (early_termination_date IS NOT NULL 
        AND CAST(early_termination_date AS DATE) >= CAST(expiration_date AS DATE))
    -- Clearing timestamp should be near execution timestamp
    OR (cleared = 'true' 
        AND clearing_timestamp IS NOT NULL
        AND ABS(DATE_DIFF('day', 
                CAST(execution_timestamp AS TIMESTAMP), 
                CAST(clearing_timestamp AS TIMESTAMP))) > 5)
  );

-- 4.1: Clearing obligation logic
SELECT 
  'CLEARING_LOGIC_ERROR' as error_type,
  COUNT(*) as error_count
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25'
  AND (
    -- If cleared=true, CCP must be populated
    (cleared = 'true' AND (central_counterparty IS NULL OR central_counterparty = ''))
    -- If cleared=true, clearing timestamp should exist
    OR (cleared = 'true' AND clearing_timestamp IS NULL)
    -- If clearing_obligation=true, typically cleared should be true
    OR (clearing_obligation = 'true' AND cleared = 'false')
  );

-- 4.1: Notional/valuation consistency
SELECT 
  uti, 
  notional_amount_1, notional_currency_1,
  valuation_amount, valuation_currency
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25'
  AND (
    -- Notional amount exists but currency missing
    (notional_amount_1 IS NOT NULL AND notional_currency_1 IS NULL)
    -- Notional currency exists but amount missing
    OR (notional_amount_1 IS NULL AND notional_currency_1 IS NOT NULL)
    -- Unrealistic values (adjust thresholds based on asset class)
    OR (notional_amount_1 < 0)
    OR (notional_amount_1 > 1000000000000) -- 1 trillion threshold
    -- Valuation inconsistencies
    OR (valuation_amount IS NOT NULL AND valuation_currency IS NULL)
  );

-- 4.2: Derivative-specific validation - Options
SELECT 
  'OPTION_INCOMPLETE_DATA' as error_type,
  COUNT(*) as error_count
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25'
  AND asset_class = 'OPTION'
  AND (
    -- If one option field is populated, all should be
    (option_type IS NOT NULL AND (option_style IS NULL OR strike_price IS NULL))
    OR (option_style IS NOT NULL AND (option_type IS NULL OR strike_price IS NULL))
    OR (strike_price IS NOT NULL AND (option_type IS NULL OR option_style IS NULL))
  );

-- 4.2: Derivative-specific validation - Swaps
SELECT 
  uti,
  leg1_fixed_rate, leg1_floating_rate,
  leg2_fixed_rate, leg2_floating_rate
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25'
  AND asset_class = 'SWAP'
  AND (
    -- Each leg should have either fixed or floating rate, not both or neither
    ((leg1_fixed_rate IS NOT NULL AND leg1_floating_rate IS NOT NULL)
     OR (leg1_fixed_rate IS NULL AND leg1_floating_rate IS NULL))
    OR
    ((leg2_fixed_rate IS NOT NULL AND leg2_floating_rate IS NOT NULL)
     OR (leg2_fixed_rate IS NULL AND leg2_floating_rate IS NULL))
  );
```

**Step Functions Optimization:**
- Use parallel state to run Phase 3 (format) and Phase 4 (logical) simultaneously
- Both write to same DynamoDB table with different SK prefixes
- Reduces total pipeline execution time by ~40%

**DynamoDB Storage Pattern:**
```
PK: reportDate#executionId
SK: LOGICAL#DATE_SEQUENCE
Attributes:
  - errorCount: 156
  - severity: CRITICAL
  - affectedRecordCount: 156
  - sampleUtis: [...]
```

---

## Phase 5: Accuracy Score Calculation

### 5.1 Scoring Methodology
Create a weighted scoring system:

**Critical Errors (High Impact):** -10 points each
- Missing mandatory identifiers (UTI, LEI)
- Invalid LEI/ISIN/UPI formats
- Missing action/event type
- Logical impossibilities (dates out of sequence)

**Major Errors (Medium Impact):** -5 points each
- Missing recommended fields
- Currency/format inconsistencies
- Incomplete derivative specifications

**Minor Errors (Low Impact):** -2 points each
- Missing optional but useful fields
- Minor formatting issues

### 5.2 Generate Scores
- Overall accuracy score (0-100%)
- Score per record
- Score per field category
- Score per error type

### Implementation Steps (Phase 5)

**Lambda Function: `src/emir/scoring-engine/index.js`**
- Invoked after Phases 2, 3, 4 complete (Step Functions waits for parallel states)
- Reads all validation results from DynamoDB
- Calculates weighted scores based on error severity
- Produces aggregated metrics for reporting
- Stores final scores back to DynamoDB

**Scoring Algorithm (Lambda Logic):**
```javascript
// Pseudo-code for scoring logic
const calculateAccuracyScore = (validationResults, totalRecords) => {
  let totalPenalty = 0;
  const maxPossibleScore = totalRecords * 100; // 100 points per record
  
  validationResults.forEach(result => {
    const { errorCount, severity } = result;
    
    // Apply weighted penalties
    if (severity === 'CRITICAL') {
      totalPenalty += errorCount * 10;
    } else if (severity === 'MAJOR') {
      totalPenalty += errorCount * 5;
    } else if (severity === 'MINOR') {
      totalPenalty += errorCount * 2;
    }
  });
  
  // Calculate percentage score
  const accuracyScore = Math.max(0, 
    ((maxPossibleScore - totalPenalty) / maxPossibleScore) * 100
  );
  
  return accuracyScore;
};
```

**Athena Query for Per-Record Scoring:**
```sql
-- Create comprehensive error view per record
CREATE TABLE emir_record_scores AS
SELECT 
  t.uti,
  t.report_date,
  -- Calculate penalty points per record
  (
    -- Completeness errors
    (CASE WHEN t.uti IS NULL THEN 10 ELSE 0 END) +
    (CASE WHEN t.counterparty_1 IS NULL THEN 10 ELSE 0 END) +
    (CASE WHEN t.action_type IS NULL THEN 10 ELSE 0 END) +
    
    -- Format errors (join with validation results)
    COALESCE(fmt.penalty_points, 0) +
    
    -- Logical errors
    COALESCE(log.penalty_points, 0)
  ) as total_penalty,
  
  -- Convert to 0-100 score
  GREATEST(0, 100 - (
    (CASE WHEN t.uti IS NULL THEN 10 ELSE 0 END) +
    (CASE WHEN t.counterparty_1 IS NULL THEN 10 ELSE 0 END) +
    -- ... etc
  )) as accuracy_score
FROM emir_trades t
LEFT JOIN format_errors fmt ON t.uti = fmt.uti
LEFT JOIN logical_errors log ON t.uti = log.uti
WHERE t.year='2025' AND t.month='09' AND t.day='25';

-- Field category scores
SELECT 
  'Critical Identifiers' as category,
  AVG(CASE WHEN uti IS NOT NULL AND counterparty_1 IS NOT NULL THEN 100 ELSE 0 END) as score
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25'
UNION ALL
SELECT 
  'Trade Information' as category,
  AVG(CASE WHEN action_type IS NOT NULL AND event_type IS NOT NULL THEN 100 ELSE 0 END) as score
FROM emir_trades
WHERE year='2025' AND month='09' AND day='25';
-- ... repeat for all categories
```

**DynamoDB Tables for Scoring:**

Table: `emir_accuracy_scores`
```
PK: reportDate#executionId
SK: OVERALL
Attributes:
  - overallAccuracyScore: 87.3
  - totalRecords: 1500000
  - recordsWithErrors: 189500
  - criticalErrorCount: 1250
  - majorErrorCount: 5230
  - minorErrorCount: 12340
  - categoryScores: {
      "critical_identifiers": 98.2,
      "trade_information": 95.1,
      "product_information": 89.4,
      ...
    }
```

Table: `emir_record_level_scores` (separate table for large datasets)
```
PK: reportDate#executionId
SK: uti (trade identifier)
Attributes:
  - accuracyScore: 85
  - errorList: ["MISSING_ISIN", "DATE_SEQUENCE"]
  - penaltyPoints: 15
```

**Output to Step Functions:**
```json
{
  "phase": "scoring",
  "status": "completed",
  "overallScore": 87.3,
  "traffLightStatus": "AMBER",
  "readyForReporting": true,
  "scoringTimestamp": "2025-09-25T11:45:00Z"
}
```

---

## Phase 6: Report Generation

### 6.1 Executive Summary
Create a one-page overview with:
- Overall data quality score
- Total records analyzed
- Key findings (3-5 bullet points)
- Critical issues requiring immediate attention
- Recommendation summary

### 6.2 Detailed Metrics Dashboard
**Include:**
- Completeness rate by field category
- Error breakdown by severity (Critical/Major/Minor)
- Top 10 most problematic fields
- Records with highest/lowest quality scores

### 6.3 Field-by-Field Analysis
Create a table showing for each field:
- Field name
- Mandatory/Optional status
- Completeness rate (%)
- Number of format errors
- Number of logical errors
- Examples of issues found

### 6.4 Error Details
Provide specific examples:
- List of records with critical errors
- Sample invalid values
- Suggested corrections where applicable

### 6.5 Trend Analysis (if historical data available)
- Compare to previous reporting periods
- Show improvement or degradation
- Highlight recurring issues

### 6.6 Recommendations
- Prioritized action items
- Root cause analysis for common errors
- Process improvements suggestions
- Timeline for remediation

### Implementation Steps (Phases 6-8: Report Generation, Visualization & Output)

**Lambda Function: `src/emir/report-generator/index.js`**
- Invoked after Phase 5 (scoring) completes
- Retrieves all scoring and validation data from DynamoDB
- Generates multiple report formats (PDF, Excel, CSV)
- Uploads reports to S3 bucket for distribution
- Sends EventBridge notification when complete

**Lambda Layer Requirements:**
Create custom Lambda layers for report generation libraries:
- **Layer 1: Python data processing** - pandas, numpy (for data manipulation)
- **Layer 2: Visualization** - matplotlib, seaborn (for charts)
- **Layer 3: Report generation** - reportlab (PDF), openpyxl (Excel)
- Alternative: Use Node.js libraries (Chart.js, exceljs, pdfkit)

**Report Generation Strategy:**

1. **Executive PDF (1-2 pages)**
   - Lambda reads summary data from DynamoDB
   - Uses template engine (EJS or similar) to populate HTML
   - Converts HTML to PDF using headless Chrome (AWS Lambda Layer) or reportlab
   - Includes: overall score, traffic light indicator, top 5 findings, key metrics
   - Upload to S3: `s3://emir-reports/2025-09-25/executive-summary.pdf`

2. **Detailed Excel Workbook (multiple sheets)**
   - Sheet 1: Executive Summary (same as PDF)
   - Sheet 2: Field-by-field analysis (203 rows, 7 columns)
   - Sheet 3: Error details by severity (sortable table)
   - Sheet 4: Sample errors (UTI, field, error type, invalid value)
   - Sheet 5: Trend analysis (if historical data available)
   - Sheet 6: Recommendations
   - Uses openpyxl or exceljs to programmatically create workbook
   - Includes formatting: conditional formatting, charts, freeze panes
   - Upload to S3: `s3://emir-reports/2025-09-25/detailed-analysis.xlsx`

3. **CSV Exports (for further analysis)**
   - File 1: Record-level scores (uti, accuracy_score, error_count)
   - File 2: Field-level completeness (field_name, completion_rate, error_count)
   - File 3: Error catalog (error_type, severity, count, sample_utis)
   - Generated directly from Athena queries (UNLOAD to S3)
   - Upload to S3: `s3://emir-reports/2025-09-25/data/`

**Visualization Implementation:**

**Chart Generation (in Lambda):**
```javascript
// Pseudo-code for chart generation
const generateCharts = async (scoringData) => {
  // 1. Pie Chart: Error distribution by severity
  const errorDistribution = {
    labels: ['Critical', 'Major', 'Minor'],
    data: [scoringData.criticalCount, scoringData.majorCount, scoringData.minorCount]
  };
  const pieChartBuffer = await createPieChart(errorDistribution);
  
  // 2. Bar Chart: Top 10 problematic fields
  const top10Fields = await queryDynamoDB({
    TableName: 'emir_validation_results',
    Key: { PK: reportDate, SK: { begins_with: 'COMPLETENESS#' }},
    SortBy: 'errorCount',
    Limit: 10
  });
  const barChartBuffer = await createBarChart(top10Fields);
  
  // 3. Line Chart: Trend over time (query historical data)
  const trendData = await queryHistoricalScores(reportDate, 30); // Last 30 days
  const lineChartBuffer = await createLineChart(trendData);
  
  // 4. Heatmap: Field category quality matrix
  const heatmapData = await getCategoryScores();
  const heatmapBuffer = await createHeatmap(heatmapData);
  
  return { pieChartBuffer, barChartBuffer, lineChartBuffer, heatmapBuffer };
};
```

**Traffic Light Logic:**
```javascript
const getTrafficLightStatus = (accuracyScore) => {
  if (accuracyScore >= 95) return { status: 'GREEN', color: '#28a745', message: 'Excellent' };
  if (accuracyScore >= 85) return { status: 'AMBER', color: '#ffc107', message: 'Needs Attention' };
  return { status: 'RED', color: '#dc3545', message: 'Critical Issues' };
};
```

**Athena Queries for Report Data:**
```sql
-- Trend analysis: Compare to previous periods
SELECT 
  report_date,
  AVG(accuracy_score) as avg_accuracy,
  COUNT(CASE WHEN accuracy_score < 70 THEN 1 END) as poor_quality_records
FROM emir_record_scores
WHERE report_date >= DATE_ADD('day', -30, CURRENT_DATE)
GROUP BY report_date
ORDER BY report_date;

-- Top 10 most problematic fields
SELECT 
  field_name,
  SUM(error_count) as total_errors,
  AVG(missing_percentage) as avg_missing_pct,
  MAX(severity) as max_severity
FROM emir_validation_results
WHERE report_date = '2025-09-25'
GROUP BY field_name
ORDER BY total_errors DESC
LIMIT 10;

-- Records with lowest quality scores (for detailed error section)
SELECT 
  uti, accuracy_score, error_list
FROM emir_record_scores
WHERE report_date = '2025-09-25'
  AND accuracy_score < 50
ORDER BY accuracy_score ASC
LIMIT 100;
```

**S3 Bucket Structure for Reports:**
```
s3://emir-reports/
├── 2025-09-24/
│   ├── executive-summary.pdf
│   ├── detailed-analysis.xlsx
│   ├── data/
│   │   ├── record-scores.csv
│   │   ├── field-analysis.csv
│   │   └── error-catalog.csv
│   └── charts/
│       ├── error-distribution.png
│       ├── top-fields.png
│       └── trend-analysis.png
├── 2025-09-25/
│   └── ... (same structure)
```

**Report Delivery Options:**

1. **S3 Pre-signed URLs**
   - Generate time-limited URLs for secure download
   - Return URLs via API or email notification

2. **Email Notification (via SNS + SES)**
   - EventBridge triggers SNS topic when report complete
   - SES sends email to CEO with summary and download links

3. **API Gateway Endpoint**
   - GET `/reports/{reportDate}` - returns metadata and download links
   - GET `/reports/{reportDate}/executive` - downloads PDF
   - GET `/reports/{reportDate}/detailed` - downloads Excel
   - GET `/reports/latest` - redirects to most recent report

**Step Functions Final State:**
```json
{
  "status": "COMPLETED",
  "reportDate": "2025-09-25",
  "executionId": "uuid",
  "reports": {
    "executivePdf": "s3://emir-reports/2025-09-25/executive-summary.pdf",
    "detailedExcel": "s3://emir-reports/2025-09-25/detailed-analysis.xlsx",
    "dataExports": "s3://emir-reports/2025-09-25/data/"
  },
  "overallScore": 87.3,
  "trafficLight": "AMBER",
  "completionTime": "2025-09-25T12:15:00Z",
  "totalDuration": "45 minutes"
}
```

**EventBridge Event (Pipeline Complete):**
```json
{
  "source": "emir.reporting",
  "detail-type": "ReportGenerationComplete",
  "detail": {
    "reportDate": "2025-09-25",
    "executionId": "uuid",
    "overallScore": 87.3,
    "trafficLight": "AMBER",
    "downloadLinks": {
      "executive": "https://presigned-url...",
      "detailed": "https://presigned-url..."
    }
  }
}
```

---

## Phase 7: Visualization
*(Integrated into Phase 6 implementation above)*

### 7.1 Key Charts to Include
- **Pie Chart:** Error distribution by severity
- **Bar Chart:** Top 10 fields with most errors
- **Bar Chart:** Completeness rate by field category
- **Line Chart:** Accuracy trend over time (if applicable)
- **Heatmap:** Field-level quality matrix

### 7.2 Traffic Light Indicators
Use Red/Amber/Green indicators:
- **Green:** >95% accuracy
- **Amber:** 85-95% accuracy
- **Red:** <85% accuracy

---

## Phase 8: Output Formats
*(Integrated into Phase 6 implementation above)*

### 8.1 Create Multiple Deliverables
- **Executive PDF:** 1-2 page summary for CEO
- **Detailed Excel:** Full field analysis and error listing
- **Interactive Dashboard:** If using visualization tools
- **Raw Data Export:** CSV with quality scores per record

---

## Technical Notes

### Data Handling Considerations
- **Large datasets**: Athena handles partitioned data efficiently (millions of records)
- **Character encoding**: Ensure S3 upload preserves UTF-8 encoding for CSV files
- **Null handling**: Athena distinguishes between NULL and empty string; standardize in validation logic
- **Partitioning strategy**: Use year/month/day partitions in S3 for query performance
- **Athena query optimization**: 
  - Use columnar formats (Parquet) for very large datasets (convert CSV on upload)
  - Partition pruning reduces scan costs by 90%+
  - Compress data (GZIP) to reduce storage and scan costs

### Validation Rule Sources
- **EMIR REFIT technical standards (RTS/ITS)**: Store as reference data in S3/DynamoDB
- **ESMA guidelines and Q&As**: Keep updated validation rule library
- **ISO standards**: LEI (ISO 17442), currency codes (ISO 4217), country codes (ISO 3166)
- **Kaizen's proprietary test rules**: Version control in separate config file
- **Reference data updates**: Schedule Lambda to refresh validation rules weekly

### AWS Service Limits & Considerations
- **Lambda execution time**: Max 15 minutes - use Step Functions for long-running tasks
- **Lambda memory**: Increase to 3GB for report generation with charts
- **Athena query timeout**: 30 minutes default - should be sufficient
- **Athena concurrent queries**: 20 per account - run validations in sequence if needed
- **DynamoDB item size**: 400KB max - large error lists may need separate table
- **S3 object size**: 5TB max per object - CSV files should fit easily
- **Step Functions execution time**: 1 year max - plenty for 45-minute pipeline

### Cost Optimization
- **Athena**: Partition data to scan only relevant dates (~$5/TB scanned)
- **S3**: Use Intelligent-Tiering for automatic cost optimization
- **Lambda**: Right-size memory allocation (more memory = faster = cheaper)
- **DynamoDB**: Use on-demand pricing for unpredictable workloads
- **Estimated monthly cost**: $50-200 for daily reports (1M records each)

### Quality Assurance
- **Unit tests**: Test validation logic with sample datasets
- **Integration tests**: End-to-end pipeline test with known good/bad data
- **Edge cases**: Empty files, malformed CSV, duplicate UTIs, future dates
- **Mock data**: Generate synthetic EMIR data for testing (use Faker or similar)
- **Version control**: All Lambda code, CDK infrastructure, validation rules in Git
- **CI/CD**: Use AWS CodePipeline or GitHub Actions for automated deployment

### Security & Compliance
- **Data encryption**: S3 encryption at rest (SSE-S3 or KMS)
- **Access control**: IAM roles with least privilege principle
- **Audit logging**: Enable CloudTrail for all S3 and Lambda activity
- **Data retention**: Configure S3 lifecycle policies (90 days compliance requirement?)
- **PII handling**: If LEI data is sensitive, enable S3 object lock
- **Report access**: Pre-signed URLs with short expiration (1 hour)

---

## Implementation Checklist

### Phase 0: Infrastructure Setup
- [ ] **Update CDK dependencies**: Ensure latest aws-cdk-lib version
- [ ] **Create S3 buckets**: lib/storage.ts (raw data + reports buckets)
- [ ] **Setup Glue Data Catalog**: lib/glue-catalog.ts (define 203-field schema)
- [ ] **Create DynamoDB tables**: Update lib/database.ts (add EMIR tables)
- [ ] **Configure Athena workgroup**: Set query result location, enable encryption
- [ ] **Deploy initial stack**: `cdk deploy` to provision base infrastructure

### Phase 1: Lambda Functions
- [ ] **data-loader**: src/emir/data-loader/index.js (S3 trigger, start Step Functions)
- [ ] **completeness-validator**: src/emir/completeness-validator/index.js (Phase 2)
- [ ] **format-validator**: src/emir/format-validator/index.js (Phase 3)
- [ ] **logical-validator**: src/emir/logical-validator/index.js (Phase 4)
- [ ] **scoring-engine**: src/emir/scoring-engine/index.js (Phase 5)
- [ ] **report-generator**: src/emir/report-generator/index.js (Phases 6-8)
- [ ] **Create Lambda layers**: pandas, matplotlib, reportlab/openpyxl

### Phase 2: Step Functions
- [ ] **Design state machine**: lib/step-functions.ts (orchestrate 6 Lambdas)
- [ ] **Configure parallel states**: Run Phase 3 & 4 simultaneously
- [ ] **Add error handling**: Retry logic, catch failures, send notifications
- [ ] **Test state machine**: Use AWS Console to manually trigger with sample payload

### Phase 3: Validation Logic
- [ ] **Confirm mandatory fields**: Review with regulatory team (203 fields)
- [ ] **Create Athena query library**: Reusable SQL queries for each validation type
- [ ] **Build reference data**: ISO currency codes, LEI patterns, validation rules
- [ ] **Implement scoring weights**: Critical (-10), Major (-5), Minor (-2)
- [ ] **Test with sample data**: Use 2025-09-25 sample file

### Phase 4: Report Generation
- [ ] **Design PDF template**: Executive summary layout
- [ ] **Design Excel workbook**: 6 sheets with formatting
- [ ] **Implement chart generation**: Pie, bar, line, heatmap charts
- [ ] **Configure S3 pre-signed URLs**: 1-hour expiration
- [ ] **Setup email notifications**: SNS + SES for CEO delivery

### Phase 5: API Layer (Optional)
- [ ] **Create API Gateway**: lib/emir-api.ts
- [ ] **Implement endpoints**: GET /reports, /reports/{date}, /reports/latest
- [ ] **Add authentication**: API keys or Cognito
- [ ] **Test API**: Postman collection

### Phase 6: Testing & QA
- [ ] **Unit tests**: Each Lambda function with Jest
- [ ] **Integration tests**: End-to-end pipeline with sample data
- [ ] **Edge case testing**: Empty files, malformed CSV, extreme values
- [ ] **Performance testing**: 1M+ record files, measure execution time
- [ ] **Cost validation**: Review AWS Cost Explorer after test runs

### Phase 7: Deployment
- [ ] **Code review**: Review all Lambda functions and CDK code
- [ ] **Deploy to dev environment**: Test with non-production data
- [ ] **Deploy to prod environment**: `cdk deploy --profile production`
- [ ] **Run first production report**: 2025-09-25 data
- [ ] **Review with team**: Verify accuracy scores make sense
- [ ] **Send to CEO**: Deliver executive PDF with talking points

### Phase 8: Monitoring & Maintenance
- [ ] **Setup CloudWatch dashboards**: Monitor Lambda errors, Athena query costs
- [ ] **Configure alarms**: Alert on pipeline failures, high costs
- [ ] **Schedule regular runs**: EventBridge cron for daily/weekly reports
- [ ] **Document runbooks**: How to troubleshoot common issues
- [ ] **Plan for updates**: Version control validation rules, update reference data

---

## Questions to Clarify with CEO (when available)

1. What's the primary concern - compliance risk, operational efficiency, or client reporting?
2. Are there specific fields or error types of particular interest?
3. Is there a comparison period or benchmark target?
4. What's the audience beyond yourself (regulators, clients, internal)?
5. What's the deadline for this report?
6. Do you want recommendations for remediation, or just the analysis?

---

## CDK Stack Structure (lib/ directory)

### Main Stack: lib/emir-stack.ts
```typescript
// Extends existing AwsMicroservicesStack pattern
export class EmirReportingStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 1. Storage layer
    const storage = new EmirStorage(this, 'EmirStorage');
    
    // 2. Data catalog
    const dataCatalog = new EmirDataCatalog(this, 'EmirDataCatalog', {
      rawDataBucket: storage.rawDataBucket,
      database: 'emir_reporting'
    });
    
    // 3. DynamoDB tables (extends existing SwnDatabase pattern)
    const database = new EmirDatabase(this, 'EmirDatabase');
    
    // 4. Lambda microservices (similar to SwnMicroservices)
    const microservices = new EmirMicroservices(this, 'EmirMicroservices', {
      rawDataBucket: storage.rawDataBucket,
      reportsBucket: storage.reportsBucket,
      athenaWorkgroup: storage.athenaWorkgroup,
      reportRunsTable: database.reportRunsTable,
      validationResultsTable: database.validationResultsTable,
      accuracyScoresTable: database.accuracyScoresTable
    });
    
    // 5. Step Functions pipeline
    const pipeline = new EmirPipeline(this, 'EmirPipeline', {
      dataLoaderFunction: microservices.dataLoaderFunction,
      completenessValidatorFunction: microservices.completenessValidatorFunction,
      formatValidatorFunction: microservices.formatValidatorFunction,
      logicalValidatorFunction: microservices.logicalValidatorFunction,
      scoringEngineFunction: microservices.scoringEngineFunction,
      reportGeneratorFunction: microservices.reportGeneratorFunction
    });
    
    // 6. EventBridge (reuse existing SwnEventBus pattern)
    const eventBus = new EmirEventBus(this, 'EmirEventBus', {
      publisherFunction: microservices.reportGeneratorFunction,
      reportCompleteTopic: /* SNS topic for notifications */
    });
    
    // 7. API Gateway (optional - for report retrieval)
    const api = new EmirApi(this, 'EmirApi', {
      reportRetrievalFunction: microservices.reportRetrievalFunction,
      reportsBucket: storage.reportsBucket
    });
  }
}
```

### File Organization
```
/home/jquintana-arroyo/git/G20Reporting/
├── lib/
│   ├── aws-microservices-stack.ts      (existing - e-commerce)
│   ├── apigateway.ts                   (existing)
│   ├── database.ts                     (existing)
│   ├── eventbus.ts                     (existing)
│   ├── microservice.ts                 (existing)
│   ├── queue.ts                        (existing)
│   │
│   ├── emir-stack.ts                   (NEW - main EMIR stack)
│   ├── storage.ts                      (NEW - S3 + Athena)
│   ├── glue-catalog.ts                 (NEW - schema definitions)
│   ├── emir-database.ts                (NEW - EMIR DynamoDB tables)
│   ├── emir-microservices.ts           (NEW - Lambda functions)
│   ├── step-functions.ts               (NEW - pipeline orchestration)
│   ├── emir-eventbus.ts                (NEW - notification events)
│   └── emir-api.ts                     (NEW - optional report API)
│
├── src/
│   ├── product/                        (existing)
│   ├── basket/                         (existing)
│   ├── ordering/                       (existing)
│   │
│   └── emir/                           (NEW)
│       ├── data-loader/
│       │   ├── index.js
│       │   └── package.json
│       ├── completeness-validator/
│       │   ├── index.js
│       │   ├── queries.sql
│       │   └── package.json
│       ├── format-validator/
│       │   ├── index.js
│       │   ├── validators/
│       │   │   ├── lei-validator.js
│       │   │   ├── isin-validator.js
│       │   │   └── upi-validator.js
│       │   └── package.json
│       ├── logical-validator/
│       │   ├── index.js
│       │   ├── rules/
│       │   │   ├── date-logic.js
│       │   │   ├── clearing-logic.js
│       │   │   └── derivative-logic.js
│       │   └── package.json
│       ├── scoring-engine/
│       │   ├── index.js
│       │   ├── scoring-algorithm.js
│       │   └── package.json
│       └── report-generator/
│           ├── index.js
│           ├── templates/
│           │   ├── executive-summary.html
│           │   └── detailed-report.xlsx
│           ├── charts/
│           │   ├── pie-chart.js
│           │   ├── bar-chart.js
│           │   └── line-chart.js
│           └── package.json
│
├── reference-data/                     (NEW)
│   ├── iso-currency-codes.json
│   ├── mandatory-fields.json
│   ├── validation-rules.json
│   └── emir-field-schema.json
│
├── test/
│   ├── aws-microservices.test.ts       (existing)
│   ├── emir-stack.test.ts              (NEW)
│   └── emir/                           (NEW)
│       ├── data-loader.test.ts
│       ├── completeness-validator.test.ts
│       ├── format-validator.test.ts
│       ├── logical-validator.test.ts
│       ├── scoring-engine.test.ts
│       └── report-generator.test.ts
│
├── bin/
│   └── aws-microservices.ts            (update to deploy both stacks)
│
├── package.json
├── tsconfig.json
├── cdk.json
├── README.md
└── emir-accuracy-report-guide.md       (this file)
```

### Deployment Commands
```bash
# Deploy only e-commerce stack (existing)
cdk deploy AwsMicroservicesStack

# Deploy only EMIR reporting stack (new)
cdk deploy EmirReportingStack

# Deploy both stacks
cdk deploy --all

# Deploy to specific environment
cdk deploy EmirReportingStack --profile production

# Generate CloudFormation template
cdk synth EmirReportingStack

# Compare deployed stack with current state
cdk diff EmirReportingStack

# Destroy stack (careful!)
cdk destroy EmirReportingStack
```

### Integration Points with Existing Repo
- **Reuse patterns**: EventBridge, Lambda, DynamoDB constructs follow same pattern as existing code
- **Separate concerns**: EMIR stack is independent from e-commerce stack
- **Shared infrastructure**: Can optionally share EventBridge or API Gateway if desired
- **Consistent naming**: Follow `Swn` prefix pattern (or change to `Emir` prefix)
- **CDK best practices**: Use constructs, props interfaces, resource grants (same as existing code)

---

## Summary

This implementation guide maps your EMIR accuracy testing requirements to AWS serverless architecture using:

✅ **S3 + Athena** for scalable, cost-effective data storage and querying  
✅ **Step Functions** for orchestrating the 8-phase validation pipeline  
✅ **Lambda** for compute-intensive validation and report generation  
✅ **DynamoDB** for storing validation results and report metadata  
✅ **EventBridge** for event-driven decoupling (existing pattern)  
✅ **CDK** for infrastructure-as-code (existing pattern)

**Estimated Build Time**: 4-6 weeks (1 developer)  
**Estimated Monthly Cost**: $50-200 (for daily reports with 1M records)  
**Pipeline Execution Time**: ~45 minutes (per report run)

You now have a comprehensive blueprint that extends your existing serverless microservices architecture to support EMIR regulatory reporting!

---

*Document created: 2025-11-04*  
*Document updated: 2025-11-05 (AWS implementation details)*  
*Project: EMIR Accuracy Testing Report*  
*Company: Kaizen Reporting*