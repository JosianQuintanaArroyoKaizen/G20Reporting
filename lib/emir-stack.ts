import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Environment, getEmirConfig, createNaming } from './emir-config';
import { EmirStorage } from './emir-storage';
import { EmirDatabase } from './emir-database';
import { EmirGlueCatalog } from './emir-glue-catalog';

export interface EmirStackProps extends StackProps {
  environment: Environment;
}

/**
 * EMIR Reporting Stack
 * Main stack for EMIR accuracy reporting infrastructure
 * 
 * Creates:
 * - S3 buckets for raw data, reports, and Athena results
 * - DynamoDB tables for metadata and validation results
 * - Glue Data Catalog with 203 EMIR REFIT fields
 * - Athena workgroup for analytics
 * 
 * Future phases will add:
 * - Lambda functions (6 microservices)
 * - Step Functions pipeline
 * - EventBridge events
 * - SNS notifications
 */
export class EmirReportingStack extends Stack {
  public readonly storage: EmirStorage;
  public readonly database: EmirDatabase;
  public readonly glue: EmirGlueCatalog;

  constructor(scope: Construct, id: string, props: EmirStackProps) {
    super(scope, id, props);

    // Get environment configuration
    const config = getEmirConfig(this, props.environment);
    const naming = createNaming(config);

    // Add tags to all resources
    this.addStackTags(config);

    // ===== Phase 0.1: Storage Layer =====
    this.storage = new EmirStorage(this, 'Storage', {
      config,
      naming,
    });

    // ===== Phase 0.2: Database Layer =====
    this.database = new EmirDatabase(this, 'Database', {
      config,
      naming,
    });

    // ===== Phase 0.3: Data Catalog =====
    this.glue = new EmirGlueCatalog(this, 'GlueCatalog', {
      config,
      naming,
      rawDataBucket: this.storage.rawDataBucket,
    });

    // ===== Outputs =====
    this.createOutputs(naming);
  }

  /**
   * Add tags to all resources in the stack
   */
  private addStackTags(config: any): void {
    this.tags.setTag('Project', 'EMIR-Reporting');
    this.tags.setTag('Environment', config.environment);
    this.tags.setTag('ManagedBy', 'CDK');
    this.tags.setTag('CostCenter', 'G20-Reporting');
    this.tags.setTag('Compliance', 'EMIR-REFIT');
  }

  /**
   * Create CloudFormation outputs
   */
  private createOutputs(naming: any): void {
    // S3 Buckets
    new CfnOutput(this, 'RawDataBucketName', {
      value: this.storage.rawDataBucket.bucketName,
      description: 'S3 bucket for raw EMIR CSV files',
      exportName: `${this.stackName}-RawDataBucket`,
    });

    new CfnOutput(this, 'ReportsBucketName', {
      value: this.storage.reportsBucket.bucketName,
      description: 'S3 bucket for generated reports (PDF/Excel)',
      exportName: `${this.stackName}-ReportsBucket`,
    });

    new CfnOutput(this, 'AthenaResultsBucketName', {
      value: this.storage.athenaResultsBucket.bucketName,
      description: 'S3 bucket for Athena query results',
      exportName: `${this.stackName}-AthenaResultsBucket`,
    });

    // DynamoDB Tables
    new CfnOutput(this, 'ReportRunsTableName', {
      value: this.database.reportRunsTable.tableName,
      description: 'DynamoDB table for report execution tracking',
      exportName: `${this.stackName}-ReportRunsTable`,
    });

    new CfnOutput(this, 'ValidationResultsTableName', {
      value: this.database.validationResultsTable.tableName,
      description: 'DynamoDB table for validation results',
      exportName: `${this.stackName}-ValidationResultsTable`,
    });

    new CfnOutput(this, 'AccuracyScoresTableName', {
      value: this.database.accuracyScoresTable.tableName,
      description: 'DynamoDB table for accuracy scores',
      exportName: `${this.stackName}-AccuracyScoresTable`,
    });

    // Glue Database
    new CfnOutput(this, 'GlueDatabaseName', {
      value: this.glue.databaseName,
      description: 'Glue database name',
      exportName: `${this.stackName}-GlueDatabase`,
    });

    new CfnOutput(this, 'GlueTableName', {
      value: this.glue.tableName,
      description: 'Glue table name (203 EMIR fields)',
      exportName: `${this.stackName}-GlueTable`,
    });

    // Athena Workgroup
    new CfnOutput(this, 'AthenaWorkgroupName', {
      value: this.storage.athenaWorkgroup.name!,
      description: 'Athena workgroup for EMIR analytics',
      exportName: `${this.stackName}-AthenaWorkgroup`,
    });

    // Instructions
    new CfnOutput(this, 'NextSteps', {
      value: 'Infrastructure deployed! Next: Upload CSV to raw-data bucket to test',
      description: 'Next steps for EMIR reporting',
    });

    new CfnOutput(this, 'UploadCommand', {
      value: `aws s3 cp your-file.csv s3://${this.storage.rawDataBucket.bucketName}/year=2025/month=11/day=05/`,
      description: 'Example command to upload EMIR CSV file',
    });
  }
}

