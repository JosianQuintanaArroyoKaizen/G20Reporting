# EMIR Accuracy Reporting - Infrastructure Design

## Overview
Complete infrastructure design for EMIR (European Market Infrastructure Regulation) accuracy reporting system analyzing 203 REFIT fields from ETD ESMA EOD Trade Activity data.

---

## Dynamic Naming Convention

### Pattern
```
{resource-type}-{project}-{purpose}-{environment}-{region}-{account}
```

### Examples
```
s3://emir-raw-data-dev-us-east-1-194561596031
lambda: emir-data-loader-prod-eu-west-1
table: EmirReportRuns-Dev-USEast1
```

### Environment Values
- `dev` - Development/testing
- `staging` - Pre-production
- `prod` - Production

### Supported Regions
- `us-east-1` - US East (N. Virginia) - Default, cheapest
- `eu-west-1` - Europe (Ireland) - ESMA proximity
- `eu-central-1` - Europe (Frankfurt) - GDPR considerations

---

## 1. Storage Layer (S3 Buckets)

### 1.1 Raw Data Bucket
**Purpose**: Store incoming EMIR CSV files from ESMA  
**Naming**: `emir-raw-data-{env}-{region}-{account}`  
**Structure**:
```
s3://emir-raw-data-dev-us-east-1-194561596031/
├── year=2025/
│   ├── month=09/
│   │   ├── day=24/
│   │   │   └── etd_esma_eod_20250924.csv
│   │   └── day=25/
│   │       └── etd_esma_eod_20250925.csv
│   └── month=10/
└── failed/  # Malformed files moved here
```

**Configuration**:
- Encryption: SSE-S3 (or KMS for prod)
- Versioning: Enabled
- Lifecycle: Archive to Glacier after 90 days
- Event notifications: Trigger Lambda on PUT
- Partitioning: year/month/day for Athena optimization

**Size Estimates**:
- Daily file: 1-5 GB (1M trades ≈ 2GB)
- Monthly: 30-150 GB
- Yearly: 365-1800 GB

### 1.2 Reports Bucket
**Purpose**: Store generated PDF/Excel reports  
**Naming**: `emir-reports-{env}-{region}-{account}`  
**Structure**:
```
s3://emir-reports-dev-us-east-1-194561596031/
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
└── 2025-09-25/
```

**Configuration**:
- Encryption: SSE-S3
- Lifecycle: Keep for 2 years (regulatory requirement)
- Pre-signed URLs: 1 hour expiration
- CORS: Enabled for web access

**Size Estimates**:
- Per report: 5-50 MB
- Monthly: ~1.5 GB
- Yearly: ~18 GB

### 1.3 Athena Results Bucket
**Purpose**: Store Athena query results  
**Naming**: `emir-athena-results-{env}-{region}-{account}`  
**Structure**:
```
s3://emir-athena-results-dev-us-east-1-194561596031/
├── queries/
└── metadata/
```

**Configuration**:
- Encryption: SSE-S3
- Lifecycle: Delete after 30 days (temp query results)

**Size Estimates**:
- Per query: 1-100 MB
- Daily: ~500 MB
- Auto-cleanup after 30 days

---

## 2. Data Catalog (AWS Glue)

### 2.1 Glue Database
**Name**: `emir_reporting_{env}_{region_code}`  
**Example**: `emir_reporting_dev_use1`

### 2.2 Glue Table: EMIR Trades
**Name**: `emir_trades`  
**Location**: `s3://emir-raw-data-{env}-{region}-{account}/`  
**Format**: CSV with header  
**Partitions**: `year`, `month`, `day`

**Schema**: 203 EMIR REFIT Fields

#### Critical Identifiers (6 fields)
```sql
uti STRING                          -- Unique Transaction Identifier
report_tracking_number STRING       -- Report tracking number
counterparty_1 STRING              -- Reporting counterparty LEI (20 chars)
counterparty_2 STRING              -- Other counterparty LEI (20 chars)
report_submitting_entity_id STRING -- Submitting entity LEI
entity_responsible_reporting STRING -- Responsible entity LEI
```

#### Critical Trade Information (7 fields)
```sql
action_type STRING                 -- NEW, MODIFY, CANCEL, etc.
event_type STRING                  -- Trade event type
event_date DATE                    -- Event occurrence date
execution_timestamp TIMESTAMP      -- Trade execution time
effective_date DATE                -- Contract effective date
expiration_date DATE               -- Contract expiration
direction STRING                   -- BUY or SELL
```

#### Product Information (10 fields)
```sql
isin STRING                        -- ISIN (12 chars)
upi STRING                         -- UPI code
asset_class STRING                 -- EQUITY, COMMODITY, FX, etc.
product_classification STRING      -- Product taxonomy
underlying_isin STRING             -- Underlying asset ISIN
underlying_index STRING            -- Index name if applicable
notional_currency_1 STRING         -- Currency ISO 4217 (3 chars)
notional_amount_1 DECIMAL(18,2)    -- Notional amount
price_currency STRING              -- Price currency
price DECIMAL(18,6)                -- Trade price
```

#### Clearing Information (5 fields)
```sql
cleared BOOLEAN                    -- true/false
central_counterparty STRING        -- CCP LEI
clearing_timestamp TIMESTAMP       -- When cleared
clearing_obligation BOOLEAN        -- Subject to clearing obligation
clearing_member STRING             -- Clearing member LEI
```

#### Additional Fields (175+ fields)
Including: venue, broker, execution agent, collateral, margins, valuation, legs (for swaps), option details, derivative specifics, etc.

**Full schema**: See `reference-data/emir-field-schema.json` (to be created)

---

## 3. Metadata Store (DynamoDB)

### 3.1 Report Runs Table
**Name**: `EmirReportRuns-{Environment}-{RegionCode}`  
**Example**: `EmirReportRuns-Dev-USEast1`

**Schema**:
```
PK: reportDate (STRING)           # "2025-09-25"
SK: executionId (STRING)          # UUID v4

Attributes:
  status (STRING)                 # INITIATED | IN_PROGRESS | COMPLETED | FAILED
  totalRecords (NUMBER)           # Number of trades analyzed
  s3Location (STRING)             # S3 path to source CSV
  reportS3Location (STRING)       # S3 path to generated report
  startTime (STRING)              # ISO 8601 timestamp
  endTime (STRING)                # ISO 8601 timestamp
  currentPhase (STRING)           # Phase 1-8
  phase1CompleteTime (STRING)
  phase2CompleteTime (STRING)
  phase3CompleteTime (STRING)
  phase4CompleteTime (STRING)
  phase5CompleteTime (STRING)
  phase6CompleteTime (STRING)
  overallScore (NUMBER)           # 0-100 accuracy score
  trafficLight (STRING)           # GREEN | AMBER | RED
  errorSummary (MAP)              # { critical: N, major: N, minor: N }
  ttl (NUMBER)                    # Auto-delete old records after 2 years
```

**Access Patterns**:
- Get report by date
- Get latest report
- List reports by date range
- Get reports by status

**Configuration**:
- Billing: On-demand (unpredictable load)
- TTL: 2 years
- Encryption: AWS managed

**Size Estimates**:
- Per item: ~2 KB
- Daily: 1 report = 2 KB
- Yearly: ~730 KB (negligible)

### 3.2 Validation Results Table
**Name**: `EmirValidationResults-{Environment}-{RegionCode}`

**Schema**:
```
PK: reportDate#executionId (STRING)    # "2025-09-25#uuid"
SK: validationType#fieldName (STRING)  # "COMPLETENESS#UTI"

Attributes:
  totalRecords (NUMBER)
  errorCount (NUMBER)
  errorPercentage (NUMBER)           # 0-100
  errorSeverity (STRING)             # CRITICAL | MAJOR | MINOR
  sampleErrors (LIST)                # [uti1, uti2, ...] up to 10 samples
  sampleInvalidValues (LIST)         # Example bad values
  validationTimestamp (STRING)
  validationPhase (NUMBER)           # 2, 3, or 4
  ttl (NUMBER)
```

**Access Patterns**:
- Get all validations for a report
- Get validations by severity
- Get validations by field
- Get validations by type

**Configuration**:
- Billing: On-demand
- TTL: 2 years
- GSI: errorSeverity-index (query by severity)

**Size Estimates**:
- Per report: ~200 validation items (203 fields)
- Per item: ~1 KB
- Daily: ~200 KB
- Yearly: ~73 MB

### 3.3 Accuracy Scores Table
**Name**: `EmirAccuracyScores-{Environment}-{RegionCode}`

**Schema**:
```
PK: reportDate#executionId (STRING)
SK: scoreType (STRING)              # OVERALL | CATEGORY | FIELD

Attributes:
  # For OVERALL:
  overallAccuracyScore (NUMBER)     # 0-100
  totalRecords (NUMBER)
  recordsWithErrors (NUMBER)
  criticalErrorCount (NUMBER)
  majorErrorCount (NUMBER)
  minorErrorCount (NUMBER)
  
  # For CATEGORY:
  categoryName (STRING)             # "Critical Identifiers", "Trade Info", etc.
  categoryScore (NUMBER)            # 0-100
  
  # For FIELD:
  fieldName (STRING)
  fieldScore (NUMBER)
  completenessRate (NUMBER)
  formatErrorCount (NUMBER)
  logicalErrorCount (NUMBER)
  
  calculationTimestamp (STRING)
  ttl (NUMBER)
```

**Access Patterns**:
- Get overall score
- Get category scores
- Get field-level scores
- Compare scores over time

**Configuration**:
- Billing: On-demand
- TTL: 5 years (historical analysis)
- GSI: categoryName-index

**Size Estimates**:
- Per report: ~250 items
- Per item: ~500 bytes
- Daily: ~125 KB
- Yearly: ~45 MB

### 3.4 Record Level Scores Table (Optional - for large datasets)
**Name**: `EmirRecordScores-{Environment}-{RegionCode}`

**Schema**:
```
PK: reportDate#executionId (STRING)
SK: uti (STRING)                    # Trade identifier

Attributes:
  accuracyScore (NUMBER)            # 0-100
  errorList (LIST)                  # ["MISSING_ISIN", "DATE_SEQUENCE"]
  penaltyPoints (NUMBER)
  ttl (NUMBER)
```

**Notes**:
- Only store records with errors (not all 1M+)
- Reduces storage costs significantly
- On-demand billing for bursty writes

**Size Estimates**:
- If 10% have errors: 100K items per report
- Per item: ~500 bytes
- Daily: ~50 MB
- Yearly: ~18 GB

---

## 4. Compute Layer (AWS Lambda)

### 4.1 Data Loader
**Name**: `emir-data-loader-{env}-{region}`  
**Runtime**: Node.js 20  
**Memory**: 512 MB  
**Timeout**: 5 minutes  

**Triggers**: S3 PUT event  
**Purpose**: 
- Detect new CSV file in raw bucket
- Extract metadata (row count, date, size)
- Validate CSV header (203 expected columns)
- Create DynamoDB record in EmirReportRuns
- Start Step Functions execution

**Environment Variables**:
```
REPORT_RUNS_TABLE=EmirReportRuns-Dev-USEast1
RAW_DATA_BUCKET=emir-raw-data-dev-us-east-1-194561596031
GLUE_DATABASE=emir_reporting_dev_use1
STEP_FUNCTION_ARN=arn:aws:states:...
ENVIRONMENT=dev
REGION=us-east-1
```

**Estimated Executions**: 1 per day = ~30/month  
**Cost**: ~$0.01/month

### 4.2 Completeness Validator
**Name**: `emir-completeness-validator-{env}-{region}`  
**Runtime**: Node.js 20  
**Memory**: 1024 MB  
**Timeout**: 15 minutes  

**Purpose**: 
- Execute Athena queries for mandatory field checks
- Analyze 203 fields for NULL/empty values
- Calculate completeness rates
- Write results to EmirValidationResults table

**Athena Queries**: ~50 queries  
**Estimated Executions**: 1 per report = ~30/month  
**Cost**: ~$0.50/month (Lambda) + ~$1-5/month (Athena scans)

### 4.3 Format Validator
**Name**: `emir-format-validator-{env}-{region}`  
**Runtime**: Node.js 20  
**Memory**: 1024 MB  
**Timeout**: 15 minutes  

**Purpose**:
- Validate LEI format (20 alphanumeric)
- Validate ISIN format (12 chars, check digit)
- Validate UPI format
- Validate currency codes (ISO 4217)
- Validate date formats (ISO 8601)
- Check UTI uniqueness

**Athena Queries**: ~30 queries with regex  
**Custom Logic**: ISIN check digit calculation  
**Estimated Executions**: 1 per report = ~30/month  
**Cost**: ~$0.50/month (Lambda) + ~$1-3/month (Athena)

### 4.4 Logical Validator
**Name**: `emir-logical-validator-{env}-{region}`  
**Runtime**: Node.js 20  
**Memory**: 1536 MB  
**Timeout**: 15 minutes  

**Purpose**:
- Cross-field validation (dates in sequence)
- Clearing logic validation
- Notional/valuation consistency
- Derivative-specific rules (options, swaps, futures)
- Counterparty direction consistency

**Athena Queries**: ~40 complex queries  
**Estimated Executions**: 1 per report = ~30/month  
**Cost**: ~$0.75/month (Lambda) + ~$2-5/month (Athena)

### 4.5 Scoring Engine
**Name**: `emir-scoring-engine-{env}-{region}`  
**Runtime**: Node.js 20  
**Memory**: 512 MB  
**Timeout**: 10 minutes  

**Purpose**:
- Read all validation results from DynamoDB
- Apply weighted scoring algorithm:
  - Critical errors: -10 points
  - Major errors: -5 points
  - Minor errors: -2 points
- Calculate overall accuracy score (0-100)
- Calculate per-category scores
- Write to EmirAccuracyScores table

**Estimated Executions**: 1 per report = ~30/month  
**Cost**: ~$0.10/month

### 4.6 Report Generator
**Name**: `emir-report-generator-{env}-{region}`  
**Runtime**: Node.js 20  
**Memory**: 3008 MB (max - for PDF generation)  
**Timeout**: 15 minutes  
**Layers**: 
- PDF generation (puppeteer or reportlab)
- Excel generation (exceljs)
- Chart generation (chart.js)

**Purpose**:
- Generate executive summary PDF
- Generate detailed Excel workbook
- Generate charts (pie, bar, line, heatmap)
- Export CSV data files
- Upload all to reports bucket
- Send EventBridge completion event

**Outputs**:
- executive-summary.pdf (1-2 pages)
- detailed-analysis.xlsx (6 sheets)
- data/*.csv (3 files)
- charts/*.png (4 charts)

**Estimated Executions**: 1 per report = ~30/month  
**Cost**: ~$1-2/month (larger memory + execution time)

---

## 5. Orchestration (AWS Step Functions)

### Step Function State Machine
**Name**: `EmirValidationPipeline-{Environment}-{RegionCode}`

**Flow**:
```
Start
  ↓
Phase 1: Data Profiling (data-loader already ran)
  ↓
Phase 2-4: Parallel Execution
  ├─ Phase 2: Completeness Validation
  ├─ Phase 3: Format Validation
  └─ Phase 4: Logical Validation
  ↓
Wait for all 3 to complete
  ↓
Phase 5: Scoring Calculation
  ↓
Phase 6: Report Generation
  ↓
Phase 7: Notification (EventBridge event)
  ↓
End
```

**Error Handling**:
- Retry each Lambda 3 times with exponential backoff
- Catch failures and update DynamoDB status
- Send failure notification

**Execution Time**: ~30-45 minutes per report  
**Estimated Executions**: 30/month  
**Cost**: ~$1-2/month

---

## 6. Analytics (AWS Athena)

### Athena Workgroup
**Name**: `emir-analytics-{env}`  
**Output Location**: `s3://emir-athena-results-{env}-{region}-{account}/`

**Configuration**:
- Engine: Athena v3
- Query result encryption: SSE-S3
- Cost control: 100 GB data scan per day limit
- CloudWatch metrics: Enabled

**Estimated Usage**:
- Queries per report: ~120 queries
- Data scanned per report: ~2 GB (with partitioning)
- Monthly scans: ~60 GB
- Cost: ~$0.30/month ($5 per TB scanned)

---

## 7. Events (Amazon EventBridge)

### Event Bus
**Name**: `emir-event-bus-{env}`

### Event Rules
1. **Report Complete**: 
   - Source: `emir.reporting`
   - Detail-type: `ReportGenerationComplete`
   - Target: SNS topic (email notification)

2. **Validation Error**:
   - Source: `emir.reporting`
   - Detail-type: `ValidationError`
   - Target: CloudWatch Logs

**Event Schema**:
```json
{
  "source": "emir.reporting",
  "detail-type": "ReportGenerationComplete",
  "detail": {
    "reportDate": "2025-09-25",
    "executionId": "uuid",
    "overallScore": 87.3,
    "trafficLight": "AMBER",
    "reportUrls": {
      "executive": "https://presigned-url...",
      "detailed": "https://presigned-url..."
    }
  }
}
```

**Cost**: Negligible (within free tier)

---

## 8. Monitoring (CloudWatch)

### Log Groups
```
/aws/lambda/emir-data-loader-{env}-{region}
/aws/lambda/emir-completeness-validator-{env}-{region}
/aws/lambda/emir-format-validator-{env}-{region}
/aws/lambda/emir-logical-validator-{env}-{region}
/aws/lambda/emir-scoring-engine-{env}-{region}
/aws/lambda/emir-report-generator-{env}-{region}
/aws/stepfunctions/EmirValidationPipeline-{env}
```

**Retention**: 30 days (dev), 90 days (prod)

### CloudWatch Dashboards
**Name**: `EMIR-Reporting-{Environment}`

**Widgets**:
- Pipeline execution count (daily/weekly)
- Average execution time
- Error rate by Lambda
- Accuracy score trend (line chart)
- Athena query costs
- S3 bucket sizes

### Alarms
1. Pipeline failure
2. Lambda errors > 5%
3. Execution time > 60 minutes
4. Athena cost > $10/day

**Cost**: ~$3-5/month (dashboards + alarms)

---

## 9. Notifications (SNS)

### SNS Topics
**Name**: `emir-report-notifications-{env}`

**Subscribers**:
- Email: CEO, compliance team
- SMS: (optional for critical failures)

**Messages**:
1. Report complete (with pre-signed URLs)
2. Pipeline failure
3. Critical accuracy score (<85%)

**Cost**: Negligible (within free tier)

---

## 10. API Gateway (Optional - Phase 2)

### REST API
**Name**: `emir-reporting-api-{env}`

**Endpoints**:
```
GET /reports                        # List all reports
GET /reports/{reportDate}          # Get specific report metadata
GET /reports/{reportDate}/executive # Download PDF
GET /reports/{reportDate}/detailed  # Download Excel
GET /reports/latest                # Get latest report
```

**Authentication**: API Key or Cognito

**Cost**: ~$3.50 per million requests (likely negligible)

---

## Cost Estimates

### Development Environment (Daily Reports, 1M records)
| Service | Monthly Cost |
|---------|--------------|
| S3 Storage | $5-10 |
| DynamoDB | $2-5 |
| Lambda | $3-5 |
| Athena | $1-3 |
| Step Functions | $1-2 |
| CloudWatch | $3-5 |
| EventBridge | <$1 |
| Data Transfer | $1-2 |
| **Total** | **$17-33/month** |

### Production Environment (Daily Reports, 1M records)
| Service | Monthly Cost |
|---------|--------------|
| S3 Storage | $10-20 |
| DynamoDB | $5-10 |
| Lambda | $5-10 |
| Athena | $3-5 |
| Step Functions | $2-3 |
| CloudWatch | $5-10 |
| EventBridge | <$1 |
| Data Transfer | $2-5 |
| KMS Encryption | $1 |
| **Total** | **$33-65/month** |

**Note**: Costs scale with data volume and report frequency.

---

## Security & Compliance

### Encryption
- **At Rest**: S3 (SSE-S3), DynamoDB (AWS managed)
- **In Transit**: TLS 1.2+
- **KMS**: Optional for production (add $1/month + $0.03 per 10K requests)

### IAM Roles
```
EmirDataLoaderRole-{env}
EmirValidatorRole-{env}
EmirReportGeneratorRole-{env}
EmirStepFunctionsRole-{env}
```

**Least privilege principle**: Each Lambda only has access to required resources

### Access Logging
- S3 access logs: Enabled
- CloudTrail: All API calls logged
- VPC Flow Logs: If using VPC (not needed initially)

### Data Retention
- Raw CSV: 2 years (Glacier after 90 days)
- Reports: 2 years
- DynamoDB: 2 years (TTL)
- CloudWatch Logs: 90 days (prod), 30 days (dev)

---

## Deployment Strategy

### Environment Configuration
**CDK Context** (`cdk.json`):
```json
{
  "context": {
    "environments": {
      "dev": {
        "account": "194561596031",
        "region": "us-east-1",
        "enableMonitoring": false,
        "logRetentionDays": 30
      },
      "prod": {
        "account": "194561596031",
        "region": "eu-west-1",
        "enableMonitoring": true,
        "logRetentionDays": 90,
        "enableAlarms": true
      }
    }
  }
}
```

### Stack Naming
```typescript
EmirReportingStack-Dev-USEast1
EmirReportingStack-Prod-EUWest1
```

### Deployment Commands
```bash
# Deploy to dev
cdk deploy EmirReportingStack-Dev --context env=dev

# Deploy to prod
cdk deploy EmirReportingStack-Prod --context env=prod
```

---

## Next Steps

1. ✅ Review this design
2. ✅ Approve naming conventions
3. ✅ Choose default region
4. 🔨 Create `lib/emir-config.ts` (environment configuration)
5. 🔨 Create `lib/emir-storage.ts` (S3 buckets + Athena)
6. 🔨 Create `lib/emir-database.ts` (DynamoDB tables)
7. 🔨 Create `lib/emir-glue-catalog.ts` (Data catalog)
8. 🔨 Create `lib/emir-stack.ts` (Main stack)
9. 🔨 Update `bin/aws-microservices.ts` (Add EMIR stack)
10. 🚀 Deploy and test

---

**Questions for Approval:**
1. ✅ Naming convention acceptable?
2. ✅ Default region: `us-east-1` or `eu-west-1`?
3. ✅ Start with dev environment only?
4. ✅ Any additional resources needed?

*Design Document v1.0 - 2025-11-05*

