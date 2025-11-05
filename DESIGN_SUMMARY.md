# EMIR Infrastructure - Quick Reference

## 📋 What You Need - At a Glance

### Storage (3 S3 Buckets)
```
✅ emir-raw-data-{env}-{region}-{account}      # CSV files from ESMA (partitioned)
✅ emir-reports-{env}-{region}-{account}       # Generated PDF/Excel reports  
✅ emir-athena-results-{env}-{region}-{account} # Athena query results
```

### Database (4 DynamoDB Tables)
```
✅ EmirReportRuns-{Env}-{Region}          # Track report executions
✅ EmirValidationResults-{Env}-{Region}   # Validation findings per field
✅ EmirAccuracyScores-{Env}-{Region}      # Accuracy scores & metrics
✅ EmirRecordScores-{Env}-{Region}        # Per-trade scores (errors only)
```

### Compute (6 Lambda Functions)
```
✅ emir-data-loader-{env}-{region}              # Load & validate CSV
✅ emir-completeness-validator-{env}-{region}   # Check 203 fields
✅ emir-format-validator-{env}-{region}         # Validate LEI/ISIN/UPI
✅ emir-logical-validator-{env}-{region}        # Cross-field rules
✅ emir-scoring-engine-{env}-{region}           # Calculate scores
✅ emir-report-generator-{env}-{region}         # Generate PDF/Excel
```

### Data Catalog (AWS Glue)
```
✅ Database: emir_reporting_{env}_{regioncode}
✅ Table: emir_trades (203 EMIR REFIT fields, partitioned by year/month/day)
```

### Orchestration
```
✅ Step Function: EmirValidationPipeline-{Env}-{Region}
   Phases: Data Load → Validate (parallel) → Score → Report
```

### Analytics
```
✅ Athena Workgroup: emir-analytics-{env}
```

### Events & Notifications
```
✅ EventBridge Bus: emir-event-bus-{env}
✅ SNS Topic: emir-report-notifications-{env}
```

---

## 🎯 Dynamic Naming Examples

### Development in US-EAST-1
```typescript
Environment: 'dev'
Region: 'us-east-1'
Account: '194561596031'

// Buckets (lowercase)
emir-raw-data-dev-us-east-1-194561596031
emir-reports-dev-us-east-1-194561596031

// Tables (PascalCase with region code)
EmirReportRuns-Dev-USE1
EmirValidationResults-Dev-USE1

// Lambdas (kebab-case)
emir-data-loader-dev-us-east-1
emir-completeness-validator-dev-us-east-1

// Glue (snake_case)
emir_reporting_dev_use1
```

### Production in EU-WEST-1
```typescript
Environment: 'prod'
Region: 'eu-west-1'
Account: '194561596031'

// Buckets
emir-raw-data-prod-eu-west-1-194561596031
emir-reports-prod-eu-west-1-194561596031

// Tables
EmirReportRuns-Prod-EUW1
EmirValidationResults-Prod-EUW1

// Lambdas
emir-data-loader-prod-eu-west-1
emir-completeness-validator-prod-eu-west-1

// Glue
emir_reporting_prod_euw1
```

---

## 💰 Cost Estimates

### Dev Environment (daily reports, 1M records/day)
- **S3**: $5-10/month (storage + requests)
- **DynamoDB**: $2-5/month (on-demand)
- **Lambda**: $3-5/month (6 functions)
- **Athena**: $1-3/month (query scans)
- **Step Functions**: $1-2/month (executions)
- **CloudWatch**: $3-5/month (logs + metrics)
- **Total: $17-33/month** ✅

### Prod Environment (daily reports, 1M records/day)
- **Total: $33-65/month** ✅

*Costs scale with data volume and frequency*

---

## 📊 Data Flow

```
1. CSV Upload
   ↓
   S3 (raw-data bucket) → Triggers Lambda
   ↓
2. Data Loader Lambda
   - Validates CSV header (203 columns)
   - Creates DynamoDB record
   - Starts Step Functions
   ↓
3. Step Functions Pipeline
   ↓
   ├─ Phase 2: Completeness (Athena) → DynamoDB
   ├─ Phase 3: Format (Athena + Logic) → DynamoDB
   └─ Phase 4: Logical (Athena + Logic) → DynamoDB
   ↓
4. Scoring Engine
   - Reads validation results
   - Calculates accuracy (0-100)
   - Writes scores to DynamoDB
   ↓
5. Report Generator
   - Generates PDF (executive summary)
   - Generates Excel (detailed analysis)
   - Generates charts
   - Uploads to reports bucket
   ↓
6. EventBridge Event
   ↓
7. SNS Notification (email with links)
```

---

## 🔧 Configuration Usage

### In Your CDK Stack:
```typescript
import { getEmirConfig, createNaming } from './emir-config';

export class EmirReportingStack extends Stack {
  constructor(scope: Construct, id: string, env: Environment) {
    super(scope, id);
    
    // Get environment configuration
    const config = getEmirConfig(this, env);
    const naming = createNaming(config);
    
    // Use dynamic naming
    const rawBucket = new Bucket(this, 'RawDataBucket', {
      bucketName: naming.bucket('raw-data'),
      // emir-raw-data-dev-us-east-1-194561596031
    });
    
    const reportTable = new Table(this, 'ReportRunsTable', {
      tableName: naming.table('ReportRuns'),
      // EmirReportRuns-Dev-USE1
    });
    
    const dataLoader = new Function(this, 'DataLoader', {
      functionName: naming.lambda('data-loader'),
      // emir-data-loader-dev-us-east-1
      memory: config.lambdaMemorySizes.dataLoader,
      // 512 MB for dev, 1024 MB for prod
    });
  }
}
```

---

## ✅ Review Checklist

Before we start building, please confirm:

### Naming Convention
- [ ] **Approve naming pattern?** (emir-{purpose}-{env}-{region}-{account})
- [ ] **Any changes needed?** (e.g., different prefix than "emir"?)

### Region Selection
- [ ] **Default region: us-east-1** (cheapest, most services) ✅
- [ ] **OR prefer: eu-west-1** (closer to ESMA/regulators)?
- [ ] **OR prefer: eu-central-1** (Frankfurt for GDPR)?

### Environment
- [ ] **Start with dev only?** ✅ (recommended)
- [ ] **OR create dev + prod immediately?**

### Resources
- [ ] **All required resources identified?**
- [ ] **Any additional needs?** (VPC, WAF, custom domains, etc.)
- [ ] **Cost estimates acceptable?** ($17-33/month for dev)

### Data Schema
- [ ] **203 EMIR REFIT fields sufficient?**
- [ ] **Any custom fields needed?**

---

## 🚀 Next Steps (After Approval)

### Step 1: Create Base Constructs
```bash
✅ lib/emir-config.ts        # DONE - Configuration & naming
🔨 lib/emir-storage.ts       # S3 buckets + Athena
🔨 lib/emir-database.ts      # DynamoDB tables
🔨 lib/emir-glue-catalog.ts  # Glue database + schema
```

### Step 2: Create Main Stack
```bash
🔨 lib/emir-stack.ts         # Main stack tying everything together
🔨 bin/aws-microservices.ts  # Add EMIR stack to app
```

### Step 3: Deploy Infrastructure
```bash
git add .
git commit -m "Add EMIR infrastructure"
git push origin develop
# Watch GitHub Actions deploy
```

### Step 4: Build Lambda Functions
```bash
🔨 src/emir/data-loader/
🔨 src/emir/completeness-validator/
🔨 src/emir/format-validator/
🔨 src/emir/logical-validator/
🔨 src/emir/scoring-engine/
🔨 src/emir/report-generator/
```

### Step 5: Create Step Functions Pipeline
```bash
🔨 lib/emir-pipeline.ts      # Step Functions state machine
```

### Step 6: Test & Iterate
```bash
📤 Upload sample CSV
👀 Watch pipeline execute
📊 Review generated reports
🔧 Iterate and improve
```

---

## 📚 Documentation Created

- ✅ **EMIR_INFRASTRUCTURE_DESIGN.md** - Complete 300+ line design doc
- ✅ **DESIGN_SUMMARY.md** - This quick reference (you are here)
- ✅ **lib/emir-config.ts** - Configuration & naming utilities

---

## ❓ Questions to Answer

1. **Region**: us-east-1, eu-west-1, or eu-central-1?
2. **Naming**: Any changes to "emir-" prefix?
3. **Scope**: Start with dev only, or dev + prod?
4. **Timeline**: How quickly do you need this?
5. **Data**: Do you have sample EMIR CSV to test with?

---

**Ready to start building?** 🚀

Once you approve the design, I'll create:
1. `lib/emir-storage.ts` (S3 + Athena)
2. `lib/emir-database.ts` (DynamoDB)
3. `lib/emir-glue-catalog.ts` (Data catalog)
4. `lib/emir-stack.ts` (Main stack)

Then we deploy and see your infrastructure come to life with perfect naming! ✨

