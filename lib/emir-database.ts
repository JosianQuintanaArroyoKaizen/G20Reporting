import { RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Table, AttributeType, BillingMode, ProjectionType } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { EmirConfig, EmirNaming } from './emir-config';

export interface EmirDatabaseProps {
  config: EmirConfig;
  naming: EmirNaming;
}

/**
 * EMIR Database Construct
 * Creates DynamoDB tables for EMIR reporting metadata
 */
export class EmirDatabase extends Construct {
  public readonly reportRunsTable: Table;
  public readonly validationResultsTable: Table;
  public readonly accuracyScoresTable: Table;
  public readonly recordScoresTable: Table;

  constructor(scope: Construct, id: string, props: EmirDatabaseProps) {
    super(scope, id);

    const { config, naming } = props;

    // 1. Report Runs Table - Tracks each report execution
    this.reportRunsTable = new Table(this, 'ReportRunsTable', {
      tableName: naming.table('ReportRuns'),
      partitionKey: {
        name: 'reportDate',
        type: AttributeType.STRING, // Format: "2025-09-25"
      },
      sortKey: {
        name: 'executionId',
        type: AttributeType.STRING, // UUID
      },
      billingMode: BillingMode.PAY_PER_REQUEST, // On-demand for unpredictable load
      timeToLiveAttribute: 'ttl', // Auto-delete old records
      pointInTimeRecovery: config.environment === 'prod',
      removalPolicy: config.environment === 'dev' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    });

    // GSI: Query by status
    this.reportRunsTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: {
        name: 'status',
        type: AttributeType.STRING, // INITIATED, IN_PROGRESS, COMPLETED, FAILED
      },
      sortKey: {
        name: 'startTime',
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
    });

    // 2. Validation Results Table - Stores validation findings per field
    this.validationResultsTable = new Table(this, 'ValidationResultsTable', {
      tableName: naming.table('ValidationResults'),
      partitionKey: {
        name: 'reportExecutionId',
        type: AttributeType.STRING, // Format: "2025-09-25#uuid"
      },
      sortKey: {
        name: 'validationKey',
        type: AttributeType.STRING, // Format: "COMPLETENESS#UTI" or "FORMAT#LEI"
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: config.environment === 'prod',
      removalPolicy: config.environment === 'dev' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    });

    // GSI: Query by severity
    this.validationResultsTable.addGlobalSecondaryIndex({
      indexName: 'SeverityIndex',
      partitionKey: {
        name: 'reportExecutionId',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'errorSeverity',
        type: AttributeType.STRING, // CRITICAL, MAJOR, MINOR
      },
      projectionType: ProjectionType.ALL,
    });

    // GSI: Query by validation type
    this.validationResultsTable.addGlobalSecondaryIndex({
      indexName: 'ValidationTypeIndex',
      partitionKey: {
        name: 'validationType',
        type: AttributeType.STRING, // COMPLETENESS, FORMAT, LOGICAL
      },
      sortKey: {
        name: 'validationTimestamp',
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.KEYS_ONLY,
    });

    // 3. Accuracy Scores Table - Overall accuracy scores and metrics
    this.accuracyScoresTable = new Table(this, 'AccuracyScoresTable', {
      tableName: naming.table('AccuracyScores'),
      partitionKey: {
        name: 'reportExecutionId',
        type: AttributeType.STRING, // Format: "2025-09-25#uuid"
      },
      sortKey: {
        name: 'scoreType',
        type: AttributeType.STRING, // OVERALL, CATEGORY, FIELD
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: config.environment === 'prod',
      removalPolicy: config.environment === 'dev' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    });

    // GSI: Query by category
    this.accuracyScoresTable.addGlobalSecondaryIndex({
      indexName: 'CategoryIndex',
      partitionKey: {
        name: 'categoryName',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'calculationTimestamp',
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
    });

    // GSI: Time series queries (for trend analysis)
    this.accuracyScoresTable.addGlobalSecondaryIndex({
      indexName: 'TimeSeriesIndex',
      partitionKey: {
        name: 'scoreType',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'calculationTimestamp',
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
    });

    // 4. Record Scores Table - Per-trade scores (only for records with errors)
    this.recordScoresTable = new Table(this, 'RecordScoresTable', {
      tableName: naming.table('RecordScores'),
      partitionKey: {
        name: 'reportExecutionId',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'uti',
        type: AttributeType.STRING, // Trade identifier
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: config.environment === 'prod',
      removalPolicy: config.environment === 'dev' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    });

    // GSI: Query by accuracy score (find worst records)
    this.recordScoresTable.addGlobalSecondaryIndex({
      indexName: 'AccuracyScoreIndex',
      partitionKey: {
        name: 'reportExecutionId',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'accuracyScore',
        type: AttributeType.NUMBER,
      },
      projectionType: ProjectionType.ALL,
    });
  }

  /**
   * Set TTL for records (auto-delete after specified period)
   */
  public static calculateTTL(days: number): number {
    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    return now + (days * 24 * 60 * 60); // Add days in seconds
  }

  /**
   * Grant read/write access to all tables
   */
  public grantFullAccess(grantee: any): void {
    this.reportRunsTable.grantReadWriteData(grantee);
    this.validationResultsTable.grantReadWriteData(grantee);
    this.accuracyScoresTable.grantReadWriteData(grantee);
    this.recordScoresTable.grantReadWriteData(grantee);
  }

  /**
   * Grant read-only access to all tables
   */
  public grantReadAccess(grantee: any): void {
    this.reportRunsTable.grantReadData(grantee);
    this.validationResultsTable.grantReadData(grantee);
    this.accuracyScoresTable.grantReadData(grantee);
    this.recordScoresTable.grantReadData(grantee);
  }
}

